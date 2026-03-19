const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let gameState = null;
let myColor = null;
let roomId = "";

const COLOR_MAP = {
    "Red": "rgb(200, 50, 50)", "Blue": "rgb(50, 100, 200)",
    "Yellow": "rgb(210, 210, 50)", "Green": "rgb(50, 170, 70)",
    "Pink": "rgb(200, 70, 200)", "Gold": "rgb(255, 215, 0)",
    "White": "#f0f0f5", "Black": "#0f0f14", "Gray": "#32323c"
};

// --- CLICK HANDLING ---
canvas.addEventListener('mousedown', function(e) {
    if (!gameState) return;
    
    // Get mouse position relative to canvas
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const me = gameState.players.find(p => p.name === myColor);
    if (!me) return;

    // 1. LOBBY CLICK (Start Game)
    if (gameState.state === "LOBBY") {
        if (mouseX > 600 && mouseX < 900 && mouseY > 650 && mouseY < 750) {
            socket.emit('startGame', roomId);
        }
    }

    // 2. MARK SELECTION CLICK
    if (gameState.state === "MARK") {
        me.availableMarks.forEach((m, i) => {
            let mx = 750 - 500 + (i * 210);
            let my = 450;
            if (mouseX > mx && mouseX < mx + 180 && mouseY > my && mouseY < my + 100) {
                console.log("Clicked Mark:", m);
                socket.emit('selectMark', { roomId, mark: m });
            }
        });
    }

    // 3. HAND/CARD CLICK
    if (gameState.state === "DISCARD" || gameState.state === "DECIDE") {
        let startX = (1500 - (me.hand.length * 105)) / 2;
        me.hand.forEach((card, i) => {
            let cx = startX + (i * 105);
            let cy = 730;
            if (mouseX > cx && mouseX < cx + 90 && mouseY > cy && mouseY < cy + 130) {
                if (gameState.state === "DECIDE") {
                    socket.emit('playCard', { roomId, cardIndex: i });
                } else if (gameState.state === "DISCARD") {
                    // Client-side toggle for visual feedback
                    card.selectedForDiscard = !card.selectedForDiscard;
                }
            }
        });

        // 4. CONFIRM DISCARD BUTTON
        if (gameState.state === "DISCARD") {
            if (mouseX > 650 && mouseX < 850 && mouseY > 650 && mouseY < 700) {
                const discards = me.hand.map((c, i) => c.selectedForDiscard ? i : -1).filter(i => i !== -1);
                if (discards.length === 5) {
                    socket.emit('submitDiscard', { roomId, discardIndices: discards });
                }
            }
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
socket.on('gameState', (data) => { 
    console.log("New State:", data.state);
    gameState = data; 
});

// --- DRAWING FUNCTIONS ---

function drawNutrientIcon(x, y, type, color, size) {
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 3 * size;
    if (type === "Sticks") {
        ctx.beginPath(); ctx.moveTo(x-8*size, y+8*size); ctx.lineTo(x+8*size, y-8*size); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x-2*size, y+8*size); ctx.lineTo(x+14*size, y-8*size); ctx.stroke();
    } else if (type === "Leaves") {
        ctx.beginPath(); ctx.moveTo(x, y-12*size); ctx.lineTo(x+8*size, y); ctx.lineTo(x, y+12*size); ctx.lineTo(x-8*size, y); ctx.closePath(); ctx.fill();
    } else if (type === "Resin") {
        ctx.beginPath(); ctx.arc(x, y+4*size, 8*size, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.moveTo(x-8*size, y+4*size); ctx.lineTo(x+8*size, y+4*size); ctx.lineTo(x, y-12*size); ctx.closePath(); ctx.fill();
    }
}

function drawCard(x, y, card, small = false) {
    const w = small ? 70 : 90; const h = small ? 100 : 130;
    ctx.fillStyle = COLOR_MAP[card.target]; ctx.strokeStyle = "white"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 8); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "white"; ctx.font = "bold 12px Verdana"; ctx.textAlign = "center";
    ctx.fillText(card.target.toUpperCase(), x + w/2, y + 18);
    ctx.font = `bold ${small?30:40}px Verdana`;
    ctx.fillText(card.value, x + w/2, y + h/2 + 10);
    drawNutrientIcon(x + w/2, y + h - 20, card.n_type, "white", small ? 0.7 : 1.0);
    if (card.selectedForDiscard) {
        ctx.fillStyle = "rgba(255, 0, 0, 0.5)"; ctx.fillRect(x,y,w,h);
    }
}

function gameLoop() {
    ctx.fillStyle = COLOR_MAP.Black;
    ctx.fillRect(0, 0, 1500, 900);
    if (!gameState) { requestAnimationFrame(gameLoop); return; }

    if (gameState.state === "LOBBY") {
        ctx.fillStyle = COLOR_MAP.Gold; ctx.font = "50px Verdana"; ctx.textAlign = "center";
        ctx.fillText("FOREST LOBBY: " + roomId, 750, 200);
        gameState.players.forEach((p, i) => {
            ctx.fillStyle = COLOR_MAP[p.name]; ctx.fillText(p.name + (p.name === myColor ? " (YOU)" : ""), 750, 300 + i*60);
        });
        ctx.fillStyle = "#1e1e23"; ctx.fillRect(600, 650, 300, 100);
        ctx.fillStyle = "white"; ctx.font = "30px Verdana"; ctx.fillText("START GAME", 750, 710);
    } else {
        // Draw Main Board
        gameState.players.forEach((p, i) => {
            let x = 20 + (i * 290); let y = 40;
            ctx.strokeStyle = COLOR_MAP[p.name]; ctx.strokeRect(x, y, 275, 200);
            ctx.fillStyle = COLOR_MAP[p.name]; ctx.font = "20px Verdana"; ctx.textAlign = "left";
            ctx.fillText(p.name, x+15, y+30);
            ctx.fillStyle = "white"; ctx.font = "14px Verdana";
            ctx.fillText(`Roots: ${p.rootDepth} | Height: ${p.saplingHeight}ft`, x+15, y+60);
            if (p.currentMark) { ctx.fillStyle = COLOR_MAP[p.currentMark]; ctx.fillRect(x+15, y+160, 100, 25); }
            if (p.playedCard && (gameState.state === "REVEAL" || gameState.state === "RESOLVE")) drawCard(x+180, y+65, p.playedCard, true);
        });

        // Draw Player Controls
        const me = gameState.players.find(p => p.name === myColor);
        if (me) {
            if (gameState.state === "MARK") {
                ctx.fillStyle = "rgba(0,0,0,0.8)"; ctx.fillRect(0,0,1500,900);
                ctx.fillStyle = "white"; ctx.textAlign = "center"; ctx.fillText("CLICK A SAPLING TO MARK", 750, 200);
                me.availableMarks.forEach((m, i) => {
                    let mx = 750 - 500 + (i * 210);
                    ctx.fillStyle = COLOR_MAP[m]; ctx.fillRect(mx, 450, 180, 100);
                    ctx.fillStyle = "white"; ctx.fillText(m, mx+90, 510);
                });
            }
            if (gameState.state === "DECIDE" || gameState.state === "DISCARD") {
                let startX = (1500 - (me.hand.length * 105)) / 2;
                me.hand.forEach((card, i) => drawCard(startX + (i * 105), 730, card));
                if (gameState.state === "DISCARD") {
                    ctx.fillStyle = "white"; ctx.fillRect(650, 650, 200, 50);
                    ctx.fillStyle = "black"; ctx.fillText("CONFIRM DISCARD (5)", 750, 685);
                }
            }
        }
    }
    requestAnimationFrame(gameLoop);
}
gameLoop();
