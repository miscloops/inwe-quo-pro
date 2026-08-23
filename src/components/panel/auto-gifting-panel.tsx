'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Play, Square, Shield, Bot, Activity, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { toast } from 'sonner'

// Hardcoded list of 5 gift commands to cycle through.
// Format on inweapp: /gift <recipient_username> <gift_name>
const GIFT_COMMANDS = [
  'neko',
  'ganja',
  'fly',
  'muri',
  'best wishes',
] as const

interface Session {
  id: string
  username: string
  status: string
  level: number | null
  pointPct: number | null
  hoursLeft: number | null
  referred: number | null
  hasAuthToken: boolean
  lastChecked: string | null
  createdAt: string
}

interface LogEntry {
  id: string
  ts: string
  kind: 'info' | 'success' | 'skip' | 'error' | 'guard'
  msg: string
}

const GUARD_THRESHOLD = 99

async function fetchProgress(username: string): Promise<number> {
  const r = await fetch(`/api/inwe/level_progress?username=${encodeURIComponent(username)}`)
  const j = await r.json()
  if (!r.ok || !j.ok) throw new Error(j.error ?? 'failed')
  return j.progress?.pointPct ?? 0
}

interface AutoGiftingPanelProps {
  sessions: Session[]
  refreshSessions: () => void
}

