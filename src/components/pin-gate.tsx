'use client'
import { useState } from 'react'
import { getUserName, setUserName, clearUserName, isLoggedIn } from '@/lib/user-pin'

interface PinGateProps { children: React.ReactNode }

export function PinGate({ children }: PinGateProps) {
  const [loggedIn, setLoggedIn] = useState(() => isLoggedIn())
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async () => {
    setError(''); setLoading(true)
    try {
      if (mode === 'register') {
        if (username.trim().length < 3) { setError('Username must be at least 3 characters'); return }
        if (password.length < 4) { setError('Password must be at least 4 characters'); return }
        if (password !== confirmPassword) { setError('Passwords do not match'); return }
        const r = await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: username.trim(), password }) })
        const j = await r.json()
        if (!r.ok || !j.ok) { setError(j.error || 'Registration failed'); return }
        setUserName(username.trim().toLowerCase()); setLoggedIn(true)
      } else {
        const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: username.trim(), password }) })
        const j = await r.json()
        if (!r.ok || !j.ok) { setError(j.error || 'Login failed'); return }
        setUserName(username.trim().toLowerCase()); setLoggedIn(true)
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong') } finally { setLoading(false) }
  }

  const handleLogout = () => {
    if (confirm('Log out? Your iNwe sessions will remain saved.')) {
      clearUserName(); setLoggedIn(false); setUsername(''); setPassword(''); setConfirmPassword(''); setMode('login')
    }
  }

  if (loggedIn) {
    const currentUser = getUserName()
    return (
      <>
        {children}
        <button onClick={handleLogout} className="fixed bottom-3 right-3 z-50 text-[10px] border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-[var(--muted-foreground)] hover:bg-[var(--secondary)] transition-colors" title={`Logged in as ${currentUser}`}>{currentUser} · logout</button>
      </>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--background)] font-mono">
      <div className="w-full max-w-sm border-2 border-[var(--border)] bg-[var(--card)] p-6">
        <div className="text-center mb-6">
          <h1 className="text-xl font-bold text-[var(--primary)] tracking-wider">███ iNwe Quo Pro</h1>
          <p className="text-xs text-[var(--muted-foreground)] mt-1">{mode === 'register' ? 'Create your account' : 'Login to your account'}</p>
          <p className="text-[10px] text-[var(--muted-foreground)] mt-2">Your account isolates your iNwe sessions from other users.<br />Nobody else can see your logged-in IDs.</p>
        </div>
        <div className="space-y-3">
          <input type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder="username" className="w-full bg-[var(--muted)] border border-[var(--border)] px-4 py-2.5 text-sm outline-none focus:border-[var(--primary)]" autoFocus onKeyDown={e => { if (e.key === 'Enter' && mode === 'login') handleSubmit() }} />
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="password" className="w-full bg-[var(--muted)] border border-[var(--border)] px-4 py-2.5 text-sm outline-none focus:border-[var(--primary)]" onKeyDown={e => { if (e.key === 'Enter' && mode === 'login') handleSubmit() }} />
          {mode === 'register' && <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="confirm password" className="w-full bg-[var(--muted)] border border-[var(--border)] px-4 py-2.5 text-sm outline-none focus:border-[var(--primary)]" onKeyDown={e => { if (e.key === 'Enter') handleSubmit() }} />}
          {error && <p className="text-xs text-red-500 text-center">{error}</p>}
          <button onClick={handleSubmit} disabled={loading || !username || !password || (mode === 'register' && !confirmPassword)} className="w-full bg-[var(--primary)] text-[var(--primary-foreground)] py-2.5 text-sm font-bold disabled:opacity-50 hover:opacity-90 transition-opacity">{loading ? '...' : mode === 'register' ? 'Create Account' : 'Login'}</button>
          <div className="text-center pt-2"><button onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError('') }} className="text-[11px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] underline">{mode === 'login' ? "Don't have an account? Register" : 'Already have an account? Login'}</button></div>
        </div>
        <div className="mt-6 pt-4 border-t border-[var(--border)] text-center"><p className="text-[10px] text-[var(--muted-foreground)]">Build 10003 · Made with ❤ in Maldives</p></div>
      </div>
    </div>
  )
}
