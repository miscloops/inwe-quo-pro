// POST /api/inwe/send-gift
// Body:
//   { action: 'list_gifts', username }
//     → returns the gift catalog from /gift_stores
//   { action: 'transfer', username, recipient, amount, pin, tag, otp? }
//     → POSTs to /transfer to send coins to another user
//   { action: 'fetch_csrf', username }
//     → returns the CSRF token scraped from the user's home page (needed for /transfer)
//   { action: 'balance', username }
//     → fetches the user's coin balance from /balance
//
// NOTE: chat.inweapp.com requires PIN + OTP for credit transfers.
// We expose both endpoints here so the UI can drive the full flow.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

const BASE = 'https://chat.inweapp.com'
const UA = 'Mozilla/5.0 (compatible; InweGiftingPanel/1.0)'

async function fetchWithSession(
  url: string,
  sessionCookie: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      'Cookie': sessionCookie,
      'User-Agent': UA,
    },
    redirect: 'manual',
    cache: 'no-store',
  })
}

// Scrape CSRF token from the user's home page
async function fetchCsrf(sessionCookie: string): Promise<string | null> {
  const res = await fetchWithSession(`${BASE}/`, sessionCookie)
  if (res.status >= 400) return null
  const html = await res.text()
  const m = html.match(/name="csrf-token" content="([^"]+)"/)
  return m ? m[1] : null
}

// Fetch the user's coin balance from /balance
async function fetchBalance(sessionCookie: string): Promise<number | null> {
  const res = await fetchWithSession(`${BASE}/balance`, sessionCookie, {
    headers: { 'Accept': 'application/json' },
  })
  if (res.status >= 400) return null
  try {
    const j = (await res.json()) as { balance?: number }
    return typeof j.balance === 'number' ? j.balance : null
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { action, username } = body as { action: string; username: string }

  if (!username) {
    return NextResponse.json({ ok: false, error: 'username required' }, { status: 400 })
  }

  const session = await db.inweSession.findUnique({ where: { username } })
  if (!session) {
    return NextResponse.json({ ok: false, error: 'No active session for this user. Login first.' }, { status: 404 })
  }

  try {
    if (action === 'fetch_csrf') {
      const csrf = await fetchCsrf(session.cookie)
      if (!csrf) {
        return NextResponse.json({ ok: false, error: 'Failed to fetch CSRF — session may be expired' }, { status: 401 })
      }
      return NextResponse.json({ ok: true, csrf })
    }

    if (action === 'balance') {
      const balance = await fetchBalance(session.cookie)
      return NextResponse.json({ ok: true, balance })
    }

    if (action === 'list_gifts') {
      // Paginated gift store
      const page = typeof body.page === 'number' ? body.page : 0
      const url = `${BASE}/gift_stores?page=${page}&order_by=name&order=asc`
      const res = await fetchWithSession(url, session.cookie, {
        headers: { 'Accept': 'application/json' },
      })
      if (res.status >= 400) {
        return NextResponse.json({ ok: false, error: `HTTP ${res.status}` }, { status: 502 })
      }
      const j = (await res.json()) as { gifts?: unknown[]; items?: unknown[]; success?: boolean; error?: string }
      if (j.success === false) {
        return NextResponse.json({ ok: false, error: j.error ?? 'Unauthorized' }, { status: 401 })
      }
      return NextResponse.json({ ok: true, gifts: j.gifts ?? j.items ?? [] })
    }

    if (action === 'send_message') {
      // Send a chat message (e.g. "/gift mindstorm neko") to a room via the
      // REST POST /send_message endpoint. This is the reliable fallback when
      // the Socket.IO send_message_to_room callback doesn't ack.
      const { roomId, message, type, mentionedUsersIds } = body as {
        roomId?: string
        message?: string
        type?: string
        mentionedUsersIds?: string[]
      }
      if (!roomId || !message) {
        return NextResponse.json({ ok: false, error: 'roomId and message required' }, { status: 400 })
      }

      // Fetch CSRF (needed for /send_message POST)
      const csrf = await fetchCsrf(session.cookie)
      if (!csrf) {
        return NextResponse.json({ ok: false, error: 'Failed to fetch CSRF — session may be expired' }, { status: 401 })
      }

      // Exact payload shape from the inweapp JS bundle's sendMessageViaApi():
      //   { id: roomId.toString(), message, type, category, mentionedUsersIds, ... }
      const res = await fetchWithSession(`${BASE}/send_message`, session.cookie, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-CSRF-Token': csrf,
        },
        body: JSON.stringify({
          id: String(roomId),
          message,
          type: type || 'text',
          category: undefined,  // not set for normal messages
          mentionedUsersIds: mentionedUsersIds || [],
        }),
      })
      if (res.status >= 400) {
        const text = await res.text().catch(() => '')
        return NextResponse.json({ ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` }, { status: 502 })
      }
      const j = (await res.json()) as { success?: boolean; error?: string; message?: string }
      if (j.success === false) {
        return NextResponse.json({ ok: false, error: j.error ?? j.message ?? 'Send failed' }, { status: 400 })
      }
      return NextResponse.json({ ok: true, response: j })
    }

    if (action === 'transfer') {
      // Required for credit transfer: recipient username, amount, pin (4-digit), tag (memo), otp (optional — server may request)
      const { recipient, amount, pin, tag, otp } = body as {
        recipient?: string
        amount?: number
        pin?: string
        tag?: string
        otp?: string
      }
      if (!recipient || !amount || !pin) {
        return NextResponse.json({ ok: false, error: 'recipient, amount, and pin are required' }, { status: 400 })
      }

      // Fetch CSRF first
      const csrf = await fetchCsrf(session.cookie)
      if (!csrf) {
        return NextResponse.json({ ok: false, error: 'Failed to fetch CSRF — session may be expired' }, { status: 401 })
      }

      // POST /transfer as JSON
      const res = await fetchWithSession(`${BASE}/transfer`, session.cookie, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-CSRF-Token': csrf,
        },
        body: JSON.stringify({
          username: recipient,
          amount,
          pin,
          tag: tag ?? '',
          otp: otp ?? '',
        }),
      })
      if (res.status >= 400) {
        return NextResponse.json({ ok: false, error: `HTTP ${res.status}`, status: res.status }, { status: 502 })
      }
      const j = (await res.json()) as {
        success?: boolean
        error?: string
        message?: string
        otp?: boolean
      }
      if (j.success === false) {
        return NextResponse.json({ ok: false, error: j.error ?? 'Transfer failed' }, { status: 400 })
      }
      // Server may request OTP — surface that to the UI
      if (j.otp) {
        return NextResponse.json({ ok: true, requiresOtp: true, message: j.message })
      }
      return NextResponse.json({ ok: true, message: j.message ?? 'Transfer successful' })
    }

    return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
