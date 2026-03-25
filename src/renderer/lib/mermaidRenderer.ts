// SPDX-License-Identifier: Apache-2.0

/**
 * Mermaid rendering — pure functions only.
 *
 * This module is a thin wrapper around beautiful-mermaid that keeps
 * rendering logic free of DOM side-effects.  Theme resolution lives
 * in {@link resolveThemeColors} so callers (React components) own the
 * "when" and "where" of reading CSS variables.
 */

import { renderMermaidSVG, type RenderOptions } from 'beautiful-mermaid'

// ---------------------------------------------------------------------------
// Theme resolution
// ---------------------------------------------------------------------------

/** Defaults used when a CSS variable is missing or empty. */
const FALLBACK_COLORS = {
  bg: '#ffffff',
  fg: '#1a1a1a',
} as const

/** Default font stack matching OpenCow's system font. */
const FONT_STACK = 'ui-sans-serif, system-ui, sans-serif'

/**
 * Read OpenCow's HSL CSS custom properties and return a
 * `RenderOptions` object that beautiful-mermaid can consume.
 *
 * Separated from rendering so it can be called independently
 * (e.g. memoised inside a React hook) or replaced in tests.
 */
export function resolveThemeColors(): RenderOptions {
  const style = getComputedStyle(document.documentElement)

  const hsl = (varName: string): string => {
    const raw = style.getPropertyValue(varName).trim()
    return raw ? `hsl(${raw})` : ''
  }

  return {
    bg: hsl('--background') || FALLBACK_COLORS.bg,
    fg: hsl('--foreground') || FALLBACK_COLORS.fg,
    border: hsl('--border') || undefined,
    muted: hsl('--muted-foreground') || undefined,
    accent: hsl('--primary') || undefined,
    transparent: true,
    font: FONT_STACK,
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Render Mermaid source text to an SVG string.
 *
 * **Pure** — accepts pre-resolved options so the function itself has
 * no DOM dependency.  Falls back to a sensible default palette when
 * `options` is omitted (useful for tests or server-side usage).
 *
 * @throws If the Mermaid syntax is invalid.
 */
export function renderMermaid(code: string, options?: RenderOptions): string {
  return renderMermaidSVG(code, options ?? { bg: FALLBACK_COLORS.bg, fg: FALLBACK_COLORS.fg })
}
