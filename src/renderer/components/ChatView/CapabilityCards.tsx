// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from 'react-i18next'
import {
  Terminal,
  Zap,
  Bot,
  Webhook,
  Plug,
  FileText,
  Package,
  Server,
  ArrowRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Switch } from '@/components/ui/switch'
import { ORIGIN_REGISTRY, LOCAL_ORIGIN_CONFIG, deriveSourceOrigin } from '@/lib/originConfig'
import type { TFunction } from 'i18next'
import type {
  CapabilityCategory,
  CapabilityEntryBase,
  CapabilitySource,
  CapabilityEntry,
  CapabilityImportRecord,
  CommandEntry,
  SkillEntry,
  AgentEntry,
  HookEventConfig,
  MCPServerEntry,
  RuleEntry,
  PluginEntry,
  LSPServerEntry,
  CapabilityIdentifier
} from '@shared/types'

// ═══════════════════════════════════════════════════════════════════════
// Shared helpers
// ═══════════════════════════════════════════════════════════════════════

/** Props shared by all selectable capability rows. */
export interface CardProps<T> {
  entry: T
  onSelect: (id: CapabilityIdentifier) => void
  isSelected: boolean
  /** Explicit CapabilityEntry — provided for managed categories, absent for legacy */
  capability?: CapabilityEntry
  /** Toggle callback — only present for managed capability entries */
  onToggle?: (entry: CapabilityEntry, enabled: boolean) => void
}

function scopeBadgeProps(source: CapabilitySource, t: TFunction<'sessions'>): { label: string; colorClass: string } {
  if (source.scope === 'project') return {
    label: t('capabilityCenter.scopeProject', 'Project'),
    colorClass: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  }
  if (source.origin === 'plugin' && source.mount) return {
    label: source.mount.name,
    colorClass: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
  }
  // Global scope — all non-plugin origins (user, marketplace, etc.)
  return {
    label: t('capabilityCenter.scopeGlobal', 'Global'),
    colorClass: 'bg-gray-500/10 text-gray-600 dark:text-gray-400',
  }
}

// ═══════════════════════════════════════════════════════════════════════
// RowShell — Linear-style dense row container
// ═══════════════════════════════════════════════════════════════════════

interface RowShellProps {
  category: CapabilityCategory
  entry: CapabilityEntryBase
  isSelected: boolean
  onSelect: (id: CapabilityIdentifier) => void
  ariaLabel: string
  children: React.ReactNode
  capability?: CapabilityEntry
  onToggle?: (entry: CapabilityEntry, enabled: boolean) => void
}

function RowShell({
  category,
  entry,
  isSelected,
  onSelect,
  ariaLabel,
  children,
  capability,
  onToggle,
}: RowShellProps): React.JSX.Element {
  const identifier: CapabilityIdentifier = {
    category,
    name: entry.name,
    source: entry.source,
  }

  return (
    <div
      className={cn(
        'group flex items-center gap-2.5 px-4 h-10 cursor-pointer transition-colors outline-none overflow-hidden',
        'hover:bg-[hsl(var(--foreground)/0.02)]',
        'focus-visible:bg-[hsl(var(--primary)/0.05)] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[hsl(var(--ring))]',
        isSelected && 'bg-[hsl(var(--primary)/0.04)]',
        capability && !capability.enabled && 'opacity-40',
      )}
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      onClick={() => onSelect(identifier)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(identifier)
        }
      }}
    >
      {children}
      {/* Toggle — visible on hover, positioned before the arrow */}
      {capability && onToggle && (
        <div
          className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <Switch
            checked={capability.enabled}
            onChange={(checked) => onToggle(capability, checked)}
            size="sm"
            label={capability.enabled ? 'Disable' : 'Enable'}
          />
        </div>
      )}
      {/* Hover arrow — click affordance */}
      <ArrowRight
        className="h-3 w-3 shrink-0 text-[hsl(var(--muted-foreground)/0.3)] opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150"
        aria-hidden="true"
      />
    </div>
  )
}

// ── Micro-components for row internals ──────────────────────────────

/** Compact inline tags — max 2 shown */
function InlineTags({ tags }: { tags: string[] }): React.JSX.Element | null {
  if (tags.length === 0) return null
  const shown = tags.slice(0, 2)
  const extra = tags.length - shown.length
  return (
    <div className="flex items-center gap-1 shrink-0">
      {shown.map((tag) => (
        <span
          key={tag}
          className="text-[10px] leading-none px-1.5 py-0.5 rounded-md bg-[hsl(var(--muted)/0.4)] text-[hsl(var(--muted-foreground)/0.8)]"
        >
          {tag}
        </span>
      ))}
      {extra > 0 && (
        <span className="text-[10px] text-[hsl(var(--muted-foreground)/0.5)]">
          +{extra}
        </span>
      )}
    </div>
  )
}

