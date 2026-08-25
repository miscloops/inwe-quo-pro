'use client'
import { useState, useRef, useCallback, useEffect } from 'react'
import { Play, Square, Shield, Bot, Activity, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { safeJsonResponse } from '@/lib/safe-json-client'

const GIFT_COMMANDS = ['neko', 'ganja', 'fly', 'muri', 'best wishes'] as const
const GUARD_THRESHOLD = 100

interface Session { id: string; username: string; status: string; level: number | null; pointPct: number | null; hoursLeft: number | null; referred: number | null; hasAuthToken: boolean; lastChecked: string | null; createdAt: string }
interface LogEntry { id: string; ts: string; kind: 'info' | 'success' | 'skip' | 'error' | 'guard'; msg: string }
interface AutoGiftingPanelProps { sessions: Session[]; refreshSessions: () => void }

export function AutoGiftingPanel({ sessions }: AutoGiftingPanelProps) {
  const [sender, setSender] = useState('')
  const [running, setRunning] = useState(false)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [pinDialogOpen, setPinDialogOpen] = useState(false)
  const [pin, setPin] = useState('')
  const [pendingStart, setPendingStart] = useState(false)
  const [retryCount, setRetryCount] = useState(0)
  const runningRef = useRef(false)
  const pinRef = useRef('')
  const logsRef = useRef<LogEntry[]>([])
  const effectiveSender = sender && sessions.find(s => s.username === sender) ? sender : (sessions[0]?.username ?? '')
  useEffect(() => { runningRef.current = running }, [running])
  useEffect(() => { pinRef.current = pin }, [pin])
  useEffect(() => { logsRef.current = logs }, [logs])
  const log = useCallback((kind: LogEntry['kind'], msg: string) => { const entry: LogEntry = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ts: new Date().toLocaleTimeString(), kind, msg }; setLogs(prev => [entry, ...prev].slice(0, 200)) }, [])
  const startBot = () => { if (!effectiveSender) { toast.error('Select a sender'); return } if (sessions.length < 2) { toast.error('Need at least 2 logged-in IDs'); return } setPinDialogOpen(true); setPendingStart(true) }
  const confirmStartWithPin = async () => {
    if (pin.length < 4) { toast.error('Password must be at least 4 characters'); return }
    setPinDialogOpen(false); setPendingStart(false)
    const recipients = sessions.filter(s => s.username !== effectiveSender).map(s => s.username)
    setRunning(true)
    log('info', `▶ Starting bot — entering room "QUO PRO"...`)
    log('info', `Sender: ${effectiveSender}`)
    log('info', `Recipients: ${recipients.length} (${recipients.join(', ')})`)
    log('info', `Gift commands: ${GIFT_COMMANDS.length} (cycling)`)
    log('guard', `Gifting Guard: ACTIVE — will skip IDs at ≥${GUARD_THRESHOLD}% progress`)
    try {
      const r = await fetch('/api/inwe/auto-gift', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'start', sender: effectiveSender, usernames: sessions.map(s => s.username), gifts: GIFT_COMMANDS.map((name, i) => ({ id: `cmd-${i}`, name, price: 3 })), password: pin, force_relogin: true }) })
      const j = await safeJsonResponse(r)
      const senderJoined = j?.joined?.includes(effectiveSender) ?? false
      const senderFailed = j?.failed?.includes(effectiveSender) ?? false
      if (!senderJoined || senderFailed || j?.status === 'failed') {
        setRetryCount(c => c + 1)
        log('error', `✗ Failed to enter chatroom`)
        log('error', `Reason: ${j?.message || j?.error || 'sender did not join'}`)
        if (j?.failed?.length) log('error', `Failed accounts: ${j.failed.join(', ')}`)
        log('info', `→ Click Start again — sender will be re-logged in and re-entered into QUO PRO`)
        setRunning(false); toast.error('Failed to enter chatroom — click Start again'); return
      }
      setRetryCount(0)
      log('success', `✓ Entered to Quo Pro.. and gifting started`)
      if (j?.joined?.length) log('success', `Joined live: ${j.joined.join(', ')}`)
      if (j?.failed?.length) log('skip', `Could not join: ${j.failed.join(', ')}`)
      toast.success('Entered to Quo Pro.. and gifting started')
      startGiftLoop()
    } catch (e) { log('error', `Bot error: ${e instanceof Error ? e.message : String(e)}`); setRunning(false); toast.error('Bot error — check the panel log') }
  }
  const stopGiftLoopRef = useRef<() => void>(() => {})
  const pinRef2 = useRef('')
  useEffect(() => { pinRef2.current = pin }, [pin])
  const startGiftLoop = useCallback(() => {
    let cancelled = false
    let consecutiveErrors = 0
    stopGiftLoopRef.current = () => { cancelled = true }

    const sendNextGift = async () => {
      if (cancelled || !runningRef.current) return

      try {
        const r = await fetch('/api/inwe/auto-gift', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'start',
            sender: effectiveSender,
            usernames: sessions.map(s => s.username),
            gifts: GIFT_COMMANDS.map((name, i) => ({ id: `cmd-${i}`, name, price: 3 })),
            password: pinRef2.current,
            force_relogin: true,
          }),
        })
        const j = await safeJsonResponse(r)
        if (!j) { consecutiveErrors++; if (consecutiveErrors >= 3) { log('error', '3 consecutive failures — stopping'); setRunning(false); return } if (!cancelled && runningRef.current) setTimeout(sendNextGift, 6000); return }

        if (j.ok && j.log) {
          for (const entry of j.log) {
            const exists = logsRef.current.some(l => l.ts === entry.ts && l.msg === entry.msg)
            if (!exists) log(entry.kind, entry.msg)
          }
        }

        if (j.status === 'all_guarded') {
          consecutiveErrors = 0
          if (!cancelled && runningRef.current) {
            setTimeout(sendNextGift, 60000)
          }
          return
        }

        if (j.status === 'failed') {
          consecutiveErrors++
          log('error', `✗ Failed: ${j.message || 'unknown error'}`)

          if (consecutiveErrors >= 3) {
            log('error', '3 consecutive failures — stopping bot')
            setRunning(false)
            toast.error('Bot stopped after 3 failures')
            return
          }
          if (!cancelled && runningRef.current) {
            setTimeout(sendNextGift, 6000)
          }
          return
        }

        consecutiveErrors = 0
      } catch (e) {
        consecutiveErrors++
        log('error', `Gift loop error: ${e instanceof Error ? e.message : String(e)}`)

        if (consecutiveErrors >= 3) {
          log('error', '3 consecutive failures — stopping bot')
          setRunning(false)
          return
        }
      }

      if (!cancelled && runningRef.current) {
        setTimeout(sendNextGift, 4000)
      }
    }

    setTimeout(sendNextGift, 4000)
  }, [effectiveSender, sessions, log])

  const stopProgressRefreshRef = useRef<() => void>(() => {})
  useEffect(() => {
    if (!running) {
      stopProgressRefreshRef.current()
      return
    }
    let cancelled = false
    stopProgressRefreshRef.current = () => { cancelled = true }

    const refreshProgress = async () => {
      if (cancelled || !runningRef.current) return
      for (const s of sessions) {
        if (s.username === effectiveSender) continue
        try {
          await fetch(`/api/inwe/level_progress?username=${encodeURIComponent(s.username)}`)
        } catch {}
      }
      if (effectiveSender) {
        try { await fetch(`/api/inwe/level_progress?username=${encodeURIComponent(effectiveSender)}`) } catch {}
      }
      if (!cancelled && runningRef.current) {
        setTimeout(refreshProgress, 60000)
      }
    }
    const t = setTimeout(refreshProgress, 60000)
    return () => { clearTimeout(t); cancelled = true }
  }, [running, sessions, effectiveSender])

  const stopBot = async () => {
    setRunning(false)
    stopGiftLoopRef.current()
    log('info', '■ Bot stopped by user')
    try { await fetch('/api/inwe/auto-gift', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'stop' }) }) } catch {}
  }
  useEffect(() => { return () => { runningRef.current = false } }, [])
  const recipients = sessions.filter(s => s.username !== effectiveSender)
  const guardedCount = recipients.filter(r => (r.pointPct ?? 0) >= GUARD_THRESHOLD).length
  const activeCount = recipients.length - guardedCount

  return (
    <div className="border-2 border-[#666] bg-[#fff]">
      <div className="border-b border-[#666] px-4 py-2 bg-[#e8e8e0]">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-[#0066cc]" /><h2 className="text-sm font-bold">3. Auto Gifting Bot</h2>
          {running && <Badge className="ml-1 bg-green-100 text-green-700 border-green-400 text-[10px]"><span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />RUNNING</Badge>}
          {!running && retryCount > 0 && <Badge className="ml-1 bg-orange-100 text-orange-700 border-orange-400 text-[10px]"><AlertTriangle className="mr-1 h-2.5 w-2.5" />RETRY #{retryCount}</Badge>}
        </div>
        <p className="mt-0.5 text-[10px] text-[#666]">Bot enters QUO PRO chatroom and cycles 5 gift commands (neko, ganja, fly, muri, best wishes) round-robin at 4-second intervals.</p>
      </div>
      <div className="p-4 space-y-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <div className="space-y-1.5"><Label className="text-xs">Sender account</Label><Select value={effectiveSender} onValueChange={setSender} disabled={running}><SelectTrigger className="bg-[#f5f5f0]"><SelectValue placeholder="Select sender..." /></SelectTrigger><SelectContent>{sessions.map(s => <SelectItem key={s.id} value={s.username}>{s.username} {s.level !== null ? `(L${s.level})` : ''}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1.5 sm:self-end">{running ? <Button onClick={stopBot} variant="destructive" className="w-full sm:w-auto"><Square className="mr-2 h-4 w-4" /> Stop</Button> : <Button onClick={startBot} disabled={pendingStart || sessions.length < 2} className="w-full sm:w-auto bg-[#0066cc] text-white hover:bg-[#0055aa]"><Play className="mr-2 h-4 w-4" /> Start Auto Gifting</Button>}</div>
        </div>
        {effectiveSender && (
          <div className="grid gap-2 sm:grid-cols-3 text-xs">
            <div className="border border-[#999] bg-[#f5f5f0] p-2"><p className="text-[#666]">Recipients</p><p className="font-semibold tabular-nums">{activeCount} active / {recipients.length} total</p></div>
            <div className="border border-[#999] bg-[#f5f5f0] p-2"><p className="text-[#666]">Guarded (≥{GUARD_THRESHOLD}%)</p><p className="font-semibold tabular-nums text-orange-500">{guardedCount}</p></div>
            <div className="border border-[#999] bg-[#f5f5f0] p-2"><p className="text-[#666]">Gift commands</p><p className="font-semibold tabular-nums">{GIFT_COMMANDS.length} (cycling)</p></div>
          </div>
        )}
        <div className="space-y-1.5">
          <Label className="text-xs">Gift commands the bot will cycle through</Label>
          <div className="border border-[#999] bg-[#f5f5f0] p-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-xs font-mono">
              {GIFT_COMMANDS.map((cmd, i) => <div key={cmd} className="flex items-center gap-2 bg-[#fff] px-2 py-1 border border-[#ccc]"><span className="text-[#666] w-5">#{i + 1}</span><code className="text-[#0066cc]">/gift &lt;username&gt; {cmd}</code></div>)}
            </div>
          </div>
        </div>
        <div className={`flex items-start gap-2 border p-2 text-xs ${running ? 'border-green-400 bg-green-50' : 'border-orange-400 bg-orange-50'}`}>
          <Shield className={`h-4 w-4 shrink-0 mt-0.5 ${running ? 'text-green-500' : 'text-orange-500'}`} />
          <div><p className="font-semibold">Gifting Guard: {running ? 'ACTIVE' : 'STANDBY'}</p><p className="text-[#666] mt-0.5">Skip IDs at {GUARD_THRESHOLD}%+ progress. Switch to next recipient automatically. Auto-refresh progress every 60 seconds.</p></div>
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between"><Label className="text-xs flex items-center gap-1.5"><Activity className="h-3.5 w-3.5" /> Bot activity log</Label>{logs.length > 0 && <button onClick={() => setLogs([])} className="text-[10px] text-[#666] hover:text-[#000]">Clear</button>}</div>
          <div className="max-h-48 overflow-y-auto border border-[#999] bg-[#f5f5f0] p-2 font-mono text-[11px] space-y-0.5">
            {logs.length === 0 ? <p className="text-[#666] italic">No activity yet. Click Start Auto Gifting to begin.</p>
            : logs.map(l => <div key={l.id} className="flex items-start gap-2"><span className="text-[#666] shrink-0">{l.ts}</span><span className="shrink-0">{l.kind === 'success' && <CheckCircle2 className="h-3 w-3 text-green-500" />}{l.kind === 'skip' && <Shield className="h-3 w-3 text-orange-500" />}{l.kind === 'error' && <XCircle className="h-3 w-3 text-red-500" />}{l.kind === 'guard' && <Shield className="h-3 w-3 text-[#0066cc]" />}{l.kind === 'info' && <Activity className="h-3 w-3 text-[#666]" />}</span><span className={l.kind === 'success' ? 'text-green-700' : l.kind === 'skip' ? 'text-orange-700' : l.kind === 'error' ? 'text-red-700' : l.kind === 'guard' ? 'text-[#0066cc]' : ''}>{l.msg}</span></div>)}
          </div>
        </div>
        {recipients.length > 0 && (
          <div><Label className="text-xs">Recipients (live status)</Label><div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
            {recipients.map(r => { const pct = r.pointPct ?? 0; const guarded = pct >= GUARD_THRESHOLD; return (
              <div key={r.id} className={`flex items-center gap-2 border p-2 text-xs ${guarded ? 'border-orange-400 bg-orange-50' : 'border-[#999] bg-[#f5f5f0]'}`}>
                <div className="flex h-7 w-7 items-center justify-center bg-[#e8e8e0] text-[10px] font-bold text-[#0066cc]">{r.username.slice(0, 2).toUpperCase()}</div>
                <div className="min-w-0 flex-1"><p className="truncate font-medium">{r.username}</p><div className="mt-0.5 h-1 overflow-hidden bg-[#e8e8e0]"><div className={`h-full ${guarded ? 'bg-orange-500' : 'bg-[#0066cc]'}`} style={{ width: `${Math.min(pct, 100)}%` }} /></div></div>
                <div className="text-right shrink-0"><p className={`font-semibold tabular-nums ${guarded ? 'text-orange-500' : ''}`}>{pct.toFixed(1)}%</p>{r.level !== null && <p className="text-[9px] text-[#666]">L{r.level}</p>}</div>
                {guarded && <Shield className="h-3.5 w-3.5 text-orange-500 shrink-0" />}
              </div>) })}
          </div></div>
        )}
      </div>
      <Dialog open={pinDialogOpen} onOpenChange={(o) => { setPinDialogOpen(o); if (!o && pendingStart) setPendingStart(false) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Shield className="h-4 w-4 text-[#0066cc]" /> Start Auto Gifting</DialogTitle><DialogDescription>Enter QUO PRO chatroom and start sending 5 gift commands every 4 seconds. Enter the sender&apos;s password below.</DialogDescription></DialogHeader>
          <div className="space-y-3 py-2"><div className="space-y-1.5"><Label className="text-xs">Sender</Label><p className="text-sm font-medium">{effectiveSender}</p></div><div className="space-y-1.5"><Label className="text-xs">Sender&apos;s password</Label><Input type="password" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="password" className="font-mono" autoFocus /></div></div>
          <DialogFooter><Button variant="ghost" onClick={() => { setPinDialogOpen(false); setPendingStart(false) }}>Cancel</Button><Button onClick={confirmStartWithPin} disabled={pin.length < 4} className="bg-[#0066cc] text-white hover:bg-[#0055aa]"><Play className="mr-2 h-4 w-4" /> Start Bot</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
