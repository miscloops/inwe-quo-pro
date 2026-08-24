'use client'

import { useState } from 'react'
import { useTheme } from '@/hooks/use-theme'
import { Palette, Check } from 'lucide-react'

export function ThemeSelector() {
  const { themeId, changeTheme, themes, currentTheme } = useTheme()
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      {/* Theme button — goes in the left corner */}
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2 py-1 text-xs border border-[var(--border)] bg-[var(--card)] hover:bg-[var(--secondary)] transition-colors"
        title="Select theme"
      >
        <Palette className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{currentTheme.name}</span>
        <span className="sm:hidden">{currentTheme.icon}</span>
      </button>

      {/* Theme dropdown */}
      {open && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />

          {/* Dropdown panel */}
          <div className="absolute top-full left-0 mt-1 z-50 w-52 max-h-80 overflow-y-auto border border-[var(--border)] bg-[var(--card)] shadow-lg">
            <div className="px-3 py-2 border-b border-[var(--border)] text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
              Select Theme
            </div>
            <div className="py-1">
              {themes.map(theme => (
                <button
                  key={theme.id}
                  onClick={() => { changeTheme(theme.id); setOpen(false) }}
                  className={`flex items-center gap-3 w-full px-3 py-2 text-xs text-left transition-colors ${
                    themeId === theme.id
                      ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                      : 'hover:bg-[var(--secondary)] text-[var(--foreground)]'
                  }`}
                >
                  {/* Color preview swatches */}
                  <div className="flex gap-0.5 shrink-0">
                    <div className="w-3 h-3" style={{ background: theme.vars['--background'], border: '1px solid ' + theme.vars['--border'] }} />
                    <div className="w-3 h-3" style={{ background: theme.vars['--primary'] }} />
                    <div className="w-3 h-3" style={{ background: theme.vars['--accent'] }} />
                  </div>
                  <span className="flex-1">{theme.icon} {theme.name}</span>
                  {themeId === theme.id && <Check className="h-3 w-3 shrink-0" />}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
