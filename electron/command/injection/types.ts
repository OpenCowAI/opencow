// SPDX-License-Identifier: Apache-2.0

import type { AIEngineKind } from '../../../src/shared/types'
import type { CapabilityPlan } from '../../services/capabilityCenter'
import type { SDKHookMap } from '../../services/capabilityCenter/claudeCodeAdapter'
import type { SystemPromptLayers } from '../systemPromptComposer'
import type {
  ClaudeSessionLaunchOptions,
  CodexSessionLaunchOptions,
  SessionLaunchOptionPatch,
} from '../sessionLaunchOptions'

export interface ClaudeEngineInjectionRequest {
  engineKind: 'claude'
  plan: CapabilityPlan
  promptLayers: SystemPromptLayers
  options: ClaudeSessionLaunchOptions
  builtInHooks?: SDKHookMap
}

export interface CodexEngineInjectionRequest {
  engineKind: 'codex'
  plan: CapabilityPlan
  promptLayers: SystemPromptLayers
  options: CodexSessionLaunchOptions
  builtInHooks?: SDKHookMap
}

export type EngineInjectionRequest = ClaudeEngineInjectionRequest | CodexEngineInjectionRequest

export interface EngineInjectionResult {
  promptLayers: SystemPromptLayers
  optionPatch: SessionLaunchOptionPatch
  hooks?: SDKHookMap
  hookCleanup?: () => void
  activeMcpServerNames?: ReadonlySet<string>
}

export interface EngineInjectionAdapter<TRequest extends EngineInjectionRequest = EngineInjectionRequest> {
  readonly engineKind: AIEngineKind
  inject(request: TRequest): EngineInjectionResult
}

export interface ClaudeEngineInjectionAdapter extends EngineInjectionAdapter<ClaudeEngineInjectionRequest> {
  readonly engineKind: 'claude'
}

export interface CodexEngineInjectionAdapter extends EngineInjectionAdapter<CodexEngineInjectionRequest> {
  readonly engineKind: 'codex'
}
