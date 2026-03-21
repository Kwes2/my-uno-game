const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let gameState = null;
let myColor = null;
let roomId = "";
let cursor = 0;
let localMoveMade = false;

const COLORS = {
    "Red": "#c83232", "Blue": "#3264c8", "Yellow": "#d2d232",
    "Green": "#32aa46", "Pink": "#c846c8", "Gold": "#ffd700",
    "White": "#f0f0f5", "Black": "#0f0f14", "Gray": "#32323c",
    "DarkGray": "#1e1e23"
};

// POLYFILL for older browsers
if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
        if (w < 2 * r) r = w / 2;
        if (h < 2 * r) r = h / 2;
        this.beginPath();
        this.moveTo(x + r, y);
        this.arcTo(x + w, y, x + w, y + h, r);
        this.arcTo(x + w, y + h, x, y + h, r);
        this.arcTo(x, y + h, x, y, r);
        this.arcTo(x, y, x + w, y, r);
        this.closePath();
        return this;
    };
}

// --- UI Logic ---

function showScreen(screenId) {
    // screens: 'setup', 'gameCanvas'
    document.getElementById('setup').style.display = screenId === 'setup' ? 'block' : 'none';
    document.getElementById('gameCanvas').style.display = screenId === 'gameCanvas' ? 'block' : 'none';
}

function joinRoom(id) {
    const input = id || document.getElementById('roomInput').value.trim();
    if (input) {
        roomId = input;
        socket.emit('joinRoom', roomId);
        showScreen('gameCanvas');
    }
}

function triggerSoloGame() {
    socket.emit('startSinglePlayer');
    showScreen('gameCanvas');
}

// Room Browser Listener
socket.on('roomList', (rooms) => {
    const listUI = document.getElementById('roomListUI');
    if (!listUI) return;
    listUI.innerHTML = "";
    if (rooms.length === 0) {
        listUI.innerHTML = "<li style='color: #888; font-style: italic;'>No active public seeds. Create one!</li>";
        return;
    }
    rooms.forEach(room => {
        const li = document.createElement('li');
        li.innerHTML = `<span>Forest: <strong>${room.id}</strong> (${room.playerCount}/5)</span>`;
        const btn = document.createElement('button');
        btn.innerText = "Join";
        btn.onclick = () => joinRoom(room.id);
        li.appendChild(btn);
        listUI.appendChild(li);
    });
});

// --- Input Handling ---

window.addEventListener('keydown', (e) => {
    if (e.key === "h" || e.key === "Escape") {
        if (typeof toggleRules === "function") toggleRules();
    }

    if (!gameState) return;
    const me = gameState.players.find(p => p.name === myColor);
    if (!me) return;

    if (me.isAutoBot && !me.isBot) return;
    if (localMoveMade && (gameState.state === "MARK" || gameState.state === "DECIDE")) return;

    let limit = 0;
    if (gameState.state === "MARK") limit = me.availableMarks.length - 1;
    if (gameState.state === "DECIDE" || gameState.state === "DISCARD") limit = me.hand.length - 1;

    if (e.key === "ArrowLeft") cursor = Math.max(0, cursor - 1);
    if (e.key === "ArrowRight") cursor = Math.min(limit, cursor + 1);

    if (e.key === "Enter") {
        if (gameState.state === "MARK" && me.currentMark === null && !localMoveMade) {
            localMoveMade = true;
            socket.emit('selectMark', { roomId, mark: me.availableMarks[cursor] });
        }
        if (gameState.state === "DECIDE" && !me.playedCard && !localMoveMade) {
            localMoveMade = true;
            socket.emit('playCard', { roomId, cardIndex: cursor });
        }
        if (gameState.state === "DISCARD") {
            me.hand[cursor].selectedForDiscard = !me.hand[cursor].selectedForDiscard;
        }
    }

    if (e.key === " ") {
        if (gameState.state === "SUMMARY") socket.emit('nextAge', roomId);
        if (gameState.state === "DISCARD") confirmDiscard(me);
    }
});

