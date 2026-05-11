// SPDX-License-Identifier: Apache-2.0

import type { ThemeConfig, ThemeMode } from './types'

/** Default theme configuration for new installations. */
export const DEFAULT_THEME_CONFIG: ThemeConfig = {
  mode: 'system',
}

const VALID_MODES = new Set<string>(['light', 'dark', 'system'])

/**
 * Validate and normalise a potentially partial/corrupted theme config.
 * Unknown fields (e.g. legacy `scheme` / `texture` from older installs)
 * are silently dropped on re-save.
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
  }
}
