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
    socket.join(playerId); // for private messages (hands, priest reveals) - symmetric with joinGame/reconnect
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
    socket.join(playerId); // for private messages (hands, priest reveals)
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

    // Per policy: disallow brand-new players from joining once a round has started.
    // Reconnects for existing playerIds are allowed (handled in the block above).
    // Joins are permitted again during the inter-round pause (roundOver) so the
    // newcomer is included when startNewRound deals the next hands.
    if (game.isStarted && !game.roundOver) {
        socket.emit('error', 'Cannot join: a round is already in progress');
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
    socket.join(playerId);
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
                game.readyPlayers.delete(playerId);
                game.lastActivity = Date.now();
                socket.to(key).emit('playerLeft', { players: game.players });
                if (game.readyPhase) {
                    io.to(key).emit('readyUpdate', { players: game.players, readyPlayers: Array.from(game.readyPlayers) });
                }
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
            if (kicker && game.players.length > 0 && game.players[0] && game.players[0].id === playerId) { // Only creator can kick
                const kickedIndex = game.players.findIndex(p => p.id === kickedPlayerId);
                if (kickedIndex !== -1 && kickedPlayerId !== playerId) {
                    const kickedPlayer = game.players.splice(kickedIndex, 1)[0];
                    game.readyPlayers.delete(kickedPlayerId);
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
                    if (game.readyPhase) {
                        io.to(key).emit('readyUpdate', { players: game.players, readyPlayers: Array.from(game.readyPlayers) });
                    }
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
        socket.join(playerId);
        game.lastActivity = Date.now();
        socket.emit('gameJoined', { joinKey, players: game.players, readyPhase: game.readyPhase, readyPlayers: Array.from(game.readyPlayers), isStarted: game.isStarted });

        // Send current hand on reconnect if game is active
        if (game.isStarted && game.hands && game.hands.has(playerId)) {
            const h = game.hands.get(playerId);
            socket.emit('privateHand', {
                hand: h.map(c => ({ name: c.name, value: c.value }))
            });
        }

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
        if (game.players && game.players.length >= 2 && game.players[0] && game.players[0].id === playerId && !game.readyPhase && !game.isStarted) {
            game.readyPhase = true;
            game.readyPlayers.clear();
            game.readyPlayers.add(playerId);
            game.lastActivity = Date.now();
            io.to(key).emit('readyPhaseStarted');
            io.to(key).emit('readyUpdate', { players: game.players, readyPlayers: Array.from(game.readyPlayers) });
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
            io.to(key).emit('readyUpdate', { players: game.players, readyPlayers: Array.from(game.readyPlayers) });
            // Auto-start when all ready
            if (game.readyPlayers.size === game.players.length) {
                initializeGame(game, key);
                console.log(`Game auto-started for ${key}`);
            }
            console.log(`Player ${playerId} toggled ready in game: ${key}`);
            break;
        }
    }
});

