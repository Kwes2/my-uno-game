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

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

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
        this.isDisconnected = false;
        this.isAutoBot = isBot;
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

// --- ATOMIC ACTION EXECUTION ---

/**
 * The single source of truth for marking. 
 * Prevents double-marking and duplicate history entries.
 */
function applyMark(player, mark) {
    if (player.currentMark !== null) return false; // Atomic lock: already marked this age
    if (!player.availableMarks.includes(mark)) return false; // Safety check

    player.currentMark = mark;
    player.pastMarks.push(mark);
    player.availableMarks = player.availableMarks.filter(m => m !== mark);
    return true;
}

function executeDiscard(player) {
    if (player.hand.length <= 10) return; 
    player.hand.sort((a, b) => b.value - a.value);
    player.hand.splice(0, 5);
    player.sortHand();
}

function executeMark(player) {
    if (player.currentMark !== null) return;
    const choice = player.availableMarks[Math.floor(Math.random() * player.availableMarks.length)];
    applyMark(player, choice);
}

function executePlay(player, hunger) {
    if (player.playedCard !== null) return;
    player.hand.sort((a, b) => {
        let scoreA = (a.n_type === hunger ? a.value : 0) - (a.target === player.currentMark ? a.value * 2 : 0);
        let scoreB = (b.n_type === hunger ? b.value : 0) - (b.target === player.currentMark ? b.value * 2 : 0);
        return scoreB - scoreA;
    });
    player.playedCard = player.hand.splice(0, 1)[0];
}

// --- GAME ENGINE ---

function startAge(room) {
    room.round = 1;
    room.phaseStartTime = Date.now();
    
    room.players.forEach(p => {
        p.currentMark = null; // Clear current mark for the new age
        p.playedCard = null;
        p.saplingHeight = 0;
        p.hungerContrib = 0;
        
        // Draw 10 cards. Race condition protected by state lock in nextAge handler
        const drawAmount = 10;
        for (let i = 0; i < drawAmount; i++) {
            if (p.deck.length > 0) p.hand.push(p.deck.pop());
        }
        p.sortHand();
    });

    if (room.age === 1) {
        room.state = "MARK";
        room.players.filter(p => p.isAutoBot).forEach(bot => executeMark(bot));
    } else {
        room.state = "DISCARD";
        room.players.filter(p => p.isAutoBot).forEach(bot => executeDiscard(bot));
    }
    broadcastState(room.id);
}