/** Inline scope badge */
function ScopeBadge({ source }: { source: CapabilitySource }): React.JSX.Element {
  const { t } = useTranslation('sessions')
  const { label, colorClass } = scopeBadgeProps(source, t)
  return (
    <span className={cn('text-[10px] px-1.5 py-0.5 rounded-md shrink-0', colorClass)}>
      {label}
    </span>
  )
}

// ── Origin & Sync indicators ────────────────────────────────────────

/**
 * Origin badge — text label showing capability provenance.
 *
 * Resolution priority:
 *   1. `importInfo.sourceOrigin` — most specific (managed entries with DB record)
 *   2. `deriveSourceOrigin(source)` — derived from universal CapabilitySource
 *   3. LOCAL_ORIGIN_CONFIG — fallback ("Custom")
 */
function OriginBadge({ source, importInfo }: {
  source: CapabilitySource
  importInfo?: CapabilityImportRecord | null
}): React.JSX.Element {
  const resolved = importInfo?.sourceOrigin ?? deriveSourceOrigin(source)
  const config = resolved
    ? (ORIGIN_REGISTRY[resolved] ?? LOCAL_ORIGIN_CONFIG)
    : LOCAL_ORIGIN_CONFIG

  return (
    <span className={cn('text-[10px] px-1.5 py-0.5 rounded-md shrink-0', config.badgeClass)}>
      {config.label}
    </span>
  )
}

function resolveDistributionTargets(capability?: CapabilityEntry): string[] {
  if (!capability) return []
  if (Array.isArray(capability.distributionTargets) && capability.distributionTargets.length > 0) {
    return capability.distributionTargets
  }
  if (capability.distributionInfo?.targetType) {
    return [capability.distributionInfo.targetType]
  }
  return []
}

function DistributionBadge({ capability }: { capability?: CapabilityEntry }): React.JSX.Element | null {
  const { t } = useTranslation('sessions')
  const targetTypes = resolveDistributionTargets(capability)
  if (targetTypes.length === 0) return null

  const hasClaude = targetTypes.some((targetType) => targetType.startsWith('claude-code-'))
  const hasCodex = targetTypes.some((targetType) => targetType.startsWith('codex-'))
  if (!hasClaude && !hasCodex) return null

  // Avoid redundant badges:
  // when a capability is imported from one engine and only published to that same engine,
  // OriginBadge already conveys equivalent information (e.g. "Claude Code", "Codex").
  const sourceOrigin = capability?.importInfo?.sourceOrigin
  if (hasClaude !== hasCodex) {
    if (hasClaude && sourceOrigin === 'claude-code') return null
    if (hasCodex && sourceOrigin === 'codex') return null
  }

  let label: string
  let badgeClass: string
  if (hasClaude && hasCodex) {
    label = t('capabilityCenter.distribution.both')
    badgeClass = 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400'
  } else if (hasClaude) {
    label = t('capabilityCenter.distribution.claude')
    badgeClass = 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
  } else {
    label = t('capabilityCenter.distribution.codex')
    badgeClass = 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400'
  }

  return (
    <span
      className={cn('text-[10px] px-1.5 py-0.5 rounded-md shrink-0', badgeClass)}
      title={t('capabilityCenter.distribution.aria', { target: label })}
    >
      {label}
    </span>
  )
}

// ── Shared row layout tokens ────────────────────────────────────────

/** Row name — elastic width, shrinkable so right-side elements (badges, switch) stay anchored */
const ROW_NAME = 'text-[13px] font-medium truncate min-w-[100px] max-w-[320px]'
/** Row description — fills remaining space, muted */
const ROW_DESC = 'text-xs text-[hsl(var(--muted-foreground)/0.55)] truncate flex-1 min-w-0'

// ═══════════════════════════════════════════════════════════════════════
// Row variants
// ═══════════════════════════════════════════════════════════════════════

export function SkillRow({
  entry: skill,
  onSelect,
  isSelected,
  capability,
  onToggle,
}: CardProps<SkillEntry>): React.JSX.Element {
  return (
    <RowShell
      category="skill"
      entry={skill}
      isSelected={isSelected}
      onSelect={onSelect}
      capability={capability}
      onToggle={onToggle}
      ariaLabel={`Skill: ${skill.name}`}
    >
      <Zap className="h-3.5 w-3.5 text-amber-500 shrink-0" aria-hidden="true" />
      <span className={ROW_NAME}>{skill.name}</span>
      {skill.description && <span className={ROW_DESC}>{skill.description}</span>}
      {!skill.description && <span className="flex-1" />}
      {capability?.tags && <InlineTags tags={capability.tags} />}

      <DistributionBadge capability={capability} />
      <OriginBadge source={skill.source} importInfo={capability?.importInfo} />
      <ScopeBadge source={skill.source} />
    </RowShell>
  )
}

