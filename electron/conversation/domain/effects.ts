// SPDX-License-Identifier: Apache-2.0

import type {
  RuntimeContextSnapshotPayload,
  RuntimeDiagnosticPayload,
  RuntimeResultPayload,
  RuntimeTurnUsage,
} from '../runtime/events'
import type { ConversationContentBlock } from './content'

export type ConversationDomainEffect =
  | {
      readonly type: 'cancel_awaiting_input_timer'
      readonly payload: Record<string, never>
    }
  | {
      readonly type: 'recover_streaming_from_awaiting_input'
      readonly payload: Record<string, never>
    }
  | {
      readonly type: 'apply_session_initialized'
      readonly payload: {
        readonly sessionRef?: string
        readonly model?: string
      }
    }
  | {
      readonly type: 'apply_assistant_partial'
      readonly payload: {
        readonly blocks: ConversationContentBlock[]
      }
    }
  | {
      readonly type: 'apply_assistant_final'
      readonly payload: {
        readonly blocks: ConversationContentBlock[]
        readonly hasToolUse: boolean
      }
    }
  | {
      readonly type: 'apply_turn_usage'
      readonly payload: RuntimeTurnUsage
    }
  | {
      readonly type: 'apply_context_snapshot'
      readonly payload: RuntimeContextSnapshotPayload
    }
  | {
      readonly type: 'apply_tool_progress'
      readonly payload: {
        readonly toolUseId: string
        readonly chunk: string
      }
    }
  | {
      readonly type: 'apply_engine_diagnostic'
      readonly payload: RuntimeDiagnosticPayload
    }
  | {
      readonly type: 'apply_turn_result'
      readonly payload: RuntimeResultPayload
    }
  | {
      readonly type: 'apply_system_compact_boundary'
      readonly payload: {
        readonly trigger: 'manual' | 'auto'
        readonly preTokens: number
      }
    }
  | {
      readonly type: 'apply_system_task_started'
      readonly payload: {
        readonly taskId: string
        readonly toolUseId?: string
        readonly description: string
        readonly taskType?: string
      }
    }
  | {
      readonly type: 'apply_system_task_notification'
      readonly payload: {
        readonly taskId: string
        readonly toolUseId?: string
        readonly status: 'completed' | 'failed' | 'stopped'
        readonly summary: string
        readonly outputFile?: string
        readonly usage?: {
          readonly totalTokens: number
          readonly toolUses: number
          readonly durationMs: number
        }
      }
    }
  | {
      readonly type: 'apply_system_hook_started'
      readonly payload: {
        readonly hookId: string
        readonly hookName: string
        readonly hookTrigger: string
      }
    }
  | {
      readonly type: 'apply_system_hook_progress'
      readonly payload: {
        readonly hookId: string
        readonly output: string
      }
    }
  | {
      readonly type: 'apply_system_hook_response'
      readonly payload: {
        readonly hookId: string
        readonly outcome: 'success' | 'error' | 'cancelled'
        readonly exitCode?: number
        readonly output: string
      }
    }
  | {
      readonly type: 'apply_protocol_violation'
      readonly payload: {
        readonly reason: string
        readonly rawType?: string
        readonly rawSubtype?: string | null
      }
    }
