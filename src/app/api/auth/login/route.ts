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
  const cleanUsername = username.trim().toLowerCase()
  const passwordHash = await hashPassword(password)
  const user = await db.findUser(cleanUsername)
  if (!user) return NextResponse.json({ ok: false, error: 'Account not found' }, { status: 404 })
  if (user.passwordHash !== passwordHash) return NextResponse.json({ ok: false, error: 'Invalid username or password' }, { status: 401 })
  return NextResponse.json({ ok: true, username: cleanUsername })
}
