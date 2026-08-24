import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { safeJson } from '@/lib/safe-fetch'

const BASE = 'https://chat.inweapp.com'
const UA = 'Mozilla/5.0 (compatible; InweGiftingPanel/1.0)'

async function fetchWithSession(url: string, sessionCookie: string, init?: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: { ...(init?.headers ?? {}), 'Cookie': sessionCookie, 'User-Agent': UA },
    redirect: 'manual',
    cache: 'no-store',
  })
}

async function fetchCsrf(sessionCookie: string): Promise<string | null> {
  const res = await fetchWithSession(`${BASE}/`, sessionCookie)
  if (res.status >= 400) return null
  const html = await res.text()
  const m = html.match(/name="csrf-token" content="([^"]+)"/)
  return m ? m[1] : null
}

async function fetchBalance(sessionCookie: string): Promise<number | null> {
  const res = await fetchWithSession(`${BASE}/balance`, sessionCookie, {
    headers: { 'Accept': 'application/json' },
  })
  if (res.status >= 400) return null
  const result = await safeJson<{ balance?: number }>(res)
  if (!result.ok) return null
  return typeof result.data?.balance === 'number' ? result.data.balance : null
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { action, username } = body as { action: string; username: string }

  if (!username) {
    return NextResponse.json({ ok: false, error: 'username required' }, { status: 400 })
  }

  const session = await db.findUnique(username)
  if (!session) {
    return NextResponse.json({ ok: false, error: 'No active session for this user. Login first.' }, { status: 404 })
  }

  try {
    // --- BALANCE ---
    if (action === 'balance') {
      const balance = await fetchBalance(session.cookie)
      return NextResponse.json({ ok: true, balance })
    }

    // --- LIST GIFTS ---
    if (action === 'list_gifts') {
      const page = typeof body.page === 'number' ? body.page : 0
      const url = `${BASE}/gift_stores?page=${page}&order_by=name&order=asc`
      const res = await fetchWithSession(url, session.cookie, {
        headers: { 'Accept': 'application/json' },
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        return NextResponse.json(
          { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` },
          { status: 502 },
        )
      }
      const result = await safeJson<{ gifts?: unknown[]; items?: unknown[]; success?: boolean; error?: string }>(res)
      if (!result.ok) {
        return NextResponse.json(
          { ok: false, error: result.error ?? 'Non-JSON response from gift store' },
          { status: 502 },
        )
      }
      if (result.data?.success === false) {
        return NextResponse.json({ ok: false, error: result.data.error ?? 'Unauthorized' }, { status: 401 })
      }
      return NextResponse.json({ ok: true, gifts: result.data?.gifts ?? result.data?.items ?? [] })
    }

    // --- SEND MESSAGE (REST API fallback for gift sending) ---
    if (action === 'send_message') {
      const { roomId, message, type, mentionedUsersIds } = body as {
        roomId?: string; message?: string; type?: string; mentionedUsersIds?: string[]
      }
      if (!roomId || !message) {
        return NextResponse.json({ ok: false, error: 'roomId and message required' }, { status: 400 })
      }
      const csrf = await fetchCsrf(session.cookie)
      if (!csrf) {
        return NextResponse.json({ ok: false, error: 'Failed to fetch CSRF — session may be expired' }, { status: 401 })
      }
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
          category: undefined,
          mentionedUsersIds: mentionedUsersIds || [],
        }),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        return NextResponse.json(
          { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` },
          { status: 502 },
        )
      }
      const result = await safeJson<{ success?: boolean; error?: string; message?: string }>(res)
      if (!result.ok) {
        return NextResponse.json(
          { ok: false, error: result.error ?? 'Non-JSON response from send_message' },
          { status: 502 },
        )
      }
      if (result.data?.success === false) {
        return NextResponse.json({ ok: false, error: result.data.error ?? result.data.message ?? 'Send failed' }, { status: 400 })
      }
      return NextResponse.json({ ok: true, response: result.data })
    }

    // --- TRANSFER ---
    if (action === 'transfer') {
      const { recipient, amount, pin, tag, otp } = body as {
        recipient?: string; amount?: number; pin?: string; tag?: string; otp?: string
      }
      if (!recipient || !amount || !pin) {
        return NextResponse.json({ ok: false, error: 'recipient, amount, and pin are required' }, { status: 400 })
      }
      const csrf = await fetchCsrf(session.cookie)
      if (!csrf) {
        return NextResponse.json({ ok: false, error: 'Failed to fetch CSRF' }, { status: 401 })
      }
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
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        return NextResponse.json(
          { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` },
          { status: 502 },
        )
      }
      const result = await safeJson<{ success?: boolean; error?: string; message?: string; otp?: boolean }>(res)
      if (!result.ok) {
        return NextResponse.json(
          { ok: false, error: result.error ?? 'Non-JSON response from transfer' },
          { status: 502 },
        )
      }
      if (result.data?.success === false) {
        return NextResponse.json({ ok: false, error: result.data.error ?? 'Transfer failed' }, { status: 400 })
      }
      if (result.data?.otp) {
        return NextResponse.json({ ok: true, requiresOtp: true, message: result.data.message })
      }
      return NextResponse.json({ ok: true, message: result.data?.message ?? 'Transfer successful' })
    }

    return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
