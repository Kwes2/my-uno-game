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
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const my = (e.clientY - rect.top) * (canvas.height / rect.height);

    if (gameState?.state === "LOBBY") {
        if (mx > 600 && mx < 900 && my > 650 && my < 750) socket.emit('startGame', roomId);
    }
    
    if (gameState?.state === "SUMMARY") socket.emit('nextAge', roomId);

    const me = gameState?.players.find(p => p.name === myColor);
    if (me && gameState.state === "DISCARD") {
        if (mx > 650 && mx < 850 && my > 620 && my < 660) confirmDiscard(me);
    }
});

function confirmDiscard(me) {
    const indices = me.hand.map((c, i) => c.selectedForDiscard ? i : -1).filter(i => i !== -1);
    if (indices.length === 5) {
        socket.emit('submitDiscard', { roomId, discardIndices: indices });
    }
}

function joinRoom() {
    roomId = document.getElementById('roomInput').value;
    if (roomId) {
        socket.emit('joinRoom', roomId);
        document.getElementById('setup').style.display = 'none';
        canvas.style.display = 'block';
    }
}

socket.on('assignedColor', (c) => myColor = c);
socket.on('gameState', (data) => { gameState = data; cursor = 0; });

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

    ctx.fillStyle = COLORS[card.target];
    ctx.beginPath(); ctx.roundRect(x, dy, w, h, 10); ctx.fill();
    ctx.strokeStyle = isSelected ? COLORS.Gold : "white";
    ctx.lineWidth = isSelected ? 4 : 2; ctx.stroke();

    ctx.fillStyle = "white"; ctx.textAlign = "center";
    ctx.font = `bold ${isSmall ? 12 : 14}px Arial`;
    ctx.fillText(card.target, x + w/2, dy + 25);
    ctx.font = `bold ${isSmall ? 30 : 40}px Arial`;
    ctx.fillText(card.value, x + w/2, dy + h/2 + 10);
    
    drawNutrientIcon(x + w/2, dy + h - 25, card.n_type, "white", isSmall ? 0.6 : 0.8);

    if (card.selectedForDiscard) {
        ctx.fillStyle = "rgba(255, 0, 0, 0.5)";
        ctx.fillRect(x, dy, w, h);
    }
}

