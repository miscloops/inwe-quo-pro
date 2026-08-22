// POST /api/inwe/login
// Body: { username, password }
// Logs into chat.inweapp.com on behalf of the user, stores the session in DB,
// returns the auth-token + user info.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

const BASE = 'https://chat.inweapp.com'
const UA = 'Mozilla/5.0 (compatible; InweGiftingPanel/1.0)'

interface InweLoginResponse {
  success?: boolean
  errors?: string
  error?: string
  message?: string
  otp?: boolean
}

async function fetchLoginPage(): Promise<{ csrf: string; cookies: string }> {
  // Get CSRF + session cookie — MUST use no-store or Next.js caches the response
  const res = await fetch(`${BASE}/login`, {
    headers: { 'User-Agent': UA },
    redirect: 'manual',
    cache: 'no-store',
  })
  const setCookie = res.headers.get('set-cookie') ?? ''
  const html = await res.text()
  const m = html.match(/authenticity_token" value="([^"]+)"/)
  const csrf = m ? m[1] : ''
  // Keep just the first cookie (the _inweapp_web_session one)
  const sessionCookie = setCookie.split(';')[0]
  return { csrf, cookies: sessionCookie }
}

async function postLogin(
  csrf: string,
  cookies: string,
  username: string,
  password: string,
): Promise<{ ok: boolean; error?: string; updatedCookie?: string; body: InweLoginResponse | string }> {
  const form = new URLSearchParams()
  form.append('utf8', '✓')
  form.append('authenticity_token', csrf)
  form.append('username', username)
  form.append('password', password)
  form.append('remember_me', '1')
  form.append('appearance', '0')
  form.append('commit', 'Login')

  const bodyStr = form.toString()

  const res = await fetch(`${BASE}/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookies,
      'Referer': `${BASE}/login`,
      'User-Agent': UA,
      'Accept': 'application/json, text/html;q=0.9',
    },
    redirect: 'manual',
    cache: 'no-store',
    body: bodyStr,
  })
  const setCookie = res.headers.get('set-cookie') ?? ''
  // Merge cookies: prefer the new one, fall back to old
  const newCookieRaw = setCookie.split(';')[0]
  const updatedCookie = newCookieRaw || cookies

  const text = await res.text()
  let body: InweLoginResponse | string = text
  try {
    body = JSON.parse(text) as InweLoginResponse
  } catch {
    // Not JSON — could be HTML redirect on success
  }

  // Determine success:
  //   - If JSON and success: true → success
  //   - If status 302 (redirect to /) → success
  //   - If JSON and success: false → fail with error
  const isJsonSuccess = (body as InweLoginResponse).success === true
  const isRedirectHome = res.status === 302
  const isJsonFail = (body as InweLoginResponse).success === false

  if (isJsonFail) {
    return {
      ok: false,
      error: (body as InweLoginResponse).errors || (body as InweLoginResponse).error || 'Login failed',
      body,
    }
  }
  if (isJsonSuccess || isRedirectHome) {
    return { ok: true, updatedCookie, body }
  }
  // Fallback: if the cookie changed, treat as success
  if (updatedCookie && updatedCookie !== cookies) {
    return { ok: true, updatedCookie, body }
  }
  return { ok: false, error: 'Unexpected login response', body }
}

async function fetchAuthToken(cookies: string): Promise<string | null> {
  // Visit homepage to extract the JWT auth-token meta tag
  const res = await fetch(`${BASE}/`, {
    headers: {
      'Cookie': cookies,
      'User-Agent': UA,
    },
    redirect: 'manual',
    cache: 'no-store',
  })
  if (res.status >= 400) return null
  const html = await res.text()
  const m = html.match(/name="auth-token" content="([^"]+)"/)
  return m ? m[1] : null
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { username, password } = body as { username?: string; password?: string }

  if (!username || !password) {
    return NextResponse.json({ ok: false, error: 'username and password are required' }, { status: 400 })
  }

  // Trim — accidental whitespace from paste is the #1 cause of "Invalid username or password!"
  const cleanUser = String(username).trim()
  const cleanPass = String(password)

  try {
    const { csrf, cookies } = await fetchLoginPage()
    if (!csrf || !cookies) {
      return NextResponse.json({ ok: false, error: 'Failed to fetch login page (CSRF/cookie)' }, { status: 502 })
    }
    const result = await postLogin(csrf, cookies, cleanUser, cleanPass)
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error ?? 'Login failed' }, { status: 401 })
    }

    const finalCookie = result.updatedCookie ?? cookies
    const authToken = await fetchAuthToken(finalCookie)

    // Persist session in DB (upsert by username)
    const session = await db.inweSession.upsert({
      where: { username: cleanUser },
      update: {
        cookie: finalCookie,
        authToken,
        status: 'active',
        lastChecked: new Date(),
      },
      create: {
        username: cleanUser,
        cookie: finalCookie,
        authToken,
        status: 'active',
      },
    })

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
