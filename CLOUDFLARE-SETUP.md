# Cloudflare setup
1. Create D1: `npx wrangler d1 create inwe-quo-pro-db`
2. Copy the returned database_id into `wrangler.jsonc`.
3. Apply schema: `npx wrangler d1 execute inwe-quo-pro-db --remote --file=migrations/0001_init.sql`
4. `npm install`
5. `npm run deploy`

## Important
The original `auto-gift` route calls `http://localhost:3001`, which cannot exist inside a Cloudflare Worker. The mini-services/gift-bot must be moved to a separate Worker/Durable Object before automatic gifting can run on Cloudflare. The rest of the Prisma session storage has been converted to D1.
