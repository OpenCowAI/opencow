// SPDX-License-Identifier: Apache-2.0

import type {
  SlashCommandExecutionContract,
  StartSessionNativeToolAllowItem,
  UserMessageContent,
} from './types'
import type { SlashItemExecutionMeta } from './slashItems'

const EVOSE_CAPABILITY = 'evose'

export function createEmptySlashExecutionContract(): SlashCommandExecutionContract {
  return { nativeRequirements: [] }
}

export function normalizeSlashExecutionContract(
  value: SlashCommandExecutionContract | null | undefined,
): SlashCommandExecutionContract {
  if (!value) return createEmptySlashExecutionContract()

  const nativeRequirements = normalizeNativeRequirements(value.nativeRequirements)
  const providerExecution = normalizeProviderExecution(value.providerExecution)

  // Provider metadata must be self-consistent with native requirements.
  if (providerExecution?.provider === 'evose' && !hasCapability(nativeRequirements, EVOSE_CAPABILITY)) {
    nativeRequirements.push({ capability: EVOSE_CAPABILITY })
  }

  return providerExecution
    ? { nativeRequirements, providerExecution }
    : { nativeRequirements }
}

export function isSlashExecutionContractMeaningful(
  contract: SlashCommandExecutionContract | null | undefined,
): boolean {
  if (!contract) return false
  return contract.nativeRequirements.length > 0 || contract.providerExecution !== undefined
}

export function compactSlashExecutionContract(
  value: SlashCommandExecutionContract | null | undefined,
): SlashCommandExecutionContract | undefined {
  const normalized = normalizeSlashExecutionContract(value)
  return isSlashExecutionContractMeaningful(normalized) ? normalized : undefined
}

export function deriveSlashExecutionContractFromItemExecutionMeta(
  meta: SlashItemExecutionMeta | undefined,
): SlashCommandExecutionContract {
  if (!meta) return createEmptySlashExecutionContract()

  if (
    meta.provider === 'evose' &&
    meta.app &&
    (meta.app.gatewayTool === 'evose_run_agent' || meta.app.gatewayTool === 'evose_run_workflow')
  ) {
    return {
      nativeRequirements: [{ capability: EVOSE_CAPABILITY }],
      providerExecution: {
        provider: 'evose',
        appId: meta.app.id,
        appType: meta.app.type,
        gatewayTool: meta.app.gatewayTool,
      },
    }
  }

  return createEmptySlashExecutionContract()
}

export function extractNativeRequirementsFromContent(
  content: UserMessageContent,
): StartSessionNativeToolAllowItem[] {
  if (typeof content === 'string') return []

  const out: StartSessionNativeToolAllowItem[] = []
  const seen = new Set<string>()
  const append = (entry: StartSessionNativeToolAllowItem): void => {
    const capability = entry.capability.trim()
    if (!capability) return
    const tool = entry.tool?.trim()
    const key = `${capability}::${tool ?? '*'}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(tool ? { capability, tool } : { capability })
  }

  for (const block of content) {
    if (block.type !== 'slash_command') continue
    const normalized = normalizeSlashExecutionContract(block.execution)
    for (const item of normalized.nativeRequirements) append(item)
  }

  return out
}

function normalizeNativeRequirements(
  requirements: ReadonlyArray<StartSessionNativeToolAllowItem> | undefined,
): StartSessionNativeToolAllowItem[] {
  if (!requirements || requirements.length === 0) return []
  const out: StartSessionNativeToolAllowItem[] = []
  const seen = new Set<string>()
  for (const raw of requirements) {
    const capability = raw.capability.trim()
    if (!capability) continue
    const tool = raw.tool?.trim()
    const key = `${capability}::${tool ?? '*'}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(tool ? { capability, tool } : { capability })
  }
  return out
}

function normalizeProviderExecution(
  providerExecution: SlashCommandExecutionContract['providerExecution'],
): SlashCommandExecutionContract['providerExecution'] {
  if (!providerExecution) return undefined
  if (providerExecution.provider !== 'evose') return undefined

  const appId = providerExecution.appId.trim()
  if (!appId) return undefined
  if (providerExecution.appType !== 'agent' && providerExecution.appType !== 'workflow') return undefined
  if (
    providerExecution.gatewayTool !== 'evose_run_agent' &&
    providerExecution.gatewayTool !== 'evose_run_workflow'
  ) {
    return undefined
  }

  return {
    provider: 'evose',
    appId,
    appType: providerExecution.appType,
    gatewayTool: providerExecution.gatewayTool,
  }
}

function hasCapability(requirements: StartSessionNativeToolAllowItem[], capability: string): boolean {
  return requirements.some((item) => item.capability === capability)
}
