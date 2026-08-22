#!/usr/bin/env bash
# =================================================================
# iNwe Quo Pro v1 — Cross-platform bundler
# Creates a single zip that friends unzip + double-click to run.
# No terminal, no git, no bun install — just double-click.
# =================================================================
set -e

VERSION="v1"
BUILD_NAME="iNwe-Quo-Pro-${VERSION}"
BUILD_DIR="/tmp/${BUILD_NAME}"
ZIP_FILE="/home/z/my-project/download/${BUILD_NAME}.zip"

echo "=== Building ${BUILD_NAME} distributable ==="
echo ""

# Clean previous build
rm -rf "$BUILD_DIR" "$ZIP_FILE"
mkdir -p "$BUILD_DIR" "$(dirname "$ZIP_FILE")"

# 1. Copy the project (excluding dev junk)
echo "[1/7] Copying project files..."
mkdir -p "$BUILD_DIR/app"
cd /home/z/my-project
rsync -a --exclude-from=- <<'EOF' ./ "$BUILD_DIR/app"/
.git
node_modules
.next
download
scripts
upload
worklog.md
dev.log
.zscripts
EOF

# 2. Download bun binary (cross-platform — we'll include all 3)
echo "[2/7] Downloading Bun runtime (macOS, Linux, Windows)..."
mkdir -p "$BUILD_DIR/runtime"
BUN_VERSION="1.3.14"

# macOS arm64 (Apple Silicon)
if [ ! -f "$BUILD_DIR/runtime/bun-darwin-arm64" ]; then
  curl -sL "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-darwin-aarch64.zip" -o /tmp/bun-mac-arm.zip
  unzip -o -q /tmp/bun-mac-arm.zip -d /tmp/bun-mac-arm
  cp /tmp/bun-mac-arm/bun-darwin-aarch64/bun "$BUILD_DIR/runtime/bun-darwin-arm64"
fi

# macOS x64 (Intel Mac)
if [ ! -f "$BUILD_DIR/runtime/bun-darwin-x64" ]; then
  curl -sL "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-darwin-x64.zip" -o /tmp/bun-mac-x64.zip
  unzip -o -q /tmp/bun-mac-x64.zip -d /tmp/bun-mac-x64
  cp /tmp/bun-mac-x64/bun-darwin-x64/bun "$BUILD_DIR/runtime/bun-darwin-x64"
fi

# Linux x64
if [ ! -f "$BUILD_DIR/runtime/bun-linux-x64" ]; then
  curl -sL "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-x64.zip" -o /tmp/bun-linux.zip
  unzip -o -q /tmp/bun-linux.zip -d /tmp/bun-linux
  cp /tmp/bun-linux/bun-linux-x64/bun "$BUILD_DIR/runtime/bun-linux-x64"
fi

# Windows x64
if [ ! -f "$BUILD_DIR/runtime/bun-windows-x64.exe" ]; then
  curl -sL "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-windows-x64.zip" -o /tmp/bun-win.zip
  unzip -o -q /tmp/bun-win.zip -d /tmp/bun-win
  cp /tmp/bun-win/bun-windows-x64/bun.exe "$BUILD_DIR/runtime/bun-windows-x64.exe"
fi

chmod +x "$BUILD_DIR/runtime/"*

# 3. Install dependencies into the bundle (so friends don't need to)
echo "[3/7] Installing dependencies into bundle..."
cd "$BUILD_DIR/app"
bun install --production --silent 2>/dev/null || npm install --production --silent

# Install gift-bot deps too
cd "$BUILD_DIR/app/mini-services/gift-bot"
bun install --production --silent 2>/dev/null || npm install --production --silent

# 4. Pre-build the Next.js app (so first run is instant)
echo "[4/7] Pre-building Next.js app..."
cd "$BUILD_DIR/app"
bun run build 2>/dev/null || echo "  (build skipped — will run in dev mode)"

# 5. Create the launcher scripts
echo "[5/7] Creating launcher scripts..."
cd "$BUILD_DIR"

# --- macOS launcher (.command — double-clickable, opens Terminal briefly then hides) ---
cat > "iNwe Quo Pro.command" << 'LAUNCH'
#!/usr/bin/env bash
# iNwe Quo Pro v1 — double-click launcher for macOS
cd "$(dirname "$0")"

