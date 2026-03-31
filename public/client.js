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
let joined = false;

// Reconnect on connect
socket.on('connect', () => {
    const storedGameKey = localStorage.getItem('gameKey');
    if (storedGameKey) {
        console.log('Attempting to reconnect to game with key:', storedGameKey, 'playerId:', playerId);
        socket.emit('reconnectGame', { joinKey: storedGameKey, playerId: playerId });
    }
});

createButton.addEventListener('click', () => {
    const nickname = nicknameInput.value.trim();
    if (nickname) {
        console.log('Emitting createGame with nickname:', nickname);
        socket.emit('createGame', { nickname, playerId });
    } else {
        showError('Please enter a nickname');
    }
});

joinButton.addEventListener('click', () => {
    const nickname = nicknameInput.value.trim();
    const joinKey = joinKeyInput.value.trim();
    if (nickname && joinKey) {
        socket.emit('joinGame', { joinKey, nickname, playerId });
    } else {
        showError('Please enter nickname and join key');
    }
});

socket.on('error', (message) => {
    showError(message);
    // If reconnect failed, clear storage and stay in lobby
    if (message === 'Game not found' || message === 'Game expired' || message === 'Player not in game') {
        localStorage.removeItem('gameKey');
        localStorage.removeItem('playerId');
        console.log('Cleared stored game due to error:', message);
    }
});

socket.on('gameJoined', (data) => {
    console.log('Received gameJoined:', data);
    // Store game session
    localStorage.setItem('gameKey', data.joinKey);
    localStorage.setItem('playerId', socket.id); // Assuming socket.id is the player id
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
    updatePlayers(data.players);
    joined = true;
});

socket.on('playerJoined', (data) => {
    updatePlayers(data.players);
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

function updatePlayers(players) {
    playerList.innerHTML = '';
    const isCreator = players.length > 0 && players[0].id === playerId;
    players.forEach(player => {
        const li = document.createElement('li');
        li.textContent = player.nickname;
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