// Play a card (core game action)
socket.on('playCard', (data) => {
    const { playerId, cardIndex, targetPlayerId, guess } = data;
    for (const [key, game] of games) {
        if (!game.isStarted || game.roundOver) continue;

        const pIdx = game.players.findIndex(pp => pp.id === playerId);
        if (pIdx === -1) continue;

        if (game.currentPlayerId !== playerId) {
            // Not your turn
            socket.emit('error', 'Not your turn');
            break;
        }
        if (game.eliminated.has(playerId)) {
            socket.emit('error', 'You are out of this round');
            break;
        }

        const hand = game.hands.get(playerId) || [];
        if (cardIndex < 0 || cardIndex >= hand.length) {
            socket.emit('error', 'Invalid card selection');
            break;
        }

        const cardToPlay = hand[cardIndex];

        // Countess rule enforcement: if holding Countess + (King or Prince), must play Countess
        const hasCountess = hand.some(c => c.name === 'Countess');
        const hasRoyal = hand.some(c => c.name === 'King' || c.name === 'Prince');
        if (hasCountess && hasRoyal && cardToPlay.name !== 'Countess') {
            socket.emit('error', 'You must play the Countess when holding it with King or Prince');
            break;
        }

        // Validate target for cards that require one
        const needsTarget = ['Guard', 'Priest', 'Baron', 'King', 'Prince'].includes(cardToPlay.name);
        const allowsSelf = cardToPlay.name === 'Prince';

        if (needsTarget && targetPlayerId) {
            // Only validate if a target was actually chosen.
            // If no target (all others protected/eliminated), we allow the play — effect will fizzle.
            if (targetPlayerId === playerId && !allowsSelf) {
                socket.emit('error', 'This card requires a different target player');
                break;
            }
            const target = game.players.find(pp => pp.id === targetPlayerId);
            if (!target || game.eliminated.has(targetPlayerId) || game.protected.has(targetPlayerId)) {
                socket.emit('error', 'Invalid or protected target');
                break;
            }
        }

        if (cardToPlay.name === 'Guard' && guess === 'Guard') {
            socket.emit('error', 'Cannot guess Guard');
            break;
        }

        // All checks passed — perform the play
        const playedCard = hand.splice(cardIndex, 1)[0];

        // Record
        if (!game.discards.has(playerId)) game.discards.set(playerId, []);
        game.discards.get(playerId).push(playedCard);
        game.lastPlayed.set(playerId, playedCard);
        game.lastActivity = Date.now();

        const actor = game.players[pIdx];

        // Send updated hand to the player who just played (they now have one less card)
        const updatedHand = game.hands.get(playerId) || [];
        io.to(playerId).emit('privateHand', {
            hand: updatedHand.map(c => ({ name: c.name, value: c.value }))
        });

        // Public announcement of the play
        io.to(key).emit('cardPlayed', {
            playerId,
            nickname: actor.nickname,
            card: { name: playedCard.name, value: playedCard.value },
            targetPlayerId: targetPlayerId || null,
            guess: guess || null
        });

        // Resolve effect (may eliminate, reveal, swap, etc.)
        resolveCardEffect(game, key, playerId, playedCard, targetPlayerId, guess);

        // If the player who just acted is still in and round not over, their turn ends
        if (!game.roundOver) {
            advanceToNextPlayer(game, key);
        }

        break;
    }
});

// Safety net: client can request their current hand (e.g. if a privateHand was missed on round start or reconnect)
socket.on('getMyHand', (data) => {
    const { playerId } = data;
    for (const [key, game] of games) {
        if (game.isStarted && game.hands && game.hands.has(playerId)) {
            const h = game.hands.get(playerId);
            socket.emit('privateHand', {
                hand: h.map(c => ({ name: c.name, value: c.value }))
            });
            break;
        }
    }
});

// Card definitions (standard Love Letter)
const CARD_DEFS = {
    'Guard':     { count: 5, value: 1, effect: 'guard' },
    'Priest':    { count: 2, value: 2, effect: 'priest' },
    'Baron':     { count: 2, value: 3, effect: 'baron' },
    'Handmaid':  { count: 2, value: 4, effect: 'handmaid' },
    'Prince':    { count: 2, value: 5, effect: 'prince' },
    'King':      { count: 1, value: 6, effect: 'king' },
    'Countess':  { count: 1, value: 7, effect: 'countess' },
    'Princess':  { count: 1, value: 8, effect: 'princess' }
};

class Card {
    constructor(name, value) {
        this.name = name;
        this.value = value;
    }
}