canvas.addEventListener('mousedown', (e) => {
    if (!gameState) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;

    if (gameState.state === "LOBBY") {
        // Start Game Button (Centered for 1200)
        if (mx > 450 && mx < 750 && my > 600 && my < 700) {
            socket.emit('startGame', roomId);
        }
    }
    
    if (gameState.state === "SUMMARY") {
        socket.emit('nextAge', roomId);
    }

    const me = gameState.players.find(p => p.name === myColor);
    if (me && gameState.state === "DISCARD" && !me.isAutoBot) {
        if (mx > 500 && mx < 700 && my > 540 && my < 580) confirmDiscard(me);
        
        const startX = (canvas.width / 2) - (me.hand.length * 55);
        me.hand.forEach((card, i) => {
            if (mx > startX + i * 110 && mx < startX + i * 110 + 100 && my > 600 && my < 740) {
                card.selectedForDiscard = !card.selectedForDiscard;
            }
        });
    }
});

function confirmDiscard(me) {
    const indices = me.hand.map((c, i) => c.selectedForDiscard ? i : -1).filter(i => i !== -1);
    if (indices.length === 5) {
        socket.emit('submitDiscard', { roomId, discardIndices: indices });
    }
}

socket.on('assignedColor', (c) => myColor = c);
socket.on('gameState', (data) => { 
    if (!gameState || gameState.state !== data.state || gameState.round !== data.round || gameState.age !== data.age) {
        localMoveMade = false;
        cursor = 0;
    }
    gameState = data;
    roomId = data.id; 
});

// --- Drawing Utils ---

function drawNutrientIcon(x, y, type, color, size) {
    ctx.fillStyle = color; ctx.strokeStyle = color;
    if (type === "Sticks") {
        ctx.lineWidth = 4 * size;
        ctx.beginPath(); ctx.moveTo(x-10*size, y+10*size); ctx.lineTo(x+10*size, y-10*size); ctx.stroke();
    } else if (type === "Leaves") {
        ctx.beginPath(); ctx.ellipse(x, y, 8*size, 12*size, 0, 0, Math.PI*2); ctx.fill();
    } else if (type === "Resin") {
        ctx.beginPath(); ctx.arc(x, y+5*size, 8*size, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.moveTo(x-8*size, y+5*size); ctx.lineTo(x+8*size, y+5*size); ctx.lineTo(x, y-12*size); ctx.fill();
    }
}

function drawCard(x, y, card, isSelected, isSmall = false) {
    const w = isSmall ? 60 : 100; const h = isSmall ? 85 : 140;
    const dy = isSelected ? y - 20 : y;

    ctx.fillStyle = COLORS[card.target] || "#555";
    ctx.beginPath(); ctx.roundRect(x, dy, w, h, 8); ctx.fill();
    ctx.strokeStyle = isSelected ? COLORS.Gold : "white";
    ctx.lineWidth = isSelected ? 4 : 2; ctx.stroke();

    ctx.fillStyle = "white"; ctx.textAlign = "center";
    ctx.font = `bold ${isSmall ? 9 : 13}px Arial`;
    ctx.fillText(card.target.toUpperCase(), x + w/2, dy + (isSmall ? 18 : 25));
    ctx.font = `bold ${isSmall ? 20 : 35}px Arial`;
    ctx.fillText(card.value, x + w/2, dy + h/2 + (isSmall ? 8 : 10));
    
    drawNutrientIcon(x + w/2, dy + h - (isSmall ? 18 : 25), card.n_type, "white", isSmall ? 0.5 : 0.8);

    if (card.selectedForDiscard) {
        ctx.fillStyle = "rgba(255, 0, 0, 0.6)";
        ctx.beginPath(); ctx.roundRect(x, dy, w, h, 8); ctx.fill();
        ctx.strokeStyle = "white"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x+10, dy+10); ctx.lineTo(x+w-10, dy+h-10); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x+w-10, dy+10); ctx.lineTo(x+10, dy+h-10); ctx.stroke();
    }
}

