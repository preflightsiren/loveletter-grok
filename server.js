const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files from public directory
app.use(express.static('public'));

// In-memory storage for games
const games = new Map();

// Minimal in-memory analytics (process lifetime; no PII)
const metricsState = {
    roomsCreated: 0,
    peakConcurrentPlayers: 0,
    seenPlayers: new Set(),       // unique visitorIds (or playerIds) observed this process
    returningPlayerIds: new Set() // ids seen again after first sighting
};

function trackPlayerSighting(dataOrId) {
    // Prefer stable visitorId (localStorage) for returning-player metrics; fall back to playerId.
    let id = null;
    if (dataOrId && typeof dataOrId === 'object') {
        id = dataOrId.visitorId || dataOrId.playerId;
    } else {
        id = dataOrId;
    }
    if (!id || typeof id !== 'string') return;
    if (metricsState.seenPlayers.has(id)) {
        metricsState.returningPlayerIds.add(id);
    } else {
        metricsState.seenPlayers.add(id);
    }
}

function isHumanPlayer(p) {
    return !!(p && !p.isBot);
}

function countConcurrentPlayers() {
    // Humans only — bots must not inflate adoption / concurrency.
    let n = 0;
    for (const game of games.values()) {
        n += (game.players || []).filter(isHumanPlayer).length;
    }
    return n;
}

function countActiveRooms() {
    // A room counts as active only if at least one human is seated.
    let n = 0;
    for (const game of games.values()) {
        if ((game.players || []).some(isHumanPlayer)) n += 1;
    }
    return n;
}

function countBotsInPlay() {
    // Debug-only seat count; not a north-star adoption field.
    let n = 0;
    for (const game of games.values()) {
        n += (game.players || []).filter(p => p && p.isBot).length;
    }
    return n;
}

function bumpPeakConcurrent() {
    const concurrent = countConcurrentPlayers();
    if (concurrent > metricsState.peakConcurrentPlayers) {
        metricsState.peakConcurrentPlayers = concurrent;
    }
}

function buildMetricsPayload() {
    return {
        status: 'ok',
        uptime: process.uptime(),
        roomsCreated: metricsState.roomsCreated,
        activeRooms: countActiveRooms(),
        concurrentPlayers: countConcurrentPlayers(),
        peakConcurrentPlayers: metricsState.peakConcurrentPlayers,
        uniquePlayersSeen: metricsState.seenPlayers.size,
        returningPlayers: metricsState.returningPlayerIds.size,
        botsInPlay: countBotsInPlay()
    };
}

// Health check for Railway and monitoring (includes lightweight metrics)
app.get('/health', (req, res) => {
    res.status(200).json(buildMetricsPayload());
});

// Dedicated metrics JSON (same shape as /health extras)
app.get('/metrics', (req, res) => {
    res.status(200).json(buildMetricsPayload());
});

// Redirect game.html to index
app.get('/game.html', (req, res) => {
    res.redirect('/');
});

// --- Memorable join code generator (human-friendly) ---
const ADJECTIVES = [
  'ancient', 'bold', 'crimson', 'daring', 'elegant', 'fierce', 'golden',
  'hidden', 'noble', 'quiet', 'royal', 'silent', 'swift', 'whispered', 'wise',
  'brave', 'cunning', 'loyal', 'proud', 'shadowy'
];

const NOUNS = [
  'crown', 'rose', 'letter', 'seal', 'dagger', 'falcon', 'throne', 'mask',
  'parchment', 'knight', 'court', 'flame', 'garden', 'blade', 'whisper',
  'lion', 'tower', 'banner', 'chalice', 'serpent'
];

