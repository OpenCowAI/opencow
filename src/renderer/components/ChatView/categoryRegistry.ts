// SPDX-License-Identifier: Apache-2.0

import type { CapabilityCategory, CapabilityTypeMap, CapabilityEntryBase } from '@shared/types'
import type { CardProps } from './CapabilityCards'
import { Terminal, Zap, Bot, Webhook, Plug, FileText, Package, Server } from 'lucide-react'
import {
  SkillRow,
  CommandRow,
  AgentRow,
  RuleRow,
  MCPServerRow,
  HookRow,
  PluginRow,
  LSPServerRow,
} from './CapabilityCards'

// ── Category groups ─────────────────────────────────────────────────────────

export type CategoryGroupId = 'capabilities' | 'integrations' | 'extensions'

export interface CategoryGroupConfig {
  id: CategoryGroupId
  /** i18n key suffix → t(`categoryGroups.${titleKey}`) */
  titleKey: string
}

export const CATEGORY_GROUPS: readonly CategoryGroupConfig[] = [
  { id: 'capabilities', titleKey: 'capabilities' },
  { id: 'integrations', titleKey: 'integrations' },
  { id: 'extensions', titleKey: 'extensions' },
] as const

// ── Category config ─────────────────────────────────────────────────────────

export interface CategoryConfig {
  id: CapabilityCategory
  /** i18n key suffix → t(`capabilityCenter.categories.${titleKey}`) */
  titleKey: string
  icon: React.ComponentType<{ className?: string }>
  textColor: string
  bgColor: string
  /** Fields to search when filtering */
  searchFields: string[]
  /** Whether this category supports CRUD (create/edit/delete) */
  creatable: boolean
  /** Card layout mode: 'grid' (cards), 'list' (vertical stack), 'rows' (dense table-like rows) */
  layout: 'grid' | 'list' | 'rows'
  /** Card component for this category — type-safe via defineCategory() */
  card: React.ComponentType<CardProps<CapabilityEntryBase>>
  /** True if this category is managed by the Capability Center (uses snapshot API) */
  managed: boolean
  /** Semantic group this category belongs to */
  group: CategoryGroupId
}

/**
 * Type-safe category definition helper.
 *
 * SAFETY: The generic K ensures that `card` matches `CardProps<CapabilityTypeMap[K]>` exactly
 * at the registration site. The internal `as` widens the card type from the specific entry type
 * to `CapabilityEntryBase` to enable heterogeneous storage in CATEGORY_REGISTRY[].
 * At runtime, the entry object always has the correct shape because the registry guarantees
 * category→entry type correspondence.
 */
function defineCategory<K extends CapabilityCategory>(
  config: Omit<CategoryConfig, 'card'> & {
    id: K
    card: React.ComponentType<CardProps<CapabilityTypeMap[K]>>
  }
): CategoryConfig {
  return {
    ...config,
     
    card: config.card as React.ComponentType<CardProps<CapabilityEntryBase>>,
  }
}

export const CATEGORY_REGISTRY: CategoryConfig[] = [
  // ── Capabilities (core, user-managed) ──────────────────────────────
  defineCategory({
    id: 'skill',
    titleKey: 'skill',
    icon: Zap,
    textColor: 'text-amber-500',
    bgColor: 'bg-amber-500/10',
    searchFields: ['name', 'description'],
    creatable: true,
    layout: 'rows',
    card: SkillRow,
    managed: true,
    group: 'capabilities',
  }),
  defineCategory({
    id: 'command',
    titleKey: 'command',
    icon: Terminal,
    textColor: 'text-blue-500',
    bgColor: 'bg-blue-500/10',
    searchFields: ['name', 'description'],
    creatable: true,
    layout: 'rows',
    card: CommandRow,
    managed: true,
    group: 'capabilities',
  }),
  defineCategory({
    id: 'agent',
    titleKey: 'agent',
    icon: Bot,
    textColor: 'text-purple-500',
    bgColor: 'bg-purple-500/10',
    searchFields: ['name', 'description', 'model'],
    creatable: true,
    layout: 'rows',
    card: AgentRow,
    managed: true,
    group: 'capabilities',
  }),
  defineCategory({
    id: 'rule',
    titleKey: 'rule',
    icon: FileText,
    textColor: 'text-orange-500',
    bgColor: 'bg-orange-500/10',
    searchFields: ['name', 'description'],
    creatable: true,
    layout: 'rows',
    card: RuleRow,
    managed: true,
    group: 'capabilities',
  }),
  // ── Integrations (external connections) ───────────────────────────
  defineCategory({
    id: 'mcp-server',
    titleKey: 'mcp-server',
    icon: Plug,
    textColor: 'text-cyan-500',
    bgColor: 'bg-cyan-500/10',
    searchFields: ['name', 'description', 'author', 'serverType'],
    creatable: true,
    layout: 'rows',
    card: MCPServerRow,
    managed: true,
    group: 'integrations',
  }),
  defineCategory({
    id: 'hook',
    titleKey: 'hook',
    icon: Webhook,
    textColor: 'text-green-500',
    bgColor: 'bg-green-500/10',
    searchFields: ['name'],
    creatable: true,
    layout: 'rows',
    card: HookRow,
    managed: true,
    group: 'integrations',
  }),
  // ── Extensions (read-only, legacy) ────────────────────────────────
  defineCategory({
    id: 'plugin',
    titleKey: 'plugin',
    icon: Package,
    textColor: 'text-pink-500',
    bgColor: 'bg-pink-500/10',
    searchFields: ['name', 'description', 'author'],
    creatable: false,
    layout: 'rows',
    card: PluginRow,
    managed: false,
    group: 'extensions',
  }),
  defineCategory({
    id: 'lsp-server',
    titleKey: 'lsp-server',
    icon: Server,
    textColor: 'text-teal-500',
    bgColor: 'bg-teal-500/10',
    searchFields: ['name', 'description', 'command'],
    creatable: false,
    layout: 'rows',
    card: LSPServerRow,
    managed: false,
    group: 'extensions',
  }),
]

/** Quick lookup by category id */
export const CATEGORY_MAP = Object.fromEntries(
  CATEGORY_REGISTRY.map(c => [c.id, c])
) as Record<CapabilityCategory, CategoryConfig>

/**
 * Returns categories grouped by their semantic group, preserving registry order.
 * Pure function over module-level constants — safe to call in render without memo.
 */
export function groupedCategories(): Array<{
  group: CategoryGroupConfig
  categories: CategoryConfig[]
}> {
  return CATEGORY_GROUPS.map(group => ({
    group,
    categories: CATEGORY_REGISTRY.filter(c => c.group === group.id),
  }))
}
