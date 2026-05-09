# Decisions for Love Letter Multiplayer Web App

## Tech Stack
- Backend: Node.js with Express and Socket.IO for real-time multiplayer.
- Frontend: Plain HTML/CSS/JavaScript (no framework) for simplicity and minimalism.
- Data Storage: In-memory (maps/objects) for games, players, and state; localStorage on client for persistence.

## UI/UX
- Design: Basic and minimal with simple shapes and colors (e.g., white backgrounds, green buttons).
- Chat: Visible at all times, including during game play.
- Hands: Displayed as text (e.g., \"Name (Value)\"), with plans for images later.
- Player List: Highlights current player (bold/blue), shows ready status (green \" (Ready)\").

## Game Mechanics
- Player Limit: Up to 6 players per game.
- Ready System: Creator starts phase (if 2+ players, not started). Ready button hidden until phase starts. Players can toggle Ready/Unready. Game starts automatically when all ready. Phase ends on start, creator leave, <2 players, or all leave.
- Game Start: Initialize deck from Python code, burn 1 card, deal 1 to each player, randomly pick starting player (highlighted in list).
- Persistence: Game state (phase, ready, started, hands, turn) persists on reload/reconnect if active (no expiry for now).
- Creator Leave: Ends game before start; continues after start if 2+ players remain.
- Kick/Ban: Creator kicks via 'x' button. Kicked twice = permanent ban for that game.
- State Updates: Broadcast on every change (join/leave, ready/unready, start/end, etc.). New/reconnecting players get full state.

## Other
- Min Players for Ready/Start: 2.
- Ready Toggle: Allowed until game starts.
- Game End: On creator leave before start; on <2 players after start (to be implemented if needed).