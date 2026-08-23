#!/usr/bin/env bash
# iNwe Quo Pro v1 — ONE-COMMAND deploy
# Run on any computer that stays on. Gets a free public URL in 60 seconds.
#
# Usage:
#   bash start.sh
#
# Then share the URL it prints with your friends. Done.

set -e

echo "=== iNwe Quo Pro v1 — Starting ==="
echo ""

# Check bun is installed
if ! command -v bun &>/dev/null; then
  echo "Installing Bun..."
  curl -fsSL https://bun.sh/install | bash
  source ~/.bashrc
fi

# Install deps if needed
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies (first run only)..."
  bun install --silent
fi

# Init database if needed
if [ ! -f "db/custom.db" ]; then
  echo "Setting up database..."
  bun run db:push 2>/dev/null || true
fi

# Kill any existing instances
pkill -f "bun run dev" 2>/dev/null || true
sleep 1

# Start the gift-bot mini-service in the background
echo "Starting gift-bot service..."
(cd mini-services/gift-bot && bun install --silent 2>/dev/null; bun run dev) &
BOT_PID=$!

# Wait a moment for the bot to start
sleep 2

# Start the Next.js app in the background
echo "Starting panel..."
bun run dev &
APP_PID=$!

# Wait for the app to be ready
echo "Waiting for app to start..."
for i in {1..30}; do
  if curl -s http://localhost:3000 >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

# Get a free public URL via localtunnel
echo ""
echo "=== App is running locally on http://localhost:3000 ==="
echo ""
echo "Getting a free public URL so friends can access it..."
echo "(Press Ctrl+C to stop everything when done)"
echo ""
npx localtunnel --port 3000 || \
  npx cloudflared tunnel --url http://localhost:3000 || \
  echo "Local URL: http://localhost:3000 (only accessible from this computer)"

# Cleanup on exit
trap "kill $BOT_PID $APP_PID 2>/dev/null; exit" INT TERM
wait
