// SPDX-License-Identifier: Apache-2.0
//
// BaseNativeCapability — OpenCow's local base class for the SDK Capability
// Provider framework.
//
// Phase 1B.11 migration: this class used to be a self-contained 141-line
// abstract class. It is now a thin adapter that:
//   1. Extends the SDK `BaseCapabilityProvider<OpenCowSessionContext>` so
//      OpenCow's 8 native capability subclasses inherit the SDK's
//      registry/lifecycle wiring without changing their import paths.
//   2. Preserves OpenCow's legacy `ToolConfig` shape (positional
//      `(args, input)` execute) so existing capability subclasses don't have
//      to rewrite their execute callback bodies. The legacy shape is
//      converted to SDK `ToolDescriptor` form by `createToolDescriptor()` —
//      the same method name the existing OpenCow capabilities already use.
//
// Subclass migration cost is minimal:
//   - `protected toolConfigs(context)` → `protected nativeToolConfigs(ctx)`
//     (the rename avoids clashing with the SDK's protected `toolConfigs`)
//   - `context.session.X` → `ctx.sessionContext.X` at the top of the method
//   - The execute callback bodies stay byte-identical
//
// Custom-getToolDescriptors capabilities (Browser, Evose) override
// `getToolDescriptors(ctx)` directly and call `createToolDescriptor()`
// selectively per their existing pattern.

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { z } from 'zod/v4'

import {
  BaseCapabilityProvider,
  type CapabilityToolContext,
  type ToolDescriptor,
} from '@opencow-ai/opencow-agent-sdk'

import { generateId } from '../shared/identity'

import type { OpenCowSessionContext } from './openCowSessionContext'

// ─── Re-exports ──────────────────────────────────────────────────────────────

export type { CallToolResult }

// ─── OpenCow legacy ToolConfig (preserved for backwards compatibility) ──────

/**
 * Declarative tool configuration consumed by `nativeToolConfigs()`.
 *
 * Kept in OpenCow's legacy positional `(args, input)` shape so existing
 * capability subclasses don't need to rewrite their execute callback bodies
 * during the Phase 1B.11 migration. `BaseNativeCapability.createToolDescriptor`
 * adapts this shape to the SDK's structured `ToolDescriptor.execute` form.
 */
export interface ToolConfig {
  /** MCP tool name (e.g. 'list_issues', 'gen_html') */
  name: string
  /** Tool description shown to the LLM */
  description: string
  /** Zod schema for tool input parameters */
  schema: Record<string, z.ZodType>
  /** Business logic — MUST return CallToolResult (enforced by TypeScript) */
  execute: (
    args: Record<string, unknown>,
    input: NativeToolCallInput,
  ) => Promise<CallToolResult>
}

/**
 * Structured invocation payload passed into the legacy `execute(args, input)`
 * second argument. Mirrors the previous `NativeToolCallInput` shape so
 * existing capability code that reads `input.context.signal` /
 * `input.context.toolUseId` keeps working unchanged.
 */
export interface NativeToolCallInput {
  readonly args: Record<string, unknown>
  readonly context: NativeToolExecutionContext
}

export interface NativeToolExecutionContext {
  /** Cooperative cancellation signal — wired from SDK's per-call abortSignal. */
  readonly signal?: AbortSignal
  /**
   * Legacy deadline timestamp. Pre-1B.11 the Codex bridge passed an
   * explicit deadlineAt; post-migration the per-call abortSignal already
   * fires on timeout (via the bridge's local AbortController), so this
   * field is left undefined. Kept on the type for backwards compatibility
   * with existing capability code that reads `input.context.deadlineAt`
   * (e.g. BrowserNativeCapability.resolveTimeoutMs).
   */
  readonly deadlineAt?: number
  /** Engine runtime label (legacy diagnostic field, always 'claude' from this adapter). */
  readonly engine?: 'claude' | 'codex'
  /** Tool use id forwarded from the SDK descriptor.execute call. */
  readonly toolUseId?: string
  /** Invocation id — legacy field; defaults to toolUseId. */
  readonly invocationId?: string
}

