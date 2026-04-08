// SPDX-License-Identifier: Apache-2.0

/**
 * BaseNativeCapability — abstract base class for all built-in native capabilities.
 *
 * Provides the shared infrastructure that every NativeCapability needs:
 *
 * 1. **ToolConfig protocol** — declarative tool definition with `execute`
 *    typed as `Promise<CallToolResult>`. This is the core type-safety
 *    guarantee: developers cannot accidentally return a plain string.
 *
 * 2. **createToolDescriptor()** — factory that wraps ToolConfig into an
 *    engine-agnostic descriptor with centralised error handling.
 *
 * 3. **Result helpers** — `textResult()` and `errorResult()` eliminate
 *    inline `{ content: [{ type: 'text' as const, text }] }` boilerplate.
 *
 * ## Two usage patterns
 *
 * **Declarative (most native capabilities)**: Override `toolConfigs()` to
 * return an array of ToolConfig objects. The default `getToolDescriptors()`
 * maps them through `createToolDescriptor()` automatically.
 *
 * **Custom (Browser, Evose)**: Override `getToolDescriptors()` directly for native
 * capabilities that need extra pipeline logic (timeout, view injection,
 * dynamic schemas). These still benefit from inherited result helpers and
 * can call `createToolDescriptor()` selectively.
 */

import type { z } from 'zod/v4'
import type {
  NativeCapability,
  NativeCapabilityMeta,
  NativeCapabilityToolContext,
  CallToolResult,
  NativeToolCallInput,
  NativeToolDescriptor,
} from './types'
import { generateId } from '../shared/identity'

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

// ─── ToolConfig ──────────────────────────────────────────────────────────────

/**
 * Declarative tool configuration.
 *
 * The `execute` return type `Promise<CallToolResult>` is the critical
 * type-safety mechanism: if a developer writes `return "some string"`,
 * TypeScript catches it at compile time — no runtime MCP validation error.
 */
export interface ToolConfig {
  /** MCP tool name (e.g. 'list_issues', 'gen_html') */
  name: string
  /** Tool description shown to the LLM */
  description: string
  /** Zod schema for tool input parameters */
  schema: Record<string, z.ZodType>
  /** Business logic — MUST return CallToolResult (enforced by TypeScript) */
  execute: (args: Record<string, unknown>, input: NativeToolCallInput) => Promise<CallToolResult>
}

// ─── BaseNativeCapability ────────────────────────────────────────────────────

export abstract class BaseNativeCapability implements NativeCapability {
  abstract readonly meta: NativeCapabilityMeta

  /**
   * Default implementation: maps `toolConfigs()` to engine-agnostic descriptors.
   *
   * Override this method for native capabilities that need custom
   * tool-building logic (e.g. BrowserNativeCapability with timeout +
   * view injection, or EvoseNativeCapability with dynamic per-app schemas).
   */
  getToolDescriptors(context: NativeCapabilityToolContext): NativeToolDescriptor[] {
    return this.toolConfigs(context).map((cfg) => this.createToolDescriptor(cfg))
  }

  /**
   * Override to provide declarative tool definitions.
   *
   * Called by the default `getToolDescriptors()` implementation.
   */
  protected toolConfigs(_context: NativeCapabilityToolContext): ToolConfig[] {
    return []
  }

  // ── Tool Factory ──────────────────────────────────────────────────────────

  /**
   * Wrap a ToolConfig into an engine-agnostic descriptor with error handling.
   *
   * Centralises the try/catch so individual tool configs only contain
   * business logic — no repetitive error wrapping.
   */
  protected createToolDescriptor(config: ToolConfig): NativeToolDescriptor {
    return {
      name: config.name,
      description: config.description,
      inputSchema: config.schema,
      execute: async (input): Promise<CallToolResult> => {
        try {
          return await config.execute(input.args, input)
        } catch (err) {
          return this.errorResult(err)
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
