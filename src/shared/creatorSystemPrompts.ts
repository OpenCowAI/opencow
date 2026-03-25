// SPDX-License-Identifier: Apache-2.0

/**
 * creatorSystemPrompts — Template-driven prompt assembly for all AI Creators.
 *
 * This is the dispatcher that assembles the final system prompt for each
 * capability category. It combines:
 *
 *   1. **Category-specific prompt parts** — role, phases, principles
 *      (from `{category}CreatorSystemPrompt.ts`)
 *   2. **Template-derived structure** — Phase 3 output example and structural
 *      constraints generated from `capabilityTemplates.ts`
 *   3. **Language directive** — resolved from the user's locale
 *
 * The Phase 3 "Generate" section (including the output example and constraints)
 * is **generated from template data**, not manually authored. This guarantees
 * that prompt, parser validation, and auto-continuation always agree on the
 * expected section structure.
 *
 * @module
 */

import type { AICreatableCategory } from './types'
import { resolveLanguageDirective } from './creatorLanguage'
import { FENCE_TYPES, getTemplate, type CapabilityTemplate, type SectionTemplate } from './capabilityTemplates'
import { RULE_CREATOR_PARTS } from './ruleCreatorSystemPrompt'
import { SKILL_CREATOR_PARTS } from './skillCreatorSystemPrompt'
import { AGENT_CREATOR_PARTS } from './agentCreatorSystemPrompt'
import { COMMAND_CREATOR_PARTS } from './commandCreatorSystemPrompt'

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Category-specific content for a creator system prompt.
 *
 * Each prompt file exports one of these — containing ONLY the content
 * unique to that category. The structural skeleton (workflow phases,
 * output example, constraints) is assembled by this dispatcher.
 */
export interface CreatorPromptParts {
  /** Opening role statement, e.g. "You are an expert Rule Creator..." */
  role: string
  /** One-sentence definition of what this capability type is */
  definition: string
  /** Phase 1 questions (markdown bullet content, without leading `1.`) */
  captureIntent: readonly string[]
  /** Phase 2 probing points (markdown bullet content) */
  researchRefine: readonly string[]
  /** Phase 4 iteration guidance */
  iterate: string
  /** Writing principles (numbered list items) */
  principles: readonly string[]
  /**
   * Common YAML frontmatter field descriptions (name, description).
   * Category-specific field descriptions are derived from the template's
   * `frontmatterFields` by the dispatcher — not listed here.
   */
  frontmatterRules: readonly string[]
  /**
   * Natural-language guidance for total body length.
   * Injected into the system prompt's structural constraints section.
   * This is prompt content, not structural data — so it lives here
   * rather than in the template.
   */
  bodyGuidance: string
}

// ─── Parts registry ──────────────────────────────────────────────────────────

const PROMPT_PARTS: Readonly<Record<AICreatableCategory, CreatorPromptParts>> = {
  rule: RULE_CREATOR_PARTS,
  skill: SKILL_CREATOR_PARTS,
  agent: AGENT_CREATOR_PARTS,
  command: COMMAND_CREATOR_PARTS,
}

// ─── Frontmatter example builders ────────────────────────────────────────────

/**
 * Build a YAML frontmatter example snippet for the code-fence output example.
 *
 * Common fields (name, description) are always included. Category-specific
 * extras are derived from `template.frontmatterFields` — no hardcoded
 * category branches. Adding a new frontmatter field to the template
 * automatically appears in the prompt example.
 */
function buildFrontmatterExample(template: CapabilityTemplate): string {
  const lines = [
    '---',
    `name: example-name`,
    'description: >',
    '  Clear, specific description of what this does and when to use it.',
  ]

  for (const field of template.frontmatterFields) {
    lines.push(`${field.key}: ${field.example}`)
  }

  lines.push('---')
  return lines.join('\n')
}

/**
 * Build the YAML Frontmatter Rules section for the prompt.
 *
 * Common field descriptions (name, description) are always included.
 * Category-specific field descriptions are derived from `template.frontmatterFields`.
 */
function buildFrontmatterRules(parts: CreatorPromptParts, template: CapabilityTemplate): string {
  // Common rules from parts (name + description are always first)
  const commonRules = parts.frontmatterRules.map(item => `- ${item}`)

  // Category-specific rules derived from template
  const templateRules = template.frontmatterFields.map(f => `- ${f.description}`)

  return [...commonRules, ...templateRules].join('\n')
}

// ─── Phase 3 generation (from template) ──────────────────────────────────────

/**
 * Build the section skeleton for the output example from template sections.
 */