function draw() {
    ctx.fillStyle = COLORS.Black; ctx.fillRect(0, 0, 1500, 900);
    if (!gameState) return;

    if (gameState.state === "LOBBY") {
        ctx.fillStyle = COLORS.Gold; ctx.font = "60px Arial"; ctx.textAlign = "center";
        ctx.fillText("MOTHER TREE LOBBY", 750, 200);
        gameState.players.forEach((p, i) => {
            ctx.fillStyle = COLORS[p.name]; ctx.font = "30px Arial";
            ctx.fillText(`${p.name} ${p.name === myColor ? "(YOU)" : ""}`, 750, 300 + i*50);
        });
        ctx.fillStyle = COLORS.DarkGray; ctx.fillRect(600, 650, 300, 100);
        ctx.fillStyle = "white"; ctx.fillText("START", 750, 715);
    } else {
        // Draw Players
        gameState.players.forEach((p, i) => {
            const x = 50 + i * 280; const y = 50;
            ctx.fillStyle = COLORS.DarkGray; ctx.beginPath(); ctx.roundRect(x, y, 250, 180, 10); ctx.fill();
            ctx.strokeStyle = COLORS[p.name]; ctx.lineWidth = 3; ctx.stroke();

            ctx.fillStyle = "white"; ctx.textAlign = "left"; ctx.font = "bold 18px Arial";
            ctx.fillText(p.name, x + 15, y + 30);
            ctx.font = "14px Arial";
            ctx.fillText(`Roots: ${p.rootDepth}`, x + 15, y + 60);
            ctx.fillText(`Height: ${p.saplingHeight}ft`, x + 15, y + 85);
            ctx.fillText(`Sharing ${gameState.hunger}: ${p.hungerContrib}`, x + 15, y + 110);
            
            if (p.playedCard && (gameState.state === "REVEAL")) {
                drawCard(x + 140, y + 40, p.playedCard, false, true);
            }
        });

        // Board Info
        ctx.fillStyle = COLORS.Gray; ctx.fillRect(50, 250, 400, 100);
        ctx.fillStyle = COLORS.Gold; ctx.font = "bold 25px Arial";
        ctx.fillText(`AGE ${gameState.age} | ROUND ${gameState.round}`, 70, 290);
        ctx.fillStyle = COLORS.White;
        ctx.fillText(`NEED: ${gameState.hunger}`, 70, 325);

        // Logs
        gameState.logs.slice(-5).forEach((log, i) => {
            ctx.fillStyle = "#aaa"; ctx.font = "14px Arial";
            ctx.fillText(log, 500, 275 + i*20);
        });

        // Hand
        const me = gameState.players.find(p => p.name === myColor);
        if (me && (gameState.state === "DECIDE" || gameState.state === "DISCARD")) {
            const startX = 750 - (me.hand.length * 55);
            me.hand.forEach((card, i) => {
                drawCard(startX + i * 110, 700, card, i === cursor);
            });
            ctx.fillStyle = "white"; ctx.textAlign = "center";
            const msg = gameState.state === "DECIDE" ? "PLAY A CARD [ENTER]" : "SELECT 5 TO DISCARD [SPACE TO CONFIRM]";
            ctx.fillText(msg, 750, 670);
            
            if (gameState.state === "DISCARD") {
                ctx.fillStyle = COLORS.DarkGray; ctx.fillRect(650, 620, 200, 40);
                ctx.fillStyle = "white"; ctx.font = "16px Arial"; ctx.fillText("CONFIRM DISCARD", 750, 645);
            }
        }

        if (gameState.state === "MARK" && me) {
            ctx.fillStyle = "rgba(0,0,0,0.8)"; ctx.fillRect(0,0,1500,900);
            ctx.fillStyle = "white"; ctx.font = "40px Arial"; ctx.fillText("SELECT A RIVAL TO MARK", 750, 300);
            me.availableMarks.forEach((m, i) => {
                ctx.fillStyle = (i === cursor) ? COLORS[m] : COLORS.Gray;
                ctx.fillRect(400 + i*150, 400, 120, 80);
                ctx.fillStyle = "white"; ctx.font = "20px Arial"; ctx.fillText(m, 460 + i*150, 445);
            });
        }
    }

    if (gameState.state === "SUMMARY") {
        ctx.fillStyle = "rgba(0,0,0,0.9)"; ctx.fillRect(0,0,1500,900);
        ctx.fillStyle = "white"; ctx.font = "40px Arial"; ctx.textAlign = "center";
        ctx.fillText(`AGE ${gameState.age} RESULTS`, 750, 150);
        
        const data = gameState.summaryData;
        data.heights.forEach((h, i) => {
            ctx.fillStyle = COLORS[h.name]; ctx.font = "20px Arial";
            let bonus = (h.name === data.shortestName) ? " (MARKED! +10 to others)" : "";
            ctx.fillText(`${h.name}: ${h.val}ft ${bonus}`, 500, 250 + i*30);
        });

        data.hungers.forEach((hu, i) => {
            ctx.fillStyle = COLORS[hu.name];
            let bonus = (hu.name === data.hWinner) ? " (+15 Reward)" : "";
            if (data.hLosers.includes(hu.name)) bonus = " (-8 Penalty)";
            ctx.fillText(`${hu.name} shared ${hu.val} ${gameState.hunger}${bonus}`, 1000, 250 + i*30);
        });

        ctx.fillStyle = COLORS.Gold; ctx.fillText("CLICK ANYWHERE TO CONTINUE", 750, 800);
    }

    requestAnimationFrame(draw);
}
draw();
