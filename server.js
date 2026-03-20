const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

const COLOR_NAMES = ["Red", "Blue", "Yellow", "Green", "Pink"];
const NUTRIENTS = ["Sticks", "Leaves", "Resin"];
const NUTRIENT_DATA = [
    { val: 0, type: "None" }, 
    { val: 1, type: "Sticks" }, { val: 4, type: "Sticks" }, { val: 7, type: "Sticks" },
    { val: 2, type: "Leaves" }, { val: 5, type: "Leaves" }, { val: 8, type: "Leaves" },
    { val: -3, type: "Resin" }, { val: 3, type: "Resin" }, { val: 6, type: "Resin" }
];

// --- Utilities ---
function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// --- Logic Classes ---
class Card {
    constructor(owner, target, value, n_type) {
        this.owner = owner;
        this.target = target;
        this.value = value;
        this.n_type = n_type;
        this.selectedForDiscard = false;
    }
}

class Player {
    constructor(name, isBot = true, socketId = null) {
        this.name = name;
        this.isBot = isBot;
        this.socketId = socketId;
        this.rootDepth = 0;
        this.saplingHeight = 0;
        this.hungerContrib = 0;
        this.hand = [];
        this.deck = [];
        this.availableMarks = COLOR_NAMES.filter(c => c !== name);
        this.pastMarks = [];
        this.currentMark = null;
        this.playedCard = null;
        this.defying = false;

        let rivals = COLOR_NAMES.filter(c => c !== this.name);
        rivals.forEach(rival => {
            NUTRIENT_DATA.forEach(data => {
                this.deck.push(new Card(this.name, rival, data.val, data.type));
            });
        });
        shuffle(this.deck);
    }

    sortHand() {
        this.hand.sort((a, b) => {
            const targetA = COLOR_NAMES.indexOf(a.target);
            const targetB = COLOR_NAMES.indexOf(b.target);
            if (targetA !== targetB) return targetA - targetB;
            return a.value - b.value;
        });
    }
}

let rooms = {};

// --- Bot Action Logic ---
function botDecideMark(bot) {
    if (bot.currentMark) return;
    const choice = bot.availableMarks[Math.floor(Math.random() * bot.availableMarks.length)];
    bot.currentMark = choice;
    bot.pastMarks.push(choice);
    bot.availableMarks = bot.availableMarks.filter(m => m !== choice);
}

function botDecidePlay(bot, hunger) {
    if (bot.playedCard) return;
    bot.hand.sort((a, b) => {
        let scoreA = (a.n_type === hunger ? a.value : 0) - (a.target === bot.currentMark ? a.value * 2 : 0);
        let scoreB = (b.n_type === hunger ? b.value : 0) - (b.target === bot.currentMark ? b.value * 2 : 0);
        return scoreB - scoreA;
    });
    bot.playedCard = bot.hand.splice(0, 1)[0];
}

function botDecideDiscard(bot) {
    if (bot.hand.length <= 10) return;
    // Discard the 5 highest value cards that help rivals (not strategically ideal but fast)
    bot.hand.sort((a, b) => b.value - a.value);
    bot.hand.splice(0, 5);
    bot.sortHand();
}

// --- Room Management ---
function setRoomTimer(room, seconds) {
    room.timerStart = Date.now();
    room.timeoutDuration = seconds * 1000;
}

function startAge(room) {
    room.round = 1;
    room.players.forEach(p => {
        p.currentMark = null;
        p.playedCard = null;
        p.saplingHeight = 0;
        p.hungerContrib = 0;
        for (let i = 0; i < 10; i++) {
            if (p.deck.length > 0) p.hand.push(p.deck.pop());
        }
        p.sortHand();
    });

    if (room.age === 1) {
        room.state = "MARK";
        setRoomTimer(room, 60); // 1 min for Mark
        room.players.filter(p => p.isBot).forEach(bot => botDecideMark(bot));
    } else {
        room.state = "DISCARD";
        setRoomTimer(room, 120); // 2 mins for Discard
        room.players.filter(p => p.isBot).forEach(bot => botDecideDiscard(bot));
    }
    broadcastState(room.id);
}

