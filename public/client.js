console.log('Script loaded');
const socket = io();
console.log('Socket created, connected:', socket.connected);

// Per-tab player ID (sessionStorage isolates tabs/windows for multi-user testing)
const playerId = sessionStorage.getItem('playerId') || Math.random().toString(36).substr(2, 9);
sessionStorage.setItem('playerId', playerId);
// Stable visitor id for returning-player metrics only (does not affect game identity / multi-tab)
let visitorId = null;
try { visitorId = localStorage.getItem('loveletterVisitorId'); } catch (e) { visitorId = null; }
if (!visitorId) {
    visitorId = Math.random().toString(36).substr(2, 9);
    try { localStorage.setItem('loveletterVisitorId', visitorId); } catch (e) {}
}
let myAuthToken = sessionStorage.getItem('authToken') || null;

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
const inviteUrlInput = document.getElementById('inviteUrl');
const copyInviteButton = document.getElementById('copyInvite');
let currentJoinKey = '';


function buildInviteUrl(joinKey) {
    const key = (joinKey || '').trim();
    if (!key) return '';
    return `${window.location.origin}/?join=${encodeURIComponent(key)}`;
}

function updateInviteShare(joinKey) {
    currentJoinKey = (joinKey || '').trim();
    const joinKeyEl = document.getElementById('joinKey');
    if (joinKeyEl) {
        joinKeyEl.textContent = currentJoinKey ? ('Join Key: ' + currentJoinKey) : 'Join Key: —';
    }
    if (inviteUrlInput) {
        inviteUrlInput.value = buildInviteUrl(currentJoinKey);
    }
    if (copyInviteButton) {
        copyInviteButton.textContent = 'Copy invite link';
        copyInviteButton.classList.remove('copied');
    }
}

async function copyInviteLink() {
    const url = buildInviteUrl(currentJoinKey) || (inviteUrlInput && inviteUrlInput.value) || '';
    if (!url) {
        showError('No invite link to copy yet');
        return;
    }
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(url);
        } else if (inviteUrlInput) {
            inviteUrlInput.focus();
            inviteUrlInput.select();
            document.execCommand('copy');
        } else {
            throw new Error('clipboard unavailable');
        }
        if (copyInviteButton) {
            copyInviteButton.textContent = 'Copied!';
            copyInviteButton.classList.add('copied');
            setTimeout(() => {
                if (copyInviteButton) {
                    copyInviteButton.textContent = 'Copy invite link';
                    copyInviteButton.classList.remove('copied');
                }
            }, 1600);
        }
    } catch (e) {
        showError('Could not copy — select the invite link and copy manually');
    }
}

// Deep link: /?join=<joinKey> prefills the join key so a guest only needs a nickname
(function prefillJoinFromQuery() {
    try {
        const params = new URLSearchParams(window.location.search);
        const join = params.get('join');
        if (join && joinKeyInput) {
            joinKeyInput.value = join;
            if (nicknameInput) nicknameInput.focus();
        }
    } catch (e) {}
})();

if (copyInviteButton) {
    copyInviteButton.addEventListener('click', () => { copyInviteLink(); });
}

// Game page logic
const playerList = document.getElementById('playerList');
const chatMessages = document.getElementById('chatMessages');
const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendMessage');
const startReadyButton = document.getElementById('startReady');
const toggleReadyButton = document.getElementById('toggleReady');
const addBotButton = document.getElementById('addBot');
const fillBotsButton = document.getElementById('fillBots');
const readyStatusDiv = document.getElementById('readyStatus');
const gameModeDiv = document.getElementById('gameMode');
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
    currentTurnSpan.innerHTML = '';
    if (current) {
        const h = getHeraldry(current.id, current.nickname);
        currentTurnSpan.appendChild(createHeraldryBadge(h));
        currentTurnSpan.appendChild(document.createTextNode(` ${current.nickname}'s turn`));
    } else {
        currentTurnSpan.textContent = 'Waiting...';
    }

    if (currentPlayers.length > 0) {
        updatePlayers(currentPlayers, [], currentTurnPlayerId);
    }
    renderHand();
    updateStartReadyButton(currentPlayers, currentReadyPhase, gameIsStarted);
});

