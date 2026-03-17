let ws;
let currentSortMode = 'palo';
let lastState = null;
let closeButtonLocked = false;
let isInitialRender = true;

const GameValidator = {
    findGroups: function(hand) {
        if (!hand || hand.length === 0) return { groups: [], leftovers: [] };
        let bestResult = { groups: [], leftovers: [...hand] };

        const solve = (currentCards, currentGroups) => {
            let foundAnyGroup = false;
            for (let size = currentCards.length; size >= 3; size--) {
                let combos = this.getSubsets(currentCards, size);
                for (let combo of combos) {
                    if (this.isValidGroup(combo)) {
                        foundAnyGroup = true;
                        let remaining = currentCards.filter(c => !this.isSameCardInArray(combo, c));
                        solve(remaining, [...currentGroups, combo]);
                    }
                }
            }
            if (!foundAnyGroup || currentGroups.length >= 2) {
                let currentPoints = this.countPoints(currentCards);
                let bestPoints = this.countPoints(bestResult.leftovers);
                if (currentPoints < bestPoints) {
                    bestResult = { groups: currentGroups, leftovers: currentCards };
                }
            }
        };
        solve(hand, []);
        return bestResult;
    },

    isSameCardInArray: function(arr, card) {
        return arr.some(c => c.numero === card.numero && c.palo === card.palo && c.comodin === card.comodin);
    },

    countPoints: function(cards) {
        return cards.reduce((acc, c) => acc + (c.comodin ? 25 : c.numero), 0);
    },

    check: function(hand8) {
        if (!hand8 || hand8.length !== 8) return { can: false, pts: 0 };
        for (let i = 0; i < 8; i++) {
            let h7 = hand8.filter((_, idx) => idx !== i);
            let res = this.findGroups(h7);
            if (res.leftovers.length === 0) return { can: true, pts: -10, card_idx: i };
            let pts = this.countPoints(res.leftovers);
            if (pts <= 3) return { can: true, pts: pts, card_idx: i };
        }
        return { can: false, pts: 0 };
    },

    isValidGroup: function(group) {
        const wildcards = group.filter(c => c.comodin).length;
        if (wildcards > 1) return false;
        const normals = group.filter(c => !c.comodin);
        if (normals.every(c => c.numero === normals[0].numero)) return true;
        return this.isStrictRun(group);
    },

    isStrictRun: function(group) {
        if (group.length < 3) return false;
        const wildcards = group.filter(c => c.comodin).length;
        const normals = group.filter(c => !c.comodin);
        if (normals.length === 0) return true;
        const palo = normals[0].palo;
        if (!normals.every(c => c.palo === palo)) return false;
        let nums = normals.map(c => c.numero).sort((a,b) => a-b);
        let gaps = 0;
        for (let i = 0; i < nums.length - 1; i++) {
            let diff = nums[i+1] - nums[i];
            if (diff === 0) return false; 
            gaps += (diff - 1);
        }
        return gaps <= wildcards;
    },

    getSubsets: function(array, size) {
        let result = [];
        const helper = (start, current) => {
            if (current.length === size) { result.push([...current]); return; }
            for (let i = start; i < array.length; i++) {
                current.push(array[i]);
                helper(i + 1, current);
                current.pop();
            }
        };
        helper(0, []);
        return result;
    }
};

function joinGame() {
    const name = document.getElementById("username").value;
    const room = document.getElementById("room-code").value;
    if (!name || !room) return alert("Rellena nombre y sala");
    document.getElementById("login-screen").style.display = "none";
    document.getElementById("game-board").style.display = "flex";
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(`${protocol}//${window.location.host}/ws/${room}/${name}`);
    ws.onmessage = (e) => {
        let msg = JSON.parse(e.data);
        if (msg.type === "showdown") {
            handleShowdown(msg);
        } else {
            if (msg.my_hand && msg.my_hand.length === 7) closeButtonLocked = false;
            if (lastState && JSON.stringify(lastState.scores) !== JSON.stringify(msg.scores)) {
                animateScoreboard(lastState.scores, msg.scores);
            } else {
                renderScoreboard(msg.scores);
            }
            lastState = msg;
            updateBoard();
        }
    };
}

function animateScoreboard(oldScores, newScores) {
    const scoreboard = document.getElementById("scoreboard");
    scoreboard.classList.add("score-ticking");
    let current = {...oldScores};
    let interval = setInterval(() => {
        let done = true;
        for (let key in newScores) {
            if (current[key] < newScores[key]) {
                current[key]++;
                done = false;
            } else if (current[key] > newScores[key]) {
                current[key]--;
                done = false;
            }
        }
        renderScoreboard(current);
        if (done) {
            clearInterval(interval);
            scoreboard.classList.remove("score-ticking");
        }
    }, 40);
}

