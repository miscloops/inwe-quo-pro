# Deploy to Cloudflare

1. Install dependencies: `npm install`
2. Create/apply the D1 table:
   `npx wrangler d1 execute inwe-quo-pro-db --remote --file=migrations/0001_inwe_session.sql`
3. Login: `npx wrangler login`
4. Deploy: `npm run deploy`

## Important: gift bot
The Next.js website can run on Cloudflare. The current Socket.IO/Bun gift bot cannot run as `localhost:3001` inside Cloudflare. For deployed auto-gifting, set a public HTTPS `BOT_URL` pointing to a separately hosted bot service. The website itself does not need to run 24/7; Cloudflare Workers run on demand.
