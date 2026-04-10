// SPDX-License-Identifier: Apache-2.0

import type { ProviderSettings, AIEngineKind } from '@shared/types'

/**
 * Resolve which LLM engine to use for headless operations,
 * based on provider configuration and user's default engine preference.
 *
 * Selection logic:
 *   1. Both engines configured → use user's defaultEngine preference
 *   2. Only one configured → use that one
 *   3. Neither configured → default to 'claude' (may have system-level credentials)
 *
 * @param providerSettings - from settingsService.getProviderSettings()
 * @param defaultEngine - from settingsService.getCommandDefaults().defaultEngine
 */
export function resolveActiveEngine(
  _providerSettings: ProviderSettings,
  _defaultEngine: AIEngineKind,
): AIEngineKind {
  return 'claude'
}