function resolveRound(room) {
    room.state = "REVEAL";
    
    room.players.forEach(p => {
        p.defying = (p.playedCard.value === 0);
    });

    room.players.forEach(p => {
        const card = p.playedCard;
        const target = room.players.find(t => t.name === card.target);

        if (card.n_type === room.hunger) {
            p.hungerContrib += card.value;
        }

        if (target && !target.defying) {
            target.saplingHeight += card.value;
        } else if (target && target.defying) {
            room.logs.push(`${target.name} defied the network and blocked ${p.name}'s nutrients!`);
        }
    });

    setTimeout(() => {
        if (room.round >= 5) {
            calculateAgeScoring(room);
        } else {
            room.round++;
            room.players.forEach(p => p.playedCard = null);
            room.state = "DECIDE";
            room.phaseStartTime = Date.now();
            room.players.filter(p => p.isAutoBot).forEach(bot => executePlay(bot, room.hunger));
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
    if (hungers[0].val > hungers[1].val) {
        hWinner = hungers[0].name;
        room.players.find(p => p.name === hWinner).rootDepth += 15;
    }

    let minHunger = Math.min(...hungers.map(h => h.val));
    let hLosers = hungers.filter(h => h.val === minHunger).map(h => h.name);
    hLosers.forEach(name => {
        room.players.find(p => p.name === name).rootDepth -= 8;
    });

    room.players.forEach(p => {
        p.rootDepth += p.saplingHeight;
    });

    room.summaryData = {
        heights: heights,
        hungers: hungers,
        shortestName: uniqueShortest,
        markWinners: markWinners,
        hWinner: hWinner,
        hLosers: hLosers
    };

    broadcastState(room.id);
}

function checkReady(room) {
    if (room.state === "DISCARD") {
        if (room.players.every(p => p.hand.length === 10)) {
            room.state = "MARK";
            room.phaseStartTime = Date.now();
            room.players.filter(p => p.isAutoBot).forEach(bot => executeMark(bot));
        }
    } else if (room.state === "MARK") {
        if (room.players.every(p => p.currentMark !== null)) {
            room.state = "DECIDE";
            room.phaseStartTime = Date.now();
            room.players.filter(p => p.isAutoBot).forEach(bot => executePlay(bot, room.hunger));
        }
    } else if (room.state === "DECIDE") {
        if (room.players.every(p => p.playedCard !== null)) {
            resolveRound(room);
        }
    }
    broadcastState(room.id);
}

// --- TICK MANAGER ---

setInterval(() => {
    const now = Date.now();
    for (let roomId in rooms) {
        const room = rooms[roomId];
        if (["LOBBY", "REVEAL", "SUMMARY", "GAMEOVER"].includes(room.state)) continue;

        let timeout = (room.state === "DISCARD") ? 120000 : 60000;
        if (now - room.phaseStartTime > timeout) {
            room.players.forEach(p => {
                if (!p.isBot && !p.isAutoBot) {
                    let inactive = false;
                    if (room.state === "DISCARD" && p.hand.length > 10) inactive = true;
                    if (room.state === "MARK" && !p.currentMark) inactive = true;
                    if (room.state === "DECIDE" && !p.playedCard) inactive = true;
                    
                    if (inactive) {
                        p.isAutoBot = true;
                        room.logs.push(`${p.name} timed out. The Network has taken control.`);
                    }
                }

                if (p.isAutoBot) {
                    if (room.state === "DISCARD") executeDiscard(p);
                    if (room.state === "MARK") executeMark(p);
                    if (room.state === "DECIDE") executePlay(p, room.hunger);
                }
            });
            checkReady(room);
        }
    }
}, 1000);

function broadcastState(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    io.to(roomId).emit('gameState', room);
}

// --- SOCKET HANDLERS ---

io.on('connection', (socket) => {
    socket.on('joinRoom', (roomId) => {
        socket.join(roomId);
        if (!rooms[roomId]) {
            rooms[roomId] = {
                id: roomId, players: [], age: 1, round: 1, hunger: "Sticks",
                state: "LOBBY", logs: ["Welcome to the Network."], summaryData: {},
                phaseStartTime: Date.now()
            };
        }
        const room = rooms[roomId];
        
        if (room.state !== "LOBBY") {
            const disconnectedPlayer = room.players.find(p => p.isDisconnected && !p.isBot);
            if (disconnectedPlayer) {
                disconnectedPlayer.socketId = socket.id;
                disconnectedPlayer.isDisconnected = false;
                disconnectedPlayer.isAutoBot = false;
                socket.emit('assignedColor', disconnectedPlayer.name);
                room.logs.push(`${disconnectedPlayer.name} has re-connected.`);
            }
        } else if (room.players.length < 5) {
            const color = COLOR_NAMES[room.players.length];
            room.players.push(new Player(color, false, socket.id));
            socket.emit('assignedColor', color);
            room.logs.push(`${color} tree has taken root.`);
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
        if (p && room.state === "MARK") {
            // ApplyMark is atomic. It will return false if they already marked.
            if (applyMark(p, data.mark)) {
                p.isAutoBot = false; 
                checkReady(room);
            }
        }
    });

    socket.on('playCard', (data) => {
        const room = rooms[data.roomId];
        const p = room.players.find(p => p.socketId === socket.id);
        if (p && room.state === "DECIDE" && !p.playedCard) {
            p.isAutoBot = false;
            p.playedCard = p.hand.splice(data.cardIndex, 1)[0];
            checkReady(room);
        }
    });

    socket.on('submitDiscard', (data) => {
        const room = rooms[data.roomId];
        const p = room.players.find(p => p.socketId === socket.id);
        if (p && room.state === "DISCARD" && p.hand.length > 10) {
            p.isAutoBot = false;
            p.hand = p.hand.filter((_, idx) => !data.discardIndices.includes(idx));
            p.sortHand();
            checkReady(room);
        }
    });

    socket.on('nextAge', (roomId) => {
        const room = rooms[roomId];
        if (!room) return;

        // STATE LOCK: Prevent double-triggering nextAge
        if (room.state !== "SUMMARY") return;

        if (room.age >= 4) {
            room.state = "GAMEOVER";
        } else {
            room.age++;
            room.hunger = NUTRIENTS[Math.floor(Math.random() * NUTRIENTS.length)];
            startAge(room);
        }
        broadcastState(roomId);
    });

    socket.on('disconnect', () => {
        for (let roomId in rooms) {
            const room = rooms[roomId];
            const p = room.players.find(p => p.socketId === socket.id);
            if (p) {
                p.isDisconnected = true;
                p.isAutoBot = true;
                room.logs.push(`${p.name} lost connection.`);
                broadcastState(roomId);
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Mother Tree Server active on ${PORT}`));
