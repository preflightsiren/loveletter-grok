const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files from public directory
app.use(express.static('public'));

// Redirect game.html to index
app.get('/game.html', (req, res) => {
    res.redirect('/');
});

// In-memory storage for games
const games = new Map();

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

// Create a new game
socket.on('createGame', (data) => {
    const { nickname, playerId } = data;
    if (!nickname || nickname.trim() === '') {
        socket.emit('error', 'Nickname is required');
        return;
    }

    const joinKey = uuidv4().slice(0, 8); // Short UUID
        const game = {
            joinKey,
            players: [{ id: playerId, nickname: nickname.trim() }],
            chat: [],
            lastActivity: Date.now(),
            kickCounts: new Map(),
            banned: new Set(),
            readyPhase: false,
            readyPlayers: new Set(),
            isStarted: false,
            deck: [],
            hands: new Map(),
            currentPlayerId: null,
            burnedCard: null
        };
    games.set(joinKey, game);

    socket.playerId = playerId;
    socket.join(joinKey);
    console.log('Emitting gameJoined to', socket.id, 'with joinKey:', joinKey);
        socket.emit('gameJoined', { joinKey, players: game.players, readyPhase: game.readyPhase, readyPlayers: Array.from(game.readyPlayers), isStarted: game.isStarted });
        console.log(`Game created: ${joinKey} by ${nickname}`);
});

// Join an existing game
socket.on('joinGame', (data) => {
    const { joinKey, nickname, playerId } = data;
    if (!nickname || nickname.trim() === '') {
        socket.emit('error', 'Nickname is required');
        return;
    }

    const game = games.get(joinKey);
    if (!game) {
        socket.emit('error', 'Game not found');
        return;
    }

    if (game.banned.has(playerId)) {
        socket.emit('error', 'You are banned from this game.');
        return;
    }

    // Check if player already in game
    const existingPlayer = game.players.find(p => p.id === playerId);
    if (existingPlayer) {
        // Update nickname if changed and not taken by others
        const trimmedNick = nickname.trim();
        if (existingPlayer.nickname !== trimmedNick) {
            if (game.players.some(p => p.id !== playerId && p.nickname === trimmedNick)) {
                socket.emit('error', 'Nickname already taken');
                return;
            }
            existingPlayer.nickname = trimmedNick;
            game.lastActivity = Date.now();
            socket.playerId = playerId;
            socket.join(joinKey);
            console.log('Emitting gameJoined to', socket.id, 'with joinKey:', joinKey);
        socket.emit('gameJoined', { joinKey, players: game.players, readyPhase: game.readyPhase, readyPlayers: Array.from(game.readyPlayers), isStarted: game.isStarted });
        socket.to(joinKey).emit('playerJoined', { players: game.players });
        console.log(`${trimmedNick} rejoined game: ${joinKey}`);
        } else {
            // Already joined with same nick
            socket.emit('error', 'Already in game');
        }
        return;
    }

    if (game.players.length >= 6) {
        socket.emit('error', 'Game is full');
        return;
    }

    // Check for duplicate nickname
    if (game.players.some(p => p.nickname === nickname.trim())) {
        socket.emit('error', 'Nickname already taken');
        return;
    }

    const player = { id: playerId, nickname: nickname.trim() };
    game.players.push(player);
    game.lastActivity = Date.now();
    socket.playerId = playerId;
    socket.join(joinKey);
    console.log('Emitting gameJoined to', socket.id, 'with joinKey:', joinKey);
        socket.emit('gameJoined', { joinKey, players: game.players, readyPhase: game.readyPhase, readyPlayers: Array.from(game.readyPlayers), isStarted: game.isStarted });
        socket.to(joinKey).emit('playerJoined', { players: game.players });
        console.log(`${nickname} joined game: ${joinKey}`);
});

    // Leave game
    socket.on('leaveGame', (data) => {
        const { playerId } = data;
        for (const [key, game] of games) {
            const index = game.players.findIndex(p => p.id === playerId);
            if (index !== -1) {
                game.players.splice(index, 1);
                game.lastActivity = Date.now();
                socket.to(key).emit('playerLeft', { players: game.players });
                console.log(`Player ${playerId} left game: ${key}`);
                break;
            }
        }
    });

    // Kick player
    socket.on('kickPlayer', (data) => {
        const { kickedPlayerId, playerId } = data;
        for (const [key, game] of games) {
            const kicker = game.players.find(p => p.id === playerId);
            if (kicker && game.players[0].id === playerId) { // Only creator can kick
                const kickedIndex = game.players.findIndex(p => p.id === kickedPlayerId);
                if (kickedIndex !== -1 && kickedPlayerId !== playerId) {
                    const kickedPlayer = game.players.splice(kickedIndex, 1)[0];
                    game.lastActivity = Date.now();
                    // Increment kick count
                    const newCount = (game.kickCounts.get(kickedPlayerId) || 0) + 1;
                    game.kickCounts.set(kickedPlayerId, newCount);
                    if (newCount >= 2) {
                        game.banned.add(kickedPlayerId);
                        console.log(`Player ${kickedPlayerId} banned from game: ${key}`);
                    }
                    // Find the kicked player's socket and emit
                    for (const [id, sock] of io.sockets.sockets) {
                        if (sock.playerId === kickedPlayerId) {
                            sock.emit('kicked', { message: newCount >= 2 ? 'You have been banned from this game.' : 'You have been kicked from the game.' });
                            sock.leave(key);
                            break;
                        }
                    }
                    socket.to(key).emit('playerLeft', { players: game.players });
                    console.log(`Player ${kickedPlayerId} kicked from game: ${key} (count: ${newCount})`);
                }
            }
            break;
        }
    });

