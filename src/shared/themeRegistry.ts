// SPDX-License-Identifier: Apache-2.0

import type { ThemeConfig, ThemeMode, ThemeScheme, ThemeTexture } from './types'

// ---------------------------------------------------------------------------
// Theme Scheme Metadata
// ---------------------------------------------------------------------------

/** Group classification for the scheme picker UI. */
export type ThemeSchemeGroup = 'neutral' | 'accent'

/** Metadata for a single theme scheme. */
export interface ThemeSchemeInfo {
  /** Machine identifier — matches `.theme-{id}` CSS class. */
  id: ThemeScheme
  /** Human-readable label. */
  label: string
  /** Grouping for the picker UI. */
  group: ThemeSchemeGroup
  /** Representative HSL color for the swatch preview (light-mode primary). */
  swatch: string
}

/** All available theme schemes in display order. */
export const THEME_SCHEMES: readonly ThemeSchemeInfo[] = [
  // Neutral
  { id: 'zinc', label: 'Zinc', group: 'neutral', swatch: '240 5.9% 10%' },
  { id: 'slate', label: 'Slate', group: 'neutral', swatch: '215.4 16.3% 46.9%' },
  { id: 'stone', label: 'Stone', group: 'neutral', swatch: '25 5.3% 44.7%' },
  { id: 'gray', label: 'Gray', group: 'neutral', swatch: '220 8.9% 46.1%' },
  { id: 'neutral', label: 'Neutral', group: 'neutral', swatch: '0 0% 45.1%' },
  // Accent
  { id: 'blue', label: 'Blue', group: 'accent', swatch: '221.2 83.2% 53.3%' },
  { id: 'green', label: 'Green', group: 'accent', swatch: '142.1 76.2% 36.3%' },
  { id: 'violet', label: 'Violet', group: 'accent', swatch: '263.4 70% 50.4%' },
  { id: 'rose', label: 'Rose', group: 'accent', swatch: '346.8 77.2% 49.8%' },
  { id: 'orange', label: 'Orange', group: 'accent', swatch: '24.6 95% 53.1%' },
] as const

// ---------------------------------------------------------------------------
// Theme Texture Metadata
// ---------------------------------------------------------------------------

/** Metadata for a single texture option. */
export interface ThemeTextureInfo {
  /** Machine identifier — matches `.texture-{id}` CSS class. */
  id: ThemeTexture
  /** Human-readable label. */
  label: string
  /** Short description for the picker UI. */
  description: string
  /** Tailwind class snippet for the mini swatch preview. */
  previewClass: string
}

/** Available texture options in display order. */
export const THEME_TEXTURES: readonly ThemeTextureInfo[] = [
  {
    id: 'plain',
    label: 'Plain',
    description: 'Clean solid surfaces',
    previewClass: 'bg-[hsl(var(--card))]',
  },
  {
    id: 'glass',
    label: 'Glass',
    description: 'Frosted glass with light refraction',
    previewClass: 'bg-[hsl(var(--card)/0.6)] backdrop-blur-md',
  },
] as const

// ---------------------------------------------------------------------------
// Defaults & Validation
// ---------------------------------------------------------------------------

/** Default theme configuration for new installations. */
export const DEFAULT_THEME_CONFIG: ThemeConfig = {
  mode: 'system',
  scheme: 'zinc',
  texture: 'plain',
}

const VALID_MODES = new Set<string>(['light', 'dark', 'system'])
const VALID_SCHEMES = new Set<string>(THEME_SCHEMES.map((s) => s.id))
const VALID_TEXTURES = new Set<string>(THEME_TEXTURES.map((t) => t.id))

/**
 * Validate and normalize a potentially partial/corrupted theme config.
 * Returns a guaranteed-valid ThemeConfig with fallbacks for invalid values.
 */
export function resolveThemeConfig(raw: unknown): ThemeConfig {
  if (raw == null || typeof raw !== 'object') {
    return DEFAULT_THEME_CONFIG
  }

  const obj = raw as Record<string, unknown>

  return {
    mode:
      typeof obj.mode === 'string' && VALID_MODES.has(obj.mode)
        ? (obj.mode as ThemeMode)
        : DEFAULT_THEME_CONFIG.mode,
    scheme:
      typeof obj.scheme === 'string' && VALID_SCHEMES.has(obj.scheme)
        ? (obj.scheme as ThemeScheme)
        : DEFAULT_THEME_CONFIG.scheme,
    texture:
      typeof obj.texture === 'string' && VALID_TEXTURES.has(obj.texture)
        ? (obj.texture as ThemeTexture)
        : DEFAULT_THEME_CONFIG.texture,
  }
}
