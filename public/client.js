console.log('Script loaded');
const socket = io();
console.log('Socket created, connected:', socket.connected);

// Generate or get persistent player ID
const playerId = sessionStorage.getItem('playerId') || Math.random().toString(36).substr(2, 9);
sessionStorage.setItem('playerId', playerId);

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
const currentTurnSpan = document.getElementById('currentTurn');
let joined = false;

// Generate or get persistent player ID
const playerId = localStorage.getItem('playerId') || Math.random().toString(36).substr(2, 9);
localStorage.setItem('playerId', playerId);
    // Switch to game view
    document.querySelector('.container').style.display = 'none';
    document.getElementById('gameSection').style.display = 'block';
    console.log('Setting joinKey to', data.joinKey);
    const joinKeyEl = document.getElementById('joinKey');
    if (joinKeyEl) {
        joinKeyEl.textContent = 'Join Key: ' + data.joinKey;
        console.log('Join key element updated:', joinKeyEl.textContent);
        console.log('Element HTML:', joinKeyEl.outerHTML);
    } else {
        console.error('Join key element not found');
    }
    updatePlayers(data.players, data.readyPlayers, data.currentPlayerId, data.isStarted);
    if (data.isStarted) {
        gameModeDiv.style.display = 'block';
        currentTurnSpan.textContent = data.players.find(p => p.id === data.currentPlayerId).nickname;
    } else {
        gameModeDiv.style.display = 'none';
    }
    if (data.readyPhase) {
        toggleReadyButton.style.display = 'block';
        readyStatusDiv.style.display = 'block';
        // Set button text based on if ready
        if (data.readyPlayers.includes(playerId)) {
            toggleReadyButton.textContent = 'Unready';
        } else {
            toggleReadyButton.textContent = 'Ready';
        }
    } else {
        toggleReadyButton.style.display = 'none';
        readyStatusDiv.style.display = 'none';
    }
    if (data.players[0].id === playerId && !data.readyPhase && !data.isStarted && data.players.length >= 2) {
        startReadyButton.style.display = 'block';
    } else {
        startReadyButton.style.display = 'none';
    }
    joined = true;
});

socket.on('playerJoined', (data) => {
    updatePlayers(data.players);
});

socket.on('readyPhaseStarted', () => {
    toggleReadyButton.style.display = 'block';
    toggleReadyButton.textContent = 'Ready';
    readyStatusDiv.style.display = 'block';
    readyStatusDiv.textContent = 'Waiting for all players to ready up...';
});

socket.on('readyUpdate', (data) => {
    updatePlayers(data.players, data.readyPlayers);
    readyStatusDiv.textContent = `Ready: ${data.readyPlayers.length} / ${data.players.length}`;
});

socket.on('gameStarted', (data) => {
    gameModeDiv.style.display = 'block';
    startReadyButton.style.display = 'none';
    toggleReadyButton.style.display = 'none';
    readyStatusDiv.style.display = 'none';
    currentTurnSpan.textContent = data.players.find(p => p.id === data.currentPlayerId).nickname;
    updatePlayers(data.players, [], data.currentPlayerId, true);
});

socket.on('privateHand', (data) => {
    handSpan.textContent = data.hand.map(c => `${c.name} (${c.value})`).join(', ');
});

socket.on('gameEnded', (data) => {
    alert(data.message);
    localStorage.removeItem('gameKey');
    localStorage.removeItem('playerId');
    // Switch to lobby
    document.getElementById('gameSection').style.display = 'none';
    document.querySelector('.container').style.display = 'block';
    joined = false;
    // Clear UI
    chatMessages.innerHTML = '';
    playerList.innerHTML = '';
    document.getElementById('joinKey').textContent = 'Join Key: ';
    gameModeDiv.style.display = 'none';
});

startReadyButton.addEventListener('click', () => {
    socket.emit('startReady', { playerId });
});