socket.on('turnChanged', (data) => {
    currentTurnPlayerId = data.currentPlayerId || null;
    const current = currentPlayers.find(p => p.id === currentTurnPlayerId);
    currentTurnSpan.innerHTML = '';
    if (current) {
        const h = getHeraldry(current.id, current.nickname);
        currentTurnSpan.appendChild(createHeraldryBadge(h));
        currentTurnSpan.appendChild(document.createTextNode(` ${current.nickname}'s turn`));
    } else {
        currentTurnSpan.textContent = 'Waiting...';
    }

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
    document.getElementById('lobby').style.display = 'block';
    joined = false;
    myAuthToken = null;
    try { sessionStorage.removeItem('authToken'); } catch (e) {}
    chatMessages.innerHTML = '';
    playerList.innerHTML = '';
    updateInviteShare('');
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
    sessionStorage.removeItem('authToken');
    // Switch to lobby
    document.getElementById('gameSection').style.display = 'none';
    document.getElementById('lobby').style.display = 'block';
    joined = false;
    myAuthToken = null;
    // Clear UI
    chatMessages.innerHTML = '';
    playerList.innerHTML = '';
    updateInviteShare('');
    gameModeDiv.style.display = 'none';
    currentReadyPhase = false;
    gameIsStarted = false;
    currentPlayers = [];
});

startReadyButton.addEventListener('click', () => {
    socket.emit('startReady', { playerId, authToken: myAuthToken });
});

if (addBotButton) {
    addBotButton.addEventListener('click', () => {
        socket.emit('addBot', { playerId, authToken: myAuthToken });
    });
}
if (fillBotsButton) {
    fillBotsButton.addEventListener('click', () => {
        socket.emit('fillBots', { playerId, authToken: myAuthToken });
    });
}

toggleReadyButton.addEventListener('click', () => {
    socket.emit('toggleReady', { playerId, authToken: myAuthToken });
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
    sessionStorage.removeItem('authToken');
    // Switch to lobby
    document.getElementById('gameSection').style.display = 'none';
    document.getElementById('lobby').style.display = 'block';
    joined = false;
    myAuthToken = null;
    // Clear chat and players
    chatMessages.innerHTML = '';
    playerList.innerHTML = '';
    updateInviteShare('');
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
    socket.emit('leaveGame', { playerId, authToken: myAuthToken });
    sessionStorage.removeItem('gameKey');
    sessionStorage.removeItem('playerId');
    sessionStorage.removeItem('authToken');
    // Switch to lobby
    document.getElementById('gameSection').style.display = 'none';
    document.getElementById('lobby').style.display = 'block';
    joined = false;
    myAuthToken = null;
    // Clear chat and players
    chatMessages.innerHTML = '';
    playerList.innerHTML = '';
    updateInviteShare('');
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
        startReadyButton.style.display = 'inline-block';
        startReadyButton.textContent = 'Start Ready Phase';
    } else {
        startReadyButton.style.display = 'none';
    }
    updateBotControls(players, isStarted);
}

function updateBotControls(players, isStarted) {
    if (!addBotButton || !fillBotsButton) return;
    const list = players || currentPlayers || [];
    const isCreator = list.length > 0 && list[0] && list[0].id === playerId;
    const canAdd = isCreator && !isStarted && list.length < 6;
    addBotButton.style.display = canAdd ? 'inline-block' : 'none';
    fillBotsButton.style.display = canAdd ? 'inline-block' : 'none';
}

