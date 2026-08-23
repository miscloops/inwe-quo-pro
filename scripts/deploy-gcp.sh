#!/usr/bin/env bash
# iNwe Quo Pro v1 — GCP e2-micro deploy script
# Run this on the VM after SSHing in. Takes ~5 min.
set -e

echo "=== iNwe Quo Pro v1 — GCP deploy starting ==="
echo ""

# 1. Install system deps
echo "[1/8] Installing system packages..."
sudo apt-get update -qq
sudo apt-get install -y -qq nginx git curl build-essential python3 ufw > /dev/null

# 2. Install Bun
echo "[2/8] Installing Bun..."
if ! command -v bun &>/dev/null; then
  curl -fsSL https://bun.sh/install | bash > /dev/null
  source ~/.bashrc
fi
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

# 3. Install PM2 (process manager — keeps app running 24/7)
echo "[3/8] Installing PM2..."
if ! command -v pm2 &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - > /dev/null
  sudo apt-get install -y -qq nodejs > /dev/null
  sudo npm install -g pm2 > /dev/null
fi

# 4. Clone the project (REPLACE with your GitHub repo URL)
REPO_URL="${1:-https://github.com/YOUR_USERNAME/inwe-quo-pro.git}"
APP_DIR="/opt/inwe-quo-pro"
echo "[4/8] Cloning project from $REPO_URL..."
sudo rm -rf "$APP_DIR"
sudo git clone "$REPO_URL" "$APP_DIR" 2>/dev/null || {
  echo "ERROR: Could not clone $REPO_URL"
  echo "Edit this script and replace YOUR_USERNAME with your actual GitHub username,"
  echo "or run: bash deploy-gcp.sh https://github.com/ACTUAL_USER/ACTUAL_REPO.git"
  exit 1
}
sudo chown -R $USER:$USER "$APP_DIR"
cd "$APP_DIR"

# 5. Install deps + push DB schema
echo "[5/8] Installing dependencies..."
bun install --silent
bun run db:push > /dev/null 2>&1 || echo "  (db:push skipped — will run on first start)"

# 6. Configure UFW firewall
echo "[6/8] Configuring firewall..."
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable

# 7. Configure Nginx as reverse proxy
echo "[7/8] Configuring Nginx..."
sudo tee /etc/nginx/sites-available/inwe-quo-pro > /dev/null << 'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name _;

    client_max_body_size 50M;

    # Main Next.js app
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }

    # Gift-bot mini-service (proxied via the gateway — actually on port 3001,
    # but the Next.js app routes through itself, so no direct nginx exposure needed)
}
NGINX
sudo ln -sf /etc/nginx/sites-available/inwe-quo-pro /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# 8. Start both services with PM2 (auto-restart on crash, persist across reboots)
echo "[8/8] Starting services with PM2..."
pm2 delete app 2>/dev/null || true
pm2 delete bot 2>/dev/null || true
pm2 start "bun run dev" --name app --cwd "$APP_DIR"
pm2 start "bun run dev" --name bot --cwd "$APP_DIR/mini-services/gift-bot"
pm2 save
pm2 startup systemd -u $USER --hp /home/$USER | tail -1 | sudo bash 2>/dev/null || true

echo ""
echo "=== DEPLOY COMPLETE ==="
echo ""
echo "Your app is live at:"
echo "  http://$(curl -s http://checkip.amazonaws.com)"
echo ""
echo "Manage services:"
echo "  pm2 status          # see what's running"
echo "  pm2 logs app        # view Next.js logs"
echo "  pm2 logs bot        # view gift-bot logs"
echo "  pm2 restart all     # restart both services"
echo ""
echo "To deploy updates: cd $APP_DIR && git pull && pm2 restart all"