function renderScoreboard(scores) {
    document.getElementById("scoreboard").innerText = Object.entries(scores).map(([n, s]) => `${n}: ${s}`).join(" | ");
}

function updateBoard() {
    if (!lastState) return;
    document.getElementById("deck-count").innerText = lastState.deck_count;
    
    const statusText = document.getElementById("opponent-status");
    const statusContainer = document.getElementById("status-container");
    const newStatus = lastState.my_turn ? "Tu turno" : "Turno del rival";

    if (statusText.innerText !== newStatus) {
        statusText.classList.add("fade-out-turn");
        setTimeout(() => {
            statusText.innerText = newStatus;
            statusContainer.style.justifyContent = lastState.my_turn ? "flex-start" : "flex-end";
            statusText.classList.remove("fade-out-turn");
        }, 300);
    }

    const pozoDiv = document.getElementById("pozo");
    pozoDiv.innerHTML = "";
    if (lastState.pozo) {
        const pCard = createCardElement(lastState.pozo);
        if (lastState.pozo.boca_abajo) pCard.classList.add("boca-abajo");
        pozoDiv.appendChild(pCard);
    }
    
    renderHand();

    const closeBtn = document.getElementById("close-btn");
    if (!closeButtonLocked) {
        if (lastState.my_turn && lastState.my_hand && lastState.my_hand.length === 8) {
            const result = GameValidator.check(lastState.my_hand);
            if (result.can) {
                closeBtn.disabled = false;
                closeBtn.classList.add("ready");
                closeBtn.onclick = () => {
                    closeButtonLocked = true;
                    ws.send(JSON.stringify({type: "close", points: result.pts, card_idx: result.card_idx}));
                };
            } else {
                closeBtn.disabled = true;
                closeBtn.classList.remove("ready");
            }
        } else {
            closeBtn.disabled = true;
            closeBtn.classList.remove("ready");
        }
    }

    document.getElementById("deck").onclick = () => {
        if (lastState.my_turn && lastState.my_hand.length === 7) ws.send(JSON.stringify({type: "draw_deck"}));
    };
    pozoDiv.onclick = () => {
        if (lastState.my_turn && lastState.my_hand.length === 7 && lastState.pozo && !lastState.pozo.boca_abajo) {
            ws.send(JSON.stringify({type: "draw_pozo"}));
        }
    };
}

function renderHand() {
    const myHandDiv = document.getElementById("my-hand");
    // Obtenemos IDs de cartas actuales antes de limpiar para saber cuál es nueva
    const currentCardIds = Array.from(myHandDiv.children).map(c => c.dataset.id);
    
    myHandDiv.innerHTML = "";
    if (!lastState.my_hand) return;

    const analysis = GameValidator.findGroups(lastState.my_hand);
    let cardsWithMeta = [];
    
    analysis.groups.forEach((group, index) => {
        group.forEach(card => {
            cardsWithMeta.push({...card, groupClass: index === 0 ? 'grupo-1' : 'grupo-2'});
        });
    });
    
    let leftovers = [...analysis.leftovers];
    if (currentSortMode === 'palo') {
        leftovers.sort((a,b) => a.palo.localeCompare(b.palo) || a.numero - b.numero);
    } else {
        leftovers.sort((a,b) => a.numero - b.numero || a.palo.localeCompare(b.palo));
    }
    leftovers.forEach(card => cardsWithMeta.push({...card, groupClass: null}));

    cardsWithMeta.forEach((card, index) => {
        const cardElem = createCardElement(card);
        const cardId = `${card.numero}-${card.palo}-${card.comodin}`;
        cardElem.dataset.id = cardId;
        
        if (card.groupClass) cardElem.classList.add(card.groupClass);
        
        // ANIMACIÓN: Si es carga inicial, o si la carta NO estaba en el render anterior
        if (isInitialRender || !currentCardIds.includes(cardId)) {
             cardElem.classList.add('card-animate');
             // Retraso escalonado solo si es el render inicial (reparto)
             cardElem.style.animationDelay = isInitialRender ? `${index * 0.15}s` : "0s";
        }

        cardElem.onclick = () => {
            if (lastState.my_turn && lastState.my_hand.length === 8) {
                const originalIdx = lastState.my_hand.findIndex(oc => 
                    oc.numero === card.numero && oc.palo === card.palo && oc.comodin === card.comodin
                );
                ws.send(JSON.stringify({type: "discard", card_idx: originalIdx}));
            }
        };
        myHandDiv.appendChild(cardElem);
    });
    
    isInitialRender = false;
}

