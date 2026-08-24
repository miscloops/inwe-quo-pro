import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  const sessions = await db.findMany()
  const safe = sessions.map(s => ({
    id: s.id,
    username: s.username,
    status: s.status,
    level: s.level,
    pointPct: s.pointPct,
    hoursLeft: s.hoursLeft,
    referred: s.referred,
    hasAuthToken: !!s.authToken,
    lastChecked: s.lastChecked,
    createdAt: s.createdAt,
  }))
  return NextResponse.json({ sessions: safe })
}
