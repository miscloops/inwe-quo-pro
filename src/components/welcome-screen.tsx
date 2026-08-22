'use client'

import { useState, useEffect } from 'react'

/**
 * Full-screen welcome splash that shows for 3 seconds on app start.
 * Uses sessionStorage to only show ONCE per browser session (so refreshes
 * during dev don't keep re-triggering it). To force-show again, clear
 * sessionStorage 'welcome-shown'.
 */
function shouldShowInitially(): boolean {
  try {
    return sessionStorage.getItem('welcome-shown') !== '1'
  } catch {
    return true  // sessionStorage blocked — always show
  }
}

export function WelcomeScreen({ children }: { children: React.ReactNode }) {
  // Lazy initializer — reads sessionStorage ONCE on first render (no effect cascade)
  const [showing, setShowing] = useState(shouldShowInitially)

  useEffect(() => {
    if (!showing) return  // already shown this session — skip

    // Show for 6 seconds, then fade out + mark as shown
    const t = setTimeout(() => {
      setShowing(false)
      try { sessionStorage.setItem('welcome-shown', '1') } catch {}
    }, 6000)

    return () => clearTimeout(t)
  }, [showing])

  return (
    <>
      {showing && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#0a0a0a]"
          style={{
            animation: 'welcome-fade-out 0.4s ease-out 5.6s forwards',
          }}
        >
          <img
            src="/welcome.png"
            alt="Welcome — iNwe Quo Pro v1"
            className="max-w-full max-h-full object-contain"
            style={{
              animation: 'welcome-zoom-in 0.5s ease-out',
            }}
          />
          <style>{`
            @keyframes welcome-zoom-in {
              0% { opacity: 0; transform: scale(0.95); }
              100% { opacity: 1; transform: scale(1); }
            }
            @keyframes welcome-fade-out {
              0% { opacity: 1; }
              100% { opacity: 0; visibility: hidden; }
            }
          `}</style>
        </div>
      )}
      {children}
    </>
  )
}
