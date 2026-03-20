const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let gameState = null;
let myColor = null;
let roomId = "";
let cursor = 0; // Local keyboard cursor

const COLORS = {
    "Red": "#c83232", "Blue": "#3264c8", "Yellow": "#d2d232",
    "Green": "#32aa46", "Pink": "#c846c8", "Gold": "#ffd700",
    "White": "#f0f0f5", "Black": "#0f0f14", "Gray": "#32323c",
    "DarkGray": "#1e1e23"
};

const NUTRIENTS = ["Sticks", "Leaves", "Resin"];

// --- INPUT HANDLING ---

window.addEventListener('keydown', (e) => {
    if (!gameState) return;
    const me = gameState.players.find(p => p.name === myColor);
    if (!me) return;

    let limit = 0;
    if (gameState.state === "MARK") limit = me.availableMarks.length - 1;
    if (gameState.state === "DISCARD" || gameState.state === "DECIDE") limit = me.hand.length - 1;

    if (e.key === "ArrowLeft") cursor = Math.max(0, cursor - 1);
    if (e.key === "ArrowRight") cursor = Math.min(limit, cursor + 1);

    if (e.key === "Enter") {
        if (gameState.state === "MARK") selectMark(me.availableMarks[cursor]);
        if (gameState.state === "DECIDE") playCard(cursor);
        if (gameState.state === "DISCARD") me.hand[cursor].selectedForDiscard = !me.hand[cursor].selectedForDiscard;
    }

    if (e.key === " ") {
        if (gameState.state === "SUMMARY") socket.emit('nextAge', roomId);
        if (gameState.state === "DISCARD") {
            const indices = me.hand.map((c, i) => c.selectedForDiscard ? i : -1).filter(i => i !== -1);
            if (indices.length === 5) socket.emit('submitDiscard', { roomId, discardIndices: indices });
        }
    }
});

canvas.addEventListener('mousedown', (e) => {
    if (!gameState) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const me = gameState.players.find(p => p.name === myColor);
    if (!me) return;

    // Lobby Start
    if (gameState.state === "LOBBY" && mx > 600 && mx < 900 && my > 650 && my < 750) socket.emit('startGame', roomId);

    // Mark Selection
    if (gameState.state === "MARK") {
        me.availableMarks.forEach((m, i) => {
            let bx = 750 - 500 + (i * 210);
            if (mx > bx && mx < bx + 180 && my > 450 && my < 550) selectMark(m);
        });
    }

    // Hand Clicks
    if (gameState.state === "DISCARD" || gameState.state === "DECIDE") {
        let startX = (1500 - (me.hand.length * 105)) / 2;
        me.hand.forEach((c, i) => {
            let cx = startX + (i * 105);
            if (mx > cx && mx < cx + 90 && my > 730 && my < 860) {
                cursor = i;
                if (gameState.state === "DECIDE") playCard(i);
                else c.selectedForDiscard = !c.selectedForDiscard;
            }
        });
        // Confirm Discard Button
        if (gameState.state === "DISCARD" && mx > 650 && mx < 850 && my > 650 && my < 700) {
            const indices = me.hand.map((c, i) => c.selectedForDiscard ? i : -1).filter(i => i !== -1);
            if (indices.length === 5) socket.emit('submitDiscard', { roomId, discardIndices: indices });
        }
    }

    // Summary Advance
    if (gameState.state === "SUMMARY" && my > 750) socket.emit('nextAge', roomId);
});

function selectMark(mark) { socket.emit('selectMark', { roomId, mark }); cursor = 0; }
function playCard(idx) { socket.emit('playCard', { roomId, cardIndex: idx }); cursor = 0; }

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

// --- DRAWING ---

function drawNutrientIcon(x, y, type, color, size) {
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 3 * size;
    if (type === "Sticks") {
        ctx.beginPath(); ctx.moveTo(x - 8 * size, y + 8 * size); ctx.lineTo(x + 8 * size, y - 8 * size); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x - 2 * size, y + 8 * size); ctx.lineTo(x + 14 * size, y - 8 * size); ctx.stroke();
    } else if (type === "Leaves") {
        ctx.beginPath(); ctx.moveTo(x, y - 12 * size); ctx.lineTo(x + 8 * size, y); ctx.lineTo(x, y + 12 * size); ctx.lineTo(x - 8 * size, y); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = "black"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y - 10 * size); ctx.lineTo(x, y + 10 * size); ctx.stroke();
    } else if (type === "Resin") {
        ctx.beginPath(); ctx.arc(x, y + 4 * size, 8 * size, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.moveTo(x - 8 * size, y + 4 * size); ctx.lineTo(x + 8 * size, y + 4 * size); ctx.lineTo(x, y - 12 * size); ctx.closePath(); ctx.fill();
    }
}

