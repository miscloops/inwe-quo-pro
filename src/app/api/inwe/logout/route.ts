// POST /api/inwe/logout
// Body: { username } | { username: '*' }
// Removes stored session(s) locally only — does NOT call /logout on chat.inweapp.com
// (to avoid invalidating the real session if the user wants to keep it active in their browser too).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { username } = body as { username?: string }

  if (!username) {
    return NextResponse.json({ ok: false, error: 'username required' }, { status: 400 })
  }

  if (username === '*') {
    await db.inweSession.deleteMany({})
    return NextResponse.json({ ok: true, cleared: 'all' })
  }

  await db.inweSession.deleteMany({ where: { username } })
  return NextResponse.json({ ok: true, cleared: username })
}
