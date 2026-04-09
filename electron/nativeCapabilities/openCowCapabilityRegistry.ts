// SPDX-License-Identifier: Apache-2.0
//
// Phase 1B.11 — OpenCow's thin wrapper around the SDK CapabilityRegistry.
//
// The SDK's CapabilityRegistry exposes the inherited public surface
// (register / list / get / has / startAll / disposeAll /
// buildMcpServerForSession / getInlineToolsForSession). OpenCow inherits all
// of these unchanged.
//
// We add ONE OpenCow-private method here: `getDescriptorsForSession`, which
// returns the flat list of `ToolDescriptor` for a given session+allowlist.
// This is what `CodexNativeBridgeManager` needs (it can't use
// `buildMcpServerForSession` because Codex bridge serves descriptors via an
// HTTP loopback, not via in-process MCP). The SDK's equivalent
// `collectDescriptors` is private — duplicating ~10 lines here keeps the
// SDK API minimal while letting OpenCow's Codex bridge keep its existing
// shape.
//
// Why `OpenCowCapabilityRegistry` and not just a free function: subclassing
// gives us automatic access to all the SDK methods + lets the type system
// enforce the OpenCowSessionContext narrowing (every OpenCow capability is
// parameterised on `OpenCowSessionContext`, so the registry must be too).
//
// See: docs/plans/2026-04-10-phase-1B.11-opencow-migration-plan.md §2.1

import {
  CapabilityRegistry,
  type CapabilityAllowlistEntry,
  type CapabilityToolContext,
  type ToolDescriptor,
} from '@opencow-ai/opencow-agent-sdk'

import { createLogger } from '../platform/logger'

import type { OpenCowSessionContext } from './openCowSessionContext'

const log = createLogger('OpenCowCapabilityRegistry')

/**
 * Authoritative native capability category set. Mirrors the value previously
 * exported from `electron/nativeCapabilities/types.ts` and consumed by the
 * registration call sites in `electron/app/createServices.ts`.
 *
 * The SDK CapabilityRegistry validates registered providers against this
 * allowlist (via the `categories` constructor option), so an accidental
 * typo at registration time is caught immediately.
 */
export const NATIVE_CAPABILITY_CATEGORIES = [
  'browser',
  'issues',
  'projects',
  'html',
  'interaction',
  'schedules',
  'evose',
  'repo-analyzer',
] as const

export type NativeCapabilityCategory =
  (typeof NATIVE_CAPABILITY_CATEGORIES)[number]

const NATIVE_CAPABILITY_CATEGORY_SET: ReadonlySet<string> = new Set(
  NATIVE_CAPABILITY_CATEGORIES,
)

export function isNativeCapabilityCategory(
  value: string,
): value is NativeCapabilityCategory {
  return NATIVE_CAPABILITY_CATEGORY_SET.has(value)
}

export interface GetDescriptorsForSessionInput {
  readonly allowlist: readonly CapabilityAllowlistEntry[]
  readonly sessionContext: OpenCowSessionContext
  readonly hostEnvironment: { readonly activeMcpServerNames: readonly string[] }
}

/**
 * OpenCow's thin wrapper around the SDK CapabilityRegistry. Inherits all
 * standard methods unchanged; adds `getDescriptorsForSession` for the
 * Codex bridge.
 */
export class OpenCowCapabilityRegistry extends CapabilityRegistry<OpenCowSessionContext> {
  constructor() {
    super({ categories: NATIVE_CAPABILITY_CATEGORIES })
  }

  /**
   * Codex-bridge access path. Resolves the host allowlist into a flat
   * `ToolDescriptor[]`. Mirrors the SDK's private `collectDescriptors`
   * logic so the Codex bridge can serve descriptors via its HTTP loopback
   * without going through the MCP server packaging step.
   *
   * Behaviour:
   *   - Walks the allowlist in order (preserves caller intent for
   *     prioritisation).
   *   - For each entry, looks up the provider by category. Logs a warning
   *     and skips on unknown category — matches the historical
   *     NativeCapabilityRegistry behaviour for forward-compatibility with
   *     stale persisted policy.
   *   - If `entry.tools` is set, includes only matching tool names from the
   *     provider's descriptor list. Otherwise includes all of them.
   *   - Throws on duplicate tool names across the merged list — mirrors
   *     `assertNoDuplicateToolNames` from the legacy registry.
   */
  getDescriptorsForSession(
    input: GetDescriptorsForSessionInput,
  ): readonly ToolDescriptor<OpenCowSessionContext>[] {
    const ctx: CapabilityToolContext<OpenCowSessionContext> = {
      sessionContext: input.sessionContext,
      hostEnvironment: input.hostEnvironment,
    }

    const result: ToolDescriptor<OpenCowSessionContext>[] = []
    for (const entry of input.allowlist) {
      const provider = this.get(entry.category)
      if (!provider) {
        log.warn(
          `Allowlist references unknown capability category "${entry.category}"; skipping`,
        )
        continue
      }
      const descriptors = provider.getToolDescriptors(ctx)
      if (entry.tools && entry.tools.length > 0) {
        const allowed = new Set(entry.tools)
        for (const descriptor of descriptors) {
          if (allowed.has(descriptor.name)) {
            result.push(descriptor)
          }
        }
      } else {
        result.push(...descriptors)
      }
    }

    assertNoDuplicateToolNames(result)
    return result
  }
}

function assertNoDuplicateToolNames(
  tools: readonly ToolDescriptor<OpenCowSessionContext>[],
): void {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const tool of tools) {
    if (seen.has(tool.name)) {
      duplicates.add(tool.name)
      continue
    }
    seen.add(tool.name)
  }
  if (duplicates.size > 0) {
    const sorted = [...duplicates].sort()
    throw new Error(
      `Duplicate native tool names are not allowed: ${sorted.join(', ')}`,
    )
  }
}
