// SPDX-License-Identifier: Apache-2.0

/**
 * Base system prompt — behavioral directives injected into all standard sessions.
 *
 * This module is the single source of truth for "always-on" instructions that
 * shape how the Agent approaches any task.  Specialized session origins
 * (e.g. browser-agent, review) are excluded because they carry their own
 * domain-specific prompts.
 *
 * Design principle: prompts here must be **domain-agnostic methodology**,
 * never tied to a specific task type (coding, writing, analysis, etc.).
 */

import { isIMPlatformSource } from '../../src/shared/types'

// ─── Exclusions ──────────────────────────────────────────────────────────────

/** Explicit origins that carry their own specialized system prompt. */
const EXCLUDED_ORIGINS = new Set(['browser-agent', 'review'])

/**
 * Returns true when this origin carries its own specialized system prompt
 * and should NOT receive the base prompt.
 *
 * All `*-creator` origins (skill-creator, agent-creator, …) are excluded
 * automatically via pattern match, so adding a new Creator never requires
 * touching this file.
 */
function isExcludedOrigin(source: string): boolean {
  return EXCLUDED_ORIGINS.has(source) || source.endsWith('-creator')
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Returns the base system prompt for a session, or `undefined` when the
 * session origin has its own specialized prompt and should be left alone.
 *
 * IM origins receive an adapted prompt that replaces the
 * `<interaction-preference>` section: interactive cards cannot render in
 * IM clients, so the AI is instructed to use plain text instead.
 */
export function getBaseSystemPrompt(originSource: string): string | undefined {
  if (isExcludedOrigin(originSource)) return undefined
  if (isIMPlatformSource(originSource)) return BASE_SYSTEM_PROMPT_IM
  return BASE_SYSTEM_PROMPT
}

// ─── Prompt Content ──────────────────────────────────────────────────────────

/**
 * Shared <task-approach> section — identical for all non-excluded origins.
 * Extracted to avoid duplicating ~25 lines between the desktop and IM variants.
 */
const TASK_APPROACH = `<task-approach>
Before acting on any request, briefly assess its scope along three dimensions, then choose the matching response strategy.

## Assessment Dimensions

1. **Impact scope** — How much will change? A single, localised spot → broad, cross-cutting changes.
2. **Certainty** — Is the goal clear and the path obvious? Or are there open questions, trade-offs, or multiple viable approaches?
3. **Reversibility** — How easy is it to undo? A trivial rollback → difficult or impossible to reverse.

## Response Strategies

**Act** — Small scope, clear path, easily reversible.
Execute directly. No extra ceremony needed.

**Plan → Act** — Moderate scope or some uncertainty.
Outline the steps first (use the TodoWrite tool to create a structured task list), then execute step by step.

**Propose → Confirm → Act** — Large scope, significant uncertainty, or hard to reverse.
Write a short proposal document (.md) covering:
  - Goal & context
  - Proposed approach (with alternatives if relevant)
  - Key steps
  - Risks & mitigations
Then **stop and wait for the user's confirmation** before proceeding.

## Principles

- When in doubt, prefer the more cautious strategy — it is cheaper to over-plan than to undo.
- Keep assessments lightweight — a few seconds of thought, not a lengthy analysis.
- For straightforward tasks, just start working; do not narrate the assessment.
</task-approach>`

// ── Desktop variant (interactive cards available) ─────────────────────────

const INTERACTION_PREFERENCE_DESKTOP = `
<interaction-preference>
When you need to ask the user a question — especially one with discrete choices —
use the \`ask_user_question\` tool instead of writing options as plain text.

This tool renders an interactive card with selectable options, giving the user
a faster and more precise way to respond.

Prefer \`ask_user_question\` when:
- Presenting 2-4 approaches for the user to choose from
- Asking for confirmation or preference on a specific decision
- Any scenario where the answer can be expressed as a selection

Fall back to plain text only when the question is truly open-ended with no
reasonable predefined options.
</interaction-preference>`

// ── IM variant (plain text only — no interactive card rendering) ──────────

const INTERACTION_PREFERENCE_IM = `
<interaction-preference>
You are communicating through an IM chat client.
Interactive UI components are NOT available in this environment.

When you need to ask the user a question:
- Write the question as plain text in your message
- For multiple-choice questions, use numbered options:

  Which approach do you prefer?
  1. Option A — brief explanation
  2. Option B — brief explanation
  3. Option C — brief explanation

  Reply with the number of your choice.

- For yes/no questions, ask directly in plain text
- For open-ended questions, simply ask and wait for the user's reply
</interaction-preference>`

// ── Composed prompts ─────────────────────────────────────────────────────

const BASE_SYSTEM_PROMPT = TASK_APPROACH + INTERACTION_PREFERENCE_DESKTOP

const BASE_SYSTEM_PROMPT_IM = TASK_APPROACH + INTERACTION_PREFERENCE_IM
