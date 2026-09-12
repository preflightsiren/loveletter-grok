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

## Invite deep links & share (2026-09)
- Support `/?join=<joinKey>`: client prefills `#joinKeyInput` on load so a guest only needs a nickname. Hand-typed join still works; server continues to use `normalizeJoinKey` / memorable adj-noun codes.
- After create / while in the table lobby, UI shows the join key plus a shareable invite URL (`origin + ?join=` + key) and a one-tap **Copy invite link** button that copies the full URL (not the bare code).
- Host hint (non-blocking polish): one line above the invite share row — “Send this link — guests only need a nickname” — parchment/medieval styling; button copy unchanged.

## Minimal analytics (2026-09)
- In-memory counters for process lifetime only. No PII. Exposed via `/metrics` and included on `/health`.
- Fields: `roomsCreated`, `activeRooms` (≥1 **human**), `concurrentPlayers`, `peakConcurrentPlayers`, `uniquePlayersSeen`, `returningPlayers` (ids seen again this process). Game identity stays per-tab in `sessionStorage.playerId` (multi-tab testing). Returning-player metrics use a separate `visitorId` from `localStorage.loveletterVisitorId`, sent on `createGame` / `joinGame` / `reconnectGame`; server `trackPlayerSighting` prefers `visitorId` and falls back to `playerId`. Bots are excluded from these north-star fields (see below).


## Optional bot opponents (2026-09)
- Host (table creator) can add AI courtiers from the pre-start lobby: **Add a courtier** (one seat) or **Fill empty chairs** (remaining seats up to 6). Bots cannot be added after the match starts.
- Bot player objects in every list payload (`gameJoined`, `playerJoined`, `playerLeft`, `readyUpdate`) include `isBot: true` and `avatarId` (`bot-1` … `bot-5`). Humans are `isBot: false` with stable `avatarId` (`human-default` until heraldry picker). Portrait PNGs live in `public/avatars/`.
- Courtly default nicknames (e.g. “Sir Pixel the Guard”). Design owns BOT chip / portrait polish; client shows a minimal `BOT` badge from `isBot`.
- Bots have no socket. Server auto-readies them when the ready phase starts (or when seated during ready). If that completes the table, the match auto-starts.
- On a bot’s turn the server waits 800–1500ms then plays through the same `tryPlayCard` path as humans (same public events). Heuristic is rules-legal and simple: Countess force, prefer Guard + common guess, Handmaid when holding Princess / as a safe play, King/Prince/Baron only vs unprotected targets when sensible, never target Handmaid-protected, targeting cards may fizzle with no valid target.
- Reconnect/leave: bots do not disconnect. If no humans remain, the table ends. Creator leave before start still ends the game.

## Metrics: humans only (2026-09)
- North-star fields on `/health` and `/metrics` must not count bots: `concurrentPlayers`, `peakConcurrentPlayers`, `uniquePlayersSeen`, `returningPlayers`, `activeRooms` (≥1 **human**). `roomsCreated` still counts human-hosted rooms.
- Bot seats never call `trackPlayerSighting` (no bot visitorIds).
- `botsInPlay` is a debug-only current bot-seat count across tables; not an adoption counter.

## Pixel portrait panels (2026-09)
- Design sketch #4: left rail = other seats (stacked); current turner largest + gold ring, sorted to front. Right rail = local player (fixed “You”).
- Art: Design PNGs in `public/avatars/` (`bot-1`…`bot-5`, `human-default`), 64×80, CSS `image-rendering: pixelated`.
- Resolve via `avatarId`: bots `/avatars/bot-N.png`; humans `human-{heraldryIndex}` when present else `human-default` (img onerror falls back to `human-default.png`). Heraldry picker not required for this slice.
- Server assigns humans a stable `avatarId` (`human-default`) on create/join/reconnect if missing; bots keep `bot-1`…`bot-5`.
- BOT chip remains under the nick on the left rail (`isBot`). Player list heraldry shields unchanged.
- `.gitignore` still ignores `*.png` globally; `public/avatars/*.png` is force-included.
