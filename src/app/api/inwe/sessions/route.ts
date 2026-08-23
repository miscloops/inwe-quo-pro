// GET /api/inwe/sessions — list all stored sessions
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  const sessions = await db.inweSession.findMany({
    orderBy: { createdAt: 'desc' },
  })

  const safe = sessions.map(s => ({
    id: s.id,
    username: s.username,
    status: s.status,
    level: s.level,
    pointPct: s.pointPct,
    hoursLeft: s.hoursLeft,
    referred: s.referred,
    hasAuthToken: !!s.authToken,
    lastChecked: s.lastChecked.toISOString(),
    createdAt: s.createdAt.toISOString(),
  }))

  return NextResponse.json({ sessions: safe })
}