export function CommandRow({
  entry: command,
  onSelect,
  isSelected,
  capability,
  onToggle,
}: CardProps<CommandEntry>): React.JSX.Element {
  return (
    <RowShell
      category="command"
      entry={command}
      isSelected={isSelected}
      onSelect={onSelect}
      capability={capability}
      onToggle={onToggle}
      ariaLabel={`Command: /${command.name}`}
    >
      <Terminal className="h-3.5 w-3.5 text-blue-500 shrink-0" aria-hidden="true" />
      <span className={ROW_NAME}>/{command.name}</span>
      {command.description && <span className={ROW_DESC}>{command.description}</span>}
      {!command.description && <span className="flex-1" />}
      {capability?.tags && <InlineTags tags={capability.tags} />}

      <DistributionBadge capability={capability} />
      <OriginBadge source={command.source} importInfo={capability?.importInfo} />
      <ScopeBadge source={command.source} />
    </RowShell>
  )
}

export function AgentRow({
  entry: agent,
  onSelect,
  isSelected,
  capability,
  onToggle,
}: CardProps<AgentEntry>): React.JSX.Element {
  return (
    <RowShell
      category="agent"
      entry={agent}
      isSelected={isSelected}
      onSelect={onSelect}
      capability={capability}
      onToggle={onToggle}
      ariaLabel={`Agent: ${agent.name}`}
    >
      {agent.color ? (
        <span
          className="h-3 w-3 rounded-full shrink-0"
          style={{ backgroundColor: agent.color }}
          aria-hidden="true"
        />
      ) : (
        <Bot className="h-3.5 w-3.5 text-purple-500 shrink-0" aria-hidden="true" />
      )}
      <span className={ROW_NAME}>{agent.name}</span>
      {agent.description && <span className={ROW_DESC}>{agent.description}</span>}
      {!agent.description && <span className="flex-1" />}
      {agent.model && (
        <span className="text-[10px] text-[hsl(var(--muted-foreground)/0.4)] shrink-0 font-mono">
          {agent.model}
        </span>
      )}
      {capability?.tags && <InlineTags tags={capability.tags} />}

      <DistributionBadge capability={capability} />
      <OriginBadge source={agent.source} importInfo={capability?.importInfo} />
      <ScopeBadge source={agent.source} />
    </RowShell>
  )
}

export function RuleRow({
  entry: rule,
  onSelect,
  isSelected,
  capability,
  onToggle,
}: CardProps<RuleEntry>): React.JSX.Element {
  return (
    <RowShell
      category="rule"
      entry={rule}
      isSelected={isSelected}
      onSelect={onSelect}
      capability={capability}
      onToggle={onToggle}
      ariaLabel={`Rule: ${rule.name}`}
    >
      <FileText className="h-3.5 w-3.5 text-orange-500 shrink-0" aria-hidden="true" />
      <span className={ROW_NAME}>{rule.name}</span>
      {rule.description && <span className={ROW_DESC}>{rule.description}</span>}
      {!rule.description && <span className="flex-1" />}
      {rule.ruleType && (
        <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-orange-500/8 text-orange-600 dark:text-orange-400 shrink-0">
          {rule.ruleType}
        </span>
      )}
      {capability?.tags && <InlineTags tags={capability.tags} />}

      <DistributionBadge capability={capability} />
      <OriginBadge source={rule.source} importInfo={capability?.importInfo} />
      <ScopeBadge source={rule.source} />
    </RowShell>
  )
}

export function MCPServerRow({
  entry: server,
  onSelect,
  isSelected,
  capability,
  onToggle,
}: CardProps<MCPServerEntry>): React.JSX.Element {
  return (
    <RowShell
      category="mcp-server"
      entry={server}
      isSelected={isSelected}
      onSelect={onSelect}
      capability={capability}
      onToggle={onToggle}
      ariaLabel={`MCP Server: ${server.name}`}
    >
      <Plug className="h-3.5 w-3.5 text-cyan-500 shrink-0" aria-hidden="true" />
      <span className={ROW_NAME}>{server.name}</span>
      {server.description && <span className={ROW_DESC}>{server.description}</span>}
      {!server.description && <span className="flex-1" />}
      {server.serverType && (
        <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-cyan-500/8 text-cyan-600 dark:text-cyan-400 shrink-0">
          {server.serverType}
        </span>
      )}
      {capability?.tags && <InlineTags tags={capability.tags} />}

      <DistributionBadge capability={capability} />
      <OriginBadge source={server.source} importInfo={capability?.importInfo} />
      <ScopeBadge source={server.source} />
    </RowShell>
  )
}

