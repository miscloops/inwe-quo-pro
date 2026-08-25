import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode('inwe-quo-pro-' + password)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { username, password } = body as { username?: string; password?: string }
  if (!username || !password) return NextResponse.json({ ok: false, error: 'username and password required' }, { status: 400 })
  if (username.length < 3) return NextResponse.json({ ok: false, error: 'Username must be at least 3 characters' }, { status: 400 })
  if (password.length < 4) return NextResponse.json({ ok: false, error: 'Password must be at least 4 characters' }, { status: 400 })
  const cleanUsername = username.trim().toLowerCase()
  const existing = await db.findUser(cleanUsername)
  if (existing) return NextResponse.json({ ok: false, error: 'Username already taken' }, { status: 409 })
  const passwordHash = await hashPassword(password)
  await db.createUser(cleanUsername, passwordHash)
  return NextResponse.json({ ok: true, username: cleanUsername })
}
