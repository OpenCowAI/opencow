// SPDX-License-Identifier: Apache-2.0

import type { ClaudeSessionLaunchOptions } from './sessionLaunchOptions'
import { createLogger } from '../platform/logger'

const log = createLogger('EnginePolicy')

const PLAN_MODE_TOOLS: ReadonlySet<string> = new Set(['ExitPlanMode', 'EnterPlanMode'])

/**
 * SDK PermissionResult — matches the Zod runtime schema used by Claude Agent SDK.
 *
 * IMPORTANT: The SDK's runtime Zod validation differs from its TypeScript declaration.
 * - Allow: `{ updatedInput: Record<string, unknown> }` — updatedInput is REQUIRED (not optional)
 * - Deny:  `{ behavior: 'deny', message: string }` — both fields REQUIRED
 *
 * The TypeScript type (`PermissionResult` in sdk.d.ts) declares `updatedInput` as optional
 * and includes `behavior: 'allow'`, but the Zod runtime schema does NOT accept
 * `{ behavior: 'allow' }` alone — it requires `updatedInput` to be present.
 *
 * @see https://github.com/anthropics/claude-code — SDK PermissionResult
 */
export type ToolPermissionDecision =
  | { updatedInput: Record<string, unknown> }
  | { behavior: 'deny'; message: string }

export type RuntimeCanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: unknown,
) => Promise<ToolPermissionDecision>

export interface ClaudeCanUseToolPolicyInput {
  logger?: {
    debug: (message: string) => void
  }
}

export interface ClaudeSessionPolicyInput {
  builtinToolsEnabled?: boolean
  options: ClaudeSessionLaunchOptions
  logger?: {
    debug: (message: string) => void
  }
}

const CLAUDE_DISALLOWED_TOOLS: ReadonlyArray<string> = ['AskUserQuestion']

/**
 * Claude runtime tool-permission policy.
 *
 * Current product policy is intentionally permissive to match existing behavior:
 * all tools are allowed, and plan-mode transitions are explicitly logged.
 */
export function createClaudeCanUseToolPolicy(input?: ClaudeCanUseToolPolicyInput): RuntimeCanUseTool {
  const logger = input?.logger ?? log
  return async (toolName, toolInput) => {
    if (PLAN_MODE_TOOLS.has(toolName)) {
      logger.debug(`[canUseTool] auto-approved plan mode tool: ${toolName}`)
    }
    // SDK Zod runtime schema expects { updatedInput: Record } for "allow" responses.
    // Returning { behavior: 'allow' } causes ZodError because the runtime union
    // discriminates on the presence of `updatedInput`, not on `behavior: 'allow'`.
    return { updatedInput: toolInput }
  }
}

/**
 * Apply Claude-specific runtime session policy to the shared lifecycle options.
 *
 * Why this policy exists:
 * - Claude tools that return `{ behavior: 'ask' }` trigger `canUseTool`.
 * - Without a decision callback, SDK falls back to `control_request`, which
 *   OpenCow does not handle in managed-session mode, causing deadlocks.
 * - We intentionally keep a permissive policy for now to match current UX.
 *
 * Ask-user-question note:
 * - SDK built-in AskUserQuestion is disallowed and replaced by OpenCow MCP
 *   tool `ask_user_question`, which provides blocking semantics with session
 *   state coordination.
 */
export function applyClaudeSessionPolicy(input: ClaudeSessionPolicyInput): void {
  const { options } = input
  const builtinToolsEnabled = input.builtinToolsEnabled ?? true

  if (!builtinToolsEnabled) {
    options.tools = []
  }

  const existingDisallowed = options.disallowedTools ?? []
  const mergedDisallowed = new Set<string>([...existingDisallowed, ...CLAUDE_DISALLOWED_TOOLS])
  options.disallowedTools = Array.from(mergedDisallowed)
  options.canUseTool = createClaudeCanUseToolPolicy({ logger: input.logger })
}