function drawTimer() {
    if (!gameState.phaseStartTime) return;
    const limit = (gameState.state === "DISCARD") ? 120 : 60;
    const elapsed = (Date.now() - gameState.phaseStartTime) / 1000;
    const remaining = Math.max(0, limit - elapsed);
    
    const x = 40, y = 330, w = 300, h = 8;
    ctx.fillStyle = COLORS.DarkGray;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 4); ctx.fill();
    
    const progressWidth = (remaining / limit) * w;
    ctx.fillStyle = remaining < 10 ? (Math.floor(Date.now()/500) % 2 ? COLORS.Red : COLORS.Gold) : "#8f8";
    ctx.beginPath(); ctx.roundRect(x, y, progressWidth, h, 4); ctx.fill();
    
    ctx.fillStyle = "white"; ctx.font = "bold 13px Arial"; ctx.textAlign = "left";
    ctx.fillText(`TIME: ${Math.ceil(remaining)}s`, x, y + 22);
}

function draw() {
    ctx.fillStyle = COLORS.Black;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (!gameState) {
        ctx.fillStyle = "white"; ctx.textAlign = "center"; ctx.font = "24px Arial";
        ctx.fillText("Connecting to the Forest Network...", canvas.width/2, canvas.height/2);
        requestAnimationFrame(draw);
        return;
    }

    if (gameState.state === "LOBBY") {
        ctx.fillStyle = COLORS.Gold; ctx.font = "bold 50px Arial"; ctx.textAlign = "center";
        ctx.fillText("MOTHER TREE", canvas.width/2, 180);
        ctx.font = "20px Arial"; ctx.fillText(`Forest: ${roomId}`, canvas.width/2, 230);

        gameState.players.forEach((p, i) => {
            ctx.fillStyle = COLORS[p.name]; ctx.font = "26px Arial";
            ctx.fillText(`${p.name} ${p.name === myColor ? "(YOU)" : ""}`, canvas.width/2, 320 + i*45);
        });

        ctx.fillStyle = COLORS.DarkGray; ctx.beginPath(); ctx.roundRect(450, 600, 300, 80, 15); ctx.fill();
        ctx.strokeStyle = COLORS.Gold; ctx.lineWidth = 3; ctx.stroke();
        ctx.fillStyle = "white"; ctx.font = "bold 30px Arial";
        ctx.fillText("START GAME", canvas.width/2, 650);
        
    } else {
        // Player Boxes: Responsive spacing for 1200px width
        gameState.players.forEach((p, i) => {
            const x = 15 + i * 238; const y = 25;
            ctx.fillStyle = COLORS.DarkGray; ctx.beginPath(); ctx.roundRect(x, y, 230, 170, 10); ctx.fill();
            ctx.strokeStyle = p.isDisconnected ? "#555" : COLORS[p.name]; ctx.lineWidth = 3; ctx.stroke();

            if (p.isDisconnected) {
                ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.beginPath(); ctx.roundRect(x, y, 230, 170, 10); ctx.fill();
                ctx.fillStyle = "white"; ctx.textAlign = "center"; ctx.font = "bold 11px Arial";
                ctx.fillText("DISCONNECTED", x + 115, y + 18);
            }

            ctx.fillStyle = COLORS[p.name]; ctx.textAlign = "left"; ctx.font = "bold 18px Arial";
            ctx.fillText(p.name + (p.name === myColor ? " (You)" : ""), x + 12, y + 30);
            
            ctx.fillStyle = "white"; ctx.font = "14px Arial";
            ctx.fillText(`Roots: ${p.rootDepth}`, x + 12, y + 60);
            ctx.fillText(`Height: ${p.saplingHeight}ft`, x + 12, y + 82);
            ctx.fillStyle = "#8f8";
            ctx.fillText(`Giving ${gameState.hunger}: ${p.hungerContrib}`, x + 12, y + 104);

            if (p.isAutoBot && !p.isBot) {
                ctx.fillStyle = COLORS.Gold; ctx.font = "italic 11px Arial";
                ctx.fillText("NETWORK CONTROL", x + 12, y + 155);
            }
            
            p.pastMarks.slice(0, gameState.age).forEach((m, mi) => {
                ctx.fillStyle = COLORS[m]; ctx.beginPath(); ctx.arc(x + 20 + (mi*22), y + 130, 7, 0, Math.PI*2); ctx.fill();
            });

            if (p.playedCard && (gameState.state === "REVEAL")) {
                drawCard(x + 155, y + 45, p.playedCard, false, true);
            }
        });

        // Game Stats
        ctx.fillStyle = COLORS.DarkGray; ctx.beginPath(); ctx.roundRect(40, 230, 300, 90, 8); ctx.fill();
        ctx.fillStyle = COLORS.Gold; ctx.font = "bold 22px Arial"; ctx.textAlign = "left";
        ctx.fillText(`AGE ${gameState.age} | ROUND ${gameState.round}`, 60, 265);
        ctx.fillStyle = "#8f8"; ctx.font = "bold 18px Arial";
        ctx.fillText(`DEMAND: ${gameState.hunger.toUpperCase()}`, 60, 300);

        drawTimer();

        // Logs
        gameState.logs.slice(-5).forEach((log, i) => {
            ctx.fillStyle = "#888"; ctx.font = "13px Arial"; ctx.textAlign = "left";
            ctx.fillText(`> ${log}`, 450, 255 + i*18);
        });

        const me = gameState.players.find(p => p.name === myColor);
        if (me) {
            if (me.isAutoBot && !me.isBot && gameState.state !== "SUMMARY") {
                ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(0, 500, canvas.width, 300);
                ctx.fillStyle = COLORS.Gold; ctx.textAlign = "center"; ctx.font = "bold 25px Arial";
                ctx.fillText("THE NETWORK IS MOVING FOR YOU...", canvas.width/2, 650);
            } else if (gameState.state === "DECIDE" || gameState.state === "DISCARD") {
                const startX = (canvas.width/2) - (me.hand.length * 55);
                me.hand.forEach((card, i) => {
                    drawCard(startX + i * 110, 600, card, i === cursor);
                });
                ctx.fillStyle = "white"; ctx.textAlign = "center"; ctx.font = "18px Arial";
                const msg = gameState.state === "DECIDE" ? "CHOOSE A CARD [ENTER]" : `DISCARD 5 CARDS (${me.hand.filter(c=>c.selectedForDiscard).length}/5)`;
                ctx.fillText(msg, canvas.width/2, 580);
                
                if (gameState.state === "DISCARD") {
                    ctx.fillStyle = COLORS.DarkGray; ctx.beginPath(); ctx.roundRect(500, 535, 200, 40, 8); ctx.fill();
                    ctx.strokeStyle = "white"; ctx.stroke();
                    ctx.fillStyle = "white"; ctx.font = "14px Arial"; ctx.fillText("CONFIRM [SPACE]", canvas.width/2, 560);
                }
            } else if (gameState.state === "MARK") {
                ctx.fillStyle = "rgba(0,0,0,0.9)"; ctx.fillRect(0,0,canvas.width,canvas.height);
                ctx.fillStyle = COLORS.Gold; ctx.font = "bold 35px Arial"; ctx.textAlign = "center";
                ctx.fillText("WHICH RIVAL WILL YOU SHADE?", canvas.width/2, 280);
                ctx.font = "16px Arial"; ctx.fillStyle = "white";
                ctx.fillText("Gain +10 Roots if your Mark is the unique shortest tree.", canvas.width/2, 320);

                me.availableMarks.forEach((m, i) => {
                    const bx = (canvas.width/2) - (me.availableMarks.length * 75) + (i * 150) + 75;
                    ctx.fillStyle = (i === cursor) ? COLORS[m] : COLORS.DarkGray;
                    if (localMoveMade || me.currentMark !== null) ctx.globalAlpha = 0.5;
                    ctx.beginPath(); ctx.roundRect(bx - 60, 400, 120, 80, 10); ctx.fill();
                    ctx.globalAlpha = 1.0;
                    ctx.strokeStyle = COLORS[m]; ctx.lineWidth = 4; ctx.stroke();
                    ctx.fillStyle = (i === cursor) ? "white" : COLORS[m];
                    ctx.font = "bold 20px Arial"; ctx.fillText(m, bx, 448);
                });
            }
        }
    }

    if (gameState.state === "SUMMARY") drawSummary();

    if (gameState.state === "GAMEOVER") {
        ctx.fillStyle = "rgba(0,0,0,0.92)"; ctx.fillRect(0,0,canvas.width,canvas.height);
        ctx.fillStyle = COLORS.Gold; ctx.font = "bold 50px Arial"; ctx.textAlign = "center";
        ctx.fillText("THE FOREST HAS SPOKEN", canvas.width/2, 300);
        const winner = [...gameState.players].sort((a,b) => b.rootDepth - a.rootDepth)[0];
        ctx.fillStyle = COLORS[winner.name]; ctx.font = "35px Arial";
        ctx.fillText(`${winner.name.toUpperCase()} MOTHER TREE WINS`, canvas.width/2, 380);
        ctx.fillStyle = "white"; ctx.font = "20px Arial";
        ctx.fillText(`Final Root Depth: ${winner.rootDepth}`, canvas.width/2, 430);
    }

    requestAnimationFrame(draw);
}

