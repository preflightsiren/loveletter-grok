# Love Letter — Court of Intrigue

Multiplayer web version of the classic Love Letter card game. Built with Node.js, Express, and Socket.IO. Plain HTML/CSS/JS frontend with a medieval parchment aesthetic.

## Features
- Real-time multiplayer (up to 6 players)
- Memorable join codes (e.g. `ancient-rose`)
- Full Love Letter rules with proper card effects
- Chat, ready system, kicking, reconnect support
- Optional AI courtiers (host can add / fill empty chairs; `isBot` + `avatarId` on players)
- All state managed server-side

## Run Locally

```bash
npm install
npm start
```

Open http://localhost:3000

## Deploy to Railway

This app is ready for Railway (single service serves both the static frontend and Socket.IO backend).

### Option 1: Railway CLI (fastest from this folder)

1. Install the Railway CLI:
   ```bash
   # macOS / Linux
   curl -fsSL https://railway.com/install.sh | sh

   # or with npm
   npm i -g @railway/cli
   ```

2. Login:
   ```bash
   railway login
   ```

3. From this project directory, initialize and deploy:
   ```bash
   railway init
   railway up
   ```

4. After deploy, generate a public domain in the Railway dashboard (or use `railway domain`).

### Option 2: GitHub + Railway (recommended for ongoing development)

1. Push this repo to GitHub.
2. Go to https://railway.com/new
3. Select "Deploy from GitHub repo"
4. Connect the repo.
5. Railway will auto-detect the Node.js app and run `npm install` (via Railpack + railway.toml).
6. Add a public domain in the service settings.

### Important Notes

- **In-memory state only**: Games are stored in RAM. Restarting the service (new deploy, crash, or Railway maintenance) will clear all active games. Fine for casual play.
- No environment variables are required.
- The app listens on `process.env.PORT` (required by Railway).
- Health endpoint at `/health`.
- Socket.IO works out of the box (polling + websocket).

### Troubleshooting Railway Deploys

If Railway did not run `npm install` (you see module not found errors at runtime or no "Installing dependencies" in logs):

1. In the Railway dashboard:
   - Go to your service → **Settings** → **Build**
   - Set **Builder** to **Railpack** (Nixpacks is deprecated)
   - **Build Command**: `npm ci` (the file also sets this)
   - **Start Command**: `npm start` (or leave blank — Procfile handles it)
2. Click **Redeploy** (use the latest commit).
3. Watch the **Build Logs** (separate from deployment/runtime logs) for the install step.

We include a `railway.toml` to force the Railpack builder and the `npm ci` build command.

## Tech
- Backend: Express + Socket.IO
- No database / no build step
- Zero external dependencies besides the three in package.json

Enjoy the game!