function buildSectionSkeleton(sections: readonly SectionTemplate[]): string {
  return sections.map(s => `## ${s.heading}\n${s.guidance}`).join('\n\n')
}

/**
 * Build the structural constraints list from a template + prompt parts.
 *
 * Structural constraints (section requirements) derive from the template.
 * Body length guidance derives from prompt parts (it's prompt content, not structure).
 */
function buildConstraints(template: CapabilityTemplate, bodyGuidance: string): string[] {
  const required = template.sections.filter(s => s.required).map(s => s.heading)
  const optional = template.sections.filter(s => !s.required).map(s => s.heading)

  const constraints = [
    'Use EXACTLY the sections shown above — do NOT add any additional sections.',
    `Required sections (${required.join(', ')}): MUST have substantive content.`,
  ]

  if (optional.length > 0) {
    constraints.push(
      `Optional sections (${optional.join(', ')}): include only if relevant to the user's request, otherwise omit the heading entirely.`
    )
  }

  constraints.push(
    'Never leave a heading empty — if a section would have no content, omit it entirely.',
    bodyGuidance,
    'Complete ALL required sections before closing the code fence.',
  )

  return constraints
}

/**
 * Build the Phase 3 "Generate" section from template data.
 *
 * This is the core of the template-driven approach: the output example
 * and constraints are derived from the same template that the parser
 * uses for validation. They can never drift apart.
 */
function buildPhase3(category: AICreatableCategory, template: CapabilityTemplate, bodyGuidance: string): string {
  const fenceTag = FENCE_TYPES[category]
  const frontmatter = buildFrontmatterExample(template)
  const skeleton = buildSectionSkeleton(template.sections)
  const constraints = buildConstraints(template, bodyGuidance)
  const categoryLabel = category.charAt(0).toUpperCase() + category.slice(1)

  return `### Phase 3: Generate the ${categoryLabel}

When you have enough context, generate the complete ${category}. Output it inside a \`\`\`${fenceTag} code fence:

\`\`\`${fenceTag}
${frontmatter}

# Title

${skeleton}
\`\`\`

**Structural constraints:**
${constraints.map(c => `- ${c}`).join('\n')}`
}

// ─── Full prompt assembly ────────────────────────────────────────────────────

/**
 * Assemble the complete system prompt from parts + template + language.
 */
function assemblePrompt(
  category: AICreatableCategory,
  parts: CreatorPromptParts,
  template: CapabilityTemplate,
  languageDirective: string
): string {
  const fenceTag = FENCE_TYPES[category]
  const categoryLabel = category.charAt(0).toUpperCase() + category.slice(1)

  const captureIntentItems = parts.captureIntent
    .map((item, i) => `${i + 1}. ${item}`)
    .join('\n')

  const researchRefineItems = parts.researchRefine
    .map(item => `- ${item}`)
    .join('\n')

  const principleItems = parts.principles
    .map((item, i) => `${i + 1}. ${item}`)
    .join('\n')

  const frontmatterRulesSection = buildFrontmatterRules(parts, template)

  const phase3 = buildPhase3(category, template, parts.bodyGuidance)

  return `${parts.role}

${parts.definition} Each ${category} has:
- **YAML frontmatter** with metadata fields
- **Markdown body** with the ${category} content

## Your Workflow

Follow these phases in order. Be conversational and helpful — not robotic.

### Phase 1: Capture Intent

Start by understanding what the user wants. Ask these key questions (adapt naturally):

${captureIntentItems}

Don't ask all at once if the user's message already answers some.

### Phase 2: Research & Refine

Once you understand the intent, probe deeper:
${researchRefineItems}

${phase3}

### Phase 4: Iterate

${parts.iterate}

## ${categoryLabel} Writing Principles

${principleItems}

## YAML Frontmatter Rules

${frontmatterRulesSection}

## Important

- Always wrap the complete ${category} output (frontmatter + body) in a \`\`\`${fenceTag} code fence
- Each revision should be a complete, standalone ${category} — not a diff or partial update
- ${languageDirective}
- Keep the ${category} name short and descriptive in English (kebab-case)`
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Get the AI Creator system prompt for a given category.
 *
 * Assembles the prompt from:
 *   - Category-specific parts (role, phases, principles)
 *   - Template-derived Phase 3 (output example + constraints)
 *   - Language directive (from user locale)
 */
export function getCreatorSystemPrompt(
  category: AICreatableCategory,
  locale?: string
): string {
  const parts = PROMPT_PARTS[category]
  const template = getTemplate(category)
  const languageDirective = resolveLanguageDirective(locale)

  return assemblePrompt(category, parts, template, languageDirective)
}
