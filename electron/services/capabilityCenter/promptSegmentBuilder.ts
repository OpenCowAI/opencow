// SPDX-License-Identifier: Apache-2.0

import type { DocumentCapabilityEntry } from '@shared/types'
import { buildFrontmatter } from '@shared/frontmatter'
import type { SkillActivationDecision } from './skillActivationEngine'

export interface SkillPromptSegment {
  kind: 'skill'
  id: string
  skillName: string
  mode: SkillActivationDecision['mode']
  source: SkillActivationDecision['source']
  content: string
  charCost: number
}

export interface RulePromptSegment {
  kind: 'rule'
  id: string
  ruleName: string
  content: string
  charCost: number
}

export function buildSkillPromptSegment(
  skill: DocumentCapabilityEntry,
  decision: SkillActivationDecision,
): SkillPromptSegment {
  const isEvose = skill.metadata?.['provider'] === 'evose'
  const content = isEvose
    ? buildEvoseSkillContent(skill, decision)
    : buildRegularSkillContent(skill, decision)

  return {
    kind: 'skill',
    id: `skill:${skill.name}`,
    skillName: skill.name,
    mode: decision.mode,
    source: decision.source,
    content,
    charCost: content.length,
  }
}

/**
 * Build prompt content for Evose skills.
 *
 * Uses `<evose-app>` tag instead of `<skill>` to prevent Claude from
 * associating these capabilities with the SDK's built-in Skill tool.
 * Evose apps are invoked via dedicated gateway tools (evose_run_agent /
 * evose_run_workflow), not through the Skill tool dispatch mechanism.
 */
function buildEvoseSkillContent(
  skill: DocumentCapabilityEntry,
  decision: SkillActivationDecision,
): string {
  const escapedName = escapeXmlAttribute(skill.name)
  const escapedMode = escapeXmlAttribute(decision.mode)
  const escapedSource = escapeXmlAttribute(decision.source)
  const gatewayTool = escapeXmlAttribute(String(skill.metadata?.['gatewayTool'] ?? 'evose_run_agent'))
  const appId = escapeXmlAttribute(String(skill.metadata?.['appId'] ?? ''))

  if (decision.mode === 'full') {
    return [
      `<evose-app name="${escapedName}" mode="${escapedMode}" source="${escapedSource}" gateway-tool="${gatewayTool}" app-id="${appId}">`,
      `  <instructions>${toCData(skill.body)}</instructions>`,
      '</evose-app>',
    ].join('\n')
  }

  return [
    `<evose-app name="${escapedName}" mode="${escapedMode}" source="${escapedSource}" gateway-tool="${gatewayTool}" app-id="${appId}">`,
    `  <frontmatter>${toCData(buildCatalogFrontmatter(skill))}</frontmatter>`,
    '</evose-app>',
  ].join('\n')
}

function buildRegularSkillContent(
  skill: DocumentCapabilityEntry,
  decision: SkillActivationDecision,
): string {
  const escapedName = escapeXmlAttribute(skill.name)
  const escapedMode = escapeXmlAttribute(decision.mode)
  const escapedSource = escapeXmlAttribute(decision.source)

  if (decision.mode === 'full') {
    return [
      `<skill name="${escapedName}" mode="${escapedMode}" source="${escapedSource}">`,
      `  <instructions>${toCData(skill.body)}</instructions>`,
      '</skill>',
    ].join('\n')
  }

  return [
    `<skill name="${escapedName}" mode="${escapedMode}" source="${escapedSource}">`,
    `  <frontmatter>${toCData(buildCatalogFrontmatter(skill))}</frontmatter>`,
    '</skill>',
  ].join('\n')
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

function buildCatalogFrontmatter(skill: DocumentCapabilityEntry): string {
  const attributes: Record<string, unknown> = { ...skill.attributes }

  const name = attributes['name']
  if (typeof name !== 'string' || name.trim().length === 0) {
    attributes['name'] = skill.name
  }

  const description = attributes['description']
  if ((typeof description !== 'string' || description.trim().length === 0) && skill.description.trim().length > 0) {
    attributes['description'] = skill.description
  }

  return buildFrontmatter(attributes)
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
