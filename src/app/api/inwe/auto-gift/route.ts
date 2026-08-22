// Auto-gift endpoints — proxy to the gift-bot mini-service on port 3001.
// All requests use the gateway's XTransformPort mechanism, but since this
// server-side code can call localhost directly, we just fetch port 3001.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

const BOT_URL = 'http://localhost:3001'

// Fetch the latest auth-tokens for all sessions (the bot needs them for socket.io auth)
async function getSessionsWithAuth(usernames: string[]) {
  const sessions = await db.inweSession.findMany({
    where: { username: { in: usernames } },
    select: { username: true, authToken: true, status: true },
  })
  return sessions
    .filter((s) => !!s.authToken)
    .map((s) => ({ username: s.username, authToken: s.authToken! }))
}

// POST /api/inwe/auto-gift/start
// Body: { sender: string, gifts: [{id, name, price}] }
// Returns: { ok: true, status: 'joined'|'failed', message, joined, failed }
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { action, sender, gifts, usernames, password } = body as {
    action?: 'start' | 'stop' | 'status'
    sender?: string
    gifts?: { id: string; name: string; price: number }[]
    usernames?: string[]
    password?: string
  }

  // STOP
  if (action === 'stop') {
    try {
      const r = await fetch(`${BOT_URL}/stop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const j = await r.json()
      return NextResponse.json(j)
    } catch (e) {
      return NextResponse.json({ ok: false, error: 'Bot service not running' }, { status: 502 })
    }
  }

  // STATUS
  if (action === 'status') {
    try {
      const r = await fetch(`${BOT_URL}/status`)
      const j = await r.json()
      return NextResponse.json(j)
    } catch {
      return NextResponse.json({ ok: false, running: false, joined: [], failed: [], log: [] })
    }
  }

  // START
  if (action === 'start') {
    if (!sender || !gifts?.length || !usernames?.length) {
      return NextResponse.json({ ok: false, error: 'sender, gifts, usernames required' }, { status: 400 })
    }

    // Fetch fresh auth-tokens for all users from DB
    let sessions = await getSessionsWithAuth(usernames)

    // If any sessions are missing auth-tokens OR force_relogin is set, re-login the sender.
    // (inweapp's socket.io join_room fails with JOIN_API_FAILED when the session is stale
    //  — re-logging in refreshes the session, then the join succeeds. This is the user's
    //  described flow: "the id first gifter id should get logged out and then logged in
    //  and then try to enter the chatroom 42081 and it will work thats how inwe works")
    const missingAuth = usernames.filter((u) => !sessions.find((s) => s.username === u))
    const forceRelogin = body.force_relogin === true
    const needsRelogin = [...missingAuth, ...(forceRelogin ? [sender] : [])]
      .filter((u, i, arr) => arr.indexOf(u) === i)  // dedupe

    if (needsRelogin.length > 0 && password) {
      for (const u of needsRelogin) {
        try {
          const r = await fetch(`${req.nextUrl.origin}/api/inwe/relogin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: u, password }),
          })
          const j = await r.json()
          if (!j.ok) {
            return NextResponse.json({
              ok: false,
              status: 'failed',
              message: `Failed to re-login ${u}: ${j.error}`,
              joined: [], failed: [u],
            })
          }
        } catch (e) {
          return NextResponse.json({
            ok: false, status: 'failed',
            message: `Re-login error for ${u}: ${e instanceof Error ? e.message : String(e)}`,
            joined: [], failed: [u],
          })
        }
      }
      // Re-fetch sessions with the fresh auth-tokens
      sessions = await getSessionsWithAuth(usernames)
    }

    if (sessions.length === 0) {
      return NextResponse.json({
        ok: false, status: 'failed',
        message: 'No valid sessions — please log in your accounts first',
        joined: [], failed: usernames,
      })
    }

    // Call the gift-bot service to start
    try {
      const r = await fetch(`${BOT_URL}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessions, sender, gifts }),
      })
      const j = await r.json()
      return NextResponse.json(j)
    } catch (e) {
      return NextResponse.json({
        ok: false, status: 'failed',
        message: `Gift bot service error: ${e instanceof Error ? e.message : String(e)}`,
        joined: [], failed: usernames,
      }, { status: 502 })
    }
  }

  return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 })
}

// GET /api/inwe/auto-gift — fetch status
export async function GET() {
  try {
    const r = await fetch(`${BOT_URL}/status`)
    const j = await r.json()
    return NextResponse.json(j)
  } catch {
    return NextResponse.json({ ok: false, running: false, joined: [], failed: [], log: [] })
  }
}
