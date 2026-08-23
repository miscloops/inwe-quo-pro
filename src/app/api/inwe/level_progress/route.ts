// GET /api/inwe/level_progress?username=xxx
// Fetches /explore/level_progress on chat.inweapp.com using the stored session
// and parses out: current level number, point progress %, hours remaining, total referred

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

const BASE = 'https://chat.inweapp.com'
const UA = 'Mozilla/5.0 (compatible; InweGiftingPanel/1.0)'

interface LevelProgress {
  level: number | null
  pointPct: number | null
  hoursLeft: number | null
  referred: number | null
  fetchedAt: string
}

async function fetchLevelProgress(cookies: string): Promise<LevelProgress> {
  const res = await fetch(`${BASE}/explore/level_progress`, {
    headers: {
      'Cookie': cookies,
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml',
    },
    redirect: 'manual',
    cache: 'no-store',
  })

  if (res.status === 302 || res.status === 301) {
    // Redirected → session expired
    throw new Error('SESSION_EXPIRED')
  }
  if (res.status >= 400) {
    throw new Error(`HTTP_${res.status}`)
  }

  const html = await res.text()

  // Parse level number
  const levelMatch = html.match(/level-progress-level-number[^>]*>(\d+)/)
  // Point progress: extract from width: X.X% on the .level-progress-points element
  const pointsMatch = html.match(/level-progress-points[^>]*style="width:\s*([\d.]+)%/)
  // Hours remaining: extract from text like "X Hours Remaining"
  const hoursMatch = html.match(/([\d]+)\s*Hours?\s*Remaining/i)
  // Total referred: extract from "Total Referred: X"
  const referredMatch = html.match(/Total Referred:\s*(\d+)/i)

  return {
    level: levelMatch ? parseInt(levelMatch[1], 10) : null,
    pointPct: pointsMatch ? parseFloat(pointsMatch[1]) : null,
    hoursLeft: hoursMatch ? parseInt(hoursMatch[1], 10) : null,
    referred: referredMatch ? parseInt(referredMatch[1], 10) : null,
    fetchedAt: new Date().toISOString(),
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const username = searchParams.get('username')

  if (!username) {
    return NextResponse.json({ ok: false, error: 'username is required' }, { status: 400 })
  }

  const session = await db.inweSession.findUnique({ where: { username } })
  if (!session) {
    return NextResponse.json({ ok: false, error: 'No active session for this user. Login first.' }, { status: 404 })
  }

  try {
    const progress = await fetchLevelProgress(session.cookie)
    const updated = await db.inweSession.update({
      where: { username },
      data: {
        level: progress.level,
        pointPct: progress.pointPct,
        hoursLeft: progress.hoursLeft,
        referred: progress.referred,
        lastChecked: new Date(),
        status: 'active',
      },
    })
    return NextResponse.json({ ok: true, username, progress, session: updated })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg === 'SESSION_EXPIRED') {
      await db.inweSession.update({
        where: { username },
        data: { status: 'expired' },
      })
      return NextResponse.json({ ok: false, error: 'Session expired — please re-login', username }, { status: 401 })
    }
    return NextResponse.json({ ok: false, error: `Failed to fetch level progress: ${msg}` }, { status: 502 })
  }
}
