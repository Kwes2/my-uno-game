const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

// --- CONSTANTS (Ported from Mother Tree Python) ---
const COLOR_NAMES = ["Red", "Blue", "Yellow", "Green", "Pink"];
const NUTRIENTS = ["Sticks", "Leaves", "Resin"];
const NUTRIENT_DATA = [
    { val: 0, type: "None" }, { val: 1, type: "Sticks" }, { val: 4, type: "Sticks" }, { val: 7, type: "Sticks" },
    { val: 2, type: "Leaves" }, { val: 5, type: "Leaves" }, { val: 8, type: "Leaves" },
    { val: -3, type: "Resin" }, { val: 3, type: "Resin" }, { val: 6, type: "Resin" }
];

// --- HELPER: Shuffle ---
function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// --- CLASSES ---
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

        // Initialize Deck: Every card vs every rival for all nutrient values
        let rivals = COLOR_NAMES.filter(c => c !== this.name);
        rivals.forEach(rival => {
            NUTRIENT_DATA.forEach(data => {
                this.deck.push(new Card(this.name, rival, data.val, data.type));
            });
        });
        shuffle(this.deck);
    }
}

let rooms = {};

// --- SOCKET HANDLERS ---
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('joinRoom', (roomId) => {
        socket.join(roomId);
        if (!rooms[roomId]) {
            rooms[roomId] = {
                id: roomId,
                players: [],
                age: 1,
                round: 1,
                hunger: NUTRIENTS[Math.floor(Math.random() * NUTRIENTS.length)],
                state: "LOBBY",
                logs: ["Forest created. Waiting for saplings..."]
            };
        }
        const room = rooms[roomId];
        if (room.state === "LOBBY" && room.players.length < 5) {
            const color = COLOR_NAMES[room.players.length];
            const p = new Player(color, false, socket.id);
            room.players.push(p);
            socket.emit('assignedColor', color);
            room.logs.push(`${color} joined the lobby.`);
        }
        broadcastState(roomId);
    });

    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if (!room || room.state !== "LOBBY") return;
        
        // Fill remaining with bots
        while (room.players.length < 5) {
            const color = COLOR_NAMES[room.players.length];
            room.players.push(new Player(color, true, null));
        }
        room.logs.push("The Mother Tree awakens. Age 1 begins.");
        startAge(room);
        broadcastState(roomId);
    });

    socket.on('selectMark', (data) => {
        const room = rooms[data.roomId];
        const p = room.players.find(p => p.socketId === socket.id);
        if (p && room.state === "MARK") {
            p.currentMark = data.mark;
            p.pastMarks.push(data.mark);
            p.availableMarks = p.availableMarks.filter(m => m !== data.mark);
            room.logs.push(`${p.name} has chosen a mark.`);
            checkReadyNextState(room);
        }
    });

    socket.on('submitDiscard', (data) => {
        const room = rooms[data.roomId];
        const p = room.players.find(p => p.socketId === socket.id);
        if (p && room.state === "DISCARD") {
            // Remove the 5 cards from hand based on indices provided by client
            p.hand = p.hand.filter((_, index) => !data.discardIndices.includes(index));
            room.logs.push(`${p.name} discarded 5 cards.`);
            checkReadyNextState(room);
        }
    });

    socket.on('playCard', (data) => {
        const room = rooms[data.roomId];
        const p = room.players.find(p => p.socketId === socket.id);
        if (p && room.state === "DECIDE" && !p.playedCard) {
            p.playedCard = p.hand.splice(data.cardIndex, 1)[0];
            checkReadyNextState(room);
        }
    });

    socket.on('disconnect', () => {
        // Find room and mark player as bot or remove room if empty
        console.log("User disconnected");
    });
});

// --- CORE ENGINE ---