function generateMemorableCode() {
  // Try a few times to avoid collision with active games
  for (let i = 0; i < 30; i++) {
    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
    const code = `${adj}-${noun}`;
    const normalized = normalizeJoinKey(code);
    if (!games.has(normalized)) {
      return code; // return pretty form
    }
  }
  // Fallback with a number
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj}-${noun}-${Math.floor(Math.random() * 90) + 10}`;
}

function normalizeJoinKey(raw) {
  if (!raw || typeof raw !== 'string') return '';
  return raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const MAX_PLAYERS = 6;

// Courtly default nicknames (Design will polish BOT chip / portraits).
const BOT_NICKNAMES = [
    'Sir Pixel the Guard',
    'Courier of the Rose',
    'The Whisperer',
    'Lady Quill',
    'Court Jester'
];

function nextBotAvatarId(game) {
    const used = new Set((game.players || []).map(p => p.avatarId).filter(Boolean));
    for (let i = 1; i <= 5; i++) {
        const id = `bot-${i}`;
        if (!used.has(id)) return id;
    }
    return `bot-${(game.players || []).filter(p => p.isBot).length + 1}`;
}

function nextBotNickname(game) {
    const used = new Set((game.players || []).map(p => p.nickname));
    for (const name of BOT_NICKNAMES) {
        if (!used.has(name)) return name;
    }
    return `Court Bot ${(game.players || []).filter(p => p.isBot).length + 1}`;
}

function humanCount(game) {
    return (game.players || []).filter(isHumanPlayer).length;
}

function clearBotTimer(game) {
    if (game && game.botTurnTimer) {
        clearTimeout(game.botTurnTimer);
        game.botTurnTimer = null;
    }
}

// Simple rules-legal heuristic (not ML). Never targets Handmaid-protected players.
const GUARD_GUESSES_COMMON = ['Priest', 'Baron', 'Handmaid', 'Prince'];
const GUARD_GUESSES_RARE = ['Princess', 'Countess', 'King'];

function chooseGuardGuess() {
    if (Math.random() < 0.65) {
        return GUARD_GUESSES_COMMON[Math.floor(Math.random() * GUARD_GUESSES_COMMON.length)];
    }
    return GUARD_GUESSES_RARE[Math.floor(Math.random() * GUARD_GUESSES_RARE.length)];
}

function getValidTargets(game, actorId, cardName) {
    const allowsSelf = cardName === 'Prince';
    return (game.players || []).filter(p => {
        if (game.eliminated && game.eliminated.has(p.id)) return false;
        if (game.protected && game.protected.has(p.id)) return false;
        if (p.id === actorId && !allowsSelf) return false;
        return true;
    });
}

function chooseBotPlay(game, actorId) {
    const hand = (game.hands && game.hands.get(actorId)) || [];
    if (hand.length === 0) return null;

    const hasCountess = hand.some(c => c.name === 'Countess');
    const hasRoyal = hand.some(c => c.name === 'King' || c.name === 'Prince');
    if (hasCountess && hasRoyal) {
        return { cardIndex: hand.findIndex(c => c.name === 'Countess'), targetPlayerId: null, guess: null };
    }

    const names = hand.map(c => c.name);
    const pickIndex = (name) => hand.findIndex(c => c.name === name);
    const pickTarget = (cardName) => {
        const targets = getValidTargets(game, actorId, cardName);
        if (targets.length === 0) return null;
        const opponents = targets.filter(p => p.id !== actorId);
        const pool = opponents.length ? opponents : targets;
        return pool[Math.floor(Math.random() * pool.length)];
    };

    // Prefer Guard with a common guess when a legal target exists.
    if (names.includes('Guard')) {
        const target = pickTarget('Guard');
        if (target) {
            return { cardIndex: pickIndex('Guard'), targetPlayerId: target.id, guess: chooseGuardGuess() };
        }
    }

    // Handmaid when threatened (holding Princess) or as a safe low-risk play.
    if (names.includes('Handmaid')) {
        return { cardIndex: pickIndex('Handmaid'), targetPlayerId: null, guess: null };
    }

    if (names.includes('Priest')) {
        const target = pickTarget('Priest');
        if (target) {
            return { cardIndex: pickIndex('Priest'), targetPlayerId: target.id, guess: null };
        }
    }

    // Baron / King / Prince only with valid unprotected targets when sensible.
    if (names.includes('Baron')) {
        const other = hand.find(c => c.name !== 'Baron');
        const target = pickTarget('Baron');
        if (target && other && other.value >= 4) {
            return { cardIndex: pickIndex('Baron'), targetPlayerId: target.id, guess: null };
        }
    }

    if (names.includes('Prince')) {
        const target = pickTarget('Prince');
        if (target && target.id !== actorId) {
            return { cardIndex: pickIndex('Prince'), targetPlayerId: target.id, guess: null };
        }
    }

    if (names.includes('King')) {
        const other = hand.find(c => c.name !== 'King');
        const target = pickTarget('King');
        if (target && other && other.value <= 3) {
            return { cardIndex: pickIndex('King'), targetPlayerId: target.id, guess: null };
        }
    }

    if (names.includes('Countess')) {
        return { cardIndex: pickIndex('Countess'), targetPlayerId: null, guess: null };
    }

    // Otherwise play the lowest-value non-Princess card (never volunteer the Princess).
    let bestIdx = -1;
    let bestVal = 99;
    hand.forEach((c, i) => {
        if (c.name === 'Princess') return;
        if (c.value < bestVal) {
            bestVal = c.value;
            bestIdx = i;
        }
    });
    if (bestIdx === -1) bestIdx = 0;

    const card = hand[bestIdx];
    const needsTarget = ['Guard', 'Priest', 'Baron', 'King', 'Prince'].includes(card.name);
    let targetPlayerId = null;
    let guess = null;
    if (needsTarget) {
        const target = pickTarget(card.name);
        if (target) targetPlayerId = target.id;
        if (card.name === 'Prince' && !targetPlayerId) targetPlayerId = actorId;
        if (card.name === 'Guard' && targetPlayerId) guess = chooseGuardGuess();
    }
    return { cardIndex: bestIdx, targetPlayerId, guess };
}

function generateAuthToken() {
  // 128-bit-ish random, url-safe, short enough
  return uuidv4().replace(/-/g, '');
}

function getPrivateRoom(game, playerId) {
  if (!game || !game.authTokens) return playerId;
  const token = game.authTokens.get(playerId);
  return token ? `${playerId}:${token}` : playerId;
}

function verifyAuth(game, playerId, providedToken) {
  if (!game || !game.authTokens || !game.authTokens.has(playerId)) {
    return true; // no token system yet (legacy)
  }
  return providedToken && providedToken === game.authTokens.get(playerId);
}

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

    const prettyKey = generateMemorableCode();
    const joinKey = normalizeJoinKey(prettyKey);
        const game = {
            joinKey: prettyKey,   // store pretty version for display
            players: [{ id: playerId, nickname: nickname.trim(), isBot: false }],
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
            burnedCard: null,
            authTokens: new Map()  // playerId -> secret token
        };
    const myToken = generateAuthToken();
    game.authTokens.set(playerId, myToken);

    games.set(joinKey, game);
    metricsState.roomsCreated += 1;
    trackPlayerSighting(data);
    bumpPeakConcurrent();

    socket.playerId = playerId;
    socket.join(joinKey);
    socket.join(`${playerId}:${myToken}`); // private room using token (not guessable from playerId)
    console.log('Emitting gameJoined to', socket.id, 'with joinKey:', prettyKey);
        socket.emit('gameJoined', { joinKey: prettyKey, players: game.players, readyPhase: game.readyPhase, readyPlayers: Array.from(game.readyPlayers), isStarted: game.isStarted, authToken: myToken });
        console.log(`Game created: ${prettyKey} by ${nickname}`);
});

// Join an existing game
socket.on('joinGame', (data) => {
    const { joinKey, nickname, playerId } = data;
    if (!nickname || nickname.trim() === '') {
        socket.emit('error', 'Nickname is required');
        return;
    }

    const normalizedKey = normalizeJoinKey(joinKey);
    const game = games.get(normalizedKey);
    if (!game) {
        socket.emit('error', 'Game not found');
        return;
    }

    if (game.banned.has(playerId)) {
        socket.emit('error', 'You are banned from this game.');
        return;
    }

    const displayKey = game.joinKey || normalizedKey;

    // Ensure authTokens map exists (for old games)
    if (!game.authTokens) game.authTokens = new Map();

    // Check if player already in game
    const existingPlayer = game.players.find(p => p.id === playerId);
    if (existingPlayer) {
        if (existingPlayer.isBot) {
            socket.emit('error', 'Cannot join as a bot seat');
            return;
        }
        // SECURITY: for existing playerId, require the correct authToken if one is on file
        if (game.authTokens && game.authTokens.has(playerId)) {
            const expected = game.authTokens.get(playerId);
            const provided = data.authToken;
            if (provided && provided !== expected) {
                socket.emit('error', 'This player is already in the game with a different session.');
                return;
            }
            if (!provided && expected) {
                // No token provided but one exists: reject to prevent easy spoof from knowing only playerId
                socket.emit('error', 'Valid session token required to rejoin as this player.');
                return;
            }
        }

        // Update nickname if changed and not taken by others
        const trimmedNick = nickname.trim();
        if (existingPlayer.nickname !== trimmedNick) {
            if (game.players.some(p => p.id !== playerId && p.nickname === trimmedNick)) {
                socket.emit('error', 'Nickname already taken');
                return;
            }
            existingPlayer.nickname = trimmedNick;
            game.lastActivity = Date.now();
        }
        const myToken = game.authTokens.get(playerId) || generateAuthToken();
        game.authTokens.set(playerId, myToken);

        socket.playerId = playerId;
        socket.join(normalizedKey);
        socket.join(`${playerId}:${myToken}`);
        trackPlayerSighting(data);
        bumpPeakConcurrent();
        console.log('Emitting gameJoined to', socket.id, 'with joinKey:', displayKey);
        socket.emit('gameJoined', { joinKey: displayKey, players: game.players, readyPhase: game.readyPhase, readyPlayers: Array.from(game.readyPlayers), isStarted: game.isStarted, authToken: myToken });
        socket.to(normalizedKey).emit('playerJoined', { players: game.players });
        console.log(`${trimmedNick} rejoined game: ${displayKey}`);
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

    const player = { id: playerId, nickname: nickname.trim(), isBot: false };
    game.players.push(player);
    game.lastActivity = Date.now();

    if (!game.authTokens) game.authTokens = new Map();
    const myToken = generateAuthToken();
    game.authTokens.set(playerId, myToken);

    socket.playerId = playerId;
    socket.join(normalizedKey);
    socket.join(`${playerId}:${myToken}`);
    trackPlayerSighting(data);
    bumpPeakConcurrent();
    console.log('Emitting gameJoined to', socket.id, 'with joinKey:', displayKey);
        socket.emit('gameJoined', { joinKey: displayKey, players: game.players, readyPhase: game.readyPhase, readyPlayers: Array.from(game.readyPlayers), isStarted: game.isStarted, authToken: myToken });
        socket.to(normalizedKey).emit('playerJoined', { players: game.players });

        console.log(`${nickname} joined game: ${displayKey}`);
});

    // Leave game
    socket.on('leaveGame', (data) => {
        const actorId = socket.playerId || data.playerId;
        for (const [key, game] of games) {
            if (!verifyAuth(game, actorId, data.authToken)) {
                // still allow leave even on bad token for cleanup, but log
                console.log('Leave with invalid token for', actorId);
            }
            const index = game.players.findIndex(p => p.id === actorId);
            if (index !== -1) {
                const leaving = game.players[index];
                if (leaving && leaving.isBot) {
                    break;
                }
                const wasCreator = index === 0;
                const wasTurn = game.currentPlayerId === actorId;
                game.players.splice(index, 1);
                game.readyPlayers.delete(actorId);
                game.lastActivity = Date.now();
                socket.to(key).emit('playerLeft', { players: game.players });
                if (endGameIfNoHumans(game, key, 'No human players remain')) {
                    break;
                }
                if (wasCreator && !game.isStarted) {
                    io.to(key).emit('gameEnded', { message: 'Creator left the game' });
                    clearBotTimer(game);
                    games.delete(key);
                    break;
                }
                if (game.isStarted && game.players.length < 2) {
                    io.to(key).emit('gameEnded', { message: 'Game ended due to insufficient players' });
                    clearBotTimer(game);
                    games.delete(key);
                    break;
                }
                if (game.readyPhase) {
                    io.to(key).emit('readyUpdate', { players: game.players, readyPlayers: Array.from(game.readyPlayers) });
                }
                if (game.isStarted && wasTurn && !game.roundOver) {
                    const active = game.players.filter(p => !game.eliminated || !game.eliminated.has(p.id));
                    if (active.length > 0) {
                        game.currentPlayerId = active[0].id;
                        if (game.deck && game.deck.length > 0) {
                            drawForPlayer(game, key, game.currentPlayerId);
                        } else {
                            io.to(key).emit('turnChanged', { currentPlayerId: game.currentPlayerId });
                            maybeScheduleBotTurn(game, key);
                        }
                    }
                }
                console.log(`Player ${actorId} left game: ${key}`);
                break;
            }
        }
    });

    // Kick player
    socket.on('kickPlayer', (data) => {
        const actorId = socket.playerId || data.playerId;
        const { kickedPlayerId } = data;
        for (const [key, game] of games) {
            if (!verifyAuth(game, actorId, data.authToken)) {
                socket.emit('error', 'Invalid session');
                return;
            }
            const kicker = game.players.find(p => p.id === actorId);
            if (kicker && game.players.length > 0 && game.players[0] && game.players[0].id === actorId) { // Only creator can kick
                const kickedIndex = game.players.findIndex(p => p.id === kickedPlayerId);
                if (kickedIndex !== -1 && kickedPlayerId !== actorId) {
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
                    if (endGameIfNoHumans(game, key, 'No human players remain')) {
                        break;
                    }
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
    const { joinKey, playerId, authToken } = data;
    console.log('Received reconnectGame for', joinKey, playerId);
    const normalizedKey = normalizeJoinKey(joinKey);
    const game = games.get(normalizedKey);
    if (!game) {
        socket.emit('error', 'Game not found');
        return;
    }
    if (false) { // No expiry for testing
        games.delete(normalizedKey);
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
    if (player.isBot) {
        socket.emit('error', 'Cannot reconnect as a bot seat');
        return;
    }
    // Validate token if we have one stored
    if (game.authTokens && game.authTokens.has(playerId)) {
        const expected = game.authTokens.get(playerId);
        if (!authToken || authToken !== expected) {
            socket.emit('error', 'Invalid session for this player');
            return;
        }
    }

    const displayKey = game.joinKey || normalizedKey;
    const token = game.authTokens ? game.authTokens.get(playerId) : null;

    socket.playerId = playerId;
    socket.join(normalizedKey);
    if (token) {
        socket.join(`${playerId}:${token}`);
    } else {
        socket.join(playerId); // legacy fallback
    }
    game.lastActivity = Date.now();
    trackPlayerSighting(data);
    bumpPeakConcurrent();
    socket.emit('gameJoined', { joinKey: displayKey, players: game.players, readyPhase: game.readyPhase, readyPlayers: Array.from(game.readyPlayers), isStarted: game.isStarted, authToken: token });

    // Send current hand on reconnect if game is active
    if (game.isStarted && game.hands && game.hands.has(playerId)) {
        const h = game.hands.get(playerId);
        socket.emit('privateHand', {
            hand: h.map(c => ({ name: c.name, value: c.value }))
        });
    }

    console.log(`Reconnected ${player.nickname} to game: ${displayKey}`);
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
    const actorId = socket.playerId || data.playerId;
    for (const [key, game] of games) {
        if (!verifyAuth(game, actorId, data.authToken)) {
            socket.emit('error', 'Invalid session');
            return;
        }
        if (game.players && game.players.length >= 2 && game.players[0] && game.players[0].id === actorId && !game.readyPhase && !game.isStarted) {
            game.readyPhase = true;
            game.readyPlayers.clear();
            game.readyPlayers.add(actorId);
            game.players.forEach(p => {
                if (p.isBot) game.readyPlayers.add(p.id);
            });
            game.lastActivity = Date.now();
            io.to(key).emit('readyPhaseStarted');
            io.to(key).emit('readyUpdate', { players: game.players, readyPlayers: Array.from(game.readyPlayers) });
            console.log(`Ready phase started for game: ${key}`);
            if (game.readyPlayers.size === game.players.length && game.players.length >= 2) {
                initializeGame(game, key);
                console.log(`Game auto-started for ${key} (bots auto-ready)`);
            }
            break;
        }
    }
});

// Toggle ready
socket.on('toggleReady', (data) => {
    const actorId = socket.playerId || data.playerId;
    for (const [key, game] of games) {
        if (!verifyAuth(game, actorId, data.authToken)) {
            socket.emit('error', 'Invalid session');
            return;
        }
        const player = game.players.find(p => p.id === actorId);
        if (player && game.readyPhase && !game.isStarted) {
            if (game.readyPlayers.has(actorId)) {
                game.readyPlayers.delete(actorId);
            } else {
                game.readyPlayers.add(actorId);
            }
            game.lastActivity = Date.now();
            io.to(key).emit('readyUpdate', { players: game.players, readyPlayers: Array.from(game.readyPlayers) });
            // Auto-start when all ready
            if (game.readyPlayers.size === game.players.length) {
                initializeGame(game, key);
                console.log(`Game auto-started for ${key}`);
            }
            console.log(`Player ${actorId} toggled ready in game: ${key}`);
            break;
        }
    }
});

// Host: add one AI courtier (lobby / pre-start only)
socket.on('addBot', (data) => {
    const actorId = socket.playerId || (data && data.playerId);
    let found = false;
    for (const [key, game] of games) {
        if (!game.players.some(p => p.id === actorId)) continue;
        found = true;
        if (!verifyAuth(game, actorId, data && data.authToken)) {
            socket.emit('error', 'Invalid session');
            return;
        }
        if (!game.players[0] || game.players[0].id !== actorId) {
            socket.emit('error', 'Only the host can add bots');
            return;
        }
        const result = addBotToGame(game, key);
        if (!result.ok) socket.emit('error', result.error);
        return;
    }
    if (!found) socket.emit('error', 'Game not found');
});

// Host: fill remaining chairs with bots (up to 6)
socket.on('fillBots', (data) => {
    const actorId = socket.playerId || (data && data.playerId);
    let found = false;
    for (const [key, game] of games) {
        if (!game.players.some(p => p.id === actorId)) continue;
        found = true;
        if (!verifyAuth(game, actorId, data && data.authToken)) {
            socket.emit('error', 'Invalid session');
            return;
        }
        if (!game.players[0] || game.players[0].id !== actorId) {
            socket.emit('error', 'Only the host can add bots');
            return;
        }
        if (game.isStarted) {
            socket.emit('error', 'Cannot add bots after the match has started');
            return;
        }
        let added = 0;
        while (game.players.length < MAX_PLAYERS) {
            const result = addBotToGame(game, key);
            if (!result.ok) break;
            added += 1;
        }
        if (added === 0 && game.players.length >= MAX_PLAYERS) {
            socket.emit('error', 'Game is full');
        }
        return;
    }
    if (!found) socket.emit('error', 'Game not found');
});

// Play a card (core game action)
socket.on('playCard', (data) => {
    // SECURITY: Use the playerId that was established when this socket joined the game.
    // Do not fully trust the playerId from the client payload for auth decisions.
    const actorId = socket.playerId || data.playerId;
    const { cardIndex, targetPlayerId, guess } = data;

    for (const [key, game] of games) {
        if (!game.isStarted || game.roundOver) continue;

        if (!verifyAuth(game, actorId, data.authToken)) {
            socket.emit('error', 'Invalid session');
            return;
        }

        const pIdx = game.players.findIndex(pp => pp.id === actorId);
        if (pIdx === -1) continue;

        const result = tryPlayCard(game, key, actorId, cardIndex, targetPlayerId, guess);
        if (!result.ok) {
            socket.emit('error', result.error);
        }
        break;
    }
});

// Also harden getMyHand
socket.on('getMyHand', (data) => {
    const actorId = socket.playerId || data.playerId;
    for (const [key, game] of games) {
        if (!verifyAuth(game, actorId, data.authToken)) {
            socket.emit('error', 'Invalid session');
            return;
        }
        if (game.isStarted && game.hands && game.hands.has(actorId)) {
            const h = game.hands.get(actorId);
            socket.emit('privateHand', {
                hand: h.map(c => ({ name: c.name, value: c.value }))
            });
            break;
        }
    }
});

function addBotToGame(game, key) {
    if (game.isStarted) {
        return { ok: false, error: 'Cannot add bots after the match has started' };
    }
    if (game.players.length >= MAX_PLAYERS) {
        return { ok: false, error: 'Game is full' };
    }
    const bot = {
        id: `bot-${uuidv4()}`,
        nickname: nextBotNickname(game),
        isBot: true,
        avatarId: nextBotAvatarId(game)
    };
    game.players.push(bot);
    game.lastActivity = Date.now();
    // Do not trackPlayerSighting / bumpPeakConcurrent — bots are not visitors.
    io.to(key).emit('playerJoined', { players: game.players });
    io.to(key).emit('message', { message: `${bot.nickname} takes a seat at the table.` });
    if (game.readyPhase && !game.isStarted) {
        game.readyPlayers.add(bot.id);
        io.to(key).emit('readyUpdate', { players: game.players, readyPlayers: Array.from(game.readyPlayers) });
        if (game.readyPlayers.size === game.players.length && game.players.length >= 2) {
            initializeGame(game, key);
            console.log(`Game auto-started for ${key} (bots auto-ready)`);
        }
    }
    console.log(`Bot ${bot.nickname} (${bot.avatarId}) added to ${key}`);
    return { ok: true, bot };
}

function endGameIfNoHumans(game, key, message) {
    if (humanCount(game) > 0) return false;
    clearBotTimer(game);
    io.to(key).emit('gameEnded', { message: message || 'No human players remain' });
    games.delete(key);
    console.log(`Game ${key} ended — no humans left`);
    return true;
}

function maybeScheduleBotTurn(game, key) {
    if (!game || !game.isStarted || game.roundOver) return;
    const pid = game.currentPlayerId;
    const player = game.players.find(p => p.id === pid);
    if (!player || !player.isBot) return;
    if (game.eliminated && game.eliminated.has(pid)) return;

    clearBotTimer(game);
    const delay = 800 + Math.floor(Math.random() * 701); // 800–1500ms
    game.botTurnTimer = setTimeout(() => {
        game.botTurnTimer = null;
        if (!games.has(key) || !game.isStarted || game.roundOver) return;
        if (game.currentPlayerId !== pid) return;
        executeBotTurn(game, key, pid);
    }, delay);
}

function executeBotTurn(game, key, actorId) {
    const choice = chooseBotPlay(game, actorId);
    if (!choice) {
        console.log('Bot had no play', actorId);
        return;
    }
    let result = tryPlayCard(game, key, actorId, choice.cardIndex, choice.targetPlayerId, choice.guess);
    if (result.ok) return;

    console.log('Bot play rejected, trying fallback:', result.error);
    const hand = (game.hands && game.hands.get(actorId)) || [];
    for (let i = 0; i < hand.length; i++) {
        if (hand[i].name === 'Princess' && hand.length > 1) continue;
        const card = hand[i];
        const needsTarget = ['Guard', 'Priest', 'Baron', 'King', 'Prince'].includes(card.name);
        let targetPlayerId = null;
        let guess = null;
        if (needsTarget) {
            const targets = getValidTargets(game, actorId, card.name);
            if (targets.length > 0) {
                const opponents = targets.filter(p => p.id !== actorId);
                const pool = opponents.length ? opponents : targets;
                targetPlayerId = pool[Math.floor(Math.random() * pool.length)].id;
            } else if (card.name === 'Prince') {
                targetPlayerId = actorId;
            }
            if (card.name === 'Guard' && targetPlayerId) guess = chooseGuardGuess();
        }
        result = tryPlayCard(game, key, actorId, i, targetPlayerId, guess);
        if (result.ok) return;
    }
    console.log('Bot fallback also failed for', actorId);
}

// Shared play path for humans (socket) and bots (scheduled). Emits the same public events.
function tryPlayCard(game, key, actorId, cardIndex, targetPlayerId, guess) {
    if (!game.isStarted || game.roundOver) {
        return { ok: false, error: 'Round is not active' };
    }
    if (game.currentPlayerId !== actorId) {
        return { ok: false, error: 'Not your turn' };
    }
    if (game.eliminated && game.eliminated.has(actorId)) {
        return { ok: false, error: 'You are out of this round' };
    }

    const pIdx = game.players.findIndex(pp => pp.id === actorId);
    if (pIdx === -1) {
        return { ok: false, error: 'Player not in game' };
    }

    const hand = game.hands.get(actorId) || [];
    if (cardIndex < 0 || cardIndex >= hand.length) {
        return { ok: false, error: 'Invalid card selection' };
    }

    const cardToPlay = hand[cardIndex];

    // Countess rule enforcement: if holding Countess + (King or Prince), must play Countess
    const hasCountess = hand.some(c => c.name === 'Countess');
    const hasRoyal = hand.some(c => c.name === 'King' || c.name === 'Prince');
    if (hasCountess && hasRoyal && cardToPlay.name !== 'Countess') {
        return { ok: false, error: 'You must play the Countess when holding it with King or Prince' };
    }

    const needsTarget = ['Guard', 'Priest', 'Baron', 'King', 'Prince'].includes(cardToPlay.name);
    const allowsSelf = cardToPlay.name === 'Prince';

    if (needsTarget && targetPlayerId) {
        if (targetPlayerId === actorId && !allowsSelf) {
            return { ok: false, error: 'This card requires a different target player' };
        }
        const target = game.players.find(pp => pp.id === targetPlayerId);
        if (!target || game.eliminated.has(targetPlayerId) || game.protected.has(targetPlayerId)) {
            return { ok: false, error: 'Invalid or protected target' };
        }
    }

    if (cardToPlay.name === 'Guard' && guess === 'Guard') {
        return { ok: false, error: 'Cannot guess Guard' };
    }

    const playedCard = hand.splice(cardIndex, 1)[0];

    if (!game.discards.has(actorId)) game.discards.set(actorId, []);
    game.discards.get(actorId).push(playedCard);
    game.lastPlayed.set(actorId, playedCard);
    game.lastActivity = Date.now();

    const actor = game.players[pIdx];

    const updatedHand = game.hands.get(actorId) || [];
    io.to(getPrivateRoom(game, actorId)).emit('privateHand', {
        hand: updatedHand.map(c => ({ name: c.name, value: c.value }))
    });

    io.to(key).emit('cardPlayed', {
        playerId: actorId,
        nickname: actor.nickname,
        card: { name: playedCard.name, value: playedCard.value },
        targetPlayerId: targetPlayerId || null,
        guess: guess || null
    });

    resolveCardEffect(game, key, actorId, playedCard, targetPlayerId, guess);

    if (!game.roundOver) {
        advanceToNextPlayer(game, key);
    }

    return { ok: true };
}

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
        io.to(getPrivateRoom(game, player.id)).emit('privateHand', { hand: h.map(c => ({ name: c.name, value: c.value })) });
    });

    // Announce the draw and whose turn it is (client uses this to enable actionArea)
    const p = game.players.find(pp => pp.id === game.currentPlayerId);
    io.to(key).emit('playerDrew', { playerId: game.currentPlayerId, nickname: p ? p.nickname : '' });
    io.to(key).emit('turnChanged', { currentPlayerId: game.currentPlayerId });

    console.log(`Round ${game.roundNumber} started for ${key}, first player: ${game.currentPlayerId}`);
    maybeScheduleBotTurn(game, key);
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
    io.to(getPrivateRoom(game, playerId)).emit('privateHand', {
        hand: hand.map(c => ({ name: c.name, value: c.value }))
    });

    // Notify everyone that the player drew (card hidden)
    io.to(key).emit('playerDrew', { playerId, nickname: p ? p.nickname : '' });

    // If after draw they have Countess + King/Prince, they are forced to play Countess (client can enforce too)
    // But server will enforce on playCard

    io.to(key).emit('turnChanged', { currentPlayerId: playerId });
    maybeScheduleBotTurn(game, key);
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
            io.to(getPrivateRoom(game, actorId)).emit('priestReveal', {
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
                io.to(getPrivateRoom(game, princeTarget)).emit('privateHand', {
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
            io.to(getPrivateRoom(game, actorId)).emit('privateHand', {
                hand: tHand.map(c => ({ name: c.name, value: c.value }))
            });
            io.to(getPrivateRoom(game, targetId)).emit('privateHand', {
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
        setTimeout(() => {
            const g = games.get(key);
            if (g) clearBotTimer(g);
            games.delete(key);
        }, 30000);
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
            const seated = game.players[index];
            if (seated && seated.isBot) {
                continue;
            }
            game.players.splice(index, 1);
            game.readyPlayers.delete(socket.playerId);
            game.eliminated && game.eliminated.delete(socket.playerId);
            game.protected && game.protected.delete(socket.playerId);
            game.hands && game.hands.delete(socket.playerId);
            game.lastActivity = Date.now();
            socket.to(key).emit('playerLeft', { players: game.players });
            if (endGameIfNoHumans(game, key, 'No human players remain')) {
                break;
            }
            // If creator left
            if (index === 0) {
                io.to(key).emit('gameEnded', { message: 'Creator left the game' });
                clearBotTimer(game);
                games.delete(key);
            } else if (game.players.length === 0) {
                clearBotTimer(game);
                games.delete(key);
            } else if (game.readyPhase) {
                io.to(key).emit('readyUpdate', { players: game.players, readyPlayers: Array.from(game.readyPlayers) });
            } else if (game.isStarted) {
                if (game.players.length < 2) {
                    io.to(key).emit('gameEnded', { message: 'Game ended due to insufficient players' });
                    clearBotTimer(game);
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
                            } else {
                                maybeScheduleBotTurn(game, key);
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