# Detect architecture
ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then
  BUN="./runtime/bun-darwin-arm64"
else
  BUN="./runtime/bun-darwin-x64"
fi
chmod +x "$BUN" 2>/dev/null

# Init DB on first run
if [ ! -f "./app/db/custom.db" ]; then
  cd ./app && "$BUN" run db:push 2>/dev/null; cd ..
fi

# Kill any previous instances
pkill -f "bun.*dev" 2>/dev/null
pkill -f "bun.*index.ts" 2>/dev/null
sleep 1

# Start the gift-bot service in background (no terminal visible)
cd ./app/mini-services/gift-bot
nohup ../../runtime/bun-darwin-* index.ts > /tmp/inwe-bot.log 2>&1 &
BOT_PID=$!

# Start the Next.js app in background
cd ../..
nohup ./runtime/bun-darwin-* run dev > /tmp/inwe-app.log 2>&1 &
APP_PID=$!

# Wait for the app to be ready
echo "Starting iNwe Quo Pro v1..."
for i in {1..30}; do
  if curl -s http://localhost:3000 >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

# Open the default browser
open "http://localhost:3000"

# Hide the Terminal window after 2 seconds
osascript -e 'tell application "Terminal" to close (every window whose name contains "iNwe Quo Pro")' 2>/dev/null &

# Keep the script alive so the background processes don't get killed
echo ""
echo "✓ iNwe Quo Pro is running at http://localhost:3000"
echo "✓ Browser should open automatically"
echo ""
echo "To stop: close this Terminal, or run: pkill -f bun"
echo ""
# Detach — let the processes keep running
disown $BOT_PID $APP_PID 2>/dev/null
exit 0
LAUNCH
chmod +x "iNwe Quo Pro.command"

# --- Windows launcher (.bat — double-clickable, runs silently) ---
cat > "iNwe Quo Pro.bat" << 'LAUNCH'
@echo off
title iNwe Quo Pro v1
cd /d "%~dp0"

REM Kill any previous instances
taskkill /F /IM bun.exe >nul 2>&1
timeout /t 1 /nobreak >nul

REM Start the gift-bot service in background
cd app\mini-services\gift-bot
start /B "" "..\..\runtime\bun-windows-x64.exe" index.ts > "%TEMP%\inwe-bot.log" 2>&1

REM Start the Next.js app in background
cd ..\..
start /B "" "..\runtime\bun-windows-x64.exe" run dev > "%TEMP%\inwe-app.log" 2>&1

REM Wait for the app to be ready
echo Starting iNwe Quo Pro v1...
for /L %%i in (1,1,30) do (
  timeout /t 1 /nobreak >nul
  powershell -command "try { (Invoke-WebRequest -Uri 'http://localhost:3000' -UseBasicParsing -TimeoutSec 2).StatusCode } catch { 0 }" | findstr "200" >nul && goto ready
)
:ready

REM Open the default browser
start "" "http://localhost:3000"

echo.
echo [OK] iNwe Quo Pro is running at http://localhost:3000
echo [OK] Browser should open automatically
echo.
echo To stop: close this window, or run: taskkill /F /IM bun.exe
echo.
echo You can minimize this window — the app keeps running.
echo.
REM Keep the window open so processes don't die
pause >nul
LAUNCH

# --- Windows VBS launcher (truly silent — no window at all) ---
cat > "iNwe Quo Pro (Silent).vbs" << 'LAUNCH'
' iNwe Quo Pro v1 — silent launcher for Windows
' Double-click this to start the app with NO visible window.
Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
strDir = fso.GetParentFolderName(WScript.ScriptFullName)

' Run the .bat silently (0 = hidden window)
WshShell.Run """" & strDir & "\iNwe Quo Pro.bat""", 0, False

' Wait 8 seconds for the app to start
WScript.Sleep 8000

' Open the default browser
WshShell.Run "http://localhost:3000"
LAUNCH