function drawCard(x, y, card, isSelected, isSmall = false) {
    const w = isSmall ? 70 : 90; const h = isSmall ? 100 : 130;
    const drawY = isSelected ? y - 25 : y;
    
    // Shadow & Base
    ctx.fillStyle = "rgba(0,0,0,0.4)"; ctx.beginPath(); ctx.roundRect(x + 4, drawY + 4, w, h, 8); ctx.fill();
    ctx.fillStyle = COLORS[card.target]; ctx.beginPath(); ctx.roundRect(x, drawY, w, h, 8); ctx.fill();
    ctx.strokeStyle = "white"; ctx.lineWidth = 2; ctx.stroke();

    // Header bar
    ctx.fillStyle = "rgba(0,0,0,0.2)"; ctx.beginPath(); ctx.roundRect(x, drawY, w, isSmall ? 20 : 30, { tl: 8, tr: 8, bl: 0, br: 0 }); ctx.fill();
    
    // Text
    ctx.fillStyle = "white"; ctx.textAlign = "center";
    ctx.font = `bold ${isSmall ? 10 : 12}px Verdana`; ctx.fillText(card.target.toUpperCase(), x + w / 2, drawY + (isSmall ? 15 : 20));
    ctx.font = `bold ${isSmall ? 30 : 45}px Verdana`; ctx.fillText(card.value, x + w / 2, drawY + (isSmall ? 60 : 75));

    drawNutrientIcon(x + w / 2, drawY + h - 25, card.n_type, "white", isSmall ? 0.7 : 1.0);

    if (isSelected) {
        ctx.strokeStyle = COLORS.Gold; ctx.lineWidth = 4; ctx.beginPath(); ctx.roundRect(x - 2, drawY - 2, w + 4, h + 4, 10); ctx.stroke();
    }
    if (card.selectedForDiscard) {
        ctx.fillStyle = "rgba(0,0,0,0.7)"; ctx.fillRect(x, drawY, w, h);
        ctx.strokeStyle = COLORS.Red; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(x + 10, drawY + 10); ctx.lineTo(x + w - 10, drawY + h - 10); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x + w - 10, drawY + 10); ctx.lineTo(x + 10, drawY + h - 10); ctx.stroke();
    }
}

function drawUI() {
    ctx.fillStyle = COLORS.Black; ctx.fillRect(0, 0, 1500, 900);
    if (!gameState) return;

    if (gameState.state === "LOBBY") {
        ctx.fillStyle = COLORS.Gold; ctx.font = "bold 50px Verdana"; ctx.textAlign = "center";
        ctx.fillText("MOTHER TREE LOBBY", 750, 200);
        gameState.players.forEach((p, i) => {
            ctx.fillStyle = COLORS[p.name]; ctx.font = "30px Verdana";
            ctx.fillText(p.name + (p.name === myColor ? " (YOU)" : ""), 750, 300 + i * 60);
        });
        ctx.fillStyle = COLORS.DarkGray; ctx.fillRect(600, 650, 300, 100);
        ctx.fillStyle = "white"; ctx.fillText("START GAME", 750, 712);
    } else {
        // Player Info Boxes
        gameState.players.forEach((p, i) => {
            let x = 20 + (i * 290); let y = 40;
            ctx.fillStyle = COLORS.DarkGray; ctx.beginPath(); ctx.roundRect(x, y, 275, 200, 12); ctx.fill();
            ctx.strokeStyle = COLORS[p.name]; ctx.lineWidth = 2; ctx.stroke();
            
            ctx.fillStyle = COLORS[p.name]; ctx.font = "bold 20px Verdana"; ctx.textAlign = "left";
            ctx.fillText(p.name, x + 15, y + 35);
            ctx.fillStyle = COLORS.Gray; ctx.fillRect(x + 15, y + 45, 245, 1);

            ctx.fillStyle = "white"; ctx.font = "bold 14px Verdana";
            ctx.fillText(`Roots: ${p.rootDepth}`, x + 15, y + 70);
            ctx.fillText(`Height: ${p.saplingHeight}ft`, x + 15, y + 90);
            ctx.fillStyle = COLORS.Green;
            ctx.fillText(`Sharing ${gameState.hunger}: ${p.hungerContrib}`, x + 15, y + 110);

            // History Dots
            p.pastMarks.forEach((m, mi) => {
                ctx.fillStyle = COLORS[m]; ctx.beginPath(); ctx.roundRect(x + 15 + (mi * 35), y + 135, 30, 12, 3); ctx.fill();
                ctx.strokeStyle = "white"; ctx.lineWidth = 1; ctx.stroke();
            });

            // Mark Badge
            if (p.currentMark) {
                ctx.fillStyle = COLORS[p.currentMark]; ctx.beginPath(); ctx.roundRect(x + 15, y + 160, 110, 25, 5); ctx.fill();
                ctx.fillStyle = "white"; ctx.font = "bold 12px Verdana"; ctx.fillText(`MARK: ${p.currentMark}`, x + 22, y + 178);
            }

            // Reveal Played Card
            if (p.playedCard && (gameState.state === "REVEAL" || gameState.state === "RESOLVE")) {
                drawCard(x + 180, y + 65, p.playedCard, false, true);
            }
        });

        // Dashboard
        ctx.fillStyle = COLORS.DarkGray; ctx.beginPath(); ctx.roundRect(40, 270, 400, 120, 10); ctx.fill();
        ctx.fillStyle = COLORS.Gold; ctx.font = "bold 32px Verdana"; ctx.fillText(`AGE ${gameState.age} | RD ${Math.min(gameState.round, 5)}`, 60, 315);
        ctx.fillStyle = COLORS.Green; ctx.font = "bold 20px Verdana"; ctx.fillText(`DEMAND: ${gameState.hunger.toUpperCase()}`, 60, 355);
        drawNutrientIcon(350, 345, gameState.hunger, COLORS.Green, 1.2);

        // Logs
        gameState.logs.slice(-8).forEach((log, i) => {
            ctx.fillStyle = COLORS.Gray; ctx.font = "bold 14px Verdana"; ctx.textAlign = "left";
            ctx.fillText(`• ${log}`, 500, 290 + (i * 22));
        });

        // Player Controls
        const me = gameState.players.find(p => p.name === myColor);
        if (me) {
            if (gameState.state === "MARK") {
                ctx.fillStyle = "rgba(10,10,15,0.9)"; ctx.fillRect(0,0,1500,900);
                ctx.fillStyle = COLORS.Gold; ctx.font = "bold 50px Verdana"; ctx.textAlign = "center";
                ctx.fillText("CHOOSE A SAPLING TO MARK", 750, 200);
                me.availableMarks.forEach((m, i) => {
                    let bx = 750 - 500 + (i * 210);
                    ctx.fillStyle = (i === cursor) ? COLORS[m] : COLORS.DarkGray;
                    ctx.beginPath(); ctx.roundRect(bx, 450, 180, 100, 15); ctx.fill();
                    ctx.strokeStyle = COLORS[m]; ctx.lineWidth = 3; ctx.stroke();
                    ctx.fillStyle = (i === cursor) ? "white" : COLORS[m];
                    ctx.fillText(m, bx + 90, 510);
                });
            } else if (gameState.state === "DISCARD" || gameState.state === "DECIDE") {
                let startX = (1500 - (me.hand.length * 105)) / 2;
                me.hand.forEach((c, i) => drawCard(startX + (i * 105), 730, c, i === cursor));
                
                ctx.fillStyle = "white"; ctx.font = "bold 32px Verdana"; ctx.textAlign = "center";
                if (gameState.state === "DISCARD") {
                    ctx.fillText("SELECT 5 CARDS TO DISCARD [SPACE] TO CONFIRM", 750, 680);
                    ctx.fillStyle = COLORS.DarkGray; ctx.fillRect(650, 620, 200, 40);
                    ctx.fillStyle = "white"; ctx.font = "bold 18px Verdana"; ctx.fillText("CONFIRM (5)", 750, 646);
                } else {
                    ctx.fillText("CHOOSE A CARD TO PLAY [ENTER]", 750, 680);
                }
            }
        }
    }

    if (gameState.state === "SUMMARY") drawSummary();
}

