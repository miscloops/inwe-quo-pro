'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LoginBox } from '@/components/panel/login-box'
import { SessionsList } from '@/components/panel/sessions-list'
import { AutoGiftingPanel } from '@/components/panel/auto-gifting-panel'
import { WelcomeScreen } from '@/components/welcome-screen'

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

async function fetchSessions(): Promise<Session[]> {
  const r = await fetch('/api/inwe/sessions')
  if (!r.ok) throw new Error('failed')
  const j = await r.json()
  return j.sessions ?? []
}

export default function Home() {
  const [refreshKey, setRefreshKey] = useState(0)
  const [selectedUsername, setSelectedUsername] = useState<string | null>(null)

  const sessionsQuery = useQuery({
    queryKey: ['sessions', refreshKey],
    queryFn: fetchSessions,
    refetchInterval: 15_000,
  })

  const sessions: Session[] = sessionsQuery.data ?? []

  const refreshSessions = () => {
    sessionsQuery.refetch()
  }

  return (
    <WelcomeScreen>
      <div className="min-h-screen flex flex-col bg-background text-foreground font-mono">
        {/* Old-school header bar */}
        <header className="border-b-2 border-[#666] bg-[#e8e8e0]">
          <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
            <span className="text-[#0066cc] font-bold tracking-wider text-base">
              ███ iNwe Quo Pro <span className="text-foreground">v1</span>
            </span>
            <span className="text-[#666] text-xs hidden sm:inline">
              :: Licensed to HQ Family
            </span>
            <span className="ml-auto text-[#666] text-[10px] hidden md:inline">
              Build 10003
            </span>
          </div>
        </header>

        {/* Main content */}
        <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-6">
          <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
            {/* Left column */}
            <div className="space-y-4">
              <LoginBox
                onLoginComplete={() => {
                  setRefreshKey(k => k + 1)
                }}
              />
              <SessionsList
                sessions={sessions}
                isLoading={sessionsQuery.isLoading}
                refreshKey={refreshKey}
                selectedUsername={selectedUsername}
                onSelectUsername={(u) => setSelectedUsername(u)}
                onSessionsChanged={refreshSessions}
              />
            </div>

            {/* Right column */}
            <div className="space-y-4">
              <AutoGiftingPanel sessions={sessions} refreshSessions={refreshSessions} />
            </div>
          </div>
        </main>

        {/* Footer */}
        <footer className="border-t-2 border-[#666] bg-[#e8e8e0] mt-auto">
          <div className="max-w-6xl mx-auto px-4 py-3 text-center text-[11px] text-[#666]">
            Build 10003 - Made with <span className="text-[#cc0000]">❤</span> in Maldives!
            <span className="mx-2 text-[#999]">::</span>
            <span className="text-[#0066cc]">iNwe Quo Pro v1</span> — Licensed to HQ Family.
          </div>
        </footer>
      </div>
    </WelcomeScreen>
  )
}