function drawSummary() {
    ctx.fillStyle = "rgba(0,0,0,0.96)"; ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle = "white"; ctx.font = "bold 35px Arial"; ctx.textAlign = "center";
    ctx.fillText(`AGE ${gameState.age} RESULTS`, canvas.width/2, 100);
    const data = gameState.summaryData;
    ctx.textAlign = "left";
    ctx.fillStyle = COLORS.Gold; ctx.font = "bold 24px Arial";
    ctx.fillText("SAPLING HEIGHTS", 200, 200);
    data.heights.forEach((h, i) => {
        ctx.fillStyle = COLORS[h.name]; ctx.font = "18px Arial";
        let markText = (h.name === data.shortestName) ? " (Shortest!)" : "";
        ctx.fillText(`${h.name}: ${h.val}ft ${markText}`, 200, 240 + i*35);
    });
    ctx.fillStyle = "#8f8"; ctx.font = "bold 24px Arial";
    ctx.fillText(`SHARING ${gameState.hunger.toUpperCase()}`, 700, 200);
    data.hungers.forEach((hu, i) => {
        ctx.fillStyle = COLORS[hu.name]; ctx.font = "18px Arial";
        let bonus = "";
        if (hu.name === data.hWinner) bonus = " (+15 Bonus)";
        if (data.hLosers.includes(hu.name)) bonus = " (-8 Penalty)";
        ctx.fillText(`${hu.name}: ${hu.val} units ${bonus}`, 700, 240 + i*35);
    });
    if (data.markWinners.length > 0) {
        ctx.fillStyle = COLORS.Gold; ctx.textAlign = "center"; ctx.font = "20px Arial";
        ctx.fillText(`Mark Success! +10 Roots for: ${data.markWinners.join(", ")}`, canvas.width/2, 550);
    }
    ctx.fillStyle = "white"; ctx.textAlign = "center"; ctx.font = "18px Arial";
    ctx.fillText("Press [SPACE] or Click to begin the next Age", canvas.width/2, 700);
}

requestAnimationFrame(draw);
