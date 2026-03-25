// SPDX-License-Identifier: Apache-2.0

import type { AIEngineKind } from '../../../src/shared/types'
import type { CapabilityPlan } from '../../services/capabilityCenter'
import type { SDKHookMap } from '../../services/capabilityCenter/claudeCodeAdapter'
import type { SystemPromptLayers } from '../systemPromptComposer'
import type { SessionLaunchOptions } from '../sessionLaunchOptions'

export interface EngineInjectionRequest {
  engineKind: AIEngineKind
  plan: CapabilityPlan
  promptLayers: SystemPromptLayers
  options: SessionLaunchOptions
  builtInHooks?: SDKHookMap
}

export interface EngineInjectionResult {
  promptLayers: SystemPromptLayers
  optionPatch: Partial<SessionLaunchOptions>
  hooks?: SDKHookMap
  hookCleanup?: () => void
  activeMcpServerNames?: ReadonlySet<string>
}

export interface EngineInjectionAdapter {
  readonly engineKind: AIEngineKind
  inject(request: EngineInjectionRequest): EngineInjectionResult
}
