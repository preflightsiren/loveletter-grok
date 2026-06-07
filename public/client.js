console.log('Script loaded');
const socket = io();
console.log('Socket created, connected:', socket.connected);

// Per-tab player ID (sessionStorage isolates tabs/windows for multi-user testing)
const playerId = sessionStorage.getItem('playerId') || Math.random().toString(36).substr(2, 9);
sessionStorage.setItem('playerId', playerId);

// Surface server 'error' emits (e.g. join rejected mid-round) in the UI
socket.on('error', (message) => {
    showError(typeof message === 'string' ? message : 'An error occurred');
});

// Lobby page logic
const nicknameInput = document.getElementById('nickname');
const createButton = document.getElementById('createGame');
const joinKeyInput = document.getElementById('joinKeyInput');
const joinButton = document.getElementById('joinGame');
const errorDiv = document.getElementById('error');

// Game page logic
const playerList = document.getElementById('playerList');
const chatMessages = document.getElementById('chatMessages');
const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendMessage');
const startReadyButton = document.getElementById('startReady');
const toggleReadyButton = document.getElementById('toggleReady');
const readyStatusDiv = document.getElementById('readyStatus');
const gameModeDiv = document.getElementById('gameMode');
const handSpan = document.getElementById('hand');
const handContainer = document.getElementById('handContainer');
const currentTurnSpan = document.getElementById('currentTurn');
const actionArea = document.getElementById('actionArea');
const targetSelector = document.getElementById('targetSelector');
const targetButtons = document.getElementById('targetButtons');
const guessSelector = document.getElementById('guessSelector');
const guessButtons = document.getElementById('guessButtons');

let joined = false;
let currentHand = [];
let myTokens = 0;
let pendingPlay = null; // { cardIndex, cardName }
let gameTokens = {}; // playerId -> tokens
let eliminatedPlayers = new Set();
let protectedPlayers = new Set();
let currentTurnPlayerId = null;
let currentPlayers = [];
let currentReadyPhase = false;
let gameIsStarted = false;

socket.on('playerJoined', (data) => {
    currentPlayers = data.players || [];
    updatePlayers(data.players);
    updateStartReadyButton(currentPlayers, currentReadyPhase, gameIsStarted);
});

socket.on('readyPhaseStarted', () => {
    currentReadyPhase = true;
    readyStatusDiv.style.display = 'block';
    readyStatusDiv.textContent = 'Waiting for all players to ready up...';
    startReadyButton.style.display = 'none';
    const isCreator = currentPlayers.length > 0 && currentPlayers[0] && currentPlayers[0].id === playerId;
    if (isCreator) {
        toggleReadyButton.style.display = 'none';
    } else {
        toggleReadyButton.style.display = 'block';
        toggleReadyButton.textContent = 'Ready';
    }
    updateStartReadyButton(currentPlayers, currentReadyPhase, gameIsStarted);
});

socket.on('readyUpdate', (data) => {
    if (!data || !data.players) return;
    updatePlayers(data.players, data.readyPlayers || []);
    const readyCount = Array.isArray(data.readyPlayers) ? data.readyPlayers.length : 0;
    readyStatusDiv.textContent = `Ready: ${readyCount} / ${data.players.length}`;
    // Sync button text for non-creator players
    if (toggleReadyButton.style.display !== 'none') {
        const isMeReady = Array.isArray(data.readyPlayers) && data.readyPlayers.includes(playerId);
        toggleReadyButton.textContent = isMeReady ? 'Unready' : 'Ready';
    }
    updateStartReadyButton(currentPlayers, currentReadyPhase, gameIsStarted);
});

socket.on('privateHand', (data) => {
    currentHand = data.hand || [];
    renderHand();
    // Re-evaluate action buttons in case this hand update happened on our turn
    const isMyTurn = currentTurnPlayerId === playerId;
    actionArea.style.display = isMyTurn && currentHand.length > 0 ? 'block' : 'none';
});

