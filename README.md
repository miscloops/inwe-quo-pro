# iNwe Quo Pro v1 — Build 10003

Licensed to HQ Family. Made with ❤ in Maldives.

## What this is

A multi-account gifting panel for **chat.inweapp.com**. Users paste their iNwe
credentials (id/password), the panel logs them in, scrapes their level progress
from `/explore/level_progress`, and runs an auto-gifting bot that sends 3-cent
gifts (neko, ganja, fly, muri, best wishes) round-robin to all other logged-in
IDs in chatroom "QUO PRO" (room ID 4xxx) every 4 seconds.

## Tech stack

- **Next.js 16** (App Router) + TypeScript + Tailwind CSS 4 + shadcn/ui
- **Prisma** ORM with **SQLite** (file: `db/custom.db`)
- **Bun** runtime
- **socket.io-client** for the gift-bot mini-service (connects to `socket.inweapp.com`)
- **TanStack Query** for server state, **Sonner** for toasts

## Project structure

```
├── src/
│   ├── app/
│   │   ├── page.tsx              ← Main panel (login + sessions + auto-gifting bot)
│   │   ├── layout.tsx            ← Root layout (Geist Mono font, Toaster, QueryProvider)
│   │   ├── globals.css           ← Old-school light theme (paper white, monospace, sharp corners)
│   │   └── api/inwe/
│   │       ├── login/            ← POST /api/inwe/login (authenticates against chat.inweapp.com)
│   │       ├── relogin/          ← POST /api/inwe/relogin (re-login when session expires)
│   │       ├── sessions/         ← GET /api/inwe/sessions (list stored sessions)
│   │       ├── logout/           ← POST /api/inwe/logout (clear session)
│   │       ├── level_progress/   ← GET /api/inwe/level_progress (scrape /explore/level_progress)
│   │       ├── send-gift/        ← POST /api/inwe/send-gift (multi-action: list_gifts, balance, transfer, send_message)
│   │       └── auto-gift/         ← POST /api/inwe/auto-gift (start/stop/status proxy to gift-bot)
│   ├── components/
│   │   ├── panel/
│   │   │   ├── login-box.tsx         ← Textarea for id/password pairs, batch login
│   │   │   ├── sessions-list.tsx     ← Logged-in accounts with level/balance/progress
│   │   │   └── auto-gifting-panel.tsx ← Sender picker + 5 hardcoded gift commands + Start/Stop
│   │   ├── welcome-screen.tsx    ← 6-second splash screen on app start
│   │   └── providers.tsx         ← TanStack Query provider
│   └── lib/
│       ├── db.ts                 ← Prisma client singleton
│       ├── format.ts             ← formatCoins, formatRelative helpers
│       └── utils.ts              ← cn() class merger
├── prisma/schema.prisma         ← InweSession model (username, cookie, authToken, level, etc.)
├── mini-services/gift-bot/
│   ├── index.ts                  ← Socket.IO service (port 3001) — joins room 42081, sends /gift commands
│   └── package.json
├── public/welcome.png           ← Splash screen image
├── package.json
├── .env                         ← DATABASE_URL=file:/home/z/my-project/db/custom.db
├── start.sh                     ← One-command launcher (installs deps, starts both services)
└── scripts/
    ├── seed.ts                  ← Seed mock data (optional)
    ├── build-bundle.sh          ← Build distributable zip (bundled Bun + launchers)
    ├── deploy-gcp.sh            ← Deploy to GCP e2-micro (always-free)
    └── DEPLOY-GCP.md            ← Step-by-step deploy guide
```

## How to run locally

```bash
# Install Bun (if not installed)
curl -fsSL https://bun.sh/install | bash

# Install dependencies
bun install
cd mini-services/gift-bot && bun install && cd ../..

# Initialize the database
bun run db:push

# Start the Next.js app (terminal 1)
bun run dev

# Start the gift-bot mini-service (terminal 2)
cd mini-services/gift-bot && bun run dev
```

Open `http://localhost:3000` in your browser.

## How it works

1. **Login** — Paste iNwe credentials in `id/password` format. The panel POSTs to
   `/api/inwe/login`, which fetches CSRF + session cookie from `chat.inweapp.com/login`,
   submits the Rails form, and stores the session + JWT auth-token in SQLite.
   Passwords are NEVER stored.

2. **Level progress** — For each logged-in ID, the panel scrapes
   `/explore/level_progress` using the stored session cookie. It extracts the
   level number, point %, hours remaining, and referral count via regex.

3. **Auto Gifting Bot** — When you click "Start Auto Gifting":
   - The panel calls `/api/inwe/auto-gift` with `action: 'start'`
   - The API fetches fresh auth-tokens from the DB and POSTs to the gift-bot service
   - The gift-bot (port 3001) connects each user to `socket.inweapp.com` via Socket.IO
   - Each user emits `join_room { room_id: "4XXXX" }` to enter room "QUO PRO"
   - The bot cycles through 5 gift commands every 4 seconds:
     - `/gift <recipient> neko`
     - `/gift <recipient> ganja`
     - `/gift <recipient> fly`
     - `/gift <recipient> muri`
     - `/gift <recipient> best wishes`
   - Gifts are sent via `send_message_to_room` (Socket.IO) with REST `/send_message`
     as fallback (more reliable — server actually processes the gift).

4. **Gifting Guard** — The bot never sends a gift to an ID whose level progress is
   ≥99%. Once the ID levels up (progress resets), gifting resumes automatically.

5. **Retry flow** — If the room join fails (inweapp returns `JOIN_API_FAILED`),
   the panel shows "Failed to enter chatroom" and a "RETRY #1" badge. Clicking
   Start again triggers `force_relogin: true`, which re-logs in the sender
   (using the provided password) before retrying the join.

## Deployment

See `scripts/DEPLOY-GCP.md` for step-by-step instructions to deploy on Google
Cloud's always-free `e2-micro` VM. Other options:
- **Oracle Cloud always-free VM** (24GB RAM, best for many users)
- **Self-host + Cloudflare Tunnel** (free, no signup)
- **Koyeb free tier** (easiest, but 512MB RAM limit)

## Security notes

- Passwords are used only for the single `/login` POST and then dropped from memory
- Session cookies + JWT auth-tokens are stored in SQLite (`db/custom.db`)
- The gift-bot mini-service runs on `localhost:3001` (not exposed externally)
- The secret room ID `42081` is hardcoded in `mini-services/gift-bot/index.ts`
  and never shown to app users (only the room name "QUO PRO" is displayed)

## Build

- Build 10003
- Made with ❤ in Maldives
- Licensed to HQ Family