// Reconnect to game
socket.on('reconnectGame', (data) => {
    const { joinKey, playerId } = data;
    console.log('Received reconnectGame for', joinKey, playerId);
    const game = games.get(joinKey);
    if (!game) {
        socket.emit('error', 'Game not found');
        return;
    }
    if (false) { // No expiry for testing
        games.delete(joinKey);
        socket.emit('error', 'Game expired');
        return;
    }
    if (game.banned.has(playerId)) {
        socket.emit('error', 'You are banned from this game.');
        return;
    }
    const player = game.players.find(p => p.id === playerId);
    if (!player) {
        socket.emit('error', 'Player not in game');
        return;
    }
        socket.playerId = playerId;
        socket.join(joinKey);
        game.lastActivity = Date.now();
        socket.emit('gameJoined', { joinKey, players: game.players, readyPhase: game.readyPhase, readyPlayers: Array.from(game.readyPlayers), isStarted: game.isStarted });
        console.log(`Reconnected ${player.nickname} to game: ${joinKey}`);
    });

// Send message
socket.on('sendMessage', (data) => {
    const { message, playerId } = data;
    if (!message || message.trim() === '') return;

    // Find the game
    let game = null;
    let playerNickname = null;
    for (const [key, g] of games) {
        const player = g.players.find(p => p.id === playerId);
        if (player) {
            game = g;
            playerNickname = player.nickname;
            break;
        }
    }
    if (!game) return;

    const chatMessage = `${playerNickname}: ${message.trim()}`;
    game.chat.push(chatMessage);
    game.lastActivity = Date.now();
    io.to(game.joinKey).emit('message', { message: chatMessage });
});

// Start ready phase
socket.on('startReady', (data) => {
    const { playerId } = data;
    for (const [key, game] of games) {
        if (game.players[0].id === playerId && !game.readyPhase && !game.isStarted && game.players.length >= 2) {
            game.readyPhase = true;
            game.readyPlayers.clear();
            game.lastActivity = Date.now();
            io.to(key).emit('readyPhaseStarted');
            console.log(`Ready phase started for game: ${key}`);
            break;
        }
    }
});

// Toggle ready
socket.on('toggleReady', (data) => {
    const { playerId } = data;
    for (const [key, game] of games) {
        const player = game.players.find(p => p.id === playerId);
        if (player && game.readyPhase && !game.isStarted) {
            if (game.readyPlayers.has(playerId)) {
                game.readyPlayers.delete(playerId);
            } else {
                game.readyPlayers.add(playerId);
            }
            game.lastActivity = Date.now();
            io.to(key).emit('readyUpdate', { readyPlayers: Array.from(game.readyPlayers) });
            // Check if all ready
            if (game.readyPlayers.size === game.players.length) {
                initializeGame(game, key);
            }
            console.log(`Player ${playerId} toggled ready in game: ${key}`);
            break;
        }
    }
});

// Initialize game function
function initializeGame(game, key) {
    // Ported from loveletter.py
    const CARDS = {
        'Princess': { count: 1, value: 8 },
        'Countess': { count: 1, value: 7 },
        'King': { count: 1, value: 6 },
        'Prince': { count: 2, value: 5 },
        'Handmaiden': { count: 2, value: 4 },
        'Baron': { count: 2, value: 3 },
        'Priest': { count: 2, value: 2 },
        'Guard': { count: 5, value: 1 }
    };

    class Card {
        constructor(name, value) {
            this.name = name;
            this.value = value;
        }
    }

    game.deck = [];
    for (const [name, info] of Object.entries(CARDS)) {
        for (let i = 0; i < info.count; i++) {
            game.deck.push(new Card(name, info.value));
        }
    }

    // Shuffle deck
    game.deck.sort(() => Math.random() - 0.5);

    // Burn first card
    game.burnedCard = game.deck.shift();

    // Deal one card to each player
    game.hands = new Map();
    game.players.forEach(player => {
        const card = game.deck.shift();
        game.hands.set(player.id, [card]);
    });

    // Pick random starting player
    const randomIndex = Math.floor(Math.random() * game.players.length);
    game.currentPlayerId = game.players[randomIndex].id;

    game.isStarted = true;
    game.readyPhase = false;
    game.lastActivity = Date.now();

    // Broadcast public state
    io.to(key).emit('gameStarted', { currentPlayerId: game.currentPlayerId, burnedCard: { name: game.burnedCard.name, value: game.burnedCard.value } });

    // Send private hands
    game.players.forEach(player => {
        const hand = game.hands.get(player.id);
        io.to(player.id).emit('privateHand', { hand: hand.map(c => ({ name: c.name, value: c.value })) });
    });

    console.log(`Game started for ${key}, starting player: ${game.currentPlayerId}`);
}

