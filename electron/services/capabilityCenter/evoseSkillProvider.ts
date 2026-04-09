// SPDX-License-Identifier: Apache-2.0

import type {
  CapabilityMountInfo,
  DocumentCapabilityEntry,
  EvoseAppConfig,
  EvoseSettings,
} from '@shared/types'
import { buildFrontmatter } from '@shared/frontmatter'
import { sanitizeEvoseAppName } from '@shared/evoseNames'
import { NativeCapabilityTools } from '@shared/nativeCapabilityToolNames'

interface SkillToggleLike {
  enabled: boolean
  tags: string[]
}

const VIRTUAL_EVOSE_SKILL_PREFIX = 'evose://skill/'

const EVOSE_MOUNT_INFO: CapabilityMountInfo = {
  namespace: 'evose',
  marketplace: 'evose',
  version: 'settings',
  sourceOrigin: 'plugin',
}

export class EvoseSkillProvider {
  constructor(
    private readonly getEvoseSettings: () => EvoseSettings,
  ) {}

  projectSkills(toggleByName: ReadonlyMap<string, SkillToggleLike>): DocumentCapabilityEntry[] {
    const apps = [...this.getEvoseSettings().apps]
      .sort((a, b) => a.name.localeCompare(b.name) || a.appId.localeCompare(b.appId))

    return apps.map((app) => {
      const skillName = buildSkillName(app)
      const sourcePath = buildVirtualSourcePath(app.appId)
      const baseEnabled = app.enabled
      const toggle = toggleByName.get(skillName)
      const enabled = baseEnabled && (toggle?.enabled ?? true)
      const tags = toggle?.tags ?? []

      const description = buildSkillDescription(app)
      const body = buildSkillBody(app)
      const attributes = {
        name: skillName,
        description,
        tags: ['evose', app.type],
        keywords: buildKeywords(app),
        aliases: buildAliases(skillName, app.name),
      }

      return {
        kind: 'document',
        name: skillName,
        description,
        body,
        attributes,
        filePath: sourcePath,
        category: 'skill',
        scope: 'global',
        enabled,
        tags,
        eligibility: { eligible: true, reasons: [] },
        metadata: {
          provider: 'evose',
          projected: true,
          appId: app.appId,
          appType: app.type,
          displayName: app.name,
          avatar: app.avatar,
          gatewayTool: app.type === 'agent' ? 'evose_run_agent' : 'evose_run_workflow',
          nativeRequirements: [{ capability: 'evose' }],
        },
        importInfo: {
          sourcePath,
          sourceOrigin: 'plugin',
          sourceHash: null,
          importedAt: 0,
        },
        distributionInfo: null,
        distributionTargets: undefined,
        mountInfo: EVOSE_MOUNT_INFO,
      }
    })
  }

  readVirtualSource(sourcePath: string): string | null {
    const appId = parseVirtualSourcePath(sourcePath)
    if (!appId) return null
    const app = this.getEvoseSettings().apps.find((candidate) => candidate.appId === appId)
    if (!app) return null
    const skillName = buildSkillName(app)
    const description = buildSkillDescription(app)
    const frontmatter = buildFrontmatter({
      name: skillName,
      description,
      tags: ['evose', app.type],
      keywords: buildKeywords(app),
    })
    return `${frontmatter}\n\n${buildSkillBody(app)}`
  }
}

export function isEvoseVirtualSkillSourcePath(sourcePath: string): boolean {
  return sourcePath.startsWith(VIRTUAL_EVOSE_SKILL_PREFIX)
}

function buildVirtualSourcePath(appId: string): string {
  return `${VIRTUAL_EVOSE_SKILL_PREFIX}${encodeURIComponent(appId)}`
}

function parseVirtualSourcePath(sourcePath: string): string | null {
  if (!sourcePath.startsWith(VIRTUAL_EVOSE_SKILL_PREFIX)) return null
  const encoded = sourcePath.slice(VIRTUAL_EVOSE_SKILL_PREFIX.length)
  if (!encoded) return null
  try {
    return decodeURIComponent(encoded)
  } catch {
    return null
  }
}