export function AutoGiftingPanel({ sessions, refreshSessions }: AutoGiftingPanelProps) {
  const qc = useQueryClient()
  const [sender, setSender] = useState<string>('')
  const [running, setRunning] = useState(false)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [pinDialogOpen, setPinDialogOpen] = useState(false)
  const [pin, setPin] = useState('')
  const [pendingStart, setPendingStart] = useState(false)
  const [retryCount, setRetryCount] = useState(0)

  // Refs for the loop
  const runningRef = useRef(false)
  const pinRef = useRef('')

  // Auto-select first session as sender (derive, don't effect-setState)
  const effectiveSender = sender && sessions.find(s => s.username === sender)
    ? sender
    : (sessions[0]?.username ?? '')

  useEffect(() => { runningRef.current = running }, [running])
  useEffect(() => { pinRef.current = pin }, [pin])

  const log = useCallback((kind: LogEntry['kind'], msg: string) => {
    const entry: LogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ts: new Date().toLocaleTimeString(),
      kind, msg,
    }
    setLogs(prev => [entry, ...prev].slice(0, 200))
  }, [])

  const startBot = () => {
    if (!effectiveSender) {
      toast.error('Select a sender account first')
      return
    }
    if (sessions.length < 2) {
      toast.error('Need at least 2 logged-in IDs (sender + recipient)')
      return
    }
    setPinDialogOpen(true)
    setPendingStart(true)
  }

  const confirmStartWithPin = async () => {
    if (pin.length < 4) {
      toast.error('Password must be at least 4 characters')
      return
    }
    setPinDialogOpen(false)
    setPendingStart(false)

    const recipients = sessions.filter(s => s.username !== effectiveSender).map(s => s.username)

    setRunning(true)
    log('info', `▶ Starting bot — entering room "QUO PRO"...`)
    log('info', `Sender: ${effectiveSender}`)
    log('info', `Recipients: ${recipients.length} (${recipients.join(', ')})`)
    log('info', `Gift commands: ${GIFT_COMMANDS.length} (cycling)`)
    log('guard', `Gifting Guard: ACTIVE — will skip IDs at ≥${GUARD_THRESHOLD}% progress`)

    // Call the auto-gift API — bot connects to socket.inweapp.com, joins room 42081, starts gifting
    try {
      const r = await fetch('/api/inwe/auto-gift', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'start',
          sender: effectiveSender,
          usernames: sessions.map(s => s.username),
          gifts: GIFT_COMMANDS.map((name, i) => ({ id: `cmd-${i}`, name, price: 3 })),
          password: pin,
          force_relogin: retryCount > 0,
        }),
      })
      const j = await r.json()

      const senderJoined = j.joined?.includes(effectiveSender) ?? false
      const senderFailed = j.failed?.includes(effectiveSender) ?? false

      if (!senderJoined || senderFailed || j.status === 'failed') {
        setRetryCount(c => c + 1)
        log('error', `✗ Failed to enter chatroom`)
        log('error', `Reason: ${j.message || 'sender did not join successfully'}`)
        if (j.failed?.length) {
          log('error', `Failed accounts: ${j.failed.join(', ')}`)
        }
        log('info', `→ Click "Start Auto Gifting" again — the sender will be re-logged in and then re-entered into QUO PRO`)
        setRunning(false)
        toast.error('Failed to enter chatroom — click Start again to auto re-login and retry')
        return
      }

      setRetryCount(0)
      log('success', `✓ Entered to Quo Pro.. and gifting started`)
      if (j.joined?.length) {
        log('success', `Joined live: ${j.joined.join(', ')}`)
      }
      if (j.failed?.length) {
        log('skip', `Could not join: ${j.failed.join(', ')}`)
      }
      toast.success('Entered to Quo Pro.. and gifting started')
      startStatusPolling()
    } catch (e) {
      log('error', `Bot service error: ${e instanceof Error ? e.message : String(e)}`)
      setRunning(false)
      toast.error('Bot service error — check the panel log')
    }
  }

  // Poll the bot service every 1.5s for live log updates
  const stopStatusPollingRef = useRef<() => void>(() => {})
  const startStatusPolling = useCallback(() => {
    let cancelled = false
    stopStatusPollingRef.current = () => { cancelled = true }

    const poll = async () => {
      if (cancelled) return
      try {
        const r = await fetch('/api/inwe/auto-gift?action=status', { method: 'GET' })
        const j = await r.json()
        if (j.ok && j.log) {
          for (const entry of j.log) {
            const exists = logs.some((l) => l.ts === entry.ts && l.msg === entry.msg)
            if (!exists) {
              log(entry.kind, entry.msg)
            }
          }
        }
        if (!j.running) {
          setRunning(false)
          log('info', '■ Bot stopped')
          return
        }
      } catch {}
      if (!cancelled) setTimeout(poll, 1500)
    }
    setTimeout(poll, 500)
  }, [logs, log])

  const stopBot = async () => {
    setRunning(false)
    stopStatusPollingRef.current()
    log('info', '■ Bot stopped by user')
    try {
      await fetch('/api/inwe/auto-gift', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' }),
      })
    } catch {}
  }

  // Cleanup
  useEffect(() => {
    return () => { runningRef.current = false }
  }, [])

  const recipients = sessions.filter(s => s.username !== effectiveSender)
  const guardedCount = recipients.filter(r => (r.pointPct ?? 0) >= GUARD_THRESHOLD).length
  const activeCount = recipients.length - guardedCount

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      <div className="border-b border-border px-5 py-3">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">3. Auto Gifting Bot</h2>
          {running && (
            <Badge className="ml-1 bg-green-500/15 text-green-600 dark:text-green-500 border-green-500/30 text-[10px]">
              <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
              RUNNING
            </Badge>
          )}
          {!running && retryCount > 0 && (
            <Badge className="ml-1 bg-orange-500/15 text-orange-600 dark:text-orange-500 border-orange-500/30 text-[10px]">
              <AlertTriangle className="mr-1 h-2.5 w-2.5" />
              RETRY #{retryCount} — next Start will re-login sender
            </Badge>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Bot enters QUO PRO chatroom and cycles <strong className="text-foreground">5 hardcoded gift commands</strong> (neko, ganja, fly, muri, best wishes) round-robin to all other logged-in IDs. 4-second interval between gifts to avoid flooding.
        </p>
      </div>

      <div className="p-5 space-y-4">
        {/* Row 1: Sender + Start button */}
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <div className="space-y-1.5">
            <Label className="text-xs">Sender account (from logged-in IDs)</Label>
            <Select value={effectiveSender} onValueChange={setSender} disabled={running}>
              <SelectTrigger className="bg-secondary/40">
                <SelectValue placeholder="Select sender..." />
              </SelectTrigger>
              <SelectContent>
                {sessions.map(s => (
                  <SelectItem key={s.id} value={s.username}>
                    {s.username} {s.level !== null ? `(L${s.level})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:self-end">
            {running ? (
              <Button onClick={stopBot} variant="destructive" className="w-full sm:w-auto">
                <Square className="mr-2 h-4 w-4" /> Stop Bot
              </Button>
            ) : (
              <Button
                onClick={startBot}
                disabled={pendingStart || sessions.length < 2}
                className="w-full sm:w-auto bg-gradient-to-r from-primary to-blue-600 text-white"
              >
                <Play className="mr-2 h-4 w-4" /> Start Auto Gifting
              </Button>
            )}
          </div>
        </div>

        {/* Recipients summary */}
        {effectiveSender && (
          <div className="grid gap-2 sm:grid-cols-3 text-xs">
            <div className="rounded-lg border border-border/60 bg-secondary/30 p-2.5">
              <p className="text-muted-foreground">Recipients</p>
              <p className="font-semibold tabular-nums">{activeCount} active / {recipients.length} total</p>
            </div>
            <div className="rounded-lg border border-border/60 bg-secondary/30 p-2.5">
              <p className="text-muted-foreground">Guarded (≥{GUARD_THRESHOLD}%)</p>
              <p className="font-semibold tabular-nums text-orange-500">{guardedCount}</p>
            </div>
            <div className="rounded-lg border border-border/60 bg-secondary/30 p-2.5">
              <p className="text-muted-foreground">Gift commands</p>
              <p className="font-semibold tabular-nums">{GIFT_COMMANDS.length} (cycling)</p>
            </div>
          </div>
        )}

        {/* Gift commands list */}
        <div className="space-y-1.5">
          <Label className="text-xs">Gift commands the bot will cycle through</Label>
          <div className="rounded-lg border border-border/60 bg-secondary/20 p-2.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs font-mono">
              {GIFT_COMMANDS.map((cmd, i) => (
                <div key={cmd} className="flex items-center gap-2 rounded bg-card px-2 py-1.5">
                  <span className="text-muted-foreground w-5">#{i + 1}</span>
                  <code className="text-primary">/gift &lt;username&gt; {cmd}</code>
                </div>
              ))}
            </div>
            <p className="mt-1.5 text-[10px] text-muted-foreground">
              Each gift sends to the next recipient in round-robin order. Username is replaced with each recipient&apos;s username at runtime.
            </p>
          </div>
        </div>

        {/* Gifting Guard banner */}
        <div className={`flex items-start gap-2 rounded-lg border p-3 text-xs ${
          running
            ? 'border-green-500/40 bg-green-500/5'
            : 'border-orange-500/30 bg-orange-500/5'
        }`}>
          <Shield className={`h-4 w-4 shrink-0 mt-0.5 ${
            running ? 'text-green-500' : 'text-orange-500'
          }`} />
          <div>
            <p className="font-semibold">
              Gifting Guard: {running ? 'ACTIVE' : 'STANDBY'}
            </p>
            <p className="text-muted-foreground mt-0.5">
              The bot will <strong>never</strong> send a gift to an ID whose level progress is at {GUARD_THRESHOLD}% or higher. Once the ID levels up (progress resets), gifting resumes automatically.
            </p>
          </div>
        </div>

        {/* Live log */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <Label className="text-xs flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5" /> Bot activity log
            </Label>
            {logs.length > 0 && (
              <button
                onClick={() => setLogs([])}
                className="text-[10px] text-muted-foreground hover:text-foreground"
              >
                Clear
              </button>
            )}
          </div>
          <div className="max-h-48 overflow-y-auto rounded-lg border border-border/60 bg-background/40 p-2.5 font-mono text-[11px] space-y-0.5">
            {logs.length === 0 ? (
              <p className="text-muted-foreground italic">No activity yet. Click Start Auto Gifting to begin.</p>
            ) : (
              logs.map(l => (
                <div key={l.id} className="flex items-start gap-2">
                  <span className="text-muted-foreground shrink-0">{l.ts}</span>
                  <span className="shrink-0">
                    {l.kind === 'success' && <CheckCircle2 className="h-3 w-3 text-green-500" />}
                    {l.kind === 'skip' && <Shield className="h-3 w-3 text-orange-500" />}
                    {l.kind === 'error' && <XCircle className="h-3 w-3 text-red-500" />}
                    {l.kind === 'guard' && <Shield className="h-3 w-3 text-blue-500" />}
                    {l.kind === 'info' && <Activity className="h-3 w-3 text-muted-foreground" />}
                  </span>
                  <span className={
                    l.kind === 'success' ? 'text-green-600 dark:text-green-400' :
                    l.kind === 'skip' ? 'text-orange-600 dark:text-orange-400' :
                    l.kind === 'error' ? 'text-red-600 dark:text-red-400' :
                    l.kind === 'guard' ? 'text-blue-600 dark:text-blue-400' :
                    'text-foreground'
                  }>{l.msg}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Recipients status (live) */}
        {recipients.length > 0 && (
          <div>
            <Label className="text-xs">Recipients (live status)</Label>
            <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
              {recipients.map(r => {
                const pct = r.pointPct ?? 0
                const guarded = pct >= GUARD_THRESHOLD
                return (
                  <div key={r.id} className={`flex items-center gap-2 rounded-md border p-2 text-xs ${
                    guarded ? 'border-orange-500/40 bg-orange-500/5' : 'border-border/60 bg-secondary/20'
                  }`}>
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-primary/20 to-blue-500/20 text-[10px] font-bold text-primary">
                      {r.username.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{r.username}</p>
                      <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-secondary">
                        <div
                          className={`h-full rounded-full transition-all ${
                            guarded ? 'bg-orange-500' : 'bg-gradient-to-r from-primary to-blue-500'
                          }`}
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`font-semibold tabular-nums ${guarded ? 'text-orange-500' : ''}`}>
                        {pct.toFixed(1)}%
                      </p>
                      {r.level !== null && <p className="text-[9px] text-muted-foreground">L{r.level}</p>}
                    </div>
                    {guarded && (
                      <Shield className="h-3.5 w-3.5 text-orange-500 shrink-0" title="Guarded — bot will skip" />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Password dialog */}
      <Dialog open={pinDialogOpen} onOpenChange={(o) => {
        setPinDialogOpen(o)
        if (!o && pendingStart) setPendingStart(false)
      }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" />
              Start Auto Gifting
            </DialogTitle>
            <DialogDescription>
              All logged-in IDs will enter the <strong className="text-foreground">QUO PRO</strong> chatroom and the bot will send 5 gift commands (neko, ganja, fly, muri, best wishes) round-robin at 4-second intervals. Enter the sender&apos;s password below (used to re-login if any session is expired — kept in-memory only, never stored).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Sender</Label>
              <p className="text-sm font-medium">{effectiveSender}</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Sender&apos;s password (used for re-login if session expired)</Label>
              <Input
                type="password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="password"
                className="font-mono"
                autoFocus
              />
            </div>
            <div className="flex items-start gap-2 rounded-md border border-orange-500/30 bg-orange-500/5 p-2 text-[11px]">
              <AlertTriangle className="h-3.5 w-3.5 text-orange-500 shrink-0 mt-0.5" />
              <p className="text-muted-foreground">
                The bot will send real gift commands through chat.inweapp.com&apos;s Socket.IO. Make sure you have permission to operate these accounts.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setPinDialogOpen(false); setPendingStart(false) }}>
              Cancel
            </Button>
            <Button onClick={confirmStartWithPin} disabled={pin.length < 4}>
              <Play className="mr-2 h-4 w-4" /> Start Bot
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