function startAge(room) {
    room.players.forEach(p => {
        p.currentMark = null;
        p.playedCard = null;
        p.saplingHeight = 0;
        p.hungerContrib = 0;
        // Draw 10 cards
        for (let i = 0; i < 10; i++) { if (p.deck.length > 0) p.hand.push(p.deck.pop()); }
    });

    // Bots automatically "Discard" first 5 cards
    room.players.filter(p => p.isBot).forEach(bot => {
        bot.hand.splice(0, 5);
    });

    room.state = (room.age === 1) ? "MARK" : "DISCARD";

    // If Age 1 (skipping discard), bots must mark immediately
    if (room.state === "MARK") {
        room.players.filter(p => p.isBot).forEach(bot => {
            let m = bot.availableMarks.shift();
            bot.currentMark = m;
            bot.pastMarks.push(m);
        });
    }
}

function checkReadyNextState(room) {
    const humans = room.players.filter(p => !p.isBot);

    if (room.state === "DISCARD") {
        if (humans.every(h => h.hand.length === 5)) {
            room.state = "MARK";
            room.players.filter(p => p.isBot).forEach(bot => {
                let m = bot.availableMarks.shift();
                bot.currentMark = m;
                bot.pastMarks.push(m);
            });
        }
    } 
    else if (room.state === "MARK") {
        if (humans.every(h => h.currentMark !== null)) {
            room.state = "DECIDE";
        }
    }
    else if (room.state === "DECIDE") {
        if (humans.every(h => h.playedCard !== null)) {
            // Bots play card
            room.players.filter(p => p.isBot).forEach(bot => {
                bot.playedCard = bot.hand.pop();
            });
            resolveRound(room);
        }
    }
    broadcastState(room.id);
}

function resolveRound(room) {
    room.state = "REVEAL";
    
    // Check for "Defying" (Playing a 0)
    room.players.forEach(p => p.defying = (p.playedCard.value === 0));

    // Calculate impacts
    room.players.forEach(p => {
        const c = p.playedCard;
        const target = room.players.find(t => t.name === c.target);
        
        if (c.n_type === room.hunger) p.hungerContrib += c.value;
        if (!target.defying) target.saplingHeight += c.value;
    });

    // Delay 4 seconds so players can see the cards before next round
    setTimeout(() => {
        room.round++;
        room.players.forEach(p => p.playedCard = null);
        
        if (room.round > 5) {
            calculateScoring(room);
        } else {
            room.state = "DECIDE";
            broadcastState(room.id);
        }
    }, 4000);
}

function calculateScoring(room) {
    room.state = "SUMMARY";
    
    // Sort by height to find the shortest
    let sortedHeight = [...room.players].sort((a,b) => a.saplingHeight - b.saplingHeight);
    let minH = sortedHeight[0].saplingHeight;
    let shortestPlayers = room.players.filter(p => p.saplingHeight === minH);
    
    // If only one player is shortest, those who marked them get root bonus
    if (shortestPlayers.length === 1) {
        let victim = shortestPlayers[0].name;
        room.players.forEach(p => {
            if (p.currentMark === victim) p.rootDepth += 10;
        });
    }

    // Hunger bonus
    let sortedHunger = [...room.players].sort((a,b) => b.hungerContrib - a.hungerContrib);
    if (sortedHunger[0].hungerContrib > sortedHunger[1].hungerContrib) {
        sortedHunger[0].rootDepth += 15;
    }
    
    // Penalize lowest hunger
    let minHunger = sortedHunger[sortedHunger.length-1].hungerContrib;
    room.players.forEach(p => {
        if (p.hungerContrib === minHunger) p.rootDepth -= 8;
        // General height to roots conversion
        p.rootDepth += p.saplingHeight;
    });

    room.logs.push(`Age ${room.age} complete.`);
    
    setTimeout(() => {
        if (room.age < 4) {
            room.age++;
            room.round = 1;
            room.hunger = NUTRIENTS[Math.floor(Math.random() * NUTRIENTS.length)];
            startAge(room);
            broadcastState(room.id);
        } else {
            room.state = "GAME_OVER";
            broadcastState(room.id);
        }
    }, 5000);
}

function broadcastState(roomId) {
    io.to(roomId).emit('gameState', rooms[roomId]);
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Mother Tree Server running on port ${PORT}`));
