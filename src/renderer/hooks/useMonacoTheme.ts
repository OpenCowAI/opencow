// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from 'react'
import { useSettingsStore } from '@/stores/settingsStore'
import type { ThemeMode } from '@shared/types'
import { DEFAULT_THEME_CONFIG } from '@shared/themeRegistry'

/**
 * Returns the Monaco Editor theme name (`'vs'` or `'vs-dark'`) that matches
 * the current application theme mode (light / dark / system).
 *
 * Note: Monaco only supports light/dark — the color scheme (zinc, blue, etc.)
 * does not affect the editor theme.
 */
export function useMonacoTheme(): string {
  const mode: ThemeMode = useSettingsStore((s) => s.settings?.theme.mode ?? DEFAULT_THEME_CONFIG.mode)

  const resolve = (m: ThemeMode): string => {
    if (m === 'dark') return 'vs-dark'
    if (m === 'light') return 'vs'
    // system — check OS preference
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'vs-dark' : 'vs'
  }

  const [monacoTheme, setMonacoTheme] = useState(() => resolve(mode))

  useEffect(() => {
    setMonacoTheme(resolve(mode))

    if (mode !== 'system') return

    // Listen for OS theme changes when in system mode
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent): void => {
      setMonacoTheme(e.matches ? 'vs-dark' : 'vs')
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [mode])

  return monacoTheme
}
