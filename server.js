const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

// --- CONSTANTS (Ported from Python) ---
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

        // Create Deck
        let rivals = COLOR_NAMES.filter(c => c !== this.name);
        rivals.forEach(rival => {
            NUTRIENT_DATA.forEach(data => {
                this.deck.push(new Card(this.name, rival, data.val, data.type));
            });
        });
        shuffle(this.deck);
    }
}

// --- GAME STATE STORAGE ---
let rooms = {};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('joinRoom', (roomId) => {
        socket.join(roomId);
        
        if (!rooms[roomId]) {
            // Initialize new game
            rooms[roomId] = {
                id: roomId,
                players: COLOR_NAMES.map(color => new Player(color, true)), // Start all as bots
                age: 1,
                round: 1,
                hunger: NUTRIENTS[Math.floor(Math.random() * NUTRIENTS.length)],
                state: "LOBBY", // Wait for players to hit "Start"
                logs: ["Waiting for players..."]
            };
        }

        // Assign the human to the first available Bot slot
        let playerAssigned = false;
        for (let p of rooms[roomId].players) {
            if (p.isBot && !playerAssigned) {
                p.isBot = false;
                p.socketId = socket.id;
                playerAssigned = true;
                socket.emit('assignedColor', p.name);
                break;
            }
        }

        broadcastState(roomId);
    });

    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if (room) {
            startAge(room);
            broadcastState(roomId);
        }
    });

    socket.on('submitDiscard', (data) => {
        const room = rooms[data.roomId];
        const player = room.players.find(p => p.socketId === socket.id);
        
        // In your real logic, filter the hand based on the 5 selected cards
        // For now, we simulate the logic from your Python script:
        player.hand = player.hand.filter(c => !data.discardIndices.includes(player.hand.indexOf(c)));
        
        checkReadyNextState(room);
    });

    socket.on('playCard', (data) => {
        const room = rooms[data.roomId];
        const player = room.players.find(p => p.socketId === socket.id);
        player.playedCard = player.hand.splice(data.cardIndex, 1)[0];
        
        checkReadyNextState(room);
    });

    socket.on('selectMark', (data) => {
        const room = rooms[data.roomId];
        const player = room.players.find(p => p.socketId === socket.id);
        player.currentMark = data.mark;
        player.pastMarks.push(data.mark);
        player.availableMarks = player.availableMarks.filter(m => m !== data.mark);
        
        checkReadyNextState(room);
    });
});

// --- CORE GAME LOGIC (The "Brain") ---

function startAge(room) {
    room.state = "START_AGE";
    room.players.forEach(p => {
        p.currentMark = null;
        for (let i = 0; i < 10; i++) {
            if (p.deck.length > 0) p.hand.push(p.deck.pop());
        }
    });
    
    // Auto-handle Bots Discarding
    room.players.filter(p => p.isBot).forEach(bot => {
        // Simple Bot Logic: discard first 5
        bot.hand.splice(0, 5);
    });

    room.state = room.age === 1 ? "MARK" : "DISCARD";
}

function checkReadyNextState(room) {
    const humans = room.players.filter(p => !p.isBot);
    
    if (room.state === "DISCARD") {
        if (humans.every(h => h.hand.length === 5)) {
            room.state = "MARK";
            // Auto-handle Bot Marks
            room.players.filter(p => p.isBot).forEach(bot => {
                let choice = bot.availableMarks.pop();
                bot.currentMark = choice;
                bot.pastMarks.push(choice);
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
            // Bots play cards
            room.players.filter(p => p.isBot).forEach(bot => {
                // Simple Bot Logic: play first card
                bot.playedCard = bot.hand.pop();
            });
            resolveRound(room);
        }
    }
    broadcastState(room.id);
}

function resolveRound(room) {
    room.state = "REVEAL";
    
    // Resolve logic ported from your Python script
    room.players.forEach(p => p.defying = (p.playedCard.value === 0));
    
    room.players.forEach(p => {
        let card = p.playedCard;
        let target = room.players.find(t => t.name === card.target);
        
        if (card.n_type === room.hunger) p.hungerContrib += card.value;
        if (!target.defying) target.saplingHeight += card.value;
    });

    setTimeout(() => {
        room.round++;
        room.players.forEach(p => p.playedCard = null);
        if (room.round > 5) {
            calculateScoring(room);
        } else {
            room.state = "DECIDE";
        }
        broadcastState(room.id);
    }, 3000); // 3 second pause to let players see what was played
}

function calculateScoring(room) {
    room.state = "SUMMARY";
    // Port your "calculate_scoring" logic here similar to resolveRound...
}

function broadcastState(roomId) {
    io.to(roomId).emit('gameState', rooms[roomId]);
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Mother Tree Server running on port ${PORT}`));
