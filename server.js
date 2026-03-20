const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

// --- CONSTANTS (Exact match to Python version) ---
const COLOR_NAMES = ["Red", "Blue", "Yellow", "Green", "Pink"];
const NUTRIENTS = ["Sticks", "Leaves", "Resin"];
const NUTRIENT_DATA = [
    { val: 0, type: "None" }, { val: 1, type: "Sticks" }, { val: 4, type: "Sticks" }, { val: 7, type: "Sticks" },
    { val: 2, type: "Leaves" }, { val: 5, type: "Leaves" }, { val: 8, type: "Leaves" },
    { val: -3, type: "Resin" }, { val: 3, type: "Resin" }, { val: 6, type: "Resin" }
];

// --- UTILS ---
function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// --- CORE CLASSES ---
class Card {
    constructor(owner, target, value, n_type) {
        this.owner = owner;
        this.target = target;
        this.value = value;
        this.n_type = n_type;
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

        // Build deck: 10 cards for every rival (Total 40 cards)
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
            // Sort by: Target Color Index, then Value, then Nutrient Type Index
            const targetA = COLOR_NAMES.indexOf(a.target);
            const targetB = COLOR_NAMES.indexOf(b.target);
            if (targetA !== targetB) return targetA - targetB;
            if (a.value !== b.value) return a.value - b.value;
            return NUTRIENTS.indexOf(a.n_type) - NUTRIENTS.indexOf(b.n_type);
        });
    }
}

let rooms = {};

// --- BOT AI LOGIC ---
function evaluateBotCard(bot, card, hunger) {
    let score = card.value;
    if (card.n_type === hunger) score += 6; // Bots prefer contributing to hunger
    if (card.target === bot.currentMark) score -= 15; // Bots avoid helping their Mark
    return score;
}

// --- ENGINE FUNCTIONS ---

function startAge(room) {
    room.round = 1;
    room.players.forEach(p => {
        p.currentMark = null;
        p.playedCard = null;
        p.saplingHeight = 0;
        p.hungerContrib = 0;
        // Draw 10 cards
        for (let i = 0; i < 10; i++) {
            if (p.deck.length > 0) p.hand.push(p.deck.pop());
        }
        p.sortHand();
    });

    room.state = (room.age === 1) ? "MARK" : "DISCARD";

    // Auto-handle bots for the first step of the Age
    if (room.state === "DISCARD") {
        room.players.filter(p => p.isBot).forEach(bot => {
            // Bot discards the 5 cards with the lowest evaluation
            bot.hand.sort((a, b) => evaluateBotCard(bot, a, room.hunger) - evaluateBotCard(bot, b, room.hunger));
            bot.hand.splice(0, 5);
            bot.sortHand();
        });
    } else if (room.state === "MARK") {
        room.players.filter(p => p.isBot).forEach(bot => {
            let choice = bot.availableMarks[Math.floor(Math.random() * bot.availableMarks.length)];
            bot.currentMark = choice;
            bot.pastMarks.push(choice);
            bot.availableMarks = bot.availableMarks.filter(m => m !== choice);
        });
    }
}

function resolveRound(room) {
    room.state = "REVEAL";
    
    // 1. Identify "Defiers" (Played a 0 card)
    room.players.forEach(p => p.defying = (p.playedCard.value === 0));

    // 2. Calculate Impacts
    room.players.forEach(p => {
        const c = p.playedCard;
        const target = room.players.find(t => t.name === c.target);
        
        // Feed the Mother Tree
        if (c.n_type === room.hunger) p.hungerContrib += c.value;
        
        // Attack/Help Sapling (Blocked if target is Defying)
        if (!target.defying) target.saplingHeight += c.value;
    });

    room.logs.push(`Round ${room.round} resolved.`);

    // 4 second delay to see the cards before cleaning up or ending age
    setTimeout(() => {
        if (room.round >= 5) {
            calculateAgeScoring(room);
        } else {
            room.round++;
            room.players.forEach(p => p.playedCard = null);
            room.state = "DECIDE";
            
            // Bots decide immediately for next round
            room.players.filter(p => p.isBot).forEach(bot => {
                bot.hand.sort((a, b) => evaluateBotCard(bot, b, room.hunger) - evaluateBotCard(bot, a, room.hunger));
                bot.playedCard = bot.hand.splice(0, 1)[0];
            });
            broadcastState(room.id);
        }
    }, 4000);
}