function resolveRound(room) {
    room.state = "REVEAL";
    room.players.forEach(p => p.defying = (p.playedCard && p.playedCard.value === 0));

    room.players.forEach(p => {
        if (!p.playedCard) return;
        const card = p.playedCard;
        const target = room.players.find(t => t.name === card.target);
        if (card.n_type === room.hunger) p.hungerContrib += card.value;
        if (target && !target.defying) target.saplingHeight += card.value;
    });

    setTimeout(() => {
        if (room.round >= 5) {
            calculateAgeScoring(room);
        } else {
            room.round++;
            room.players.forEach(p => p.playedCard = null);
            room.state = "DECIDE";
            setRoomTimer(room, 60); // 1 min for Round play
            room.players.filter(p => p.isBot || !p.socketId).forEach(p => botDecidePlay(p, room.hunger));
            broadcastState(room.id);
        }
    }, 3000);
}

function calculateAgeScoring(room) {
    room.state = "SUMMARY";
    let heights = room.players.map(p => ({ name: p.name, val: p.saplingHeight }));
    heights.sort((a, b) => a.val - b.val);

    let minH = Math.min(...heights.map(h => h.val));
    let shortestPlayers = heights.filter(h => h.val === minH);
    let uniqueShortest = (shortestPlayers.length === 1) ? shortestPlayers[0].name : null;
    let markWinners = [];

    if (uniqueShortest) {
        room.players.forEach(p => {
            if (p.currentMark === uniqueShortest) {
                p.rootDepth += 10;
                markWinners.push(p.name);
            }
        });
    }

    let hungers = room.players.map(p => ({ name: p.name, val: p.hungerContrib }));
    hungers.sort((a, b) => b.val - a.val);

    let hWinner = null;
    if (hungers.length > 1 && hungers[0].val > hungers[1].val) {
        hWinner = hungers[0].name;
        room.players.find(p => p.name === hWinner).rootDepth += 15;
    }

    let minHunger = Math.min(...hungers.map(h => h.val));
    let hLosers = hungers.filter(h => h.val === minHunger).map(h => h.name);
    hLosers.forEach(name => {
        room.players.find(p => p.name === name).rootDepth -= 8;
    });

    room.players.forEach(p => p.rootDepth += p.saplingHeight);

    room.summaryData = {
        heights: heights, hungers: hungers, shortestName: uniqueShortest,
        markWinners: markWinners, hWinner: hWinner, hLosers: hLosers
    };
    broadcastState(room.id);
}

function checkReady(room) {
    const activeHumans = room.players.filter(p => !p.isBot && p.socketId !== null);
    
    if (room.state === "DISCARD") {
        if (activeHumans.every(h => h.hand.length === 10)) {
            room.state = "MARK";
            setRoomTimer(room, 60);
            room.players.filter(p => p.isBot || !p.socketId).forEach(p => botDecideMark(p));
        }
    } else if (room.state === "MARK") {
        if (activeHumans.every(h => h.currentMark !== null)) {
            room.state = "DECIDE";
            setRoomTimer(room, 60);
            room.players.filter(p => p.isBot || !p.socketId).forEach(p => botDecidePlay(p, room.hunger));
        }
    } else if (room.state === "DECIDE") {
        if (activeHumans.every(h => h.playedCard !== null)) {
            resolveRound(room);
        }
    }
    broadcastState(room.id);
}

function broadcastState(roomId) {
    const room = rooms[roomId];
    if (room) {
        room.timeLeft = Math.max(0, Math.ceil((room.timeoutDuration - (Date.now() - room.timerStart)) / 1000));
        io.to(roomId).emit('gameState', room);
    }
}

