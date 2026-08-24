'use client'
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LogIn, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { toast } from 'sonner'
function parseCreds(raw: string): { username: string; password: string }[] {
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  const creds: { username: string; password: string }[] = []
  const seen = new Set<string>()
  for (const line of lines) { const m = line.match(/^([^\/:|\s]+)\s*[\/:|\s]\s*(.+)$/); if (m) { const username = m[1].trim(); const password = m[2].trim(); if (!seen.has(username)) { seen.add(username); creds.push({ username, password }) } } }
  return creds
}
async function loginOne(username: string, password: string) {
  const r = await fetch('/api/inwe/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) })
  const j = await r.json(); if (!r.ok || !j.ok) throw new Error(j.error ?? `Login failed for ${username}`); return j
}
interface LoginBoxProps { onLoginComplete: () => void }
export function LoginBox({ onLoginComplete }: LoginBoxProps) {
  const qc = useQueryClient()
  const [raw, setRaw] = useState('')
  const [showPasswords, setShowPasswords] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number; ok: number; failed: string[] } | null>(null)
  const creds = parseCreds(raw)
  const loginMutation = useMutation({
    mutationFn: async () => {
      if (creds.length === 0) throw new Error('No valid credentials found')
      setProgress({ done: 0, total: creds.length, ok: 0, failed: [] })
      let okCount = 0; const failed: string[] = []
      for (let i = 0; i < creds.length; i++) { const { username, password } = creds[i]; try { await loginOne(username, password); okCount++ } catch (e) { failed.push(`${username}: ${e instanceof Error ? e.message : 'failed'}`) }; setProgress({ done: i + 1, total: creds.length, ok: okCount, failed }); if (i < creds.length - 1) await new Promise(r => setTimeout(r, 600)) }
      return { okCount, failed }
    },
    onSuccess: ({ okCount, failed }) => { qc.invalidateQueries({ queryKey: ['sessions'] }); if (failed.length === 0) toast.success(`All ${okCount} account(s) logged in successfully`); else if (okCount > 0) toast.warning(`${okCount} logged in, ${failed.length} failed`, { description: failed.slice(0, 3).join('\n') }); else toast.error('All logins failed', { description: failed.slice(0, 3).join('\n') }); setRaw(''); onLoginComplete() },
    onError: (e) => toast.error(e.message),
  })
  const example = `# Paste one account per line, format: id/password
# Examples:

just2chat/MyP@ss123
get2chat/Myp@ss123`
  return (
    <div className="border-2 border-[#666] bg-[#fff]">
      <div className="border-b border-[#666] px-4 py-2 bg-[#e8e8e0]">
        <h2 className="text-sm font-bold">1. Login iNwe Accounts</h2>
        <p className="text-[10px] text-[#666] mt-0.5">Paste credentials in id/password format. Sessions are stored locally — passwords are not saved.</p>
      </div>
      <div className="p-4 space-y-3">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Credentials ({creds.length} parsed)</Label>
            <div className="flex items-center gap-2"><Label htmlFor="show-pass" className="text-xs text-[#666] cursor-pointer">Show</Label><Switch id="show-pass" checked={showPasswords} onCheckedChange={setShowPasswords} /></div>
          </div>
          <Textarea value={raw} onChange={e => setRaw(e.target.value)} placeholder={example} className={`min-h-[140px] font-mono text-xs bg-[#f5f5f0] ${showPasswords ? '' : '[-webkit-text-security:disc]'}`} style={showPasswords ? undefined : { WebkitTextSecurity: 'disc' } as React.CSSProperties} spellCheck={false} />
        </div>
        {progress && (
          <div className="border border-[#999] bg-[#f5f5f0] p-2 text-xs">
            <div className="flex items-center justify-between"><span className="font-medium">Logging in...</span><span className="tabular-nums">{progress.done}/{progress.total}</span></div>
            <div className="mt-1.5 h-1.5 overflow-hidden bg-[#e8e8e0]"><div className="h-full bg-[#0066cc] transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} /></div>
            <div className="mt-1 flex gap-3"><span className="text-green-600">✓ {progress.ok}</span><span className="text-red-600">✗ {progress.failed.length}</span></div>
          </div>
        )}
        <div className="flex items-center gap-2">
          <Button onClick={() => loginMutation.mutate()} disabled={loginMutation.isPending || creds.length === 0} className="bg-[#0066cc] text-white hover:bg-[#0055aa]">
            {loginMutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Logging in {progress ? `(${progress.done}/${progress.total})` : '...'}</> : <><LogIn className="mr-2 h-4 w-4" /> Login {creds.length > 0 ? `${creds.length} account${creds.length > 1 ? 's' : ''}` : ''}</>}
          </Button>
          {raw && !loginMutation.isPending && <Button variant="ghost" onClick={() => setRaw('')}>Clear</Button>}
        </div>
      </div>
    </div>
  )
}
