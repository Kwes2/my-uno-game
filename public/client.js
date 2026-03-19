const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let gameState = null;
let myColor = null;
let cursor = 0;
let roomId = "";

const COLOR_MAP = {
    "Red": "rgb(200, 50, 50)", "Blue": "rgb(50, 100, 200)",
    "Yellow": "rgb(210, 210, 50)", "Green": "rgb(50, 170, 70)",
    "Pink": "rgb(200, 70, 200)", "Gold": "rgb(255, 215, 0)",
    "White": "#f0f0f5", "Black": "#0f0f14", "Gray": "#32323c"
};

const COLOR_NAMES = ["Red", "Blue", "Yellow", "Green", "Pink"];

// --- INPUT HANDLING ---
window.addEventListener('keydown', (e) => {
    if (!gameState) return;
    const me = gameState.players.find(p => p.name === myColor);
    if (!me) return;

    let limit = (gameState.state === "MARK") ? me.availableMarks.length - 1 : me.hand.length - 1;

    if (e.key === "ArrowLeft") cursor = Math.max(0, cursor - 1);
    if (e.key === "ArrowRight") cursor = Math.min(limit, cursor + 1);

    if (e.key === "Enter") {
        if (gameState.state === "DISCARD") {
            me.hand[cursor].selectedForDiscard = !me.hand[cursor].selectedForDiscard;
        } else if (gameState.state === "DECIDE") {
            socket.emit('playCard', { roomId, cardIndex: cursor });
        } else if (gameState.state === "MARK") {
            socket.emit('selectMark', { roomId, mark: me.availableMarks[cursor] });
            cursor = 0;
        }
    }

    if (e.key === " ") {
        if (gameState.state === "LOBBY") socket.emit('startGame', roomId);
        if (gameState.state === "DISCARD") {
            const discards = me.hand.map((c, i) => c.selectedForDiscard ? i : -1).filter(i => i !== -1);
            if (discards.length === 5) socket.emit('submitDiscard', { roomId, discardIndices: discards });
        }
    }
});

function joinRoom() {
    roomId = document.getElementById('roomInput').value;
    if (roomId) {
        socket.emit('joinRoom', roomId);
        document.getElementById('setup').style.display = 'none';
        canvas.style.display = 'block';
    }
}

socket.on('assignedColor', (color) => { myColor = color; });
socket.on('gameState', (data) => { gameState = data; });

// --- DRAWING FUNCTIONS ---

function drawNutrientIcon(x, y, type, color, size) {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 3 * size;

    if (type === "Sticks") {
        ctx.beginPath(); ctx.moveTo(x-8*size, y+8*size); ctx.lineTo(x+8*size, y-8*size); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x-2*size, y+8*size); ctx.lineTo(x+14*size, y-8*size); ctx.stroke();
    } else if (type === "Leaves") {
        ctx.beginPath();
        ctx.moveTo(x, y-12*size); ctx.lineTo(x+8*size, y); ctx.lineTo(x, y+12*size); ctx.lineTo(x-8*size, y);
        ctx.closePath(); ctx.fill();
    } else if (type === "Resin") {
        ctx.beginPath(); ctx.arc(x, y+4*size, 8*size, 0, Math.PI*2); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x-8*size, y+4*size); ctx.lineTo(x+8*size, y+4*size); ctx.lineTo(x, y-12*size);
        ctx.closePath(); ctx.fill();
    }
}

function drawCard(x, y, card, isSelected, small = false) {
    const w = small ? 70 : 90;
    const h = small ? 100 : 130;
    if (isSelected) y -= 20;

    // Shadow & Base
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(x+4, y+4, w, h);
    ctx.fillStyle = COLOR_MAP[card.target];
    ctx.strokeStyle = "white";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 8); ctx.fill(); ctx.stroke();

    // Header
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath(); ctx.roundRect(x, y, w, small?20:30, [8,8,0,0]); ctx.fill();
    
    ctx.fillStyle = "white";
    ctx.font = "bold 12px Verdana";
    ctx.textAlign = "center";
    ctx.fillText(card.target.toUpperCase(), x + w/2, y + 18);

    // Value
    ctx.font = `bold ${small?30:45}px Verdana`;
    ctx.fillText(card.value, x + w/2, y + h/2 + 10);

    drawNutrientIcon(x + w/2, y + h - 20, card.n_type, "white", small ? 0.7 : 1.0);
    
    if (card.selectedForDiscard) {
        ctx.fillStyle = "rgba(200, 0, 0, 0.6)";
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = "white"; ctx.strokeText("X", x+w/2, y+h/2);
    }
}