# --- Linux launcher (.sh — double-clickable or runnable from terminal) ---
cat > "iNwe Quo Pro.sh" << 'LAUNCH'
#!/usr/bin/env bash
# iNwe Quo Pro v1 — launcher for Linux
cd "$(dirname "$0")"
BUN="./runtime/bun-linux-x64"
chmod +x "$BUN" 2>/dev/null

# Init DB on first run
if [ ! -f "./app/db/custom.db" ]; then
  cd ./app && "$BUN" run db:push 2>/dev/null; cd ..
fi

# Kill any previous instances
pkill -f "bun.*dev" 2>/dev/null
pkill -f "bun.*index.ts" 2>/dev/null
sleep 1

# Start the gift-bot service in background
cd ./app/mini-services/gift-bot
nohup ../../runtime/bun-linux-x64 index.ts > /tmp/inwe-bot.log 2>&1 &

# Start the Next.js app in background
cd ../..
nohup ./runtime/bun-linux-x64 run dev > /tmp/inwe-app.log 2>&1 &

# Wait for the app to be ready
echo "Starting iNwe Quo Pro v1..."
for i in {1..30}; do
  if curl -s http://localhost:3000 >/dev/null 2>&1; then break; fi
  sleep 1
done

# Open the default browser
xdg-open "http://localhost:3000" 2>/dev/null || open "http://localhost:3000" 2>/dev/null

echo ""
echo "✓ iNwe Quo Pro is running at http://localhost:3000"
echo "✓ Browser should open automatically"
echo ""
echo "To stop: pkill -f bun"
echo ""
disown -a 2>/dev/null
exit 0
LAUNCH
chmod +x "iNwe Quo Pro.sh"

# 6. Create a README.txt
cat > "README.txt" << 'README'
╔══════════════════════════════════════════════════════════════╗
║              iNwe Quo Pro v1 — Build 10003                  ║
║              Licensed to HQ Family                          ║
╚══════════════════════════════════════════════════════════════╝

HOW TO RUN
──────────

Double-click ONE of these files (based on your OS):

  macOS:        "iNwe Quo Pro.command"
  Windows:      "iNwe Quo Pro.bat"         (shows a window)
           or   "iNwe Quo Pro (Silent).vbs" (truly silent)
  Linux:        "iNwe Quo Pro.sh"

The app will start automatically and open in your default browser
at http://localhost:3000

First run takes ~10 seconds (database setup). After that it's
instant.


HOW TO STOP
──────────

  macOS/Linux:  Open Terminal, run:  pkill -f bun
  Windows:      Open Task Manager, end all "bun.exe" processes


HOW TO USE
──────────

1. The app opens in your browser at http://localhost:3000
2. Paste your iNwe credentials (id/password format) in the Login box
3. Click "Login" — your accounts will appear with their level + balance
4. Click "Start Auto Gifting" — the bot enters room QUO PRO and
   starts sending 3c gifts (neko, ganja, fly, muri, best wishes)
   round-robin to all other logged-in IDs every 4 seconds


TROUBLESHOOTING
───────────────

If the app doesn't start:
  - Check the log files in your temp folder:
      macOS/Linux:  /tmp/inwe-app.log  and  /tmp/inwe-bot.log
      Windows:      %TEMP%\inwe-app.log  and  %TEMP%\inwe-bot.log

If "bun" is blocked by antivirus:
  - The bundled bun binary is in the "runtime" folder
  - Add an exception for it in your antivirus

If port 3000 is already in use:
  - Close any other app using port 3000
  - Or edit the start command in the .bat/.sh/.command file


Made with ❤ in Maldives!
README

# 7. Create the zip
echo "[6/7] Creating zip archive..."
cd /tmp
zip -r -q "$ZIP_FILE" "$BUILD_NAME"
echo "[7/7] Done!"

# Show file size
SIZE=$(du -h "$ZIP_FILE" | cut -f1)
echo ""
echo "═══════════════════════════════════════════════════"
echo "  ✓ Bundle created: $ZIP_FILE"
echo "  📦 Size: $SIZE"
echo "═══════════════════════════════════════════════════"
echo ""
echo "Share the zip with your friends. They:"
echo "  1. Unzip it"
echo "  2. Double-click the launcher for their OS"
echo "  3. The app opens in their browser"
echo ""
echo "No terminal, no git, no bun install — just double-click."
