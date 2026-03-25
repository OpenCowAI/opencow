// SPDX-License-Identifier: Apache-2.0

/**
 * System prompt composer — the single source of truth for prompt layer ordering.
 *
 * Defines a typed layer model and a single composition function.
 * All prompt assembly in the application flows through `composeSystemPrompt()`,
 * guaranteeing consistent ordering regardless of which code path triggers.
 *
 * Layer stack (highest priority → lowest):
 *
 *   L0  identity     — Brand identity (ALWAYS present)
 *   L1  context      — Issue contextRefs, file changes, review diffs
 *   L2  base         — Domain-agnostic behavioral directives
 *   L3  session      — Per-session: custom prompt, agent persona, or creator
 *   L4  capability   — Skills + Rules (XML-wrapped fragments)
 */

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Typed representation of the system prompt layer stack.
 *
 * Each field corresponds to a numbered layer. The composer joins non-empty
 * layers in fixed order (L0 → L4) separated by double newlines.
 *
 * `identity` (L0) is required — brand identity must always be present.
 * All other layers are optional.
 */
export interface SystemPromptLayers {
  /** L0 — Brand identity (always injected, highest priority) */
  identity: string
  /** L1 — Contextual background (issue refs, file changes, etc.) */
  context?: string
  /** L2 — Domain-agnostic behavioral directives (skipped for specialized origins) */
  base?: string
  /** L3 — Per-session prompt (custom, agent persona, or creator role) */
  session?: string
  /** L4 — Capability prompt (skills + rules, XML-wrapped) */
  capability?: string
}

// ─── Composition ────────────────────────────────────────────────────────────

/**
 * Compose a final system prompt string from typed layers.
 *
 * Layers are joined in the canonical order (L0 → L4).
 * Empty / undefined layers are silently skipped.
 */
export function composeSystemPrompt(layers: SystemPromptLayers): string {
  return [
    layers.identity,
    layers.context,
    layers.base,
    layers.session,
    layers.capability,
  ]
    .filter(Boolean)
    .join('\n\n')
}
