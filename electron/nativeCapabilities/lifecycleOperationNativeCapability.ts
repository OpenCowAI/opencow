// SPDX-License-Identifier: Apache-2.0

/**
 * LifecycleOperationNativeCapability — Agentic confirm/cancel for pending
 * lifecycle operations.
 *
 * Propose → Confirm → Act is OpenCow's standard flow for in-session
 * governance of destructive or high-uncertainty lifecycle writes (issue /
 * schedule create/update/…). The `propose_*_operation` tools in the
 * entity-specific capabilities (`issueNativeCapability`,
 * `scheduleNativeCapability`) create a `pending_confirmation` envelope and
 * render a rich review card in the UI; committing it used to require the
 * user to click the card's Confirm button.
 *
 * This capability closes the chat-side loop: when the user acknowledges a
 * pending operation in natural language ("确定" / "yes" / "go ahead"), the
 * model can call `apply_lifecycle_operation(operationId)` directly and the
 * schedule / issue actually lands. Symmetric `cancel_lifecycle_operation`
 * handles "算了" / "no, cancel that".
 *
 * The tools are deliberately entity-agnostic — an `operationId` is
 * self-identifying, and the coordinator's `confirmOperation` /
 * `rejectOperation` already know how to dispatch the real work regardless
 * of whether the envelope is an issue or a schedule. Hosting them in a
 * single tiny capability avoids duplicating definitions across the two
 * entity capabilities.
 */

import { z } from 'zod/v4'
import type { ToolDescriptor } from '@opencow-ai/opencow-agent-sdk'
import type { NativeCapabilityMeta, NativeCapabilityToolContext } from './types'
import { BaseNativeCapability } from './baseNativeCapability'
import type { OpenCowSessionContext } from './openCowSessionContext'
import type { LifecycleOperationCoordinator } from '../services/lifecycleOperations'

export interface LifecycleOperationNativeCapabilityDeps {
  lifecycleOperationCoordinator: LifecycleOperationCoordinator
}

export class LifecycleOperationNativeCapability extends BaseNativeCapability {
  readonly meta: NativeCapabilityMeta = {
    category: 'lifecycle',
    description:
      'Confirm or cancel previously proposed lifecycle operations (schedules / issues)',
  }

  private readonly lifecycleOperationCoordinator: LifecycleOperationCoordinator

  constructor(deps: LifecycleOperationNativeCapabilityDeps) {
    super()
    this.lifecycleOperationCoordinator = deps.lifecycleOperationCoordinator
  }

  override getToolDescriptors(
    ctx: NativeCapabilityToolContext,
  ): readonly ToolDescriptor<OpenCowSessionContext>[] {
    const session = ctx.sessionContext
    return [
      this.tool({
        name: 'apply_lifecycle_operation',
        description:
          'Apply (commit) a previously proposed schedule or issue lifecycle operation. ' +
          'Call this when the user confirms a pending operation in natural language — ' +
          'e.g. "确定" / "confirm" / "ok" / "go ahead" / "yes, do it" immediately after ' +
          'a `propose_schedule_operation` or `propose_issue_operation` tool_use whose ' +
          'result contained `state: "pending_confirmation"`. Pass the `operationId` field ' +
          'returned inside that tool_result. The coordinator resolves the entity kind ' +
          '(schedule vs issue) automatically. Do NOT invoke this for any other purpose.',
        schema: {
          operationId: z
            .string()
            .describe(
              'The `operationId` returned by a preceding propose_*_operation tool_result. ' +
              'Only operations whose state is `pending_confirmation` can be applied.',
            ),
        },
        execute: async ({ args }) => {
          const result = await this.lifecycleOperationCoordinator.confirmOperation({
            sessionId: session.sessionId,
            operationId: args.operationId,
          })
          if (!result.ok) {
            return this.errorResult(
              `apply_lifecycle_operation failed (code=${result.code}). ` +
              'The operation may have been applied already, cancelled, or never proposed. ' +
              'Use list_schedules / list_issues (or re-propose) to recover.',
            )
          }
          return this.textResult(JSON.stringify({ code: result.code, operation: result.operation }, null, 2))
        },
      }),

      this.tool({
        name: 'cancel_lifecycle_operation',
        description:
          'Cancel (reject) a previously proposed schedule or issue lifecycle operation. ' +
          'Call this when the user declines a pending proposal — e.g. "算了" / "cancel" / ' +
          '"不要了" / "never mind" / "no, don\'t do it" after a `propose_*_operation` ' +
          'tool_result with `state: "pending_confirmation"`. Pass the `operationId` field ' +
          'from that tool_result. Cancelling is idempotent — already-terminal operations ' +
          'return successfully without change.',
        schema: {
          operationId: z
            .string()
            .describe(
              'The `operationId` returned by a preceding propose_*_operation tool_result. ' +
              'Only operations whose state is `pending_confirmation` can be cancelled.',
            ),
        },
        execute: async ({ args }) => {
          const result = await this.lifecycleOperationCoordinator.rejectOperation({
            sessionId: session.sessionId,
            operationId: args.operationId,
          })
          if (!result.ok) {
            return this.errorResult(
              `cancel_lifecycle_operation failed (code=${result.code}).`,
            )
          }
          return this.textResult(JSON.stringify({ code: result.code, operation: result.operation }, null, 2))
        },
      }),
    ]
  }
}
