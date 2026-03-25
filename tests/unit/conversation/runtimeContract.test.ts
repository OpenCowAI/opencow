// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import type { ThreadEvent } from '@openai/codex-sdk'
import type { EngineRuntimeEvent } from '../../../electron/conversation/runtime/events'

type ExpectedRuntimeEventKind =
  | 'turn.started'
  | 'session.initialized'
  | 'assistant.partial'
  | 'assistant.final'
  | 'turn.usage'
  | 'context.snapshot'
  | 'tool.progress'
  | 'engine.diagnostic'
  | 'turn.result'
  | 'system.compact_boundary'
  | 'system.task_started'
  | 'system.task_notification'
  | 'system.hook_started'
  | 'system.hook_progress'
  | 'system.hook_response'
  | 'protocol.violation'

type RuntimeKindExtra = Exclude<EngineRuntimeEvent['kind'], ExpectedRuntimeEventKind>
type RuntimeKindMissing = Exclude<ExpectedRuntimeEventKind, EngineRuntimeEvent['kind']>
type RuntimeKindsStable = [RuntimeKindExtra, RuntimeKindMissing] extends [never, never] ? true : never

type CodexHandledThreadEventType =
  | 'thread.started'
  | 'turn.started'
  | 'item.started'
  | 'item.updated'
  | 'item.completed'
  | 'turn.completed'
  | 'turn.failed'
  | 'error'

type CodexUnhandledThreadEventType = Exclude<ThreadEvent['type'], CodexHandledThreadEventType>
type CodexThreadEventCoverageStable = CodexUnhandledThreadEventType extends never ? true : never

const runtimeKindsStable: RuntimeKindsStable = true
const codexThreadEventCoverageStable: CodexThreadEventCoverageStable = true

describe('conversation runtime contracts', () => {
  it('keeps EngineRuntimeEvent kind union stable', () => {
    expect(runtimeKindsStable).toBe(true)
  })

  it('covers all Codex ThreadEvent variants in adapter switch', () => {
    expect(codexThreadEventCoverageStable).toBe(true)
  })
})