socket.on('roundStarted', (data) => {
    console.log('roundStarted', data);
    gameModeDiv.style.display = 'block';
    actionArea.style.display = 'none';
    targetSelector.style.display = 'none';
    guessSelector.style.display = 'none';
    pendingPlay = null;
    eliminatedPlayers = new Set();
    protectedPlayers = new Set();
    gameTokens = data.tokens || {};
    currentTurnPlayerId = data.currentPlayerId || null;
    currentHand = [];  // ensure clean slate for new round
    if (handContainer) handContainer.innerHTML = '';

    // Hide all pre-game / ready controls now that we're in the actual game
    startReadyButton.style.display = 'none';
    toggleReadyButton.style.display = 'none';
    readyStatusDiv.style.display = 'none';

    currentReadyPhase = false;
    gameIsStarted = true;

    const current = currentPlayers.find(p => p.id === currentTurnPlayerId);
    currentTurnSpan.textContent = current ? current.nickname : (currentTurnPlayerId || '');

    if (currentPlayers.length > 0) {
        updatePlayers(currentPlayers, [], currentTurnPlayerId);
    }
    renderHand();
    updateStartReadyButton(currentPlayers, currentReadyPhase, gameIsStarted);
});

socket.on('turnChanged', (data) => {
    currentTurnPlayerId = data.currentPlayerId || null;
    const current = currentPlayers.find(p => p.id === currentTurnPlayerId);
    currentTurnSpan.textContent = current ? current.nickname : (currentTurnPlayerId || '');

    // Guard (and other targeting cards like Priest/Baron/King) action state
    // (pending guess/target selectors) must expire at the beginning of the
    // player's next turn. Clear it on every turn change so the next player
    // (including the same player on their subsequent turn) starts clean.
    targetSelector.style.display = 'none';
    guessSelector.style.display = 'none';
    pendingPlay = null;

    const isMyTurn = currentTurnPlayerId === playerId;
    actionArea.style.display = isMyTurn && currentHand.length > 0 ? 'block' : 'none';
    updatePlayers(currentPlayers, [], currentTurnPlayerId);
    renderHand();
});

socket.on('playerDrew', (data) => {
    // Just informational; hand updated via privateHand
    console.log(data.nickname + ' drew a card');
});

socket.on('cardPlayed', (data) => {
    const msg = `${data.nickname} played ${data.card.name}`;
    addMessage(msg);
    // If it was us, clear pending
    if (data.playerId === playerId) {
        pendingPlay = null;
        targetSelector.style.display = 'none';
        guessSelector.style.display = 'none';
    }
});

socket.on('playerEliminated', (data) => {
    eliminatedPlayers.add(data.playerId);
    protectedPlayers.delete(data.playerId); // protection no longer relevant
    addMessage(`${data.nickname} is out${data.reason ? ' (' + data.reason + ')' : ''}`);
    updatePlayers(currentPlayers, [], null);
});

socket.on('playerProtected', (data) => {
    protectedPlayers.add(data.playerId);
    addMessage(`${data.nickname} is protected by Handmaid`);
    updatePlayers(currentPlayers, [], null);
});

socket.on('playerProtectionEnded', (data) => {
    protectedPlayers.delete(data.playerId);
    addMessage(`${data.nickname}'s Handmaid protection has expired`);
    updatePlayers(currentPlayers, [], null);
});

socket.on('guardSuccess', (data) => {
    addMessage(`Guard guess correct!`);
});

socket.on('guardFail', (data) => {
    addMessage(`Guard guess failed.`);
});

socket.on('priestReveal', (data) => {
    const handStr = data.hand.map(c => `${c.name}(${c.value})`).join(', ');
    alert(`Priest: ${data.nickname}'s hand: ${handStr}`);
    addMessage(`You saw ${data.nickname}'s hand via Priest.`);
});

socket.on('baronCompare', (data) => {
    addMessage(`Baron compare: ${data.actorNick} ${data.actorCard.name} vs ${data.targetNick} ${data.targetCard.name}`);
});

socket.on('princeEffect', (data) => {
    addMessage(`Prince: ${data.targetNick} discarded ${data.discarded.name}`);
});

socket.on('kingSwap', (data) => {
    addMessage(`King: ${data.actorNick} swapped hands with ${data.targetNick}`);
});

