import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const sessions = await db.inweSession.findMany({ select: { username: true, cookie: true, authToken: true, status: true, lastChecked: true } })
for (const s of sessions) {
  console.log(`--- ${s.username} (${s.status}) ---`)
  console.log(`  cookie: ${s.cookie ?? '(null)'}`)
  console.log(`  authToken: ${s.authToken ? s.authToken.slice(0, 80) + '...' : '(null)'}`)
}
await db.$disconnect()
