const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let gameState = null;
let myColor = null;
let roomId = "";
let cursor = 0;

const COLORS = {
    "Red": "#c83232", "Blue": "#3264c8", "Yellow": "#d2d232",
    "Green": "#32aa46", "Pink": "#c846c8", "Gold": "#ffd700",
    "White": "#f0f0f5", "Black": "#0f0f14", "Gray": "#32323c",
    "DarkGray": "#1e1e23"
};

// POLYFILL: Fixes "Black Screen" on older browsers that don't support roundRect
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

// Input Handling
window.addEventListener('keydown', (e) => {
    if (!gameState) return;
    const me = gameState.players.find(p => p.name === myColor);
    if (!me) return;

    let limit = 0;
    if (gameState.state === "MARK") limit = me.availableMarks.length - 1;
    if (gameState.state === "DECIDE" || gameState.state === "DISCARD") limit = me.hand.length - 1;

    if (e.key === "ArrowLeft") cursor = Math.max(0, cursor - 1);
    if (e.key === "ArrowRight") cursor = Math.min(limit, cursor + 1);

    if (e.key === "Enter") {
        if (gameState.state === "MARK") socket.emit('selectMark', { roomId, mark: me.availableMarks[cursor] });
        if (gameState.state === "DECIDE") socket.emit('playCard', { roomId, cardIndex: cursor });
        if (gameState.state === "DISCARD") me.hand[cursor].selectedForDiscard = !me.hand[cursor].selectedForDiscard;
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

    // Start Button in Lobby
    if (gameState.state === "LOBBY") {
        if (mx > 600 && mx < 900 && my > 650 && my < 750) {
            socket.emit('startGame', roomId);
        }
    }
    
    // Next Age in Summary
    if (gameState.state === "SUMMARY") {
        socket.emit('nextAge', roomId);
    }

    const me = gameState.players.find(p => p.name === myColor);
    if (me && gameState.state === "DISCARD") {
        // Discard confirm button
        if (mx > 650 && mx < 850 && my > 620 && my < 660) confirmDiscard(me);
        
        // Clicking cards to toggle discard
        const startX = 750 - (me.hand.length * 55);
        me.hand.forEach((card, i) => {
            if (mx > startX + i * 110 && mx < startX + i * 110 + 100 && my > 700 && my < 840) {
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

function joinRoom() {
    const input = document.getElementById('roomInput');
    roomId = input.value.trim();
    if (roomId) {
        socket.emit('joinRoom', roomId);
        document.getElementById('setup').style.display = 'none';
        canvas.style.display = 'block';
    }
}

socket.on('assignedColor', (c) => myColor = c);
socket.on('gameState', (data) => { 
    gameState = data; 
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
    const w = isSmall ? 70 : 100; const h = isSmall ? 100 : 140;
    const dy = isSelected ? y - 20 : y;

    ctx.fillStyle = COLORS[card.target] || "#555";
    ctx.beginPath(); ctx.roundRect(x, dy, w, h, 10); ctx.fill();
    ctx.strokeStyle = isSelected ? COLORS.Gold : "white";
    ctx.lineWidth = isSelected ? 4 : 2; ctx.stroke();

    ctx.fillStyle = "white"; ctx.textAlign = "center";
    ctx.font = `bold ${isSmall ? 10 : 13}px Arial`;
    ctx.fillText(card.target.toUpperCase(), x + w/2, dy + 25);
    ctx.font = `bold ${isSmall ? 25 : 35}px Arial`;
    ctx.fillText(card.value, x + w/2, dy + h/2 + 10);
    
    drawNutrientIcon(x + w/2, dy + h - 25, card.n_type, "white", isSmall ? 0.6 : 0.8);

    if (card.selectedForDiscard) {
        ctx.fillStyle = "rgba(255, 0, 0, 0.6)";
        ctx.beginPath(); ctx.roundRect(x, dy, w, h, 10); ctx.fill();
        ctx.strokeStyle = "white"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x+10, dy+10); ctx.lineTo(x+w-10, dy+h-10); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x+w-10, dy+10); ctx.lineTo(x+10, dy+h-10); ctx.stroke();
    }
}

function draw() {
    // Clear Background
    ctx.fillStyle = COLORS.Black;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (!gameState) {
        ctx.fillStyle = "white";
        ctx.textAlign = "center";
        ctx.font = "30px Arial";
        ctx.fillText("Connecting to the Forest Network...", 750, 450);
        requestAnimationFrame(draw);
        return;
    }

    if (gameState.state === "LOBBY") {
        ctx.fillStyle = COLORS.Gold; ctx.font = "bold 60px Arial"; ctx.textAlign = "center";
        ctx.fillText("MOTHER TREE", 750, 200);
        ctx.font = "24px Arial"; ctx.fillText(`Room: ${roomId}`, 750, 250);

        gameState.players.forEach((p, i) => {
            ctx.fillStyle = COLORS[p.name]; ctx.font = "30px Arial";
            ctx.fillText(`${p.name} ${p.name === myColor ? "(YOU)" : ""}`, 750, 350 + i*50);
        });

        // Start Button
        ctx.fillStyle = COLORS.DarkGray; ctx.beginPath(); ctx.roundRect(600, 650, 300, 100, 15); ctx.fill();
        ctx.strokeStyle = COLORS.Gold; ctx.lineWidth = 3; ctx.stroke();
        ctx.fillStyle = "white"; ctx.font = "bold 35px Arial";
        ctx.fillText("START GAME", 750, 715);
        
    } else {
        // Draw Player Dashboard (Stats)
        gameState.players.forEach((p, i) => {
            const x = 40 + i * 290; const y = 40;
            ctx.fillStyle = COLORS.DarkGray; ctx.beginPath(); ctx.roundRect(x, y, 260, 180, 12); ctx.fill();
            ctx.strokeStyle = COLORS[p.name]; ctx.lineWidth = 3; ctx.stroke();

            ctx.fillStyle = COLORS[p.name]; ctx.textAlign = "left"; ctx.font = "bold 20px Arial";
            ctx.fillText(p.name + (p.name === myColor ? " (You)" : ""), x + 15, y + 35);
            
            ctx.fillStyle = "white"; ctx.font = "16px Arial";
            ctx.fillText(`Roots: ${p.rootDepth}`, x + 15, y + 70);
            ctx.fillText(`Height: ${p.saplingHeight}ft`, x + 15, y + 95);
            ctx.fillStyle = "#8f8";
            ctx.fillText(`Giving ${gameState.hunger}: ${p.hungerContrib}`, x + 15, y + 120);
            
            // Mark History
            p.pastMarks.forEach((m, mi) => {
                ctx.fillStyle = COLORS[m]; ctx.beginPath(); ctx.arc(x + 25 + (mi*25), y + 150, 8, 0, Math.PI*2); ctx.fill();
            });

            if (p.playedCard && (gameState.state === "REVEAL")) {
                drawCard(x + 160, y + 50, p.playedCard, false, true);
            }
        });

        // Center Info
        ctx.fillStyle = COLORS.DarkGray; ctx.beginPath(); ctx.roundRect(50, 250, 400, 110, 10); ctx.fill();
        ctx.fillStyle = COLORS.Gold; ctx.font = "bold 28px Arial"; ctx.textAlign = "left";
        ctx.fillText(`AGE ${gameState.age} | ROUND ${gameState.round}`, 75, 295);
        ctx.fillStyle = "#8f8"; ctx.font = "bold 20px Arial";
        ctx.fillText(`NETWORK HUNGER: ${gameState.hunger.toUpperCase()}`, 75, 335);

        // Logs
        gameState.logs.slice(-6).forEach((log, i) => {
            ctx.fillStyle = "#888"; ctx.font = "14px Arial"; ctx.textAlign = "left";
            ctx.fillText(`> ${log}`, 500, 280 + i*20);
        });

        // Player Interaction Area
        const me = gameState.players.find(p => p.name === myColor);
        if (me) {
            if (gameState.state === "DECIDE" || gameState.state === "DISCARD") {
                const startX = 750 - (me.hand.length * 55);
                me.hand.forEach((card, i) => {
                    drawCard(startX + i * 110, 700, card, i === cursor);
                });
                ctx.fillStyle = "white"; ctx.textAlign = "center"; ctx.font = "22px Arial";
                const msg = gameState.state === "DECIDE" ? "CHOOSE A CARD TO PLAY [ENTER]" : `SELECT 5 CARDS TO DISCARD (${me.hand.filter(c=>c.selectedForDiscard).length}/5)`;
                ctx.fillText(msg, 750, 675);
                
                if (gameState.state === "DISCARD") {
                    ctx.fillStyle = COLORS.DarkGray; ctx.beginPath(); ctx.roundRect(650, 615, 200, 45, 8); ctx.fill();
                    ctx.strokeStyle = "white"; ctx.stroke();
                    ctx.fillStyle = "white"; ctx.font = "16px Arial"; ctx.fillText("CONFIRM [SPACE]", 750, 643);
                }
            } else if (gameState.state === "MARK") {
                ctx.fillStyle = "rgba(0,0,0,0.85)"; ctx.fillRect(0,0,1500,900);
                ctx.fillStyle = COLORS.Gold; ctx.font = "bold 45px Arial"; ctx.textAlign = "center";
                ctx.fillText("WHICH RIVAL WILL YOU SHADE?", 750, 300);
                ctx.font = "20px Arial"; ctx.fillStyle = "white";
                ctx.fillText("Earn +10 Root Depth if your Mark is the unique shortest sapling at end of Age.", 750, 350);

                me.availableMarks.forEach((m, i) => {
                    const bx = 750 - (me.availableMarks.length * 80) + (i * 160);
                    ctx.fillStyle = (i === cursor) ? COLORS[m] : COLORS.DarkGray;
                    ctx.beginPath(); ctx.roundRect(bx - 70, 450, 140, 90, 10); ctx.fill();
                    ctx.strokeStyle = COLORS[m]; ctx.lineWidth = 4; ctx.stroke();
                    ctx.fillStyle = (i === cursor) ? "white" : COLORS[m];
                    ctx.font = "bold 24px Arial"; ctx.fillText(m, bx, 505);
                });
            }
        }
    }

    if (gameState.state === "SUMMARY") {
        drawSummary();
    }

    if (gameState.state === "GAMEOVER") {
        ctx.fillStyle = "rgba(0,0,0,0.9)"; ctx.fillRect(0,0,1500,900);
        ctx.fillStyle = COLORS.Gold; ctx.font = "bold 60px Arial"; ctx.textAlign = "center";
        ctx.fillText("THE FOREST HAS SPOKEN", 750, 300);
        
        const winner = [...gameState.players].sort((a,b) => b.rootDepth - a.rootDepth)[0];
        ctx.fillStyle = COLORS[winner.name]; ctx.font = "40px Arial";
        ctx.fillText(`${winner.name.toUpperCase()} MOTHER TREE WINS`, 750, 400);
        ctx.fillStyle = "white"; ctx.font = "25px Arial";
        ctx.fillText(`Final Root Depth: ${winner.rootDepth}`, 750, 450);
    }

    requestAnimationFrame(draw);
}

function drawSummary() {
    ctx.fillStyle = "rgba(0,0,0,0.95)"; ctx.fillRect(0,0,1500,900);
    ctx.fillStyle = "white"; ctx.font = "bold 45px Arial"; ctx.textAlign = "center";
    ctx.fillText(`AGE ${gameState.age} RESULTS`, 750, 120);
    
    const data = gameState.summaryData;
    
    // Height Results
    ctx.textAlign = "left";
    ctx.fillStyle = COLORS.Gold; ctx.font = "bold 28px Arial";
    ctx.fillText("SAPLING HEIGHTS", 300, 220);
    data.heights.forEach((h, i) => {
        ctx.fillStyle = COLORS[h.name]; ctx.font = "22px Arial";
        let markText = (h.name === data.shortestName) ? " (Shortest! Marks triggered)" : "";
        ctx.fillText(`${h.name}: ${h.val}ft ${markText}`, 300, 270 + i*40);
    });

    // Hunger Results
    ctx.fillStyle = "#8f8"; ctx.font = "bold 28px Arial";
    ctx.fillText(`SHARING ${gameState.hunger.toUpperCase()}`, 850, 220);
    data.hungers.forEach((hu, i) => {
        ctx.fillStyle = COLORS[hu.name]; ctx.font = "22px Arial";
        let bonus = "";
        if (hu.name === data.hWinner) bonus = " (+15 Bonus)";
        if (data.hLosers.includes(hu.name)) bonus = " (-8 Penalty)";
        ctx.fillText(`${hu.name}: ${hu.val} units ${bonus}`, 850, 270 + i*40);
    });

    // Mark Winners
    if (data.markWinners.length > 0) {
        ctx.fillStyle = COLORS.Gold; ctx.textAlign = "center";
        ctx.font = "24px Arial";
        ctx.fillText(`Mark Success! +10 Roots for: ${data.markWinners.join(", ")}`, 750, 600);
    }

    ctx.fillStyle = "white"; ctx.textAlign = "center"; ctx.font = "20px Arial";
    ctx.fillText("Click anywhere to begin the next Age", 750, 800);
}

// Start Loop
requestAnimationFrame(draw);