socket.on('roundEnded', (data) => {
    let winnerText = data.winnerNickname ? `${data.winnerNickname} wins the round!` : 'Round ended in a tie.';
    if (data.deckEmpty) {
        winnerText = `No cards left in the deck. ${winnerText}`;
    }
    addMessage(`Round ${data.roundNumber} over. ${winnerText}`);
    // Show quick summary of revealed hands (optional)
    console.log('Revealed hands:', data.revealed);
    gameTokens = data.tokens || {};
    protectedPlayers = new Set(); // ensure any lingering Handmaid protection is cleared between rounds
    updatePlayers(currentPlayers, [], null);
});

socket.on('gameOver', (data) => {
    alert(`Game Over! ${data.winnerNickname} wins with ${data.finalTokens[data.winnerId]} tokens.`);
    // Reset UI to lobby
    document.getElementById('gameSection').style.display = 'none';
    document.querySelector('.container').style.display = 'block';
    joined = false;
    chatMessages.innerHTML = '';
    playerList.innerHTML = '';
    document.getElementById('joinKey').textContent = 'Join Key: ';
    gameModeDiv.style.display = 'none';
    actionArea.style.display = 'none';
    currentReadyPhase = false;
    gameIsStarted = false;
    currentPlayers = [];
});

socket.on('gameEnded', (data) => {
    alert(data.message);
    sessionStorage.removeItem('gameKey');
    sessionStorage.removeItem('playerId');
    // Switch to lobby
    document.getElementById('gameSection').style.display = 'none';
    document.querySelector('.container').style.display = 'block';
    joined = false;
    // Clear UI
    chatMessages.innerHTML = '';
    playerList.innerHTML = '';
    document.getElementById('joinKey').textContent = 'Join Key: ';
    gameModeDiv.style.display = 'none';
    currentReadyPhase = false;
    gameIsStarted = false;
    currentPlayers = [];
});

startReadyButton.addEventListener('click', () => {
    socket.emit('startReady', { playerId });
});

toggleReadyButton.addEventListener('click', () => {
    socket.emit('toggleReady', { playerId });
    toggleReadyButton.textContent = toggleReadyButton.textContent === 'Ready' ? 'Unready' : 'Ready';
});

socket.on('playerLeft', (data) => {
    currentPlayers = data.players || [];
    updatePlayers(data.players);
    updateStartReadyButton(currentPlayers, currentReadyPhase, gameIsStarted);
});

socket.on('message', (data) => {
    addMessage(data.message);
});

socket.on('kicked', (data) => {
    alert(data.message);
    sessionStorage.removeItem('gameKey');
    sessionStorage.removeItem('playerId');
    // Switch to lobby
    document.getElementById('gameSection').style.display = 'none';
    document.querySelector('.container').style.display = 'block';
    joined = false;
    // Clear chat and players
    chatMessages.innerHTML = '';
    playerList.innerHTML = '';
    document.getElementById('joinKey').textContent = 'Join Key: ';
    currentReadyPhase = false;
    gameIsStarted = false;
    currentPlayers = [];
});



sendButton.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

document.getElementById('leaveGame').addEventListener('click', () => {
    socket.emit('leaveGame', { playerId });
    sessionStorage.removeItem('gameKey');
    sessionStorage.removeItem('playerId');
    // Switch to lobby
    document.getElementById('gameSection').style.display = 'none';
    document.querySelector('.container').style.display = 'block';
    joined = false;
    // Clear chat and players
    chatMessages.innerHTML = '';
    playerList.innerHTML = '';
    document.getElementById('joinKey').textContent = 'Join Key: ';
    currentReadyPhase = false;
    gameIsStarted = false;
    currentPlayers = [];
});

function sendMessage() {
    const message = messageInput.value.trim();
    if (message) {
        socket.emit('sendMessage', { message, playerId });
        messageInput.value = '';
    }
}

function updateStartReadyButton(players, readyPhase, isStarted) {
    const isCreator = players && players.length > 0 && players[0] && players[0].id === playerId;
    if (isCreator && !isStarted && !readyPhase && players.length >= 2) {
        startReadyButton.style.display = 'block';
        startReadyButton.textContent = 'Start Ready Phase';
    } else {
        startReadyButton.style.display = 'none';
    }
}