/**
 * Resolves the tool use id from the invocation context.
 * Falls back to a generated id if neither toolUseId nor invocationId is present.
 */
export function resolveProposalToolUseId(context: {
  toolUseId?: string
  invocationId?: string
}): string {
  if (typeof context.toolUseId === 'string' && context.toolUseId.trim().length > 0) {
    return context.toolUseId
  }
  if (typeof context.invocationId === 'string' && context.invocationId.trim().length > 0) {
    return context.invocationId
  }
  return `missing-tool-use-id:${generateId()}`
}

// ─── BaseNativeCapability ────────────────────────────────────────────────────

export abstract class BaseNativeCapability extends BaseCapabilityProvider<OpenCowSessionContext> {
  /**
   * SDK contract: walk this capability's tool list. Default delegates to
   * OpenCow's legacy `nativeToolConfigs(ctx)` and adapts each entry through
   * `createToolDescriptor()`. Custom-pipeline capabilities (Browser, Evose)
   * override this method directly and call `createToolDescriptor()`
   * selectively per their existing pattern.
   */
  override getToolDescriptors(
    ctx: CapabilityToolContext<OpenCowSessionContext>,
  ): readonly ToolDescriptor<OpenCowSessionContext>[] {
    return this.nativeToolConfigs(ctx).map((cfg) => this.createToolDescriptor(cfg))
  }

  /**
   * Override to provide declarative tool definitions in OpenCow's legacy
   * `ToolConfig` shape. Default returns `[]` so subclasses overriding
   * `getToolDescriptors()` directly can leave this alone.
   *
   * Renamed from the pre-migration `toolConfigs(context)` to avoid clashing
   * with the SDK's `BaseCapabilityProvider.toolConfigs` (which expects a
   * different return shape).
   */
  protected nativeToolConfigs(
    _ctx: CapabilityToolContext<OpenCowSessionContext>,
  ): ToolConfig[] {
    return []
  }

  /**
   * Wrap an OpenCow legacy `ToolConfig` into a SDK `ToolDescriptor`.
   *
   * Adapter responsibilities:
   *   - Forwards args from the SDK destructured input to the legacy positional
   *     callback signature `(args, { args, context })`
   *   - Forwards SDK's per-call `abortSignal` to legacy `input.context.signal`
   *   - Forwards SDK's `toolUseId` to legacy `input.context.toolUseId` and
   *     `input.context.invocationId` (legacy fields treated as the same value)
   *   - Adds the framework try/catch boundary so subclass `execute` only
   *     contains business logic. Throws are converted to errorResult shape
   *     identical to MCP / inline exit equivalence guarantees (AC #4).
   */
  protected createToolDescriptor(
    config: ToolConfig,
  ): ToolDescriptor<OpenCowSessionContext> {
    const errorResult = this.errorResult.bind(this)
    return {
      name: config.name,
      description: config.description,
      // SDK ToolDescriptor.inputSchema is a mapped type
      // `{ [K in keyof TInput]: z.ZodType<TInput[K]> }`. OpenCow's legacy
      // ToolConfig.schema is the structurally equivalent
      // `Record<string, z.ZodType>`. Same shape at runtime; cast bridges
      // the two type-system spellings.
      inputSchema: config.schema as unknown as ToolDescriptor<OpenCowSessionContext>['inputSchema'],
      async execute({ args, toolUseId, abortSignal }) {
        try {
          return await config.execute(args, {
            args,
            context: {
              signal: abortSignal,
              engine: 'claude',
              toolUseId,
              invocationId: toolUseId,
            },
          })
        } catch (err) {
          return errorResult(err)
        }
      },
    }
  }

  // ── Result Helpers ────────────────────────────────────────────────────────

  /** Create a successful text result. */
  protected textResult(text: string): CallToolResult {
    return { content: [{ type: 'text' as const, text }] }
  }

  /** Create an error result from any thrown value. */
  protected errorResult(err: unknown): CallToolResult {
    const message = err instanceof Error ? err.message : String(err)
    return {
      content: [{ type: 'text' as const, text: `Error: ${message}` }],
      isError: true,
    }
  }
}
