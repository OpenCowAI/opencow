// SPDX-License-Identifier: Apache-2.0

/**
 * capabilityOutputParser — Extracts and validates AI-generated capability
 * output from conversation messages.
 *
 * Each AI Creator outputs its result inside a typed code fence:
 *   - ```skill-output   → Skill
 *   - ```agent-output   → Agent
 *   - ```command-output  → Command
 *   - ```rule-output     → Rule
 *
 * Uses the shared `codeFenceScanner` for the line-scanning state machine,
 * then applies capability-specific field mapping and **template-based
 * section validation** to detect incomplete output.
 *
 * @module
 */

import { scanLastFencedBlock, scanLastFencedBlockFromMessages, type ScannedFencedBlock, type ScanOptions } from './codeFenceScanner'
import { FENCE_TYPES, TAG_TO_CATEGORY, ALL_FENCE_TAGS, getTemplate, type CapabilityTemplate } from './capabilityTemplates'
import type { AICreatableCategory, ManagedSessionMessage } from './types'

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Result of validating a body against a capability template.
 */
export interface SectionValidation {
  /** Sections from the template that are present with content */
  present: string[]
  /** Required sections that are missing or have empty content */
  missingRequired: string[]
  /** Whether all required sections have substantive content */
  isComplete: boolean
}

export interface ParsedCapabilityOutput {
  /** Runtime discriminant — which category this output came from */
  kind: AICreatableCategory
  /** Capability name from frontmatter (kebab-case) */
  name: string
  /** Description from frontmatter */
  description: string
  /** Body (markdown content after frontmatter) */
  body: string
  /** Raw content including frontmatter — used for saving */
  raw: string
  /** Agent-specific: model selection */
  model?: string
  /** Agent-specific: color hex code */
  color?: string
  /** Command-specific: argument hint string */
  argumentHint?: string
  /**
   * `true` when the output is structurally incomplete:
   *   1. **Unclosed fence** — the code fence was never closed (scanner-level)
   *   2. **Missing required sections** — template validation detected gaps
   */
  isPartial?: boolean
  /**
   * Names of required sections that are missing or empty.
   * Used by auto-continuation to send targeted recovery prompts.
   * Empty array when output is complete.
   */
  missingSections?: string[]
}

// ─── Section extraction & validation ─────────────────────────────────────────

/** Matches a `## Heading` line (level 2 heading). */
const H2_RE = /^##\s+(.+)/

/**
 * Normalize a heading for fuzzy comparison.
 *
 * LLMs don't always reproduce headings exactly — they may change case,
 * substitute `&` with `and`, or add/remove whitespace. This function
 * normalizes both the template heading and the body heading so that
 * `"Role & Expertise"` matches `"Role and Expertise"`, `"role & expertise"`, etc.
 */
