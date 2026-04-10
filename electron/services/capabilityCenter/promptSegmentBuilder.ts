// SPDX-License-Identifier: Apache-2.0

/**
 * Prompt segment builder — builds XML segments for capability injection
 * into the system prompt.
 *
 * Phase 1B.11d: skill segments removed. Skills are now surfaced via the
 * SDK's built-in SkillTool (Options.commands → catalog + Skill('name')
 * activation). Only rule segments remain — rules are "always-on"
 * instructions that must be in the system prompt, not gated by activation.
 */

import type { DocumentCapabilityEntry } from '@shared/types'

export interface RulePromptSegment {
  kind: 'rule'
  id: string
  ruleName: string
  content: string
  charCost: number
}

export function buildRulePromptSegment(rule: DocumentCapabilityEntry): RulePromptSegment {
  const escapedName = escapeXmlAttribute(rule.name)
  const content = [
    `<rule name="${escapedName}">`,
    `  <instructions>${toCData(rule.body)}</instructions>`,
    '</rule>',
  ].join('\n')

  return {
    kind: 'rule',
    id: `rule:${rule.name}`,
    ruleName: rule.name,
    content,
    charCost: content.length,
  }
}

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function toCData(value: string): string {
  return `<![CDATA[${value.replace(/\]\]>/g, ']]]]><![CDATA[>')}]]>`
}
