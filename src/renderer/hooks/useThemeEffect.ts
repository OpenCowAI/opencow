// SPDX-License-Identifier: Apache-2.0

import { useEffect } from 'react'
import { useSettingsStore } from '@/stores/settingsStore'
import type { ThemeConfig } from '@shared/types'
import { DEFAULT_THEME_CONFIG } from '@shared/themeRegistry'
import { THEME_STORAGE_KEY } from '@/constants/theme'

/** Resolve whether dark mode should be active based on the configured mode. */
function resolveDarkMode(mode: ThemeConfig['mode']): boolean {
  if (mode === 'dark') return true
  if (mode === 'light') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function applyTheme(config: ThemeConfig): void {
  document.documentElement.classList.toggle('dark', resolveDarkMode(config.mode))

  // Cache for FOUC prevention on next launch.
  try {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(config))
  } catch {
    // localStorage unavailable — ignore
  }
}

export function useThemeEffect(): void {
  const themeConfig = useSettingsStore((s) => s.settings?.theme ?? DEFAULT_THEME_CONFIG)

  useEffect(() => {
    applyTheme(themeConfig)

    if (themeConfig.mode !== 'system') return

    // Track OS preference changes while in system mode.
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent): void => {
      document.documentElement.classList.toggle('dark', e.matches)
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [themeConfig.mode])
}