// --- Socket Events ---
io.on('connection', (socket) => {
    socket.on('joinRoom', (roomId) => {
        socket.join(roomId);
        if (!rooms[roomId]) {
            rooms[roomId] = {
                id: roomId, players: [], age: 1, round: 1, hunger: "Sticks",
                state: "LOBBY", logs: ["Network Online."], summaryData: {},
                timerStart: Date.now(), timeoutDuration: 0
            };
        }
        const room = rooms[roomId];

        // Rejoin Logic: Check if a "vacant" human player exists
        let existingPlayer = room.players.find(p => !p.isBot && p.socketId === null);
        if (existingPlayer) {
            existingPlayer.socketId = socket.id;
            socket.emit('assignedColor', existingPlayer.name);
            room.logs.push(`${existingPlayer.name} has reconnected.`);
        } else if (room.state === "LOBBY" && room.players.length < 5) {
            const color = COLOR_NAMES[room.players.length];
            room.players.push(new Player(color, false, socket.id));
            socket.emit('assignedColor', color);
            room.logs.push(`${color} tree joined.`);
        }
        
        socket.emit('gameState', room);
        broadcastState(roomId);
    });

    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if (!room || room.state !== "LOBBY") return;
        while (room.players.length < 5) {
            const color = COLOR_NAMES[room.players.length];
            room.players.push(new Player(color, true, null));
        }
        room.hunger = NUTRIENTS[Math.floor(Math.random() * NUTRIENTS.length)];
        startAge(room);
    });

    socket.on('selectMark', (data) => {
        const room = rooms[data.roomId];
        const p = room.players.find(p => p.socketId === socket.id);
        if (p && room.state === "MARK" && !p.currentMark) {
            p.currentMark = data.mark;
            p.pastMarks.push(data.mark);
            p.availableMarks = p.availableMarks.filter(m => m !== data.mark);
            checkReady(room);
        }
    });

    socket.on('playCard', (data) => {
        const room = rooms[data.roomId];
        const p = room.players.find(p => p.socketId === socket.id);
        if (p && room.state === "DECIDE" && !p.playedCard) {
            p.playedCard = p.hand.splice(data.cardIndex, 1)[0];
            checkReady(room);
        }
    });

    socket.on('submitDiscard', (data) => {
        const room = rooms[data.roomId];
        const p = room.players.find(p => p.socketId === socket.id);
        if (p && room.state === "DISCARD" && p.hand.length > 10) {
            p.hand = p.hand.filter((_, idx) => !data.discardIndices.includes(idx));
            p.sortHand();
            checkReady(room);
        }
    });

    socket.on('nextAge', (roomId) => {
        const room = rooms[roomId];
        if (room && room.state === "SUMMARY") {
            if (room.age >= 4) {
                room.state = "GAMEOVER";
            } else {
                room.age++;
                room.hunger = NUTRIENTS[Math.floor(Math.random() * NUTRIENTS.length)];
                startAge(room);
            }
            broadcastState(roomId);
        }
    });

    socket.on('disconnect', () => {
        for (let rid in rooms) {
            let p = rooms[rid].players.find(p => p.socketId === socket.id);
            if (p) {
                p.socketId = null; // Mark as vacant
                rooms[rid].logs.push(`${p.name} disconnected. Network auto-feeding enabled.`);
                // If everyone left is a bot/vacant, the game will progress via the timeout loop
                break;
            }
        }
    });
});

// --- Heartbeat Loop: Runs every second to check for Timeouts ---
setInterval(() => {
    for (let rid in rooms) {
        const room = rooms[rid];
        if (room.state === "LOBBY" || room.state === "SUMMARY" || room.state === "REVEAL" || room.state === "GAMEOVER") continue;

        const now = Date.now();
        const timedOut = (now - room.timerStart) > room.timeoutDuration;

        // Force bot moves for anyone who hasn't acted (Bots, Disconnected Humans, or Slow Humans)
        let forcedAction = false;
        room.players.forEach(p => {
            const needsToAct = (room.state === "MARK" && !p.currentMark) || 
                               (room.state === "DECIDE" && !p.playedCard) || 
                               (room.state === "DISCARD" && p.hand.length > 10);

            // If timed out, EVERYONE who hasn't acted is forced. 
            // If disconnected, force immediately to keep game moving if lobby is mix of bots/humans
            const shouldForce = timedOut || (p.socketId === null && !p.isBot);

            if (needsToAct && shouldForce) {
                if (room.state === "MARK") botDecideMark(p);
                if (room.state === "DECIDE") botDecidePlay(p, room.hunger);
                if (room.state === "DISCARD") botDecideDiscard(p);
                forcedAction = true;
            }
        });

        if (forcedAction || timedOut) {
            checkReady(room);
        } else {
            // Just update the countdown for the client
            broadcastState(rid);
        }
    }
}, 1000);

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Mother Tree Server active on ${PORT}`));
