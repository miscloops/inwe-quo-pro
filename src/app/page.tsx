'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LoginBox } from '@/components/panel/login-box'
import { SessionsList } from '@/components/panel/sessions-list'
import { AutoGiftingPanel } from '@/components/panel/auto-gifting-panel'
import { WelcomeScreen } from '@/components/welcome-screen'
import { ThemeSelector } from '@/components/theme-selector'
import { useTheme } from '@/hooks/use-theme'
import { PinGate } from '@/components/pin-gate'
import { getUserName } from '@/lib/user-pin'

interface Session { id: string; username: string; status: string; level: number | null; pointPct: number | null; hoursLeft: number | null; referred: number | null; hasAuthToken: boolean; lastChecked: string | null; createdAt: string }
async function fetchSessions(): Promise<Session[]> {
  const userName = getUserName()
  const r = await fetch('/api/inwe/sessions', { headers: userName ? { 'x-user-name': userName } : {} })
  if (!r.ok) throw new Error('failed')
  const j = await r.json()
  return j.sessions ?? []
}

export default function Home() {
  const [refreshKey, setRefreshKey] = useState(0)
  const [selectedUsername, setSelectedUsername] = useState<string | null>(null)
  const sessionsQuery = useQuery({ queryKey: ['sessions', refreshKey], queryFn: fetchSessions, refetchInterval: 15_000 })
  const sessions: Session[] = sessionsQuery.data ?? []
  const refreshSessions = () => sessionsQuery.refetch()
  useTheme()

  return (
    <PinGate>
      <WelcomeScreen>
        <div className="min-h-screen flex flex-col bg-[var(--background)] text-[var(--foreground)] font-mono">
          <header className="border-b-2 border-[var(--border)] bg-[var(--header-bg)]">
            <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
              <ThemeSelector />
              <span className="text-[var(--header-text)] font-bold tracking-wider text-base">███ iNwe Quo Pro <span className="text-[var(--foreground)]">v1</span></span>
              <span className="text-[var(--muted-foreground)] text-xs hidden sm:inline">:: Licensed to HQ Family</span>
              <span className="ml-auto text-[var(--muted-foreground)] text-[10px] hidden md:inline">Build 10003</span>
            </div>
          </header>
          <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-6">
            <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
              <div className="space-y-4">
                <LoginBox onLoginComplete={() => setRefreshKey(k => k + 1)} />
                <SessionsList sessions={sessions} isLoading={sessionsQuery.isLoading} refreshKey={refreshKey} selectedUsername={selectedUsername} onSelectUsername={(u) => setSelectedUsername(u)} onSessionsChanged={refreshSessions} />
              </div>
              <div className="space-y-4"><AutoGiftingPanel sessions={sessions} refreshSessions={refreshSessions} /></div>
            </div>
          </main>
          <footer className="border-t-2 border-[var(--border)] bg-[var(--footer-bg)] mt-auto">
            <div className="max-w-6xl mx-auto px-4 py-3 text-center text-[11px] text-[var(--footer-text)]">
              Build 10003 - Made with <span className="text-[var(--destructive)]">❤</span> in Maldives!
              <span className="mx-2 text-[var(--muted-foreground)]">::</span>
              <span className="text-[var(--header-text)]">iNwe Quo Pro v1</span> — Licensed to HQ Family.
            </div>
          </footer>
        </div>
      </WelcomeScreen>
    </PinGate>
  )
}
