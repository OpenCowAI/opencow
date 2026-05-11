// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from 'react'
import * as monaco from 'monaco-editor'
import { useSettingsStore } from '@/stores/settingsStore'
import type { ThemeMode } from '@shared/types'
import { DEFAULT_THEME_CONFIG } from '@shared/themeRegistry'

// ---------------------------------------------------------------------------
// Custom Monaco themes — bind editor surfaces to the warm 凝脂/墨夜 palette
// ---------------------------------------------------------------------------
//
// Monaco's built-in `vs` / `vs-dark` themes hard-code `#FFFFFF` /
// `#1E1E1E` for `editor.background`, which clashes with the app palette.
// We register a paired light/dark theme whose surface colors mirror the
// CSS-var palette in themes.css. Syntax highlighting (`rules: []` +
// `inherit: true`) is left untouched — the user's request was a softer
// background, not a re-coloured token scheme.
//
// Theme registration is a side-effect on module import: it runs once, and
// because every Monaco consumer in the app reaches Monaco through this
// hook, the themes are guaranteed to exist before any editor mounts.

const OPENCOW_LIGHT = 'opencow-light'
const OPENCOW_DARK = 'opencow-dark'

monaco.editor.defineTheme(OPENCOW_LIGHT, {
  base: 'vs',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#FCF9F2',                  // --card (light)
    'editor.foreground': '#282119',                  // --foreground
    'editor.lineHighlightBackground': '#EFEDE6',     // --muted
    'editor.lineHighlightBorder': '#00000000',
    'editor.selectionBackground': '#D5C8A080',       // 缥缃 @ 50% alpha
    'editor.inactiveSelectionBackground': '#D5C8A040',
    'editorCursor.foreground': '#282119',
    'editorLineNumber.foreground': '#A89E89',
    'editorLineNumber.activeForeground': '#282119',
    'editorIndentGuide.background': '#EAE6DC',
    'editorIndentGuide.activeBackground': '#D5C8A0',
    'editorWhitespace.foreground': '#E4E1D7',
    'editorWidget.background': '#FCF9F2',
    'editorWidget.border': '#E4E1D7',
    'editorBracketMatch.background': '#D5C8A040',
    'editorBracketMatch.border': '#D5C8A0',
  },
})

monaco.editor.defineTheme(OPENCOW_DARK, {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#28231F',                  // --card (dark)
    'editor.foreground': '#EDE9DE',                  // --foreground
    'editor.lineHighlightBackground': '#2D2925',     // --muted
    'editor.lineHighlightBorder': '#00000000',
    'editor.selectionBackground': '#D5C8A040',
    'editor.inactiveSelectionBackground': '#D5C8A020',
    'editorCursor.foreground': '#D5C8A0',
    'editorLineNumber.foreground': '#6B6256',
    'editorLineNumber.activeForeground': '#EDE9DE',
    'editorIndentGuide.background': '#2D2925',
    'editorIndentGuide.activeBackground': '#3D3832',
    'editorWhitespace.foreground': '#3D3832',
    'editorWidget.background': '#28231F',
    'editorWidget.border': '#3D3832',
    'editorBracketMatch.background': '#D5C8A030',
    'editorBracketMatch.border': '#D5C8A0',
  },
})

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Returns the Monaco theme name that matches the current app mode.
 * Resolves `system` against the OS preference and keeps tracking it.
 */
export function useMonacoTheme(): string {
  const mode: ThemeMode = useSettingsStore(
    (s) => s.settings?.theme.mode ?? DEFAULT_THEME_CONFIG.mode,
  )

  const resolve = (m: ThemeMode): string => {
    if (m === 'dark') return OPENCOW_DARK
    if (m === 'light') return OPENCOW_LIGHT
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? OPENCOW_DARK
      : OPENCOW_LIGHT
  }

  const [monacoTheme, setMonacoTheme] = useState(() => resolve(mode))

  useEffect(() => {
    setMonacoTheme(resolve(mode))

    if (mode !== 'system') return

    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent): void => {
      setMonacoTheme(e.matches ? OPENCOW_DARK : OPENCOW_LIGHT)
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [mode])

  return monacoTheme
}