export function HookRow({
  entry: config,
  onSelect,
  isSelected,
  capability,
  onToggle,
}: CardProps<HookEventConfig>): React.JSX.Element {
  const totalRules = config.ruleGroups.reduce((sum, g) => sum + g.hooks.length, 0)

  return (
    <RowShell
      category="hook"
      entry={config}
      isSelected={isSelected}
      onSelect={onSelect}
      capability={capability}
      onToggle={onToggle}
      ariaLabel={`${config.name} hook event, ${totalRules} rules`}
    >
      <Webhook className="h-3.5 w-3.5 text-green-500 shrink-0" aria-hidden="true" />
      <span className={ROW_NAME}>{config.name}</span>
      <span className={ROW_DESC}>
        {totalRules} rule{totalRules !== 1 ? 's' : ''}
      </span>
      {capability?.tags && <InlineTags tags={capability.tags} />}

      <DistributionBadge capability={capability} />
      <OriginBadge source={config.source} importInfo={capability?.importInfo} />
      <ScopeBadge source={config.source} />
    </RowShell>
  )
}

export function PluginRow({
  entry: plugin,
  onSelect,
  isSelected,
}: CardProps<PluginEntry>): React.JSX.Element {
  const { t } = useTranslation('sessions')
  const { t: tCommon } = useTranslation('common')

  // Compact capability summary: "3 cmd · 2 skill · 1 agent"
  const capParts = [
    plugin.capabilities.commands > 0 && t('capabilityCards.cmdCount', { count: plugin.capabilities.commands }),
    plugin.capabilities.skills > 0 && t('capabilityCards.skillCount', { count: plugin.capabilities.skills }),
    plugin.capabilities.agents > 0 && t('capabilityCards.agentCount', { count: plugin.capabilities.agents }),
    plugin.capabilities.hooks > 0 && t('capabilityCards.hookCount', { count: plugin.capabilities.hooks }),
  ].filter(Boolean) as string[]

  return (
    <RowShell
      category="plugin"
      entry={plugin}
      isSelected={isSelected}
      onSelect={onSelect}
      ariaLabel={`Plugin: ${plugin.name}`}
    >
      <Package className="h-3.5 w-3.5 text-pink-500 shrink-0" aria-hidden="true" />
      <span className={ROW_NAME}>{plugin.name}</span>
      {plugin.description && <span className={ROW_DESC}>{plugin.description}</span>}
      {!plugin.description && <span className="flex-1" />}
      {plugin.version && (
        <span className="text-[10px] text-[hsl(var(--muted-foreground)/0.4)] shrink-0 font-mono">
          v{plugin.version}
        </span>
      )}
      {capParts.length > 0 && (
        <span className="text-[10px] text-[hsl(var(--muted-foreground)/0.4)] shrink-0 hidden sm:inline">
          {capParts.join(' · ')}
        </span>
      )}
      {/* Enabled / Disabled status badge */}
      <span className={cn(
        'text-[10px] px-1.5 py-0.5 rounded-md shrink-0',
        plugin.enabled
          ? 'bg-green-500/10 text-green-600 dark:text-green-400'
          : 'bg-gray-500/10 text-gray-500 dark:text-gray-400',
      )}>
        {plugin.enabled ? tCommon('enabled') : tCommon('disabled')}
      </span>
      <OriginBadge source={plugin.source} />
      <ScopeBadge source={plugin.source} />
    </RowShell>
  )
}

export function LSPServerRow({
  entry: server,
  onSelect,
  isSelected,
}: CardProps<LSPServerEntry>): React.JSX.Element {
  return (
    <RowShell
      category="lsp-server"
      entry={server}
      isSelected={isSelected}
      onSelect={onSelect}
      ariaLabel={`LSP Server: ${server.name}`}
    >
      <Server className="h-3.5 w-3.5 text-teal-500 shrink-0" aria-hidden="true" />
      <span className={ROW_NAME}>{server.name}</span>
      {server.description && <span className={ROW_DESC}>{server.description}</span>}
      {!server.description && <span className="flex-1" />}
      {server.command && (
        <span className="text-[10px] text-[hsl(var(--muted-foreground)/0.4)] shrink-0 font-mono">
          {server.command}
        </span>
      )}
      {server.languages.length > 0 && (
        <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-teal-500/8 text-teal-600 dark:text-teal-400 shrink-0">
          {server.languages.join(', ')}
        </span>
      )}
      <OriginBadge source={server.source} />
      <ScopeBadge source={server.source} />
    </RowShell>
  )
}