function drawSummary() {
    const data = gameState.summaryData;
    ctx.fillStyle = "rgba(0,0,0,0.85)"; ctx.fillRect(0,0,1500,900);
    ctx.fillStyle = COLORS.DarkGray; ctx.beginPath(); ctx.roundRect(200, 150, 1100, 600, 20); ctx.fill();
    ctx.strokeStyle = COLORS.Gold; ctx.lineWidth = 3; ctx.stroke();

    ctx.fillStyle = "white"; ctx.font = "bold 45px Verdana"; ctx.textAlign = "left";
    ctx.fillText(`AGE ${gameState.age} RESULTS`, 240, 210);

    // Height Column
    ctx.fillStyle = COLORS.Gold; ctx.font = "bold 28px Verdana"; ctx.fillText("SAPLING HEIGHTS", 240, 280);
    data.heights.forEach((h, i) => {
        let txt = `${h.name}: ${h.val}ft`;
        if (h.name === data.shortestName) txt += ` (Marked by ${data.markWinners.join(', ')}, +10)`;
        ctx.fillStyle = COLORS[h.name]; ctx.font = "bold 18px Verdana";
        ctx.fillText(txt, 240, 330 + (i * 40));
    });

    // Hunger Column
    ctx.fillStyle = COLORS.Green; ctx.font = "bold 28px Verdana"; ctx.fillText(`SHARING: ${gameState.hunger}`, 800, 280);
    data.hungers.forEach((hu, i) => {
        let bonus = "";
        if (hu.name === data.hWinner) bonus = " (+15 Reward)";
        if (data.hLosers.includes(hu.name)) bonus = " (-8 Penalty)";
        ctx.fillStyle = COLORS[hu.name]; ctx.font = "bold 18px Verdana";
        ctx.fillText(`${hu.name}: ${hu.val}${bonus}`, 800, 330 + (i * 40));
    });

    ctx.fillStyle = COLORS.Gold; ctx.textAlign = "center";
    ctx.fillText("Click anywhere or press [SPACE] for next Age", 750, 720);
}

function loop() {
    drawUI();
    requestAnimationFrame(loop);
}
loop();