function buildAndShuffleDeck() {
    const deck = [];
    for (const [name, info] of Object.entries(CARD_DEFS)) {
        for (let i = 0; i < info.count; i++) {
            deck.push(new Card(name, info.value));
        }
    }
    // Fisher-Yates shuffle
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

// Start a brand new match (first round)
function initializeGame(game, key) {
    game.tokens = new Map();
    game.players.forEach(p => game.tokens.set(p.id, 0));
    game.roundNumber = 1;
    game.isStarted = true;
    game.readyPhase = false;
    game.lastActivity = Date.now();
    game.discards = new Map();
    game.lastPlayed = new Map();
    game.protected = new Set();
    game.eliminated = new Set();
    game.roundOver = false;

    startNewRound(game, key, true);
}

// Start (or restart) a single round within the match
function startNewRound(game, key, isFirstRound = false) {
    game.deck = buildAndShuffleDeck();
    game.removedCard = game.deck.shift(); // burned/removed card for the round
    game.hands = new Map();
    game.discards = new Map();
    game.protected = new Set();
    game.eliminated = new Set();
    game.lastPlayed = new Map();
    game.roundOver = false;

    // Deal 1 card to each player (who is still in the overall game)
    game.players.forEach(player => {
        if (game.deck.length > 0) {
            const c = game.deck.shift();
            game.hands.set(player.id, [c]);
        } else {
            game.hands.set(player.id, []);
        }
    });

    // Choose starting player: for first round random, otherwise previous round winner or random among remaining
    let startIdx = Math.floor(Math.random() * game.players.length);
    if (!isFirstRound && game.lastRoundWinnerId) {
        const wIdx = game.players.findIndex(p => p.id === game.lastRoundWinnerId);
        if (wIdx !== -1) startIdx = wIdx;
    }
    game.currentPlayerId = game.players[startIdx].id;

    game.lastActivity = Date.now();

    // Draw for the starting player synchronously *before* any round broadcasts.
    // This ensures the privateHand we emit for them (in the loop below) is already the
    // correct 2-card hand per Love Letter rules. We emit playerDrew + turnChanged after
    // roundStarted for clean event ordering (enables play UI after round announce).
    if (game.deck.length > 0 && game.hands.has(game.currentPlayerId) && !game.eliminated.has(game.currentPlayerId)) {
        const drawn = game.deck.shift();
        const hand = game.hands.get(game.currentPlayerId);
        hand.push(drawn);
        game.protected.delete(game.currentPlayerId);
    }

    // Broadcast round start
    io.to(key).emit('roundStarted', {
        roundNumber: game.roundNumber,
        currentPlayerId: game.currentPlayerId,
        removedCard: { name: game.removedCard.name, value: game.removedCard.value }, // visible only for flavor / future tiebreak
        tokens: Object.fromEntries(game.tokens)
    });

    // Private hands (post-draw for the starting player, 1 card for others)
    game.players.forEach(player => {
        const h = game.hands.get(player.id) || [];
        io.to(player.id).emit('privateHand', { hand: h.map(c => ({ name: c.name, value: c.value })) });
    });

    // Announce the draw and whose turn it is (client uses this to enable actionArea)
    const p = game.players.find(pp => pp.id === game.currentPlayerId);
    io.to(key).emit('playerDrew', { playerId: game.currentPlayerId, nickname: p ? p.nickname : '' });
    io.to(key).emit('turnChanged', { currentPlayerId: game.currentPlayerId });

    console.log(`Round ${game.roundNumber} started for ${key}, first player: ${game.currentPlayerId}`);
}

function drawForPlayer(game, key, playerId) {
    if (game.roundOver || game.eliminated.has(playerId) || !game.hands.has(playerId)) return;

    if (game.deck.length === 0) {
        endRound(game, key, true);
        return;
    }

    const drawn = game.deck.shift();
    const hand = game.hands.get(playerId);
    hand.push(drawn);

    // Protection drops at the start of your turn (Handmaid lasts until the protected
    // player's next turn begins). Broadcast the end so clients can update UI and
    // allow targeting again.
    const p = game.players.find(pp => pp.id === playerId);
    if (game.protected.has(playerId)) {
        game.protected.delete(playerId);
        io.to(key).emit('playerProtectionEnded', {
            playerId,
            nickname: p ? p.nickname : ''
        });
    }

    // Send updated private hand to the player
    io.to(playerId).emit('privateHand', {
        hand: hand.map(c => ({ name: c.name, value: c.value }))
    });

    // Notify everyone that the player drew (card hidden)
    io.to(key).emit('playerDrew', { playerId, nickname: p ? p.nickname : '' });

    // If after draw they have Countess + King/Prince, they are forced to play Countess (client can enforce too)
    // But server will enforce on playCard

    io.to(key).emit('turnChanged', { currentPlayerId: playerId });
}

function advanceToNextPlayer(game, key) {
    if (game.roundOver) return;

    const activePlayers = game.players.filter(p => !game.eliminated.has(p.id));
    if (activePlayers.length <= 1) {
        endRound(game, key);
        return;
    }

    // If no cards left in deck at the start of someone's turn, round ends
    if (game.deck.length === 0) {
        endRound(game, key, true);
        return;
    }

    let idx = game.players.findIndex(p => p.id === game.currentPlayerId);
    let attempts = 0;
    do {
        idx = (idx + 1) % game.players.length;
        const candidate = game.players[idx];
        if (!game.eliminated.has(candidate.id)) {
            game.currentPlayerId = candidate.id;
            break;
        }
        attempts++;
        if (attempts > game.players.length * 2) break; // safety
    } while (true);

    // Draw for the new current player (this also drops their protection)
    drawForPlayer(game, key, game.currentPlayerId);
}

function resolveCardEffect(game, key, actorId, playedCard, targetId, guess) {
    const effect = CARD_DEFS[playedCard.name] ? CARD_DEFS[playedCard.name].effect : null;
    if (!effect) return;

    const actor = game.players.find(p => p.id === actorId);
    if (!actor) return;

    switch (effect) {
        case 'princess':
            // Playing Princess eliminates you
            game.eliminated.add(actorId);
            io.to(key).emit('playerEliminated', { playerId: actorId, nickname: actor.nickname, reason: 'Princess' });
            checkRoundEndAfterElimination(game, key);
            break;

        case 'handmaid':
            game.protected.add(actorId);
            io.to(key).emit('playerProtected', { playerId: actorId, nickname: actor.nickname });
            break;

        case 'countess':
            // No special effect, just played
            break;

        case 'guard': {
            if (!targetId || !guess) {
                io.to(key).emit('message', { message: `${actor.nickname}'s Guard had no effect (no unprotected targets).` });
                return;
            }
            if (game.protected.has(targetId) || game.eliminated.has(targetId)) {
                io.to(key).emit('message', { message: `${actor.nickname}'s Guard had no effect (no unprotected targets).` });
                return;
            }
            const targetPlayer = game.players.find(p => p.id === targetId);
            const targetHand = game.hands.get(targetId) || [];
            const correct = targetHand.some(c => c.name === guess);
            if (correct) {
                game.eliminated.add(targetId);
                io.to(key).emit('playerEliminated', { playerId: targetId, nickname: targetPlayer ? targetPlayer.nickname : '', reason: `Guard guessed ${guess}` });
                io.to(key).emit('guardSuccess', { actorId, targetId, guess });
                checkRoundEndAfterElimination(game, key);
            } else {
                io.to(key).emit('guardFail', { actorId, targetId, guess });
            }
            break;
        }

        case 'priest': {
            if (!targetId) {
                io.to(key).emit('message', { message: `${actor.nickname}'s Priest had no effect (no unprotected targets).` });
                return;
            }
            if (game.protected.has(targetId) || game.eliminated.has(targetId)) {
                io.to(key).emit('message', { message: `${actor.nickname}'s Priest had no effect (no unprotected targets).` });
                return;
            }
            const targetPlayer = game.players.find(p => p.id === targetId);
            const targetHand = (game.hands.get(targetId) || []).map(c => ({ name: c.name, value: c.value }));
            // Only the actor sees the hand
            io.to(actorId).emit('priestReveal', {
                targetId,
                nickname: targetPlayer ? targetPlayer.nickname : '',
                hand: targetHand
            });
            io.to(key).emit('priestUsed', { actorId, actorNick: actor.nickname, targetId });
            break;
        }

        case 'baron': {
            if (!targetId) {
                io.to(key).emit('message', { message: `${actor.nickname}'s Baron had no effect (no unprotected targets).` });
                return;
            }
            if (game.protected.has(targetId) || game.eliminated.has(targetId)) {
                io.to(key).emit('message', { message: `${actor.nickname}'s Baron had no effect (no unprotected targets).` });
                return;
            }
            const targetPlayer = game.players.find(p => p.id === targetId);
            const actorHand = game.hands.get(actorId) || [];
            const tHand = game.hands.get(targetId) || [];
            const actorCard = actorHand[0];
            const targetCard = tHand[0];
            if (!actorCard || !targetCard) return;

            // Reveal both cards publicly for the comparison
            io.to(key).emit('baronCompare', {
                actorId,
                actorNick: actor.nickname,
                actorCard: { name: actorCard.name, value: actorCard.value },
                targetId,
                targetNick: targetPlayer ? targetPlayer.nickname : '',
                targetCard: { name: targetCard.name, value: targetCard.value }
            });

            if (actorCard.value > targetCard.value) {
                game.eliminated.add(targetId);
                io.to(key).emit('playerEliminated', { playerId: targetId, nickname: targetPlayer.nickname, reason: 'Baron' });
            } else if (targetCard.value > actorCard.value) {
                game.eliminated.add(actorId);
                io.to(key).emit('playerEliminated', { playerId: actorId, nickname: actor.nickname, reason: 'Baron' });
            }
            checkRoundEndAfterElimination(game, key);
            break;
        }

        case 'prince': {
            const princeTarget = targetId || actorId; // default to self if none provided
            if (game.eliminated.has(princeTarget)) {
                io.to(key).emit('message', { message: `${actor.nickname}'s Prince had no effect (no unprotected targets).` });
                return;
            }
            if (game.protected.has(princeTarget)) {
                io.to(key).emit('message', { message: `${actor.nickname}'s Prince had no effect (no unprotected targets).` });
                return;
            }
            const tPlayer = game.players.find(p => p.id === princeTarget);
            const tHand = game.hands.get(princeTarget) || [];
            if (tHand.length === 0) break;

            // Discard current hand
            const discarded = tHand.shift();
            if (!game.discards.has(princeTarget)) game.discards.set(princeTarget, []);
            game.discards.get(princeTarget).push(discarded);

            if (discarded.name === 'Princess') {
                game.eliminated.add(princeTarget);
                io.to(key).emit('playerEliminated', { playerId: princeTarget, nickname: tPlayer ? tPlayer.nickname : '', reason: 'Prince forced Princess' });
            } else {
                // Draw a replacement if possible
                if (game.deck.length > 0) {
                    const newCard = game.deck.shift();
                    tHand.push(newCard);
                } else if (game.removedCard) {
                    // Use the removed card as last resort (some house rules)
                    tHand.push(game.removedCard);
                    game.removedCard = null;
                }
            }

            // Notify the target of their new hand (if not eliminated)
            if (!game.eliminated.has(princeTarget)) {
                io.to(princeTarget).emit('privateHand', {
                    hand: tHand.map(c => ({ name: c.name, value: c.value }))
                });
            }

            io.to(key).emit('princeEffect', {
                actorId,
                actorNick: actor.nickname,
                targetId: princeTarget,
                targetNick: tPlayer ? tPlayer.nickname : '',
                discarded: { name: discarded.name, value: discarded.value }
            });

            checkRoundEndAfterElimination(game, key);
            break;
        }

        case 'king': {
            if (!targetId || targetId === actorId) {
                io.to(key).emit('message', { message: `${actor.nickname}'s King had no effect (no unprotected targets).` });
                return;
            }
            if (game.protected.has(targetId) || game.eliminated.has(targetId)) {
                io.to(key).emit('message', { message: `${actor.nickname}'s King had no effect (no unprotected targets).` });
                return;
            }

            const targetPlayer = game.players.find(p => p.id === targetId);
            const actorHand = game.hands.get(actorId) || [];
            const tHand = game.hands.get(targetId) || [];

            // Swap
            game.hands.set(actorId, tHand);
            game.hands.set(targetId, actorHand);

            // Send new private hands
            io.to(actorId).emit('privateHand', {
                hand: tHand.map(c => ({ name: c.name, value: c.value }))
            });
            io.to(targetId).emit('privateHand', {
                hand: actorHand.map(c => ({ name: c.name, value: c.value }))
            });

            io.to(key).emit('kingSwap', {
                actorId,
                actorNick: actor.nickname,
                targetId,
                targetNick: targetPlayer ? targetPlayer.nickname : ''
            });
            break;
        }
    }
}

function checkRoundEndAfterElimination(game, key) {
    const stillActive = game.players.filter(p => !game.eliminated.has(p.id));
    if (stillActive.length <= 1) {
        endRound(game, key);
    }
}

function endRound(game, key, deckEmpty = false) {
    if (game.roundOver) return;
    game.roundOver = true;

    const active = game.players.filter(p => !game.eliminated.has(p.id));

    let roundWinner = null;
    if (active.length === 1) {
        roundWinner = active[0];
    } else if (active.length > 1) {
        // Compare hands (highest value wins). Simple tie-break: first in list with the max value
        let bestValue = -1;
        let winners = [];
        active.forEach(pl => {
            const h = game.hands.get(pl.id) || [];
            const val = h.length > 0 ? h[0].value : 0;
            if (val > bestValue) {
                bestValue = val;
                winners = [pl];
            } else if (val === bestValue) {
                winners.push(pl);
            }
        });
        if (winners.length === 1) {
            roundWinner = winners[0];
        } else {
            // Tie: use lastPlayed value as tiebreaker if available, otherwise pick first
            let bestLast = -1;
            let tieWinners = [];
            winners.forEach(pl => {
                const last = game.lastPlayed.get(pl.id);
                const v = last ? last.value : 0;
                if (v > bestLast) {
                    bestLast = v;
                    tieWinners = [pl];
                } else if (v === bestLast) {
                    tieWinners.push(pl);
                }
            });
            roundWinner = tieWinners.length > 0 ? tieWinners[0] : winners[0];
        }
    }

    // Award token
    if (roundWinner) {
        const current = game.tokens.get(roundWinner.id) || 0;
        game.tokens.set(roundWinner.id, current + 1);
        game.lastRoundWinnerId = roundWinner.id;
    }

    // Reveal all remaining hands + the removed card
    const revealed = {};
    game.players.forEach(pl => {
        const h = game.hands.get(pl.id) || [];
        revealed[pl.id] = h.map(c => ({ name: c.name, value: c.value }));
    });

    io.to(key).emit('roundEnded', {
        roundNumber: game.roundNumber,
        winnerId: roundWinner ? roundWinner.id : null,
        winnerNickname: roundWinner ? roundWinner.nickname : null,
        revealed,
        removedCard: game.removedCard ? { name: game.removedCard.name, value: game.removedCard.value } : null,
        tokens: Object.fromEntries(game.tokens),
        deckEmpty: !!deckEmpty
    });

    // Check for match win (first to 3 tokens)
    let matchWinner = null;
    for (const [pid, t] of game.tokens) {
        if (t >= 3) {
            matchWinner = game.players.find(p => p.id === pid);
            break;
        }
    }

    if (matchWinner) {
        io.to(key).emit('gameOver', {
            winnerId: matchWinner.id,
            winnerNickname: matchWinner.nickname,
            finalTokens: Object.fromEntries(game.tokens)
        });
        // Optionally keep the game object for a bit or delete
        setTimeout(() => games.delete(key), 30000);
        return;
    }

    // Start next round automatically after a short pause
    game.roundNumber += 1;
    setTimeout(() => {
        if (games.has(key) && game.isStarted) {
            startNewRound(game, key, false);
        }
    }, 4000);
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
            game.eliminated && game.eliminated.delete(socket.playerId);
            game.protected && game.protected.delete(socket.playerId);
            game.hands && game.hands.delete(socket.playerId);
            game.lastActivity = Date.now();
            socket.to(key).emit('playerLeft', { players: game.players });
            // If creator left
            if (index === 0) {
                io.to(key).emit('gameEnded', { message: 'Creator left the game' });
                games.delete(key);
            } else if (game.players.length === 0) {
                games.delete(key);
            } else if (game.readyPhase) {
                io.to(key).emit('readyUpdate', { players: game.players, readyPlayers: Array.from(game.readyPlayers) });
            } else if (game.isStarted) {
                if (game.players.length < 2) {
                    io.to(key).emit('gameEnded', { message: 'Game ended due to insufficient players' });
                    games.delete(key);
                } else {
                    // If it was their turn, advance
                    if (game.currentPlayerId === socket.playerId) {
                        // Pick next non-eliminated (simple recovery; order is original list order)
                        const active = game.players.filter(p => !game.eliminated.has(p.id));
                        if (active.length > 0) {
                            game.currentPlayerId = active[0].id;
                            io.to(key).emit('turnChanged', { currentPlayerId: game.currentPlayerId });
                            // draw for them if possible
                            if (!game.roundOver && game.deck && game.deck.length > 0) {
                                drawForPlayer(game, key, game.currentPlayerId);
                            }
                        }
                    }
                    io.to(key).emit('readyUpdate', { players: game.players, readyPlayers: Array.from(game.readyPlayers) });
                }
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