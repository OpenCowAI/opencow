// SPDX-License-Identifier: Apache-2.0

/**
 * capabilityTemplates — Structural templates for AI-generated capabilities.
 *
 * This module is the **single source of truth** for the section structure
 * AND frontmatter fields of each capability category. It drives:
 *
 *   1. **System prompt generation** — the AI sees a concrete output skeleton,
 *      frontmatter example, and structural constraints derived from the template.
 *   2. **Output validation** — the parser checks the body against the template
 *      to detect missing or empty required sections.
 *   3. **Output field extraction** — the parser maps frontmatter attributes
 *      to typed fields based on the template's field definitions.
 *   4. **Targeted auto-continuation** — when sections are missing, the recovery
 *      prompt names the specific sections that need content.
 *
 * Changing a template here automatically propagates to all layers.
 *
 * @module
 */

import type { AICreatableCategory } from './types'

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * A single section within a capability body.
 *
 * Sections map to `## Heading` blocks in the generated markdown.
 */
export interface SectionTemplate {
  /** Section heading text (without the `## ` prefix), e.g. `"Purpose"` */
  heading: string
  /** One-line guidance for the AI — injected into the prompt example */
  guidance: string
  /** If `true`, the section MUST contain substantive content */
  required: boolean
}

/**
 * A YAML frontmatter field definition for a capability category.
 *
 * Beyond the common fields (name, description) that every category has,
 * each category may define additional fields (e.g. `model` for agents,
 * `argument-hint` for commands). These definitions drive:
 *
 *   - Prompt example generation (YAML example in Phase 3)
 *   - Output field extraction (parser maps attributes → typed fields)
 *   - Prompt documentation (field descriptions in YAML Frontmatter Rules)
 */
export interface FrontmatterFieldTemplate {
  /** YAML key name, e.g. `'model'`, `'argument-hint'` */
  key: string
  /** Example value for the system prompt, e.g. `'sonnet'` */
  example: string
  /** Description for the prompt's YAML Frontmatter Rules section */
  description: string
  /**
   * The property name on ParsedCapabilityOutput to map this field to.
   * E.g. `'model'`, `'color'`, `'argumentHint'`.
   * Used by the parser to extract the field from frontmatter attributes.
   */
  outputField: string
}

/**
 * Body structure definition for a specific capability category.
 *
 * Templates define **structural concerns only**: which sections exist,
 * which are required, and what frontmatter fields to extract.
 *
 * Prompt-layer concerns (body length guidance, writing principles, etc.)
 * live in `CreatorPromptParts` — not here.
 */
export interface CapabilityTemplate {
  /** Ordered sections — the AI must use exactly these and no others */
  readonly sections: readonly SectionTemplate[]
  /**
   * Category-specific frontmatter fields beyond the common ones (name, description).
   * Empty array when the category has no extra fields.
   */
  readonly frontmatterFields: readonly FrontmatterFieldTemplate[]
}

// ─── Fence type registry ─────────────────────────────────────────────────────
// Moved here from capabilityOutputParser.ts — shared by templates, parser,
// prompt generation, and auto-continuation.

/** Maps each capability category to its code-fence tag. */
export const FENCE_TYPES: Readonly<Record<AICreatableCategory, string>> = {
  skill: 'skill-output',
  agent: 'agent-output',
  command: 'command-output',
  rule: 'rule-output',
}

/** Reverse lookup: fence tag → category. */
export const TAG_TO_CATEGORY: Readonly<Record<string, AICreatableCategory>> =
  Object.fromEntries(
    Object.entries(FENCE_TYPES).map(([cat, tag]) => [tag, cat as AICreatableCategory])
  ) as Record<string, AICreatableCategory>

/** All recognized fence tags (for multi-category scanning). */
export const ALL_FENCE_TAGS: readonly string[] = Object.values(FENCE_TYPES)

// ─── Per-category templates ──────────────────────────────────────────────────

export const RULE_TEMPLATE: CapabilityTemplate = {
  frontmatterFields: [],
  sections: [
    {
      heading: 'Purpose',
      guidance: 'Why this rule exists and what problem it prevents (2-5 sentences)',
      required: true,
    },
    {
      heading: 'Guidelines',
      guidance: 'Concrete, actionable guidelines as bullet points',
      required: true,
    },
    {
      heading: 'Examples',
      guidance: 'Good and bad examples showing the rule in practice',
      required: false,
    },
  ],
}

export const SKILL_TEMPLATE: CapabilityTemplate = {
  frontmatterFields: [],
  sections: [
    {
      heading: 'Overview',
      guidance: 'What this skill does and when it activates (2-5 sentences)',
      required: true,
    },
    {
      heading: 'Instructions',
      guidance: 'Step-by-step instructions for Claude to follow',
      required: true,
    },
    {
      heading: 'Output Format',
      guidance: 'Expected output structure, format, and artifacts',
      required: false,
    },
  ],
}

export const AGENT_TEMPLATE: CapabilityTemplate = {
  frontmatterFields: [
    {
      key: 'model',
      example: 'sonnet',
      description: '**model**: Optional. One of: `sonnet` (balanced), `opus` (strongest), `haiku` (fastest). Omit for default.',
      outputField: 'model',
    },
    {
      key: 'color',
      example: "'#8B5CF6'",
      description: "**color**: Optional. Hex color code (e.g. `'#8B5CF6'`) for UI identification.",
      outputField: 'color',
    },
  ],
  sections: [
    {
      heading: 'Role & Expertise',
      guidance: 'Core identity, domain expertise, and decision-making style',
      required: true,
    },
    {
      heading: 'Communication Style',
      guidance: 'Tone, formality, and interaction patterns',
      required: true,
    },
    {
      heading: 'Guidelines',
      guidance: 'Behavioral rules, boundaries, and constraints',
      required: true,
    },
  ],
}

export const COMMAND_TEMPLATE: CapabilityTemplate = {
  frontmatterFields: [
    {
      key: 'argument-hint',
      example: '<required-arg> [optional-arg]',
      description: '**argument-hint**: Optional. Shows in the UI as usage hint. Format: `<required> [optional] [--flag]`.',
      outputField: 'argumentHint',
    },
  ],
  sections: [
    {
      heading: 'What This Command Does',
      guidance: 'Core action, trigger context, and purpose',
      required: true,
    },
    {
      heading: 'Steps',
      guidance: 'Numbered step-by-step workflow',
      required: true,
    },
    {
      heading: 'Output Format',
      guidance: 'What the user sees when the command completes',
      required: false,
    },
  ],
}

// ─── Template registry ───────────────────────────────────────────────────────

const TEMPLATES: Readonly<Record<AICreatableCategory, CapabilityTemplate>> = {
  rule: RULE_TEMPLATE,
  skill: SKILL_TEMPLATE,
  agent: AGENT_TEMPLATE,
  command: COMMAND_TEMPLATE,
}

/**
 * Get the template for a given capability category.
 */
export function getTemplate(category: AICreatableCategory): CapabilityTemplate {
  return TEMPLATES[category]
}
