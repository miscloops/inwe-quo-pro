'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LogIn, Loader2, Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { toast } from 'sonner'

interface ParsedCred {
  username: string
  password: string
}

function parseCreds(raw: string): ParsedCred[] {
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  const creds: ParsedCred[] = []
  const seen = new Set<string>()
  for (const line of lines) {
    // Accept formats: id/password, id:password, id password, id|password
    const m = line.match(/^([^\/:|\s]+)\s*[\/:|\s]\s*(.+)$/)
    if (m) {
      const username = m[1].trim()
      const password = m[2].trim()
      if (!seen.has(username)) {
        seen.add(username)
        creds.push({ username, password })
      }
    }
  }
  return creds
}

async function loginOne(username: string, password: string) {
  const r = await fetch('/api/inwe/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  const j = await r.json()
  if (!r.ok || !j.ok) throw new Error(j.error ?? `Login failed for ${username}`)
  return j
}

interface LoginBoxProps {
  onLoginComplete: () => void
}

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
      let okCount = 0
      const failed: string[] = []
      for (let i = 0; i < creds.length; i++) {
        const { username, password } = creds[i]
        try {
          await loginOne(username, password)
          okCount++
        } catch (e) {
          failed.push(`${username}: ${e instanceof Error ? e.message : 'failed'}`)
        }
        setProgress({ done: i + 1, total: creds.length, ok: okCount, failed })
        // Brief pause between logins to avoid rate-limiting
        if (i < creds.length - 1) await new Promise(r => setTimeout(r, 600))
      }
      return { okCount, failed }
    },
    onSuccess: ({ okCount, failed }) => {
      qc.invalidateQueries({ queryKey: ['sessions'] })
      if (failed.length === 0) {
        toast.success(`All ${okCount} account(s) logged in successfully`)
      } else if (okCount > 0) {
        toast.warning(`${okCount} logged in, ${failed.length} failed`, {
          description: failed.slice(0, 3).join('\n'),
        })
      } else {
        toast.error('All logins failed', { description: failed.slice(0, 3).join('\n') })
      }
      setRaw('')
      onLoginComplete()
    },
    onError: (e) => {
      toast.error(e.message)
    },
  })

  const example = `# Paste one account per line, format: id/password
# Examples:

just2chat/MyP@ss123
get2chat/Myp@ss123`

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      <div className="border-b border-border px-5 py-3">
        <div className="flex items-center gap-2">
          <LogIn className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">1. Login iNwe Accounts</h2>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Paste credentials in <code className="rounded bg-secondary px-1 py-0.5 text-[10px]">id/password</code> format, one per line. Sessions are stored locally — passwords are not saved.
        </p>
      </div>
      <div className="p-5 space-y-3">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-medium">Credentials ({creds.length} parsed)</Label>
            <div className="flex items-center gap-2">
              <Label htmlFor="show-pass" className="text-xs text-muted-foreground cursor-pointer">Show</Label>
              <Switch id="show-pass" checked={showPasswords} onCheckedChange={setShowPasswords} />
            </div>
          </div>
          <Textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder={example}
            className={`min-h-[160px] font-mono text-xs bg-secondary/40 ${showPasswords ? '' : '[-webkit-text-security:disc]'}`}
            style={showPasswords ? undefined : { WebkitTextSecurity: 'disc' } as React.CSSProperties}
            spellCheck={false}
          />
        </div>

        {progress && (
          <div className="rounded-lg border border-border/60 bg-secondary/30 p-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-medium">Logging in…</span>
              <span className="tabular-nums">{progress.done}/{progress.total}</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${(progress.done / progress.total) * 100}%` }}
              />
            </div>
            <div className="mt-1.5 flex items-center gap-3">
              <span className="text-green-600 dark:text-green-500">✓ {progress.ok} ok</span>
              <span className="text-red-600 dark:text-red-500">✗ {progress.failed.length} failed</span>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button
            onClick={() => loginMutation.mutate()}
            disabled={loginMutation.isPending || creds.length === 0}
            className="bg-gradient-to-r from-primary to-blue-600 text-white"
          >
            {loginMutation.isPending ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Logging in {progress ? `(${progress.done}/${progress.total})` : '…'}</>
            ) : (
              <><LogIn className="mr-2 h-4 w-4" /> Login {creds.length > 0 ? `${creds.length} account${creds.length > 1 ? 's' : ''}` : ''}</>
            )}
          </Button>
          {raw && !loginMutation.isPending && (
            <Button variant="ghost" onClick={() => setRaw('')}>
              Clear
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
