const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public')); // This shows your website files to players

let rooms = {};

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('joinRoom', (roomId) => {
        socket.join(roomId);
        if (!rooms[roomId]) {
            rooms[roomId] = { players: [], deck: ['Red 1', 'Blue 2', 'Green 5', 'Yellow 9'], turn: 0 };
        }
        
        // Add the human player
        rooms[roomId].players.push({ id: socket.id, name: "Human", cards: ['Red 1'] });
        
        // ADD A BOT AUTOMATICALLY
        rooms[roomId].players.push({ id: "bot-1", name: "Computer Bot", cards: ['Blue 2'], isBot: true });

        io.to(roomId).emit('gameState', rooms[roomId]);
    });

    socket.on('playCard', (data) => {
        const room = rooms[data.roomId];
        // Logic: Move to next player
        room.turn = (room.turn + 1) % room.players.length;
        
        io.to(data.roomId).emit('gameState', room);

        // BOT LOGIC: If it's the bot's turn, make it play after 2 seconds
        const nextPlayer = room.players[room.turn];
        if (nextPlayer && nextPlayer.isBot) {
            setTimeout(() => {
                room.turn = (room.turn + 1) % room.players.length;
                io.to(data.roomId).emit('gameState', room);
            }, 2000);
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));