function updatePlayers(players, readyPlayers = [], currentPlayerId = null, isStarted = false) {
    if (!players || !Array.isArray(players)) return;
    currentPlayers = players;
    playerList.innerHTML = '';
    const isCreator = players.length > 0 && players[0].id === playerId;
    players.forEach(player => {
        const li = document.createElement('li');
        let text = player.nickname;
        const tokens = gameTokens[player.id] || 0;
        text += ` [${tokens}]`;
        if (eliminatedPlayers.has(player.id)) {
            text += ' (Out)';
            li.style.opacity = '0.6';
        }
        if (protectedPlayers.has(player.id)) {
            text += ' 🛡️';
        }
        if (player.id === currentPlayerId) {
            text += ' ←';
            li.style.fontWeight = 'bold';
        }
        if (Array.isArray(readyPlayers) && readyPlayers.includes(player.id)) {
            text += ' (Ready)';
        }
        li.textContent = text;
        if (isCreator && player.id !== playerId && !eliminatedPlayers.has(player.id)) {
            const kickBtn = document.createElement('button');
            kickBtn.textContent = 'x';
            kickBtn.className = 'kick-btn';
            kickBtn.addEventListener('click', () => {
                socket.emit('kickPlayer', { kickedPlayerId: player.id, playerId });
            });
            li.appendChild(kickBtn);
        }
        playerList.appendChild(li);
    });
    // Keep the pre-game start button in sync whenever the player list is refreshed
    updateStartReadyButton(players, currentReadyPhase, gameIsStarted);
}

