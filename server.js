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
            banned: new Set()
        };
    games.set(joinKey, game);

    socket.playerId = playerId;
    socket.join(joinKey);
    console.log('Emitting gameJoined to', socket.id, 'with joinKey:', joinKey);
    socket.emit('gameJoined', { joinKey, players: game.players });
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
            socket.emit('gameJoined', { joinKey, players: game.players });
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
    socket.emit('gameJoined', { joinKey, players: game.players });
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
        socket.emit('gameJoined', { joinKey, players: game.players });
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

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log('A user disconnected:', socket.id);
        // Remove player from game
        for (const [key, game] of games) {
            const index = game.players.findIndex(p => p.id === socket.id);
            if (index !== -1) {
                game.players.splice(index, 1);
                socket.to(key).emit('playerLeft', { players: game.players });
                // If no players left, delete game
                if (game.players.length === 0) {
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