toggleReadyButton.addEventListener('click', () => {
    socket.emit('toggleReady', { playerId });
    toggleReadyButton.textContent = toggleReadyButton.textContent === 'Ready' ? 'Unready' : 'Ready';
});

socket.on('readyPhaseStarted', () => {
    toggleReadyButton.style.display = 'block';
    toggleReadyButton.textContent = 'Ready';
    readyStatusDiv.style.display = 'block';
    readyStatusDiv.textContent = 'Waiting for all players to ready up...';
});

socket.on('readyUpdate', (data) => {
    updatePlayers(data.players, data.readyPlayers);
    readyStatusDiv.textContent = `Ready: ${data.readyPlayers.length} / ${data.players.length}`;
});

socket.on('gameStarted', (data) => {
    gameModeDiv.style.display = 'block';
    startReadyButton.style.display = 'none';
    toggleReadyButton.style.display = 'none';
    readyStatusDiv.style.display = 'none';
    currentTurnSpan.textContent = data.players.find(p => p.id === data.currentPlayerId).nickname;
    updatePlayers(data.players, [], data.currentPlayerId, true);
});

socket.on('privateHand', (data) => {
    handSpan.textContent = data.hand.map(c => `${c.name} (${c.value})`).join(', ');
});

socket.on('gameEnded', (data) => {
    alert(data.message);
    localStorage.removeItem('gameKey');
    localStorage.removeItem('playerId');
    // Switch to lobby
    document.getElementById('gameSection').style.display = 'none';
    document.querySelector('.container').style.display = 'block';
    joined = false;
    // Clear UI
    chatMessages.innerHTML = '';
    playerList.innerHTML = '';
    document.getElementById('joinKey').textContent = 'Join Key: ';
    gameModeDiv.style.display = 'none';
});

startReadyButton.addEventListener('click', () => {
    socket.emit('startReady', { playerId });
});

toggleReadyButton.addEventListener('click', () => {
    socket.emit('toggleReady', { playerId });
    toggleReadyButton.textContent = toggleReadyButton.textContent === 'Ready' ? 'Unready' : 'Ready';
});

socket.on('playerLeft', (data) => {
    updatePlayers(data.players);
});

socket.on('message', (data) => {
    addMessage(data.message);
});

socket.on('kicked', (data) => {
    alert(data.message);
    localStorage.removeItem('gameKey');
    localStorage.removeItem('playerId');
    // Switch to lobby
    document.getElementById('gameSection').style.display = 'none';
    document.querySelector('.container').style.display = 'block';
    joined = false;
    // Clear chat and players
    chatMessages.innerHTML = '';
    playerList.innerHTML = '';
    document.getElementById('joinKey').textContent = 'Join Key: ';
});



sendButton.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

document.getElementById('leaveGame').addEventListener('click', () => {
    socket.emit('leaveGame', { playerId });
    localStorage.removeItem('gameKey');
    localStorage.removeItem('playerId');
    // Switch to lobby
    document.getElementById('gameSection').style.display = 'none';
    document.querySelector('.container').style.display = 'block';
    joined = false;
    // Clear chat and players
    chatMessages.innerHTML = '';
    playerList.innerHTML = '';
    document.getElementById('joinKey').textContent = 'Join Key: ';
});

function sendMessage() {
    const message = messageInput.value.trim();
    if (message) {
        socket.emit('sendMessage', { message, playerId });
        messageInput.value = '';
    }
}

function updatePlayers(players, readyPlayers = [], currentPlayerId = null, isStarted = false) {
    playerList.innerHTML = '';
    const isCreator = players.length > 0 && players[0].id === playerId;
    players.forEach(player => {
        const li = document.createElement('li');
        li.textContent = player.nickname;
        if (readyPlayers.includes(player.id)) {
            li.textContent += ' (Ready)';
            li.className = 'ready-player';
        }
        if (isStarted && player.id === currentPlayerId) {
            li.className += ' current-player';
        }
        if (isCreator && player.id !== playerId) {
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