// Función para las partículas de oro
function createGoldRain() {
    for (let i = 0; i < 50; i++) {
        const particle = document.createElement('div');
        particle.className = 'gold-particle';
        particle.style.left = Math.random() * 100 + 'vw';
        particle.style.animationDuration = (Math.random() * 2 + 2) + 's';
        particle.style.animationDelay = Math.random() * 2 + 's';
        document.body.appendChild(particle);
        setTimeout(() => particle.remove(), 4000);
    }
}

function handleShowdown(state) {
    const overlay = document.getElementById("showdown-overlay");
    overlay.style.display = "flex";
    overlay.innerHTML = "";
    
    if (state.points_type === -10) createGoldRain();

    Object.entries(state.all_hands).forEach(([player, hand]) => {
        const pDiv = document.createElement("div");
        pDiv.className = "showdown-player";
        
        let label = "LOSE";
        let color = "#ff4444";
        if (player === state.winner) {
            if (state.points_type === -10) { label = "CHINCHÓN"; color = "gold"; }
            else { label = "WIN"; color = "#44ff44"; }
        }

        const ptsRonda = state.round_results[player];
        const ptsAnteriores = lastState.scores[player] || 0;
        const ptsTotales = ptsAnteriores + ptsRonda; // Suma correcta para la UI

        pDiv.innerHTML = `
            <div class="round-points" style="color: ${color}">${ptsRonda >= 0 ? '+' + ptsRonda : ptsRonda}</div>
            <div class="player-info-reveal">
                <h1 style="color: ${color}" class="${label === 'CHINCHÓN' ? 'chinchon-glow' : ''}">${label}</h1>
                <h2 style="margin: 5px 0">${player}</h2>
                <div style="font-weight: bold; margin-bottom: 10px;">Total: ${ptsTotales} pts</div>
                <div class="reveal-cards"></div>
            </div>`;
            
        const cardContainer = pDiv.querySelector(".reveal-cards");
        const analysis = GameValidator.findGroups(hand);
        
        analysis.groups.forEach((g, i) => g.forEach(c => {
            let el = createCardElement(c);
            el.classList.add(i === 0 ? 'grupo-1' : 'grupo-2');
            cardContainer.appendChild(el);
        }));
        analysis.leftovers.forEach(c => cardContainer.appendChild(createCardElement(c)));
        overlay.appendChild(pDiv);
    });

    // Botón Revancha / Continuar
    const revanchaBtn = document.createElement("button");
    revanchaBtn.className = "reload-btn";
    revanchaBtn.innerText = state.game_over ? "REVANCHA" : "SIGUIENTE RONDA";
    revanchaBtn.style.marginTop = "20px";
    revanchaBtn.onclick = () => {
        overlay.style.display = "none";
        if (state.game_over) location.reload();
    };
    overlay.appendChild(revanchaBtn);
}

function showGameOver(state) {
    const goOverlay = document.getElementById("game-over-overlay");
    const resultsDiv = document.getElementById("final-results");
    goOverlay.style.display = "flex";
    
    // Aquí el estado ya viene con los scores finales actualizados del servidor
    const sortedPlayers = Object.entries(state.scores).sort((a,b) => a[1] - b[1]);
    
    resultsDiv.innerHTML = sortedPlayers.map(([name, score], idx) => `
        <div style="margin: 10px; color: ${idx === 0 ? 'gold' : '#ff4444'}">
            <strong>${idx === 0 ? '🏆 GANADOR' : 'PERDEDOR'}:</strong> ${name} (${score} pts)
        </div>
    `).join("");

    const restartBtn = document.createElement("button");
    restartBtn.className = "reload-btn";
    restartBtn.innerText = "NUEVA PARTIDA";
    restartBtn.onclick = () => location.reload();
    resultsDiv.appendChild(restartBtn);
}

function createCardElement(cardData) {
    const card = document.createElement("div");
    card.className = `card ${cardData.palo.toLowerCase()}`;
    if (cardData.comodin) card.classList.add("comodin");
    const icons = {oros: "🟡", copas: "🍷", espadas: "⚔️", bastos: "🪵"};
    card.innerHTML = `<div>${cardData.numero}</div><div style="font-size:1.5em">${icons[cardData.palo.toLowerCase()]}</div>`;
    return card;
}

// BOTÓN ORDENAR MEJORADO
document.getElementById("sort-btn").onclick = () => {
    const cards = document.querySelectorAll('#my-hand .card');
    
    // Solo aplicamos el apilado (stacking) a las cartas que NO tienen grupo
    cards.forEach(c => {
        if (!c.classList.contains('grupo-1') && !c.classList.contains('grupo-2')) {
            c.classList.add('stacking');
        }
    });

    // Tiempo de animación más lento (0.6s) para que se aprecie el movimiento
    setTimeout(() => {
        currentSortMode = (currentSortMode === 'palo') ? 'numero' : 'palo';
        isInitialRender = true; // Forzamos animación de despliegue
        renderHand();
    }, 600);
};