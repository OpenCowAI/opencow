// SPDX-License-Identifier: Apache-2.0

// src/shared/i18n.ts — Shared between main process and renderer; pure logic utilities with no UI copy.

export type SupportedLocale = 'zh-CN' | 'en-US'
export type LanguagePref = 'system' | SupportedLocale

/**
 * Resolve the final locale based on user preference and system language.
 * When pref is null/undefined, it is treated as 'system'.
 */
export function resolveLocale(
  pref: LanguagePref | null | undefined,
  systemLocale: string
): SupportedLocale {
  if (pref === 'zh-CN' || pref === 'en-US') return pref
  return systemLocale.startsWith('zh') ? 'zh-CN' : 'en-US'
}
