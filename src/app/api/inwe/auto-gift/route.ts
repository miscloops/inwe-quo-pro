// POST /api/inwe/auto-gift
// Joins room 42081 via Socket.IO (polling), then sends /gift via REST /send_message.
// Gifting Guard: skips IDs at 100% progress, switches to next recipient automatically.
// Bot only stops when ALL recipients are at 100%.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { safeJson } from '@/lib/safe-fetch'
import { joinRoomViaPolling } from '@/lib/socket-polling'

const BASE = 'https://chat.inweapp.com'
const UA = 'Mozilla/5.0 (compatible; InweGiftingPanel/1.0)'
const ROOM_ID = '42081'
const ROOM_NAME = 'QUO PRO'
const GUARD_THRESHOLD = 100

const botState = {
  running: false,
  joined: [] as string[],
  failed: [] as string[],
  log: [] as { ts: string; kind: string; msg: string }[],
  giftIdx: 0,
  recipientIdx: 0,
  roomJoined: false,
}

function botLog(kind: string, msg: string) {
  const entry = { ts: new Date().toLocaleTimeString(), kind, msg }
  botState.log.push(entry)
  if (botState.log.length > 200) botState.log.shift()
}

async function fetchCsrfForUser(username: string): Promise<{ csrf: string | null; cookie: string | null }> {
  const session = await db.findUnique(username)
  if (!session) return { csrf: null, cookie: null }
  const res = await fetch(`${BASE}/`, {
    headers: { 'Cookie': session.cookie, 'User-Agent': UA },
    redirect: 'manual', cache: 'no-store',
  })
  if (res.status >= 400) return { csrf: null, cookie: session.cookie }
  const html = await res.text()
  const m = html.match(/name="csrf-token" content="([^"]+)"/)
  return { csrf: m ? m[1] : null, cookie: session.cookie }
}

