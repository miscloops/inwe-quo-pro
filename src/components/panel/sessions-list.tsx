'use client'
import { useState, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, RefreshCw, LogOut, Trophy, Clock, TrendingUp, Users, CheckCircle2, XCircle, AlertCircle, Coins } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import { getUserName } from '@/lib/user-pin'
import { safeJsonResponse } from '@/lib/safe-json-client'

interface Session { id: string; username: string; status: string; level: number | null; pointPct: number | null; hoursLeft: number | null; referred: number | null; hasAuthToken: boolean; lastChecked: string | null; createdAt: string }

async function fetchBalance(username: string): Promise<number | null> {
  const name = getUserName()
  try {
    const r = await fetch('/api/inwe/send-gift', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(name ? { 'x-user-name': name } : {}) },
      body: JSON.stringify({ action: 'balance', username }),
    })
    const j = await safeJsonResponse(r)
    if (!r.ok || !j?.ok) return null
    return typeof j.balance === 'number' ? j.balance : null
  } catch { return null }
}

async function refreshProgress(username: string) {
  const name = getUserName()
  const r = await fetch(`/api/inwe/level_progress?username=${encodeURIComponent(username)}`, {
    headers: name ? { 'x-user-name': name } : {},
  })
  const j = await safeJsonResponse(r)
  if (!r.ok || !j?.ok) throw new Error(j?.error ?? 'Failed')
  return j
}

async function logout(username: string) {
  const name = getUserName()
  const r = await fetch('/api/inwe/logout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(name ? { 'x-user-name': name } : {}) },
    body: JSON.stringify({ username }),
  })
  if (!r.ok) throw new Error('failed')
  return safeJsonResponse(r)
}

async function logoutAll() {
  const name = getUserName()
  const r = await fetch('/api/inwe/logout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(name ? { 'x-user-name': name } : {}) },
    body: JSON.stringify({ username: '*' }),
  })
  if (!r.ok) throw new Error('failed')
  return safeJsonResponse(r)
}

interface SessionsListProps {
  sessions: Session[]
  isLoading: boolean
  refreshKey: number
  selectedUsername: string | null
  onSelectUsername: (u: string) => void
  onSessionsChanged: () => void
}

