const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

// --- CONSTANTS ---
const COLOR_NAMES = ["Red", "Blue", "Yellow", "Green", "Pink"];
const NUTRIENTS = ["Sticks", "Leaves", "Resin"];
const NUTRIENT_DATA = [
    { val: 0, type: "None" }, { val: 1, type: "Sticks" }, { val: 4, type: "Sticks" }, { val: 7, type: "Sticks" },
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
    }
}

class Player {
    constructor(name, isBot = true, socketId = null) {
        this.name = name;
        this.isBot = isBot;
        this.socketId = socketId;
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
}

let rooms = {};

io.on('connection', (socket) => {
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
                logs: ["Waiting for players..."]
            };
        }

        const room = rooms[roomId];
        if (room.players.length < 5 && room.state === "LOBBY") {
            const assignedColor = COLOR_NAMES[room.players.length];
            const newPlayer = new Player(assignedColor, false, socket.id);
            room.players.push(newPlayer);
            socket.emit('assignedColor', assignedColor);
            room.logs.push(`${assignedColor} joined the forest.`);
        } else if (room.state !== "LOBBY") {
            socket.emit('error', 'Game already in progress.');
        } else {
            socket.emit('error', 'Room is full.');
        }
        broadcastState(roomId);
    });

    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if (!room || room.state !== "LOBBY") return;

        while (room.players.length < 5) {
            const botColor = COLOR_NAMES[room.players.length];
            const bot = new Player(botColor, true, null);
            room.players.push(bot);
            room.logs.push(`${botColor} (Bot) added to fill space.`);
        }

        room.logs.push("The Mother Tree awakens!");
        startAge(room);
        broadcastState(roomId);
    });

    socket.on('playCard', (data) => {
        const room = rooms[data.roomId];
        const player = room.players.find(p => p.socketId === socket.id);
        if (player && room.state === "DECIDE") {
            player.playedCard = player.hand.splice(data.cardIndex, 1)[0];
            checkReadyNextState(room);
        }
    });

    // ... Add other socket handlers (submitDiscard, selectMark) here
});

function startAge(room) {
    room.state = "START_AGE";
    room.players.forEach(p => {
        p.currentMark = null; // Reset marks for new age
        p.playedCard = null;
        for (let i = 0; i < 10; i++) {
            if (p.deck.length > 0) p.hand.push(p.deck.pop());
        }
    });
    
    // Auto-handle Bots Discarding
    room.players.filter(p => p.isBot).forEach(bot => {
        bot.hand.splice(0, 5); // Simple Bot Logic: discard first 5
    });

    room.state = (room.age === 1) ? "MARK" : "DISCARD";

    // IMPORTANT: If we are in MARK state, Bots must pick their marks NOW
    if (room.state === "MARK") {
        room.players.filter(p => p.isBot).forEach(bot => {
            if (bot.availableMarks.length > 0) {
                let choice = bot.availableMarks.pop();
                bot.currentMark = choice;
                bot.pastMarks.push(choice);
            }
        });
    }
}

function checkReadyNextState(room) {
    const humans = room.players.filter(p => !p.isBot);
    
    if (room.state === "DISCARD") {
        // Check if all humans have exactly 5 cards left (meaning they discarded 5)
        if (humans.every(h => h.hand.length === 5)) {
            room.state = "MARK";
            // Bots pick marks immediately upon entering MARK state
            room.players.filter(p => p.isBot).forEach(bot => {
                if (bot.availableMarks.length > 0) {
                    let choice = bot.availableMarks.pop();
                    bot.currentMark = choice;
                    bot.pastMarks.push(choice);
                }
            });
            room.logs.push("Discarding complete. Choose your Marks.");
        }
    } 
    else if (room.state === "MARK") {
        // Check if all humans have selected a currentMark
        if (humans.every(h => h.currentMark !== null)) {
            room.state = "DECIDE";
            room.logs.push("Marks set. Choose a card to play.");
        }
    }
    else if (room.state === "DECIDE") {
        // Check if all humans have played a card
        if (humans.every(h => h.playedCard !== null)) {
            // Now make Bots play a card
            room.players.filter(p => p.isBot).forEach(bot => {
                // Simple Bot: Play the first card in hand
                bot.playedCard = bot.hand.pop();
            });
            room.logs.push("All cards played! Revealing...");
            resolveRound(room);
        }
    }
    broadcastState(room.id);
}

function resolveRound(room) {
    room.state = "REVEAL";
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
        room.state = (room.round > 5) ? "SUMMARY" : "DECIDE";
        broadcastState(room.id);
    }, 3000);
}

function broadcastState(roomId) {
    io.to(roomId).emit('gameState', rooms[roomId]);
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));
