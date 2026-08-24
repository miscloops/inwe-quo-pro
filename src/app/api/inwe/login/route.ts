import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { safeJson } from '@/lib/safe-fetch'

const BASE = 'https://chat.inweapp.com'
const UA = 'Mozilla/5.0 (compatible; InweGiftingPanel/1.0)'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { username, password } = body as { username?: string; password?: string }

  if (!username || !password) {
    return NextResponse.json({ ok: false, error: 'username and password are required' }, { status: 400 })
  }

  const cleanUser = String(username).trim()
  const cleanPass = String(password)

  try {
    // 1. Fetch login page for CSRF + session cookie
    const loginPageRes = await fetch(`${BASE}/login`, {
      headers: { 'User-Agent': UA },
      redirect: 'manual',
      cache: 'no-store',
    })
    const setCookie1 = loginPageRes.headers.get('set-cookie') ?? ''
    const loginHtml = await loginPageRes.text()
    const csrfMatch = loginHtml.match(/authenticity_token" value="([^"]+)"/)
    const csrf = csrfMatch ? csrfMatch[1] : ''
    const sessionCookie = setCookie1.split(';')[0]

    if (!csrf || !sessionCookie) {
      return NextResponse.json({ ok: false, error: 'Failed to fetch login page (CSRF/cookie)' }, { status: 502 })
    }

    // 2. POST /login
    const form = new URLSearchParams()
    form.append('utf8', '✓')
    form.append('authenticity_token', csrf)
    form.append('username', cleanUser)
    form.append('password', cleanPass)
    form.append('remember_me', '1')
    form.append('appearance', '0')
    form.append('commit', 'Login')

    const loginRes = await fetch(`${BASE}/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': sessionCookie,
        'Referer': `${BASE}/login`,
        'User-Agent': UA,
        'Accept': 'application/json, text/html;q=0.9',
      },
      redirect: 'manual',
      cache: 'no-store',
      body: form.toString(),
    })

    const setCookie2 = loginRes.headers.get('set-cookie') ?? ''
    const newCookie = setCookie2.split(';')[0] || sessionCookie

    // Safe JSON parse of login response
    const loginResult = await safeJson(loginRes)
    if (loginResult.ok && loginResult.data?.success === false) {
      return NextResponse.json(
        { ok: false, error: loginResult.data.errors || loginResult.data.error || 'Login failed' },
        { status: 401 },
      )
    }
    // If not JSON (e.g., HTML redirect), that's OK — check if cookie changed
    if (!loginResult.ok && !newCookie) {
      return NextResponse.json(
        { ok: false, error: `Login failed — ${loginResult.error}` },
        { status: 401 },
      )
    }

    // 3. Fetch auth-token from home page
    const homeRes = await fetch(`${BASE}/`, {
      headers: { 'Cookie': newCookie, 'User-Agent': UA },
      redirect: 'manual',
      cache: 'no-store',
    })
    let authToken: string | null = null
    if (homeRes.status < 400) {
      const homeHtml = await homeRes.text()
      const m = homeHtml.match(/name="auth-token" content="([^"]+)"/)
      if (m) authToken = m[1]
    }

    // 4. Store session in D1
    const session = await db.upsert(
      cleanUser,
      { cookie: newCookie, authToken, status: 'active' },
      { username: cleanUser, cookie: newCookie, authToken, status: 'active' },
    )

    return NextResponse.json({
      ok: true,
      username: cleanUser,
      sessionId: session.id,
      hasAuthToken: !!authToken,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: `Login error: ${msg}` }, { status: 500 })
  }
}
