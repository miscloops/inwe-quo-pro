import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

const BASE = 'https://chat.inweapp.com'
const UA = 'Mozilla/5.0 (compatible; InweGiftingPanel/1.0)'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const username = searchParams.get('username')

  if (!username) {
    return NextResponse.json({ ok: false, error: 'username is required' }, { status: 400 })
  }

  const session = await db.findUnique(username)
  if (!session) {
    return NextResponse.json({ ok: false, error: 'No active session for this user. Login first.' }, { status: 404 })
  }

  try {
    const res = await fetch(`${BASE}/explore/level_progress`, {
      headers: {
        'Cookie': session.cookie,
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
      },
      redirect: 'manual',
      cache: 'no-store',
    })

    if (res.status === 302 || res.status === 301) {
      await db.update(username, { status: 'expired' })
      return NextResponse.json({ ok: false, error: 'Session expired — please re-login', username }, { status: 401 })
    }

    if (res.status >= 400) {
      const text = await res.text().catch(() => '')
      return NextResponse.json(
        { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` },
        { status: 502 },
      )
    }

    const html = await res.text()
    const levelMatch = html.match(/level-progress-level-number[^>]*>(\d+)/)
    const pointsMatch = html.match(/level-progress-points[^>]*style="width:\s*([\d.]+)%/)
    const hoursMatch = html.match(/([\d]+)\s*Hours?\s*Remaining/i)
    const referredMatch = html.match(/Total Referred:\s*(\d+)/i)

    const progress = {
      level: levelMatch ? parseInt(levelMatch[1], 10) : null,
      pointPct: pointsMatch ? parseFloat(pointsMatch[1]) : null,
      hoursLeft: hoursMatch ? parseInt(hoursMatch[1], 10) : null,
      referred: referredMatch ? parseInt(referredMatch[1], 10) : null,
      fetchedAt: new Date().toISOString(),
    }

    await db.update(username, {
      ...progress,
      status: 'active',
    })

    return NextResponse.json({ ok: true, username, progress })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: `Failed: ${msg}` }, { status: 502 })
  }
}
