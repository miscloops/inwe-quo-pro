'use client'

import { useState, useEffect, useCallback } from 'react'
import { THEMES, getTheme, DEFAULT_THEME_ID } from '@/lib/themes'

export function useTheme() {
  const [themeId, setThemeId] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('inwe-theme-id')
      if (saved && THEMES.find(t => t.id === saved)) return saved
    } catch {}
    return DEFAULT_THEME_ID
  })

  // Apply theme CSS variables whenever themeId changes
  const applyTheme = useCallback((id: string) => {
    const theme = getTheme(id)
    const root = document.documentElement
    for (const [key, value] of Object.entries(theme.vars)) {
      root.style.setProperty(key, value)
    }
    root.setAttribute('data-theme-id', id)
  }, [])

  useEffect(() => {
    applyTheme(themeId)
    try { localStorage.setItem('inwe-theme-id', themeId) } catch {}
  }, [themeId, applyTheme])

  const changeTheme = useCallback((id: string) => {
    setThemeId(id)
  }, [])

  return { themeId, changeTheme, themes: THEMES, currentTheme: getTheme(themeId) }
}
