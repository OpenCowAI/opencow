// SPDX-License-Identifier: Apache-2.0

import { CreditCard, Globe, Key, Zap, type LucideIcon } from 'lucide-react'
import type { AIEngineKind, ApiProvider, CodexReasoningEffort } from '@shared/types'

export interface ProviderModeOption {
  mode: ApiProvider
  labelKey: string
  descKey: string
  icon: LucideIcon
  /** When true, this mode is hidden behind "More options" in simplified UIs (e.g. onboarding). */
  advanced?: boolean
}

export const ENGINE_TABS: ReadonlyArray<{ kind: AIEngineKind; labelKey: string }> = [
  { kind: 'claude', labelKey: 'provider.engines.claude' },
  { kind: 'codex', labelKey: 'provider.engines.codex' },
]

const CLAUDE_PROVIDER_MODES: ReadonlyArray<ProviderModeOption> = [
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

const CODEX_PROVIDER_MODES: ReadonlyArray<ProviderModeOption> = [
  {
    mode: 'openrouter',
    labelKey: 'provider.modesCodex.openrouter',
    descKey: 'provider.modesCodex.openrouterDesc',
    icon: Zap,
  },
  {
    mode: 'custom',
    labelKey: 'provider.modesCodex.custom',
    descKey: 'provider.modesCodex.customDesc',
    icon: Globe,
  },
]

export const PROVIDER_MODES_BY_ENGINE: Record<AIEngineKind, ReadonlyArray<ProviderModeOption>> = {
  claude: CLAUDE_PROVIDER_MODES,
  codex: CODEX_PROVIDER_MODES,
}

const MODE_LABEL_KEY_BY_ENGINE: Record<AIEngineKind, Partial<Record<ApiProvider, string>>> = {
  claude: {
    subscription: 'provider.modes.subscription',
    api_key: 'provider.modes.apiKey',
    openrouter: 'provider.modes.openrouter',
    custom: 'provider.modes.custom',
  },
  codex: {
    openrouter: 'provider.modesCodex.openrouter',
    custom: 'provider.modesCodex.custom',
  },
}

export function getModeLabelKey(
  engineKind: AIEngineKind,
  mode: ApiProvider | null | undefined,
): string | null {
  if (!mode) return null
  return MODE_LABEL_KEY_BY_ENGINE[engineKind][mode] ?? null
}

export const MODEL_SUGGESTIONS_BY_ENGINE: Record<AIEngineKind, ReadonlyArray<string>> = {
  claude: [
    'claude-opus-4-6',
    'claude-sonnet-4-6',
    'claude-haiku-4-5-20251001',
  ],
  codex: [
    'gpt-5.3-codex',
    'gpt-5.2-codex',
    'gpt-5.1-codex-max',
    'gpt-5-codex',
    'codex-mini-latest',
  ],
}

export const CODEX_REASONING_EFFORT_OPTIONS: ReadonlyArray<{
  value: CodexReasoningEffort
  labelKey: string
}> = [
  { value: 'minimal', labelKey: 'provider.reasoningEffortLevels.minimal' },
  { value: 'low', labelKey: 'provider.reasoningEffortLevels.low' },
  { value: 'medium', labelKey: 'provider.reasoningEffortLevels.medium' },
  { value: 'high', labelKey: 'provider.reasoningEffortLevels.high' },
  { value: 'xhigh', labelKey: 'provider.reasoningEffortLevels.xhigh' },
]
