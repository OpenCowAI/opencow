// SPDX-License-Identifier: Apache-2.0

import { useEffect } from 'react'
import { useSettingsStore } from '@/stores/settingsStore'
import type { ThemeConfig } from '@shared/types'
import { DEFAULT_THEME_CONFIG } from '@shared/themeRegistry'
import { THEME_STORAGE_KEY } from '@/constants/theme'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Replace any existing class matching the prefix with the new value. */
function replaceClassByPrefix(element: HTMLElement, prefix: string, value: string): void {
  for (const cls of Array.from(element.classList)) {
    if (cls.startsWith(prefix)) {
      element.classList.remove(cls)
    }
  }
  element.classList.add(`${prefix}${value}`)
}

/** Resolve whether dark mode should be active based on the configured mode. */
function resolveDarkMode(mode: ThemeConfig['mode']): boolean {
  if (mode === 'dark') return true
  if (mode === 'light') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

// ---------------------------------------------------------------------------
// Theme Application
// ---------------------------------------------------------------------------

function applyTheme(config: ThemeConfig): void {
  const html = document.documentElement

  // Mode
  html.classList.toggle('dark', resolveDarkMode(config.mode))

  // Scheme
  replaceClassByPrefix(html, 'theme-', config.scheme)

  // Texture
  replaceClassByPrefix(html, 'texture-', config.texture)

  // FOUC cache
  try {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(config))
  } catch {
    // localStorage unavailable — ignore
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useThemeEffect(): void {
  const themeConfig = useSettingsStore((s) => s.settings?.theme ?? DEFAULT_THEME_CONFIG)

  useEffect(() => {
    applyTheme(themeConfig)

    if (themeConfig.mode !== 'system') return

    // Listen for OS theme changes when in system mode
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent): void => {
      document.documentElement.classList.toggle('dark', e.matches)
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [themeConfig.mode, themeConfig.scheme, themeConfig.texture])
}
