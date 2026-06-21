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
- Ready System: Creator starts phase (if 2+ players, not started). Ready button hidden until phase starts. Players can toggle Ready/Unready. Game starts automatically when all ready (no separate "Start Game" force button). Phase ends on start, creator leave, <2 players, or all leave.
- Join policy: New players may not join while a round is in progress (isStarted && !roundOver). Reconnects and joins during inter-round pause (after roundOver) are allowed.
- Game Start: Initialize deck from Python code, burn 1 card, deal 1 to each player, randomly pick starting player (highlighted in list).
- Persistence: Game state (phase, ready, started, hands, turn) persists on reload/reconnect if active (no expiry for now).
- Creator Leave: Ends game before start; continues after start if 2+ players remain.
- Kick/Ban: Creator kicks via 'x' button. Kicked twice = permanent ban for that game.
- State Updates: Broadcast on every change (join/leave, ready/unready, start/end, etc.). New/reconnecting players get full state.
- Card Effect Timing & Temporary State:
  - Handmaid protection lasts until the start of the protected player's next turn. Server drops it in `drawForPlayer` (at turn start) and emits `playerProtectionEnded` so all clients remove the shield icon and allow targeting again. Client also cleans up on elimination and between rounds.
  - Countess rule: A player holding the Countess together with a King or Prince must play the Countess. Client disables the royal cards with a tooltip and shows an alert on click; server also enforces on `playCard`.
  - Targeting cards (Guard, Priest, Baron, King, and Prince) with no valid unprotected targets: the play is allowed (to avoid trapping the player), but the effect fizzles. An explicit public chat message is emitted (e.g. "X's Priest had no effect (no unprotected targets).").
  - Temporary turn/action UI state (target/guess selectors and `pendingPlay` from Guard and similar cards) is cleared at the beginning of every turn change so each new turn starts with a clean action state.
- Prince respects Handmaid protection the same as other targeted cards (client no longer offers protected targets; server validates).

## Other
- Min Players for Ready/Start: 2.
- Ready Toggle: Allowed until game starts.
- Game End: On creator leave before start; on <2 players after start (to be implemented if needed).

## UI Theme Overhaul (Medieval European Style)
- **Goal**: Replace the original generic modern/minimal UI (white containers, bright green/blue buttons, Arial, plain text hand) with a cohesive medieval European aesthetic fitting the "Love Letter" theme of courtly intrigue.
- **Design constraints**: Stay true to the project's "plain HTML/CSS/JS, no frameworks" philosophy. No external fonts, icon libraries, or image assets. Pure CSS + Unicode symbols.
- **Color & typography palette**:
  - Dark aged wood background (#2c2115) with subtle grid texture.
  - Parchment panels (#f4e9d1 / #e8d9b5) with double borders (dark ink + inner gold).
  - Accent colors: gold (#b38b4d, #d4af37), burgundy (#5c2a1e), deep ink browns.
  - Serif typography (Georgia / Times family) with letter-spacing for titles.
- **Card design**: Hand cards are now visual card elements (`.card`) rather than plain `<button>` text:
  - Top-left value, large central Unicode icon per card type (🛡️ ⚔️ 📜 👑 etc.), prominent name, subtle footer.
  - State styling: current-turn gold highlight, disabled (Countess rule + non-turn), hover lift.
  - Tooltips carry the original rule text.
- **Structural changes**:
  - Lobby container given explicit `#lobby` id.
  - In-game area wrapped in `.game-panel`.
  - All `.container` show/hide logic in client.js updated to target `#lobby` (prevents accidental styling bleed or selector fragility).
  - Added `.title-banner` with heraldic title treatment.
  - Themed section labels ("Court Whispers", "Letters in Your Possession", "Players at the Table", etc.).
- **Other visual/UX touches**:
  - Player list uses thematic status icons (✝︎ eliminated, 🛡︎ Handmaid protection, → current turn) and ✉︎ token marker.
  - Buttons use raised parchment/velvet styling with strong borders and active press feedback.
  - Chat and action areas use inset parchment styling.
- **Screenshots**: Runtime screenshots (before/after captures) are kept untracked / out of the repo to avoid binary bloat.
- **Rationale for icons**: Unicode emoji chosen as a lightweight, immediately recognizable stand-in for full card art. Maintains readability across platforms while evoking the right flavor (shields, swords, crowns, scrolls).
- **Future possibilities noted** (not implemented): Real card illustrations (SVG or external assets), hand fanning via CSS rotation, entrance animations, a dedicated game table background layer. Kept out of scope to preserve zero-dependency nature.