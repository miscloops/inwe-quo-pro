import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { username } = body as { username?: string }
  const userPin = req.headers.get('x-user-name') ?? undefined

  if (!username) {
    return NextResponse.json({ ok: false, error: 'username required' }, { status: 400 })
  }

  if (username === '*') {
    // Delete all sessions for THIS user only
    const allSessions = await db.findMany(undefined, userPin)
    await db.deleteMany(allSessions.map(s => s.username), userPin)
    return NextResponse.json({ ok: true, cleared: 'all' })
  }

  await db.deleteMany([username], userPin)
  return NextResponse.json({ ok: true, cleared: username })
}
