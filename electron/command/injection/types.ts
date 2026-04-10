// SPDX-License-Identifier: Apache-2.0

import type { AIEngineKind } from '../../../src/shared/types'
import type { CapabilityPlan } from '../../services/capabilityCenter'
import type { SDKHookMap } from '../../services/capabilityCenter/claudeCodeAdapter'
import type { SystemPromptLayers } from '../systemPromptComposer'
import type {
  SessionLaunchOptions,
  SessionLaunchOptionPatch,
} from '../sessionLaunchOptions'

export interface ClaudeEngineInjectionRequest {
  engineKind: 'claude'
  plan: CapabilityPlan
  promptLayers: SystemPromptLayers
  options: SessionLaunchOptions
  builtInHooks?: SDKHookMap
}

export type EngineInjectionRequest = ClaudeEngineInjectionRequest

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