export function normalizeHeading(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Extract `## Heading` sections from a markdown body.
 *
 * Returns a Map of **normalized** heading text → trimmed content beneath it.
 * Content spans from the heading to the next `## ` or end of body.
 *
 * Only level-2 headings are extracted — `#` (title) and `###`+
 * (sub-headings within a section) are not treated as section boundaries.
 */
export function extractSections(body: string): Map<string, string> {
  const sections = new Map<string, string>()
  const lines = body.split('\n')
  let currentKey: string | null = null
  let currentLines: string[] = []

  for (const line of lines) {
    const match = H2_RE.exec(line)
    if (match) {
      // Save previous section
      if (currentKey !== null) {
        sections.set(currentKey, currentLines.join('\n').trim())
      }
      currentKey = normalizeHeading(match[1])
      currentLines = []
    } else if (currentKey !== null) {
      currentLines.push(line)
    }
  }

  // Save last section
  if (currentKey !== null) {
    sections.set(currentKey, currentLines.join('\n').trim())
  }

  return sections
}

/**
 * Validate a body against a capability template.
 *
 * Uses **normalized** heading comparison so that minor LLM output
 * variations (case, `&` vs `and`, whitespace) don't trigger false
 * positives that would cause unnecessary auto-continuation.
 *
 * Returns the validation result including the original template heading
 * names of any missing required sections — enabling targeted
 * auto-continuation prompts with the canonical names.
 */
export function validateSections(
  body: string,
  template: CapabilityTemplate
): SectionValidation {
  const bodySections = extractSections(body)
  const present: string[] = []
  const missingRequired: string[] = []

  for (const section of template.sections) {
    const key = normalizeHeading(section.heading)
    const content = bodySections.get(key)
    if (content && content.length > 0) {
      present.push(section.heading)
    } else if (section.required) {
      missingRequired.push(section.heading)
    }
  }

  return {
    present,
    missingRequired,
    isComplete: missingRequired.length === 0,
  }
}

// ─── Domain-specific mapping ─────────────────────────────────────────────────

/**
 * Map a scanned fenced block to a ParsedCapabilityOutput.
 *
 * Extracts common fields (name, description) and type-specific fields
 * (model, color for agents; argumentHint for commands).
 *
 * Sets `isPartial` when the scanner flagged an unclosed fence OR when
 * template-based section validation detects missing required sections.
 *
 * Returns null if the required `name` attribute is missing.
 */
function mapToCapabilityOutput(
  scanned: ScannedFencedBlock,
  category?: AICreatableCategory
): ParsedCapabilityOutput | null {
  const { attributes, body, raw, tag } = scanned

  const name = typeof attributes.name === 'string' ? attributes.name.trim() : ''
  const description =
    typeof attributes.description === 'string' ? attributes.description.trim() : ''

  if (!name) return null

  // Resolve the category from the detected fence tag
  const kind: AICreatableCategory = category ?? TAG_TO_CATEGORY[tag] ?? 'skill'

  const result: ParsedCapabilityOutput = { kind, name, description, body, raw }

  // Template-based completeness check:
  //   1. Scanner-level: unclosed code fence (token limit mid-fence)
  //   2. Template-level: required sections missing or empty
  const template = getTemplate(kind)
  const validation = validateSections(body, template)

  if (scanned.partial || !validation.isComplete) {
    result.isPartial = true
    result.missingSections = validation.missingRequired
  }

  // Extract category-specific frontmatter fields from the template.
  // No hardcoded category branches — adding a field to a template
  // automatically flows through to the parsed output.
  for (const field of template.frontmatterFields) {
    const value = attributes[field.key]
    if (typeof value === 'string') {
      ;(result as unknown as Record<string, unknown>)[field.outputField] = value.trim()
    }
  }

  return result
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Extract a ParsedCapabilityOutput from a single text block.
 * Returns null if no valid capability-output fence is found.
 *
 * When multiple output blocks exist, returns the **last** one
 * (the most recent revision).
 *
 * @param text - The full text to scan
 * @param category - Optional: only match this specific category's fence type.
 *                   When omitted, matches any recognized fence type.
 * @param options - Optional scan options (e.g. allowUnclosed for truncated output)
 */
export function parseCapabilityOutput(
  text: string,
  category?: AICreatableCategory,
  options?: ScanOptions
): ParsedCapabilityOutput | null {
  const tags = category ? [FENCE_TYPES[category]] : ALL_FENCE_TAGS
  const scanned = scanLastFencedBlock(text, tags, options)
  if (!scanned) return null
  return mapToCapabilityOutput(scanned, category)
}

/**
 * Scan session messages in reverse order and extract the most recent
 * capability-output from assistant messages.
 *
 * Automatically enables `allowUnclosed` to handle truncated AI output
 * (e.g. when the model hits its output token limit). Results from unclosed
 * fences are flagged with `isPartial: true`.
 *
 * @param messages - Session messages
 * @param category - Optional: only match a specific category's fence type
 */
export function extractLatestCapabilityOutput(
  messages: ManagedSessionMessage[],
  category?: AICreatableCategory
): ParsedCapabilityOutput | null {
  const tags = category ? [FENCE_TYPES[category]] : ALL_FENCE_TAGS
  const scanned = scanLastFencedBlockFromMessages(messages, tags, { allowUnclosed: true })
  if (!scanned) return null
  return mapToCapabilityOutput(scanned, category)
}
