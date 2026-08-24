import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { username } = body as { username?: string }

  if (!username) {
    return NextResponse.json({ ok: false, error: 'username required' }, { status: 400 })
  }

  if (username === '*') {
    await db.deleteMany()
    return NextResponse.json({ ok: true, cleared: 'all' })
  }

  await db.deleteMany([username])
  return NextResponse.json({ ok: true, cleared: username })
}