async function sendGiftViaRest(sender: string, giftName: string, recipient: string): Promise<{ ok: boolean; error?: string }> {
  const { csrf, cookie } = await fetchCsrfForUser(sender)
  if (!csrf || !cookie) return { ok: false, error: `No CSRF for ${sender}` }

  const giftText = `/gift ${recipient} ${giftName}`
  botLog('info', `→ ${sender} sending: ${giftText}`)

  const res = await fetch(`${BASE}/send_message`, {
    method: 'POST',
    headers: {
      'Cookie': cookie, 'User-Agent': UA,
      'Content-Type': 'application/json', 'Accept': 'application/json',
      'X-CSRF-Token': csrf,
    },
    redirect: 'manual', cache: 'no-store',
    body: JSON.stringify({ id: ROOM_ID, message: giftText, type: 'gift', category: undefined, mentionedUsersIds: [recipient] }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` }
  }

  const result = await safeJson<{ success?: boolean; error?: string; message?: string; message_new?: { text?: string } }>(res)
  if (!result.ok) return { ok: false, error: result.error ?? 'Non-JSON response' }
  if (result.data?.success === false) return { ok: false, error: result.data.error ?? result.data.message ?? 'Send failed' }

  const preview = result.data?.message_new?.text?.slice(0, 80) ?? ''
  botLog('success', `✓ ${giftName} sent to ${recipient}${preview ? ' — ' + preview : ''}`)
  return { ok: true }
}

async function findNextUnguardedRecipient(
  recipients: string[],
  startIndex: number,
): Promise<{ recipient: string | null; allGuarded: boolean; skipped: string[] }> {
  const skipped: string[] = []
  for (let i = 0; i < recipients.length; i++) {
    const idx = (startIndex + i) % recipients.length
    const recipient = recipients[idx]
    const recipientSession = await db.findUnique(recipient)
    if (recipientSession?.pointPct != null && recipientSession.pointPct >= GUARD_THRESHOLD) {
      skipped.push(recipient)
      continue
    }
    botState.recipientIdx = (idx + 1) % recipients.length
    return { recipient, allGuarded: false, skipped }
  }
  return { recipient: null, allGuarded: true, skipped }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { action, sender, gifts, usernames, password, force_relogin } = body as {
    action?: 'start' | 'stop' | 'status'; sender?: string;
    gifts?: { id: string; name: string; price: number }[];
    usernames?: string[]; password?: string; force_relogin?: boolean
  }

  if (action === 'stop') {
    botState.running = false; botState.roomJoined = false
    botLog('info', '■ Bot stopped')
    return NextResponse.json({ ok: true })
  }

  if (action === 'status') {
    return NextResponse.json({ ok: true, running: botState.running, joined: botState.joined, failed: botState.failed, log: botState.log.slice(-50) })
  }

  if (action === 'start') {
    if (!sender || !gifts?.length || !usernames?.length)
      return NextResponse.json({ ok: false, error: 'sender, gifts, usernames required' }, { status: 400 })

    if (password !== undefined) {
      botState.running = false; botState.joined = []; botState.failed = []; botState.log = []
      botState.giftIdx = 0; botState.recipientIdx = 0; botState.roomJoined = false
    }

    botLog('info', `▶ Starting gift bot — sender: ${sender}, room: "${ROOM_NAME}" (${ROOM_ID})`)

    const senderSession = await db.findUnique(sender)
    if (!senderSession || !senderSession.authToken) {
      if (password) {
        botLog('info', `No session for ${sender} — re-logging in...`)
        try {
          const r = await fetch(`${req.nextUrl.origin}/api/inwe/relogin`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: sender, password }),
          })
          const result = await safeJson(r)
          if (!result.ok || result.data?.ok === false) {
            botLog('error', `Failed to re-login ${sender}: ${result.data?.error ?? result.error}`)
            return NextResponse.json({ ok: true, status: 'failed', message: `Failed to re-login: ${result.data?.error ?? result.error}`, joined: [], failed: [sender], log: botState.log })
          }
          botLog('success', `${sender}: re-login successful`)
        } catch (e) {
          botLog('error', `Re-login error: ${e instanceof Error ? e.message : String(e)}`)
          return NextResponse.json({ ok: true, status: 'failed', message: `Re-login error`, joined: [], failed: [sender], log: botState.log })
        }
      } else {
        botLog('error', `Sender "${sender}" has no valid session`)
        return NextResponse.json({ ok: true, status: 'failed', message: `Sender has no valid session`, joined: [], failed: [sender], log: botState.log })
      }
    }

    const freshSession = await db.findUnique(sender)
    if (!freshSession || !freshSession.authToken) {
      botLog('error', `Sender "${sender}" still has no valid session after re-login`)
      return NextResponse.json({ ok: true, status: 'failed', message: `Sender has no valid session`, joined: [], failed: [sender], log: botState.log })
    }

    const allSessions = await db.findMany(usernames)
    const recipients = allSessions.filter(s => s.username !== sender).map(s => s.username)
    if (recipients.length === 0) {
      botLog('error', 'No recipients')
      return NextResponse.json({ ok: true, status: 'failed', message: 'No recipients', joined: [], failed: [], log: botState.log })
    }

    botLog('info', `Recipients: ${recipients.join(', ')}`)
    botLog('guard', `Gifting Guard: ACTIVE — skip IDs at ≥${GUARD_THRESHOLD}% (switch to next recipient)`)

    if (!botState.roomJoined) {
      botLog('info', `Joining room "${ROOM_NAME}" via Socket.IO...`)
      const joinResult = await joinRoomViaPolling(sender, freshSession.authToken)
      for (const entry of joinResult.log) botState.log.push(entry)

      if (!joinResult.ok) {
        if (password) {
          botLog('info', `Room join failed — re-logging in ${sender} and retrying...`)
          try {
            const r = await fetch(`${req.nextUrl.origin}/api/inwe/relogin`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ username: sender, password }),
            })
            const relResult = await safeJson(r)
            if (relResult.ok && relResult.data?.ok) {
              botLog('success', `${sender}: re-login successful`)
              const freshSession2 = await db.findUnique(sender)
              if (freshSession2?.authToken) {
                botLog('info', `Retrying room join...`)
                const retryResult = await joinRoomViaPolling(sender, freshSession2.authToken)
                for (const entry of retryResult.log) botState.log.push(entry)
                if (retryResult.ok) {
                  botState.roomJoined = true; botState.joined.push(sender)
                  botLog('success', `✓ Entered to Quo Pro.. — ${sender} joined room`)
                } else {
                  botLog('error', `✗ Retry also failed: ${retryResult.error}`)
                  return NextResponse.json({ ok: true, status: 'failed', message: `Failed to enter chatroom — ${retryResult.error}`, joined: [], failed: [sender], log: botState.log })
                }
              }
            } else {
              botLog('error', `Re-login failed: ${relResult.data?.error ?? relResult.error}`)
              return NextResponse.json({ ok: true, status: 'failed', message: `Failed to enter chatroom — ${joinResult.error}`, joined: [], failed: [sender], log: botState.log })
            }
          } catch (e) {
            botLog('error', `Re-login error: ${e instanceof Error ? e.message : String(e)}`)
            return NextResponse.json({ ok: true, status: 'failed', message: `Failed to enter chatroom — ${joinResult.error}`, joined: [], failed: [sender], log: botState.log })
          }
        } else {
          botLog('error', `✗ Failed to enter chatroom: ${joinResult.error}`)
          return NextResponse.json({ ok: true, status: 'failed', message: `Failed to enter chatroom — ${joinResult.error}`, joined: [], failed: [sender], log: botState.log })
        }
      } else {
        botState.roomJoined = true; botState.joined.push(sender)
        botLog('success', `✓ Entered to Quo Pro.. — ${sender} joined room`)
      }
    }

    // Find next unguarded recipient (skip 100% IDs)
    const findResult = await findNextUnguardedRecipient(recipients, botState.recipientIdx)

    for (const skipped of findResult.skipped) {
      const skipSession = await db.findUnique(skipped)
      const pct = skipSession?.pointPct ?? 0
      botLog('skip', `SKIP ${skipped} — at ${pct.toFixed(1)}% (≥${GUARD_THRESHOLD}%, switching to next recipient)`)
    }

    if (findResult.allGuarded) {
      botLog('success', `✓ All recipients at ${GUARD_THRESHOLD}% — bot waiting for level-ups (progress auto-refreshes every 60s)`)
      botState.running = true
      return NextResponse.json({
        ok: true, status: 'all_guarded',
        message: `All recipients at ${GUARD_THRESHOLD}% — waiting for level-ups`,
        joined: botState.joined, failed: [], log: botState.log,
      })
    }

    const recipient = findResult.recipient!
    const gift = gifts[botState.giftIdx % gifts.length]
    botState.giftIdx = (botState.giftIdx + 1) % gifts.length

    const result = await sendGiftViaRest(sender, gift.name, recipient)
    botState.running = true

    if (result.ok) {
      return NextResponse.json({ ok: true, status: 'joined', message: 'Entered to Quo Pro.. and gifting started', joined: botState.joined, failed: [], log: botState.log })
    } else {
      botLog('error', `✗ Failed: ${result.error}`)
      if (result.error?.includes('not in this room') || result.error?.includes('not in room')) {
        botState.roomJoined = false
        botLog('info', 'Room join expired — will re-join on next request')
      }
      return NextResponse.json({ ok: true, status: 'failed', message: result.error ?? 'Failed to send', joined: botState.joined, failed: [], log: botState.log })
    }
  }

  return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 })
}

export async function GET() {
  return NextResponse.json({ ok: true, running: botState.running, joined: botState.joined, failed: botState.failed, log: botState.log.slice(-50) })
}