function updatePlayers(players, readyPlayers = [], currentPlayerId = null) {
    if (!players || !Array.isArray(players)) return;
    currentPlayers = players;
    playerList.innerHTML = '';
    const isCreator = players.length > 0 && players[0].id === playerId;

    players.forEach(player => {
        const li = document.createElement('li');

        const tokens = gameTokens[player.id] || 0;

        let statusHtml = '';
        if (eliminatedPlayers.has(player.id)) {
            statusHtml += ' <span class="status-icon" title="Eliminated">✝︎</span>';
            li.style.opacity = '0.65';
        }
        if (protectedPlayers.has(player.id)) {
            statusHtml += ' <span class="status-icon" title="Protected by Handmaid">🛡︎</span>';
        }
        if (player.id === currentPlayerId) {
            statusHtml += ' <span class="status-icon" title="Current turn">→</span>';
            li.classList.add('current-player');
        }
        if (Array.isArray(readyPlayers) && readyPlayers.includes(player.id)) {
            statusHtml += ' <span class="status-icon ready-player">(Ready)</span>';
        }

        // Insert heraldry badge
        const heraldry = getHeraldry(player.id, player.nickname);
        li.appendChild(createHeraldryBadge(heraldry));

        li.dataset.playerId = player.id;
        li.dataset.isBot = player.isBot ? 'true' : 'false';
        if (player.avatarId) li.dataset.avatarId = player.avatarId;

        const nameSpan = document.createElement('span');
        nameSpan.textContent = player.nickname;
        li.appendChild(nameSpan);

        if (player.isBot) {
            const botBadge = document.createElement('span');
            botBadge.className = 'bot-badge';
            botBadge.textContent = 'BOT';
            botBadge.title = 'AI courtier';
            li.appendChild(botBadge);
        }

        const tokenSpan = document.createElement('span');
        tokenSpan.style.marginLeft = 'auto';
        tokenSpan.style.fontSize = '0.85rem';
        tokenSpan.style.color = '#5c4630';
        tokenSpan.textContent = `[${tokens} ✉︎]`;
        li.appendChild(tokenSpan);

        // Add status icons via innerHTML for the remaining part (small)
        if (statusHtml) {
            const statusSpan = document.createElement('span');
            statusSpan.innerHTML = statusHtml;
            li.appendChild(statusSpan);
        }

        if (isCreator && player.id !== playerId && !eliminatedPlayers.has(player.id)) {
            const kickBtn = document.createElement('button');
            kickBtn.textContent = '×';
            kickBtn.className = 'kick-btn';
            kickBtn.title = 'Remove from court';
            kickBtn.addEventListener('click', () => {
                socket.emit('kickPlayer', { kickedPlayerId: player.id, playerId, authToken: myAuthToken });
            });
            li.appendChild(kickBtn);
        }
        playerList.appendChild(li);
    });

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

/* === Simplified British Heraldry (deterministic per player) === */
const HERALDIC_TINCTURES = [
  { name: 'Or',        hex: '#E8C872', isMetal: true  },  // Gold
  { name: 'Argent',    hex: '#EDEDED', isMetal: true  },  // Silver
  { name: 'Gules',     hex: '#9C2E2E', isMetal: false },  // Red
  { name: 'Azure',     hex: '#1E3A5F', isMetal: false },  // Blue
  { name: 'Vert',      hex: '#1B4D3E', isMetal: false },  // Green
  { name: 'Sable',     hex: '#222222', isMetal: false },  // Black
  { name: 'Purpure',   hex: '#4A235A', isMetal: false }   // Purple
];

// Classic charges used in British heraldry
const HERALDIC_CHARGES = ['🦁', '🦅', '✠', '⚜', '✦'];

function getHeraldry(playerId, nickname = '') {
  const seed = (playerId || nickname || 'x').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const tincture = HERALDIC_TINCTURES[seed % HERALDIC_TINCTURES.length];
  const charge = HERALDIC_CHARGES[seed % HERALDIC_CHARGES.length];
  return { color: tincture.hex, charge, isMetal: tincture.isMetal };
}

function createHeraldryBadge(heraldry) {
  const el = document.createElement('span');
  el.className = 'heraldry shield';
  el.style.backgroundColor = heraldry.color;
  el.style.color = heraldry.isMetal ? '#2C2115' : '#F5F0E6';
  el.style.textShadow = heraldry.isMetal 
    ? '0 0 1px #3f2a1f' 
    : '0 0 1px rgba(255,255,255,0.5)';
  el.textContent = heraldry.charge;
  el.title = 'Arms';
  return el;
}

const CARD_DATA = {
    'Guard': {
        icon: '🛡️',
        value: 1,
        flavor: 'The humble soldier. Trust no one.',
        effect: 'Name a card other than Guard. If the target holds it, they are eliminated.'
    },
    'Priest': {
        icon: '📜',
        value: 2,
        flavor: 'The eyes of the church see all secrets.',
        effect: 'Privately look at another player\'s hand.'
    },
    'Baron': {
        icon: '⚔️',
        value: 3,
        flavor: 'A duel of honor. The weaker falls.',
        effect: 'Compare hands with another player. The lower value is eliminated.'
    },
    'Handmaid': {
        icon: '👑',
        value: 4,
        flavor: 'Protected by virtue and silk.',
        effect: 'You are immune to other players\' card effects until your next turn.'
    },
    'Prince': {
        icon: '🤴',
        value: 5,
        flavor: 'Royal decree: discard and draw anew.',
        effect: 'Choose a player (including yourself). They discard their hand and draw a new one. If they discard Princess, they are eliminated.'
    },
    'King': {
        icon: '👑',
        value: 6,
        flavor: 'The crown exchanges its burdens.',
        effect: 'Swap hands with another player.'
    },
    'Countess': {
        icon: '👸',
        value: 7,
        flavor: 'A lady of too much influence to ignore.',
        effect: 'If you hold the King or Prince with the Countess, you must play the Countess.'
    },
    'Princess': {
        icon: '👸',
        value: 8,
        flavor: 'The most precious. Touch her and you perish.',
        effect: 'If you play this card (or are forced to discard it), you are eliminated.'
    }
};

function getCardIcon(name) {
    return (CARD_DATA[name] && CARD_DATA[name].icon) || '◆';
}

function getCardTooltipHTML(card) {
    const data = CARD_DATA[card.name] || { flavor: '', effect: '' };
    const val = data.value || card.value;
    return `
        <div class="card-tooltip">
            <div class="tooltip-name">${card.name}</div>
            <div class="tooltip-value">Value ${val}</div>
            <div class="tooltip-flavor">${data.flavor || ''}</div>
            <div class="tooltip-effect">${data.effect || ''}</div>
        </div>
    `;
}

function renderHand() {
    if (!handContainer) return;
    handContainer.innerHTML = '';
    const isMyTurn = currentTurnPlayerId === playerId;

    const hasCountess = currentHand.some(c => c.name === 'Countess');
    const hasRoyal = currentHand.some(c => c.name === 'King' || c.name === 'Prince');

    currentHand.forEach((card, idx) => {
        const cardEl = document.createElement('div');
        const typeClass = 'card-' + card.name.toLowerCase();
        cardEl.className = `card ${typeClass}`;
        if (isMyTurn) cardEl.classList.add('current-turn');

        const mustPlayCountess = hasCountess && hasRoyal && card.name !== 'Countess';

        if (!isMyTurn || mustPlayCountess) {
            cardEl.classList.add('disabled');
        }

        const icon = getCardIcon(card.name);
        const tooltipHTML = mustPlayCountess
            ? `<div class="card-tooltip"><div class="tooltip-name">${card.name}</div><div class="tooltip-effect">You must play the Countess when holding it together with King or Prince.</div></div>`
            : getCardTooltipHTML(card);

        cardEl.innerHTML = `
            <div class="card-value">${card.value}</div>
            <div class="card-icon">${icon}</div>
            <div class="card-name">${card.name}</div>
            <div class="card-bottom">${card.value} — ${card.name.slice(0,3).toUpperCase()}</div>
            ${tooltipHTML}
        `;

        cardEl.addEventListener('click', () => {
            if (!isMyTurn) return;
            if (mustPlayCountess) {
                alert('You must play the Countess when holding it with King or Prince!');
                return;
            }
            handlePlayCard(idx, card.name);
        });

        handContainer.appendChild(cardEl);
    });
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
        // Collect valid targets (exclude self except for Prince, eliminated, protected)
        const allowSelf = cardName === 'Prince';
        const validTargets = currentPlayers.filter(p => {
            if (p.id === playerId && !allowSelf) return false;
            if (eliminatedPlayers.has(p.id)) return false;
            if (protectedPlayers.has(p.id)) return false; // cannot target protected players (Handmaid)
            return true;
        });

        if (validTargets.length === 0) {
            // No valid targets (everyone else protected/eliminated)
            if (cardName === 'Prince') {
                // Prince can always target self
                pendingPlay.targetPlayerId = playerId;
                sendPlayCard();
            } else {
                // Guard / Priest / Baron / King with no legal targets: play anyway (effect will fizzle with message)
                // Do not trap the player in an empty selector
                targetSelector.style.display = 'none';
                sendPlayCard();
            }
        } else if (validTargets.length === 1) {
            // Only one possible target: auto-select it (no extra click needed)
            pendingPlay.targetPlayerId = validTargets[0].id;
            if (needsGuess) {
                showGuessSelector();
            } else {
                sendPlayCard();
            }
        } else {
            // Multiple targets: show buttons for the user to choose
            validTargets.forEach(p => {
                const tBtn = document.createElement('button');
                const h = getHeraldry(p.id, p.nickname);
                const badge = createHeraldryBadge(h);
                badge.style.marginRight = '5px';
                tBtn.appendChild(badge);
                tBtn.appendChild(document.createTextNode(p.nickname));
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
        authToken: myAuthToken,
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
    socket.emit('createGame', { nickname, playerId, visitorId });
});

// Join game
joinButton.addEventListener('click', () => {
    const nickname = nicknameInput.value.trim();
    const joinKey = joinKeyInput.value.trim();
    if (!nickname || !joinKey) {
        showError('Nickname and join key are required');
        return;
    }
    socket.emit('joinGame', { joinKey, nickname, playerId, visitorId, authToken: myAuthToken });
});

// Game joined handler
socket.on('gameJoined', (data) => {
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('gameSection').style.display = 'block';
    console.log('Setting joinKey to', data.joinKey);
    updateInviteShare(data.joinKey);
    updatePlayers(data.players || [], data.readyPlayers || [], data.currentPlayerId);
    currentPlayers = data.players || [];
    currentReadyPhase = !!data.readyPhase;
    gameIsStarted = !!data.isStarted;

    if (data.authToken) {
        myAuthToken = data.authToken;
        try { sessionStorage.setItem('authToken', myAuthToken); } catch (e) {}
    }

    if (data.isStarted) {
        gameModeDiv.style.display = 'block';
        const current = data.players.find(p => p.id === data.currentPlayerId);
        if (current) {
            currentTurnSpan.innerHTML = '';
            const h = getHeraldry(current.id, current.nickname);
            currentTurnSpan.appendChild(createHeraldryBadge(h));
            currentTurnSpan.appendChild(document.createTextNode(` ${current.nickname}'s turn`));
        } else {
            currentTurnSpan.textContent = 'Waiting...';
        }
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
                socket.emit('getMyHand', { playerId, authToken: myAuthToken });
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