function addMessage(message) {
    const p = document.createElement('p');
    p.textContent = message;
    chatMessages.appendChild(p);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function showError(message) {
    errorDiv.textContent = message;
    setTimeout(() => errorDiv.textContent = '', 5000);
}

function renderHand() {
    if (!handContainer) return;
    handContainer.innerHTML = '';
    const isMyTurn = currentTurnPlayerId === playerId;
    currentHand.forEach((card, idx) => {
        const btn = document.createElement('button');
        btn.textContent = `${card.name} (${card.value})`;
        btn.style.marginRight = '6px';

        const hasCountess = currentHand.some(c => c.name === 'Countess');
        const hasRoyal = currentHand.some(c => c.name === 'King' || c.name === 'Prince');
        const mustPlayCountess = hasCountess && hasRoyal && card.name !== 'Countess';

        btn.disabled = !isMyTurn || mustPlayCountess;
        if (mustPlayCountess) {
            btn.title = 'You must play the Countess when holding it with King or Prince';
        }

        btn.addEventListener('click', () => {
            if (!isMyTurn) return;
            if (mustPlayCountess) {
                alert('You must play the Countess when holding it with King or Prince!');
                return;
            }
            handlePlayCard(idx, card.name);
        });
        handContainer.appendChild(btn);
    });
    // Also keep legacy span in sync
    if (handSpan) {
        handSpan.textContent = currentHand.map(c => `${c.name} (${c.value})`).join(', ');
    }
}

function handlePlayCard(cardIndex, cardName) {
    pendingPlay = { cardIndex, cardName };

    // Clear previous selectors
    targetButtons.innerHTML = '';
    guessButtons.innerHTML = '';
    targetSelector.style.display = 'none';
    guessSelector.style.display = 'none';

    const needsTarget = ['Guard', 'Priest', 'Baron', 'King', 'Prince'].includes(cardName);
    const needsGuess = cardName === 'Guard';

    if (needsTarget) {
        // Build target buttons from currentPlayers (exclude self for most, allow for Prince)
        const allowSelf = cardName === 'Prince';
        currentPlayers.forEach(p => {
            if (p.id === playerId && !allowSelf) return;
            if (eliminatedPlayers.has(p.id)) return;
            if (protectedPlayers.has(p.id)) return; // cannot target protected players (Handmaid), even with Prince

            const tBtn = document.createElement('button');
            tBtn.textContent = p.nickname;
            tBtn.style.margin = '2px';
            tBtn.addEventListener('click', () => {
                pendingPlay.targetPlayerId = p.id;
                if (needsGuess) {
                    showGuessSelector();
                } else {
                    sendPlayCard();
                }
            });
            targetButtons.appendChild(tBtn);
        });

        if (targetButtons.children.length === 0) {
            // No valid targets (everyone else protected/eliminated)
            if (cardName === 'Prince') {
                // Prince can always target self
                pendingPlay.targetPlayerId = playerId;
                sendPlayCard();
            } else {
                // Guard / Priest / Baron / King with no legal targets (all protected/eliminated): play anyway (effect will fizzle with message)
                // Do not trap the player in an empty selector
                targetSelector.style.display = 'none';
                sendPlayCard();
            }
        } else {
            targetSelector.style.display = 'block';
        }
    } else if (needsGuess) {
        showGuessSelector();
    } else {
        // No target/guess needed (Handmaid, Countess, Princess)
        sendPlayCard();
    }
}

function showGuessSelector() {
    guessButtons.innerHTML = '';
    const guesses = ['Priest', 'Baron', 'Handmaid', 'Prince', 'King', 'Countess', 'Princess'];
    guesses.forEach(g => {
        const gBtn = document.createElement('button');
        gBtn.textContent = g;
        gBtn.style.margin = '2px';
        gBtn.addEventListener('click', () => {
            pendingPlay.guess = g;
            sendPlayCard();
        });
        guessButtons.appendChild(gBtn);
    });
    guessSelector.style.display = 'block';
}

function sendPlayCard() {
    if (!pendingPlay) return;
    socket.emit('playCard', {
        playerId,
        cardIndex: pendingPlay.cardIndex,
        targetPlayerId: pendingPlay.targetPlayerId || null,
        guess: pendingPlay.guess || null
    });
    // Optimistic clear
    targetSelector.style.display = 'none';
    guessSelector.style.display = 'none';
    actionArea.style.display = 'none';
}

// Create game
createButton.addEventListener('click', () => {
    const nickname = nicknameInput.value.trim();
    if (!nickname) {
        showError('Nickname is required');
        return;
    }
    socket.emit('createGame', { nickname, playerId });
});

// Join game
joinButton.addEventListener('click', () => {
    const nickname = nicknameInput.value.trim();
    const joinKey = joinKeyInput.value.trim();
    if (!nickname || !joinKey) {
        showError('Nickname and join key are required');
        return;
    }
    socket.emit('joinGame', { joinKey, nickname, playerId });
});

// Game joined handler
socket.on('gameJoined', (data) => {
    document.querySelector('.container').style.display = 'none';
    document.getElementById('gameSection').style.display = 'block';
    console.log('Setting joinKey to', data.joinKey);
    const joinKeyEl = document.getElementById('joinKey');
    if (joinKeyEl) {
        joinKeyEl.textContent = 'Join Key: ' + data.joinKey;
    }
    updatePlayers(data.players || [], data.readyPlayers || [], data.currentPlayerId, data.isStarted);
    currentPlayers = data.players || [];
    currentReadyPhase = !!data.readyPhase;
    gameIsStarted = !!data.isStarted;
    if (data.isStarted) {
        gameModeDiv.style.display = 'block';
        const current = data.players.find(p => p.id === data.currentPlayerId);
        if (current) currentTurnSpan.textContent = current.nickname;
        currentTurnPlayerId = data.currentPlayerId || null;
        // Reset play UI state on (re)join
        actionArea.style.display = 'none';
        targetSelector.style.display = 'none';
        guessSelector.style.display = 'none';
        pendingPlay = null;
        currentHand = [];
        if (handContainer) handContainer.innerHTML = '';

        // Safety net for hand on join/reconnect to active game
        setTimeout(() => {
            if (currentHand.length === 0) {
                socket.emit('getMyHand', { playerId });
            }
        }, 400);
    } else {
        gameModeDiv.style.display = 'none';
    }
    // Show/hide ready controls - creator never gets the toggle button
    const isCreator = data.players.length > 0 && data.players[0] && data.players[0].id === playerId;
    if (data.readyPhase) {
        readyStatusDiv.style.display = 'block';
        if (isCreator) {
            toggleReadyButton.style.display = 'none';
        } else {
            toggleReadyButton.style.display = 'block';
            toggleReadyButton.textContent = 'Ready';
        }
        startReadyButton.style.display = 'none';
    } else {
        toggleReadyButton.style.display = 'none';
        readyStatusDiv.style.display = 'none';
    }
    // Re-evaluate creator's "Start Ready Phase" button using shared logic (now that we have >=2 players after joins)
    updateStartReadyButton(currentPlayers, currentReadyPhase, gameIsStarted);
    joined = true;
});