export function SessionsList({ sessions, isLoading, selectedUsername, onSelectUsername, onSessionsChanged }: SessionsListProps) {
  const qc = useQueryClient()
  const refreshOne = useMutation({
    mutationFn: (username: string) => refreshProgress(username),
    onSuccess: (_, username) => { qc.invalidateQueries({ queryKey: ['sessions'] }); onSessionsChanged(); toast.success(`Refreshed ${username}`) },
    onError: (e, username) => toast.error(`Failed: ${e instanceof Error ? e.message : 'unknown'}`, { description: `for ${username}` }),
  })
  const refreshAll = useMutation({
    mutationFn: async () => { for (const s of sessions) { try { await refreshProgress(s.username) } catch {} } },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sessions'] }); onSessionsChanged(); toast.success('Refreshed all') },
  })
  const logoutOne = useMutation({
    mutationFn: (username: string) => logout(username),
    onSuccess: (_, username) => { qc.invalidateQueries({ queryKey: ['sessions'] }); onSessionsChanged(); toast.success(`Logged out ${username}`) },
  })
  const logoutAllM = useMutation({
    mutationFn: logoutAll,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sessions'] }); onSessionsChanged(); toast.success('Cleared all') },
  })

  return (
    <div className="border-2 border-[#666] bg-[#fff]">
      <div className="flex items-center justify-between border-b border-[#666] px-4 py-2 bg-[#e8e8e0]">
        <h2 className="text-sm font-bold">2. Logged-in Accounts ({sessions.length})</h2>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => refreshAll.mutate()} disabled={refreshAll.isPending || sessions.length === 0}>
            {refreshAll.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            <span className="ml-1 hidden sm:inline">Refresh all</span>
          </Button>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-destructive hover:text-destructive" onClick={() => { if (confirm('Log out ALL?')) logoutAllM.mutate() }} disabled={logoutAllM.isPending || sessions.length === 0}>
            <LogOut className="h-3.5 w-3.5" /><span className="ml-1 hidden sm:inline">Logout all</span>
          </Button>
        </div>
      </div>
      <div className="p-3">
        {isLoading ? (
          <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center text-sm text-[#666]">
            <AlertCircle className="mb-2 h-8 w-8 opacity-40" />No accounts logged in yet.
            <p className="text-xs mt-1">Paste your id/password pairs above.</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {sessions.map(s => (
              <SessionRow
                key={s.id}
                session={s}
                isSelected={selectedUsername === s.username}
                onSelect={() => onSelectUsername(s.username)}
                onRefresh={() => refreshOne.mutate(s.username)}
                onLogout={() => { if (confirm(`Log out ${s.username}?`)) logoutOne.mutate(s.username) }}
                refreshing={refreshOne.isPending && refreshOne.variables === s.username}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function SessionRow({ session, isSelected, onSelect, onRefresh, onLogout, refreshing }: {
  session: Session
  isSelected: boolean
  onSelect: () => void
  onRefresh: () => void
  onLogout: () => void
  refreshing: boolean
}) {
  const status = session.status
  const statusColor = status === 'active' ? 'text-green-600' : status === 'expired' ? 'text-orange-500' : 'text-red-500'
  const StatusIcon = status === 'active' ? CheckCircle2 : status === 'expired' ? AlertCircle : XCircle
  const [balance, setBalance] = useState<number | null>(null)
  const [balanceLoading, setBalanceLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (status !== 'active') return
      setBalanceLoading(true)
      const b = await fetchBalance(session.username)
      if (!cancelled) { setBalance(b); setBalanceLoading(false) }
    }
    load()
    const t = setInterval(load, 30_000)
    return () => { cancelled = true; clearInterval(t) }
  }, [session.username, status, session.lastChecked])

  return (
    <Card className={`p-3 cursor-pointer transition-all ${isSelected ? 'border-[#0066cc] border-2 bg-[#f0f8ff]' : 'hover:border-[#0066cc]/40'}`}>
      <div className="flex items-center gap-3" onClick={onSelect}>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#e8e8e0] text-sm font-bold text-[#0066cc]">
          {session.username.slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold">{session.username}</p>
            <StatusIcon className={`h-3.5 w-3.5 ${statusColor}`} />
            {session.hasAuthToken && <Badge variant="secondary" className="px-1 py-0 text-[9px]">auth-tok</Badge>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#666]">
            <span className="flex items-center gap-1"><Trophy className="h-3 w-3" />Level {session.level ?? '—'}</span>
            <span className="flex items-center gap-1 font-semibold text-yellow-600"><Coins className="h-3 w-3" />{balanceLoading ? '…' : balance !== null ? `${balance.toLocaleString()} C` : '— C'}</span>
            {session.pointPct !== null && <span className="flex items-center gap-1"><TrendingUp className="h-3 w-3" />{session.pointPct.toFixed(1)}%</span>}
            {session.hoursLeft !== null && session.hoursLeft > 0 && <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{session.hoursLeft}h left</span>}
            {session.referred !== null && session.referred > 0 && <span className="flex items-center gap-1"><Users className="h-3 w-3" />{session.referred} refs</span>}
          </div>
          {session.pointPct !== null && (
            <div className="mt-1.5 h-1.5 overflow-hidden bg-[#e8e8e0]">
              <div className={`h-full ${session.pointPct >= 99 ? 'bg-orange-500' : 'bg-[#0066cc]'}`} style={{ width: `${Math.min(session.pointPct, 100)}%` }} />
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={(e) => { e.stopPropagation(); onRefresh() }} disabled={refreshing}>
            {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={(e) => { e.stopPropagation(); onLogout() }}>
            <LogOut className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </Card>
  )
}