// Start ready phase
socket.on('startReady', (data) => {
    const { playerId } = data;
    for (const [key, game] of games) {
        if (game.players[0].id === playerId && !game.readyPhase && !game.isStarted && game.players.length >= 2) {
            game.readyPhase = true;
            game.readyPlayers.clear();
            game.lastActivity = Date.now();
            io.to(key).emit('readyPhaseStarted');
            console.log(`Ready phase started for game: ${key}`);
            break;
        }
    }
});

// Toggle ready
socket.on('toggleReady', (data) => {
    const { playerId } = data;
    for (const [key, game] of games) {
        const player = game.players.find(p => p.id === playerId);
        if (player && game.readyPhase && !game.isStarted) {
            if (game.readyPlayers.has(playerId)) {
                game.readyPlayers.delete(playerId);
            } else {
                game.readyPlayers.add(playerId);
            }
            game.lastActivity = Date.now();
            io.to(key).emit('readyUpdate', { readyPlayers: Array.from(game.readyPlayers) });
            // Check if all ready
            if (game.readyPlayers.size === game.players.length) {
                initializeGame(game, key);
            }
            console.log(`Player ${playerId} toggled ready in game: ${key}`);
            break;
        }
    }
});

// Initialize game function
function initializeGame(game, key) {
    // Ported from loveletter.py
    const CARDS = {
        'Princess': { count: 1, value: 8 },
        'Countess': { count: 1, value: 7 },
        'King': { count: 1, value: 6 },
        'Prince': { count: 2, value: 5 },
        'Handmaiden': { count: 2, value: 4 },
        'Baron': { count: 2, value: 3 },
        'Priest': { count: 2, value: 2 },
        'Guard': { count: 5, value: 1 }
    };

    class Card {
        constructor(name, value) {
            this.name = name;
            this.value = value;
        }
    }

    game.deck = [];
    for (const [name, info] of Object.entries(CARDS)) {
        for (let i = 0; i < info.count; i++) {
            game.deck.push(new Card(name, info.value));
        }
    }

    // Shuffle deck
    game.deck.sort(() => Math.random() - 0.5);

    // Burn first card
    game.burnedCard = game.deck.shift();

    // Deal one card to each player
    game.hands = new Map();
    game.players.forEach(player => {
        const card = game.deck.shift();
        game.hands.set(player.id, [card]);
    });

    // Pick random starting player
    const randomIndex = Math.floor(Math.random() * game.players.length);
    game.currentPlayerId = game.players[randomIndex].id;

    game.isStarted = true;
    game.readyPhase = false;
    game.lastActivity = Date.now();

    // Broadcast public state
    io.to(key).emit('gameStarted', { currentPlayerId: game.currentPlayerId });

    // Send private hands
    game.players.forEach(player => {
        const hand = game.hands.get(player.id);
        io.to(player.id).emit('privateHand', { hand: hand.map(c => ({ name: c.name, value: c.value })) });
    });

    console.log(`Game started for ${key}, starting player: ${game.currentPlayerId}`);
}

// Handle disconnection
socket.on('disconnect', () => {
    console.log('A user disconnected:', socket.id);
    // Remove player from game
    for (const [key, game] of games) {
        const index = game.players.findIndex(p => p.id === socket.playerId);
        if (index !== -1) {
            game.players.splice(index, 1);
            game.readyPlayers.delete(socket.playerId);
            game.lastActivity = Date.now();
            socket.to(key).emit('playerLeft', { players: game.players });
            // If creator left
            if (index === 0) {
                io.to(key).emit('gameEnded', { message: 'Creator left the game' });
                games.delete(key);
            } else if (game.players.length === 0) {
                games.delete(key);
            } else if (game.readyPhase) {
                io.to(key).emit('readyUpdate', { readyPlayers: Array.from(game.readyPlayers) });
            } else if (game.isStarted && game.players.length < 2) {
                io.to(key).emit('gameEnded', { message: 'Game ended due to insufficient players' });
                games.delete(key);
            }
            break;
        }
    }
});
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});