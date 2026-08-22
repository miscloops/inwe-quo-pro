# Deploy iNwe Quo Pro v1 on Google Cloud (e2-micro, free forever)

This guide walks you through deploying the panel on a free GCP e2-micro VM
that runs 24/7 — shareable with friends.

## Prerequisites

- A Google account
- A credit/debit card (for verification only — never charged for e2-micro)
- Your project pushed to GitHub (you'll need the repo URL)

## Step 1 — Push your project to GitHub

If you haven't already:

```bash
cd /home/z/my-project
git init
git add -A
git commit -m "iNwe Quo Pro v1"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/inwe-quo-pro.git
git push -u origin main
```

## Step 2 — Create the GCP project

1. Go to https://cloud.google.com/free → **Get started for free**
2. Sign in with Google
3. Enter your card (it's only verified, never charged if you stay within limits)
4. A project named "My First Project" auto-creates

## Step 3 — Create the e2-micro VM

1. Go to https://console.cloud.google.com/compute/instances
2. Click **Create Instance**
3. Set:
   - **Name:** `inwe-quo-pro`
   - **Region:** `us-central1-a` (MUST be one of: `us-central1`, `us-east1`, `us-west1`)
   - **Machine type:** `e2-micro` (2 shared vCPU, 1 GB RAM, 30 GB disk — always-free)
   - **Boot disk:** click Change → Ubuntu 22.04 LTS → 30 GB Standard Persistent Disk
   - **Firewall:** check both ☑ Allow HTTP traffic and ☑ Allow HTTPS traffic
4. Click **Create** and wait ~1 min

## Step 4 — SSH into the VM

In the VM list, click **SSH** next to `inwe-quo-pro`. A browser terminal opens.

## Step 5 — Run the deploy script

In the SSH terminal, paste this and press Enter:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/YOUR_USERNAME/inwe-quo-pro/main/scripts/deploy-gcp.sh) \
  https://github.com/YOUR_USERNAME/inwe-quo-pro.git
```

Replace `YOUR_USERNAME` with your actual GitHub username.

The script will:
1. Install nginx, git, bun, pm2
2. Clone your repo to `/opt/inwe-quo-pro`
3. Install dependencies + push Prisma schema
4. Configure firewall + nginx reverse proxy
5. Start both services with PM2 (auto-restart on crash + reboot)

## Step 6 — Get your public URL

After the script finishes (~5 min), it prints:

```
=== DEPLOY COMPLETE ===

Your app is live at:
  http://123.45.67.89
```

Share that IP with your friends. They visit it in their browser.

## Step 7 — Verify it's running

```bash
pm2 status
```

You should see `app` and `bot` both `online`. Logs:

```bash
pm2 logs app        # Next.js panel
pm2 logs bot        # gift-bot mini-service
```

## Step 8 — (Optional) Add a free domain + HTTPS

Use **Cloudflare** for a free domain:

1. Buy a $5 domain (or use a free `.tk`/`.ml` from Freenom — though those are unreliable)
2. Add it to Cloudflare (free plan)
3. Point it to your VM's public IP via an A record
4. Cloudflare auto-provisions HTTPS

Or use **Cloudflare Tunnel** for a free `*.trycloudflare.com` URL (no domain needed):

```bash
# On the VM:
sudo cloudflared service install
cloudflared tunnel --url http://localhost:3000
```

## Managing the server

| Command | What it does |
|---------|--------------|
| `pm2 status` | See if app and bot are running |
| `pm2 logs app` | View Next.js logs |
| `pm2 logs bot` | View gift-bot logs |
| `pm2 restart all` | Restart both services |
| `pm2 stop all` | Stop everything |
| `cd /opt/inwe-quo-pro && git pull && pm2 restart all` | Deploy updates |

## Always-free limits (don't exceed these)

| Resource | Free limit |
|----------|-----------|
| **Region** | `us-central1`, `us-east1`, or `us-west1` only |
| **VM type** | 1× `e2-micro` (1 GB RAM, 0.25 vCPU shared) |
| **Disk** | 30 GB Standard Persistent Disk |
| **Network** | 1 GB egress/month to non-Google IPs |
| **Runtime** | Unlimited (no sleep) |

The 1 GB egress limit means ~5,000 page views/month — fine for personal use
with a few friends. If you exceed it, GCP charges a few cents per GB — set
a **budget alert** at $1 to be safe.

## Troubleshooting

**App not loading at the IP?**
```bash
sudo nginx -t
sudo systemctl status nginx
pm2 logs app --lines 20
```

**Gifts not sending?**
```bash
pm2 logs bot --lines 50
# Check that the bot is connected to socket.inweapp.com
```

**Out of memory?**
The e2-micro has only 1 GB RAM. If bun crashes:
```bash
sudo fallocate -l 1G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

**Need to update the code?**
```bash
cd /opt/inwe-quo-pro
git pull
pm2 restart all
```
