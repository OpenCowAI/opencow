// SPDX-License-Identifier: Apache-2.0

import { CreditCard, Globe, Key, Zap, type LucideIcon } from 'lucide-react'
import type { ApiProvider } from '@shared/types'

export interface ProviderModeOption {
  mode: ApiProvider
  labelKey: string
  descKey: string
  icon: LucideIcon
  /** When true, this mode is hidden behind "More options" in simplified UIs (e.g. onboarding). */
  advanced?: boolean
}

export const PROVIDER_MODES: ReadonlyArray<ProviderModeOption> = [
  {
    mode: 'subscription',
    labelKey: 'provider.modes.subscription',
    descKey: 'provider.modes.subscriptionDesc',
    icon: CreditCard,
  },
  {
    mode: 'api_key',
    labelKey: 'provider.modes.apiKey',
    descKey: 'provider.modes.apiKeyDesc',
    icon: Key,
  },
  {
    mode: 'openrouter',
    labelKey: 'provider.modes.openrouter',
    descKey: 'provider.modes.openrouterDesc',
    icon: Zap,
    advanced: true,
  },
  {
    mode: 'custom',
    labelKey: 'provider.modes.custom',
    descKey: 'provider.modes.customDesc',
    icon: Globe,
    advanced: true,
  },
]

const MODE_LABEL_KEY: Partial<Record<ApiProvider, string>> = {
  subscription: 'provider.modes.subscription',
  api_key: 'provider.modes.apiKey',
  openrouter: 'provider.modes.openrouter',
  custom: 'provider.modes.custom',
}

export function getModeLabelKey(mode: ApiProvider | null | undefined): string | null {
  if (!mode) return null
  return MODE_LABEL_KEY[mode] ?? null
}

export const MODEL_SUGGESTIONS: ReadonlyArray<string> = [
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-haiku-4-5-20251001',
]