function gameLoop() {
    ctx.fillStyle = COLOR_MAP.Black;
    ctx.fillRect(0, 0, 1500, 900);

    if (!gameState) {
        requestAnimationFrame(gameLoop);
        return;
    }

    // Draw Players
    gameState.players.forEach((p, i) => {
        let x = 20 + (i * 290);
        let y = 40;
        ctx.strokeStyle = COLOR_MAP[p.name];
        ctx.fillStyle = "#1e1e23";
        ctx.beginPath(); ctx.roundRect(x, y, 275, 200, 12); ctx.fill(); ctx.stroke();

        ctx.fillStyle = COLOR_MAP[p.name];
        ctx.font = "bold 20px Verdana";
        ctx.textAlign = "left";
        ctx.fillText(p.name + (p.name === myColor ? " (YOU)" : ""), x + 15, y + 30);

        ctx.fillStyle = "white";
        ctx.font = "bold 14px Verdana";
        ctx.fillText(`Roots: ${p.rootDepth}`, x + 15, y + 60);
        ctx.fillText(`Height: ${p.saplingHeight}ft`, x + 15, y + 85);
        ctx.fillText(`Sharing ${gameState.hunger}: ${p.hungerContrib}`, x + 15, y + 110);
        
        if (p.currentMark) {
            ctx.fillStyle = COLOR_MAP[p.currentMark];
            ctx.fillRect(x + 15, y + 160, 100, 25);
            ctx.fillStyle = "white";
            ctx.fillText("MARK: " + p.currentMark, x + 20, y + 178);
        }

        if (p.playedCard && (gameState.state === "REVEAL" || gameState.state === "RESOLVE")) {
            drawCard(x + 180, y + 65, p.playedCard, false, true);
        }
    });

    // Draw Age/Round Info
    ctx.fillStyle = "#1e1e23";
    ctx.beginPath(); ctx.roundRect(40, 270, 400, 120, 10); ctx.fill();
    ctx.fillStyle = COLOR_MAP.Gold;
    ctx.font = "bold 32px Verdana";
    ctx.fillText(`AGE ${gameState.age} | RD ${gameState.round}`, 60, 315);
    ctx.fillStyle = COLOR_MAP.Green;
    ctx.font = "bold 20px Verdana";
    ctx.fillText(`DEMAND: ${gameState.hunger}`, 60, 360);

    // Draw Logs
    ctx.fillStyle = "gray";
    ctx.font = "bold 14px Verdana";
    gameState.logs.slice(-5).forEach((log, i) => {
        ctx.fillText("• " + log, 500, 290 + (i * 22));
    });

    // Draw Hand (Local Player)
    const me = gameState.players.find(p => p.name === myColor);
    if (me && (gameState.state === "DISCARD" || gameState.state === "DECIDE")) {
        let startX = (1500 - (me.hand.length * 105)) / 2;
        me.hand.forEach((card, i) => {
            drawCard(startX + (i * 105), 730, card, (i === cursor));
        });
    }

    // Draw Mark Choice Overlay
    if (gameState.state === "MARK" && me) {
        ctx.fillStyle = "rgba(0,0,0,0.8)";
        ctx.fillRect(0,0,1500,900);
        ctx.fillStyle = COLOR_MAP.Gold;
        ctx.textAlign = "center";
        ctx.fillText("CHOOSE A SAPLING TO MARK", 750, 200);
        me.availableMarks.forEach((m, i) => {
            let mx = 750 - 500 + (i * 210);
            ctx.fillStyle = (i === cursor) ? COLOR_MAP[m] : "#1e1e23";
            ctx.beginPath(); ctx.roundRect(mx, 450, 180, 100, 15); ctx.fill();
            ctx.fillStyle = (i === cursor) ? "white" : COLOR_MAP[m];
            ctx.fillText(m, mx + 90, 510);
        });
    }

    requestAnimationFrame(gameLoop);
}

gameLoop();