function calculateAgeScoring(room) {
    room.state = "SUMMARY";
    
    // Prepare Summary Data for Client
    let heights = room.players.map(p => ({ name: p.name, val: p.saplingHeight }));
    heights.sort((a, b) => b.val - a.val);
    
    // Mark Bonus: Unique Shortest logic
    let minH = Math.min(...room.players.map(p => p.saplingHeight));
    let shortest = room.players.filter(p => p.saplingHeight === minH);
    let uniqueShortestName = (shortest.length === 1) ? shortest[0].name : null;
    let markWinners = [];

    if (uniqueShortestName) {
        room.players.forEach(p => {
            if (p.currentMark === uniqueShortestName) {
                p.rootDepth += 10;
                markWinners.push(p.name);
            }
        });
    }

    // Hunger Rewards/Penalties
    let hungers = room.players.map(p => ({ name: p.name, val: p.hungerContrib }));
    hungers.sort((a, b) => b.val - a.val);
    
    let hWinner = null;
    if (hungers[0].val > hungers[1].val) {
        let winnerObj = room.players.find(p => p.name === hungers[0].name);
        winnerObj.rootDepth += 15;
        hWinner = winnerObj.name;
    }

    let minHungerVal = Math.min(...room.players.map(p => p.hungerContrib));
    let hLosers = room.players.filter(p => p.hungerContrib === minHungerVal).map(p => p.name);
    
    room.players.forEach(p => {
        if (hLosers.includes(p.name)) p.rootDepth -= 8;
        // Total Age conversion
        p.rootDepth += p.saplingHeight;
    });

    room.summaryData = {
        heights: heights,
        hungers: hungers,
        shortestName: uniqueShortestName,
        markWinners: markWinners,
        hWinner: hWinner,
        hLosers: hLosers
    };

    broadcastState(room.id);
}

// --- SOCKETS ---

io.on('connection', (socket) => {
    socket.on('joinRoom', (roomId) => {
        socket.join(roomId);
        if (!rooms[roomId]) {
            rooms[roomId] = {
                id: roomId, players: [], age: 1, round: 1, hunger: "Sticks", 
                state: "LOBBY", logs: ["Waiting for saplings..."], summaryData: {}
            };
        }
        const room = rooms[roomId];
        if (room.state === "LOBBY" && room.players.length < 5) {
            const color = COLOR_NAMES[room.players.length];
            room.players.push(new Player(color, false, socket.id));
            socket.emit('assignedColor', color);
            room.logs.push(`${color} joined.`);
        }
        broadcastState(roomId);
    });

    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if (!room) return;
        while (room.players.length < 5) {
            const color = COLOR_NAMES[room.players.length];
            room.players.push(new Player(color, true, null));
        }
        room.hunger = NUTRIENTS[Math.floor(Math.random() * NUTRIENTS.length)];
        startAge(room);
        broadcastState(roomId);
    });

    socket.on('submitDiscard', (data) => {
        const room = rooms[data.roomId];
        const p = room.players.find(p => p.socketId === socket.id);
        if (p && room.state === "DISCARD") {
            p.hand = p.hand.filter((_, idx) => !data.discardIndices.includes(idx));
            p.sortHand();
            checkReady(room);
        }
    });

    socket.on('selectMark', (data) => {
        const room = rooms[data.roomId];
        const p = room.players.find(p => p.socketId === socket.id);
        if (p && room.state === "MARK") {
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
});

function checkReady(room) {
    const humans = room.players.filter(p => !p.isBot);

    if (room.state === "DISCARD") {
        if (humans.every(h => h.hand.length === 5)) {
            room.state = "MARK";
            // Bots mark now
            room.players.filter(p => p.isBot).forEach(bot => {
                let choice = bot.availableMarks[Math.floor(Math.random() * bot.availableMarks.length)];
                bot.currentMark = choice;
                bot.pastMarks.push(choice);
                bot.availableMarks = bot.availableMarks.filter(m => m !== choice);
            });
        }
    } else if (room.state === "MARK") {
        if (humans.every(h => h.currentMark !== null)) {
            room.state = "DECIDE";
            // Bots pick cards for Round 1
            room.players.filter(p => p.isBot).forEach(bot => {
                bot.hand.sort((a, b) => evaluateBotCard(bot, b, room.hunger) - evaluateBotCard(bot, a, room.hunger));
                bot.playedCard = bot.hand.splice(0, 1)[0];
            });
        }
    } else if (room.state === "DECIDE") {
        if (humans.every(h => h.playedCard !== null)) {
            resolveRound(room);
        }
    }
    broadcastState(room.id);
}

function broadcastState(roomId) {
    io.to(roomId).emit('gameState', rooms[roomId]);
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Mother Tree Server logic active on port ${PORT}`));
