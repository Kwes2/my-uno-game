socket.on('joinRoom', (roomId) => {
        socket.join(roomId);
        if (!rooms[roomId]) {
            rooms[roomId] = {
                id: roomId, players: [], age: 1, round: 1, hunger: "Sticks",
                state: "LOBBY", logs: ["Welcome to the Network."], summaryData: {}
            };
        }
        const room = rooms[roomId];
        
        // Only allow joining if in Lobby
        if (room.state === "LOBBY" && room.players.length < 5) {
            const color = COLOR_NAMES[room.players.length];
            room.players.push(new Player(color, false, socket.id));
            socket.emit('assignedColor', color);
            room.logs.push(`${color} tree has taken root.`);
        }
        
        // CRITICAL: Always send the current state immediately after joining
        socket.emit('gameState', room); 
        broadcastState(roomId);
    });