function buildSkillName(app: EvoseAppConfig): string {
  const namePart = sanitizeEvoseAppName(app.name) || sanitizeToken(app.appId)
  const suffix = shortStableToken(app.appId)
  return `evose:${namePart}_${suffix}`
}

function buildSkillDescription(app: EvoseAppConfig): string {
  const trimmed = app.description?.trim()
  const gatewayTool = app.type === 'agent' ? 'evose_run_agent' : 'evose_run_workflow'
  if (trimmed) return `${trimmed} (invoke via \`${gatewayTool}\`, not the Skill tool)`
  return `Run Evose ${app.type} "${app.name}" via \`${gatewayTool}\` tool directly (not via the Skill tool).`
}

/**
 * Build matchable aliases for implicit skill matching.
 *
 * The internal skill name (e.g. "evose:x_analyst_ja4t9n") includes a namespace
 * prefix and hash suffix that users never type. The original app name
 * ("X Analyst") is what users naturally reference in conversation, so it is
 * declared as an alias for the implicit matching scorer to consume.
 */
function buildAliases(skillName: string, appName: string): string[] {
  const trimmed = appName.trim()
  if (!trimmed || trimmed === skillName) return []
  return [trimmed]
}

function buildKeywords(app: EvoseAppConfig): string[] {
  return [
    'evose',
    app.type,
    ...tokenize(app.name),
    ...tokenize(app.description ?? ''),
  ].filter((value, index, arr) => value.length > 0 && arr.indexOf(value) === index)
}

function buildSkillBody(app: EvoseAppConfig): string {
  const escapedName = app.name.replace(/"/g, '\\"')
  // Phase 1B.11b: tool names are now BARE (no MCP prefix) because OpenCow
  // uses the SDK's inline tool exit (`Options.tools?: SdkTool[]`) instead of
  // the MCP exit (`Options.mcpServers`). The model sees the descriptor name
  // verbatim — no `mcp__opencow-capabilities__` transport-layer prefix.
  // NativeCapabilityTools.EVOSE_RUN_AGENT now resolves to `'evose_run_agent'`.
  const toolName = app.type === 'agent'
    ? NativeCapabilityTools.EVOSE_RUN_AGENT
    : NativeCapabilityTools.EVOSE_RUN_WORKFLOW

  if (app.type === 'agent') {
    return [
      `Use this capability to run Evose Agent "${escapedName}".`,
      '',
      'IMPORTANT: This is an Evose app, NOT a regular skill.',
      `Do NOT use the Skill tool to invoke this. Call the \`${toolName}\` tool DIRECTLY.`,
      '',
      `Call \`${toolName}\` with:`,
      `- app_id: "${app.appId}"`,
      '- input: a concise, task-focused instruction',
      '- session_id: optional, only for continuing an existing Evose thread',
      '',
      'Rules:',
      '- Never change app_id.',
      '- Ask for missing constraints before invoking the tool.',
      '- Return the tool result directly; do not fabricate output.',
    ].join('\n')
  }

  return [
    `Use this capability to run Evose Workflow "${escapedName}".`,
    '',
    'IMPORTANT: This is an Evose app, NOT a regular skill.',
    `Do NOT use the Skill tool to invoke this. Call the \`${toolName}\` tool DIRECTLY.`,
    '',
    `Call \`${toolName}\` with:`,
    `- app_id: "${app.appId}"`,
    '- inputs: a structured object containing required workflow parameters',
    '',
    'Rules:',
    '- Never change app_id.',
    '- Build `inputs` explicitly with typed keys and values.',
    '- Ask for missing required parameters before invoking the tool.',
    '- Return the tool result directly; do not fabricate output.',
  ].join('\n')
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
}

function sanitizeToken(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return cleaned || 'app'
}

function shortStableToken(value: string): string {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0
  }
  return Math.abs(hash).toString(36).slice(0, 6).padStart(6, '0')
}
