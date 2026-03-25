// SPDX-License-Identifier: Apache-2.0

import { useState, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Loader2, Search, X, AlertTriangle, Check, Copy,
  FolderOpen, ChevronDown, ChevronRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Dialog } from '../ui/Dialog'
import { ProjectPicker } from '../ui/ProjectPicker'
import { toast } from '@/lib/toast'
import { useCloneCapabilities, capKey } from '@/hooks/useCloneCapabilities'
import { CATEGORY_MAP } from './categoryRegistry'
import type { CloneConflictResolution, ManagedCapabilityCategory, ClonableCapability } from '@shared/types'

// ── Types ────────────────────────────────────────────────────────────────────

interface CloneCapabilitiesDialogProps {
  open: boolean
  onClose: () => void
  targetProjectId: string
}

type DialogStep = 'select' | 'conflicts'

// ── Component ────────────────────────────────────────────────────────────────

export function CloneCapabilitiesDialog({
  open,
  onClose,
  targetProjectId,
}: CloneCapabilitiesDialogProps): React.JSX.Element | null {
  const { t } = useTranslation('sessions')
  const [sourceProjectId, setSourceProjectId] = useState<string | null>(null)
  const [step, setStep] = useState<DialogStep>('select')
  const [conflictResolution, setConflictResolution] = useState<CloneConflictResolution>('skip')

  const {
    phase,
    capabilities,
    discoverError,
    selectedKeys,
    toggleItem,
    toggleAll,
    allSelected,
    someSelected,
    selectedCount,
    hasConflicts,
    conflictCount,
    searchQuery,
    setSearchQuery,
    groupedCapabilities,
    executeClone,
    cloneError,
  } = useCloneCapabilities({
    sourceProjectId,
    targetProjectId,
  })

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleExecuteClone = useCallback(async (resolution: CloneConflictResolution) => {
    const result = await executeClone(resolution)
    if (result) {
      const { summary } = result
      if (summary.failed === 0) {
        toast(
          t('cloneCapabilities.success', {
            count: summary.succeeded,
            defaultValue: `Copied ${summary.succeeded} capabilities`,
          }),
        )
      } else {
        toast(
          t('cloneCapabilities.partial', {
            succeeded: summary.succeeded,
            failed: summary.failed,
            defaultValue: `${summary.succeeded} copied, ${summary.failed} failed`,
          }),
        )
      }
      onClose()
    }
  }, [executeClone, onClose, t])

  const handleCopyClick = useCallback(() => {
    if (hasConflicts) {
      setStep('conflicts')
    } else {
      void handleExecuteClone('skip')
    }
  }, [hasConflicts, handleExecuteClone])

  const handleBack = useCallback(() => {
    setStep('select')
  }, [])

  const handleClose = useCallback(() => {
    if (phase === 'cloning') return // prevent closing during clone
    setSourceProjectId(null)
    setStep('select')
    onClose()
  }, [phase, onClose])

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title={t('cloneCapabilities.title', 'Copy Capabilities')}
      size="sm"
    >
      <div className="p-6">
        {/* Header */}
        <h2 className="text-base font-semibold mb-1">
          {step === 'select'
            ? t('cloneCapabilities.title', 'Copy Capabilities from Project')
            : t('cloneCapabilities.resolveConflicts', 'Resolve Conflicts')
          }
        </h2>
        <p className="text-sm text-[hsl(var(--muted-foreground))] mb-4">
          {step === 'select'
            ? t('cloneCapabilities.description', 'Select capabilities to copy to this project.')
            : t('cloneCapabilities.conflictDescription', {
                count: conflictCount,
                defaultValue: `${conflictCount} capability(s) already exist in this project.`,
              })
          }
        </p>

        {step === 'select' ? (
          <SelectStep
            sourceProjectId={sourceProjectId}
            onSourceChange={setSourceProjectId}
            targetProjectId={targetProjectId}
            phase={phase}
            discoverError={discoverError}
            capabilities={capabilities}
            groupedCapabilities={groupedCapabilities}
            selectedKeys={selectedKeys}
            toggleItem={toggleItem}
            toggleAll={toggleAll}
            allSelected={allSelected}
            someSelected={someSelected}
            selectedCount={selectedCount}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
          />
        ) : (
          <ConflictStep
            capabilities={capabilities}
            selectedKeys={selectedKeys}
            conflictResolution={conflictResolution}
            onResolutionChange={setConflictResolution}
          />
        )}

        {/* Error banner */}
        {(discoverError || cloneError) && (
          <div className="mt-3 px-3 py-2 rounded-lg bg-[hsl(var(--destructive)/0.1)] text-[hsl(var(--destructive))] text-xs">
            {discoverError || cloneError}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center justify-end gap-2 mt-5">
          {step === 'conflicts' && (
            <button
              onClick={handleBack}
              disabled={phase === 'cloning'}
              className="px-3 py-1.5 text-sm rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors disabled:opacity-50 mr-auto"
            >
              {t('common:back', 'Back')}
            </button>
          )}
          <button
            onClick={handleClose}
            disabled={phase === 'cloning'}
            className="px-3 py-1.5 text-sm rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors disabled:opacity-50"
          >
            {t('common:cancel', 'Cancel')}
          </button>
          {step === 'select' ? (
            <button
              onClick={handleCopyClick}
              disabled={
                phase === 'cloning' || phase === 'discovering' || phase === 'idle' || selectedCount === 0
              }
              className="px-4 py-1.5 rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] font-medium text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {phase === 'cloning' ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  {t('cloneCapabilities.copying', 'Copying…')}
                </span>
              ) : (
                <span className="flex items-center gap-1.5">
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('cloneCapabilities.copy', { count: selectedCount, defaultValue: `Copy ${selectedCount} items` })}
                </span>
              )}
            </button>
          ) : (
            <button
              onClick={() => void handleExecuteClone(conflictResolution)}
              disabled={phase === 'cloning'}
              className="px-4 py-1.5 rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] font-medium text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {phase === 'cloning' ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  {t('cloneCapabilities.copying', 'Copying…')}
                </span>
              ) : (
                t('cloneCapabilities.confirmCopy', 'Confirm Copy')
              )}
            </button>
          )}
        </div>
      </div>
    </Dialog>
  )
}

// ── Select Step ──────────────────────────────────────────────────────────────

interface SelectStepProps {
  sourceProjectId: string | null
  onSourceChange: (id: string | null) => void
  targetProjectId: string
  phase: string
  discoverError: string | null
  capabilities: ClonableCapability[]
  groupedCapabilities: Map<ManagedCapabilityCategory, ClonableCapability[]>
  selectedKeys: ReadonlySet<string>
  toggleItem: (key: string) => void
  toggleAll: () => void
  allSelected: boolean
  someSelected: boolean
  selectedCount: number
  searchQuery: string
  setSearchQuery: (q: string) => void
}

function SelectStep({
  sourceProjectId,
  onSourceChange,
  targetProjectId,
  phase,
  capabilities,
  groupedCapabilities,
  selectedKeys,
  toggleItem,
  toggleAll,
  allSelected,
  someSelected,
  selectedCount,
  searchQuery,
  setSearchQuery,
}: SelectStepProps): React.JSX.Element {
  const { t } = useTranslation('sessions')

  // Exclude the target project from the source picker so the user cannot clone to self.
  const excludeIds = useMemo(() => [targetProjectId], [targetProjectId])

  return (
    <>
      {/* Source project picker */}
      <div className="mb-4">
        <label className="text-xs font-medium text-[hsl(var(--muted-foreground))] mb-1.5 block">
          {t('cloneCapabilities.sourceProject', 'Source Project')}
        </label>
        <ProjectPicker
          value={sourceProjectId}
          onChange={onSourceChange}
          excludeIds={excludeIds}
          placeholder={t('cloneCapabilities.selectProject', 'Select a project…')}
          ariaLabel={t('cloneCapabilities.sourceProject', 'Source Project')}
          portal
        />
      </div>

      {/* Content area */}
      <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.3)] px-4 py-3">
        {!sourceProjectId ? (
          <div className="text-center py-8">
            <FolderOpen className="h-7 w-7 mx-auto mb-2 text-[hsl(var(--muted-foreground)/0.4)]" aria-hidden="true" />
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              {t('cloneCapabilities.selectProjectHint', 'Select a source project to see its capabilities')}
            </p>
          </div>
        ) : phase === 'discovering' ? (
          <div className="flex items-center justify-center py-8 gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-[hsl(var(--primary))]" aria-hidden="true" />
            <span className="text-sm text-[hsl(var(--muted-foreground))]">
              {t('cloneCapabilities.discovering', 'Discovering capabilities…')}
            </span>
          </div>
        ) : capabilities.length === 0 ? (
          <div className="text-center py-8">
            <FolderOpen className="h-7 w-7 mx-auto mb-2 text-[hsl(var(--muted-foreground)/0.4)]" aria-hidden="true" />
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              {t('cloneCapabilities.noCapabilities', 'No project-scoped capabilities found')}
            </p>
          </div>
        ) : (
          <>
            {/* Search */}
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-[hsl(var(--border))]">
              <Search className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))] shrink-0" aria-hidden="true" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('cloneCapabilities.search', 'Search capabilities…')}
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-[hsl(var(--muted-foreground)/0.5)]"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Select All */}
            <div className="flex items-center justify-between mb-2 pb-2 border-b border-[hsl(var(--border))]">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = someSelected }}
                  onChange={toggleAll}
                  className="h-3.5 w-3.5 rounded border-[hsl(var(--border))] accent-[hsl(var(--primary))]"
                />
                <span className="text-xs font-medium">
                  {t('cloneCapabilities.selectAll', 'Select All')}
                </span>
              </label>
              <span className="text-[10px] text-[hsl(var(--muted-foreground))] tabular-nums">
                {selectedCount} {t('common:selected', 'selected')}
              </span>
            </div>

            {/* Capability list grouped by category */}
            <div className="max-h-[300px] overflow-y-auto overscroll-contain -mx-1 px-1 space-y-3">
              {Array.from(groupedCapabilities.entries()).map(([category, items]) => (
                <CategoryGroup
                  key={category}
                  category={category}
                  items={items}
                  selectedKeys={selectedKeys}
                  onToggle={toggleItem}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </>
  )
}

// ── Category Group ───────────────────────────────────────────────────────────

interface CategoryGroupProps {
  category: ManagedCapabilityCategory
  items: ClonableCapability[]
  selectedKeys: ReadonlySet<string>
  onToggle: (key: string) => void
}

function CategoryGroup({ category, items, selectedKeys, onToggle }: CategoryGroupProps): React.JSX.Element {
  const { t } = useTranslation('sessions')
  const config = CATEGORY_MAP[category]
  const Icon = config?.icon
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div>
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-1.5 w-full text-left mb-1"
      >
        {collapsed
          ? <ChevronRight className="h-3 w-3 text-[hsl(var(--muted-foreground))]" />
          : <ChevronDown className="h-3 w-3 text-[hsl(var(--muted-foreground))]" />
        }
        {Icon && <Icon className={cn('h-3.5 w-3.5', config?.textColor)} />}
        <span className="text-xs font-semibold">
          {t(`capabilityCenter.categories.${config?.titleKey ?? category}`, category)}
        </span>
        <span className="text-[10px] text-[hsl(var(--muted-foreground))] tabular-nums ml-auto">
          {items.length}
        </span>
      </button>
      {!collapsed && (
        <div className="space-y-0.5 ml-1.5">
          {items.map((cap) => {
            const key = capKey(category, cap.name)
            return (
              <label
                key={key}
                className={cn(
                  'flex items-center gap-2.5 p-2 rounded-lg cursor-pointer transition-colors',
                  'hover:bg-[hsl(var(--accent)/0.5)]',
                  selectedKeys.has(key) && 'bg-[hsl(var(--accent)/0.3)]',
                )}
              >
                <input
                  type="checkbox"
                  checked={selectedKeys.has(key)}
                  onChange={() => onToggle(key)}
                  className="h-3.5 w-3.5 shrink-0 rounded border-[hsl(var(--border))] accent-[hsl(var(--primary))]"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{cap.name}</p>
                  {cap.description && (
                    <p className="text-xs text-[hsl(var(--muted-foreground))] truncate">
                      {cap.description}
                    </p>
                  )}
                </div>
                {cap.conflict && (
                  <span
                    className="shrink-0 flex items-center gap-1 text-[10px] text-[hsl(var(--warning,40_100%_50%))] px-1.5 py-0.5 rounded-md bg-[hsl(var(--warning,40_100%_50%)/0.1)]"
                    title={t('cloneCapabilities.conflictTooltip', 'Already exists in target project')}
                  >
                    <AlertTriangle className="h-3 w-3" />
                    {t('cloneCapabilities.conflict', 'Conflict')}
                  </span>
                )}
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Conflict Step ────────────────────────────────────────────────────────────

interface ConflictStepProps {
  capabilities: ClonableCapability[]
  selectedKeys: ReadonlySet<string>
  conflictResolution: CloneConflictResolution
  onResolutionChange: (r: CloneConflictResolution) => void
}

function ConflictStep({
  capabilities,
  selectedKeys,
  conflictResolution,
  onResolutionChange,
}: ConflictStepProps): React.JSX.Element {
  const { t } = useTranslation('sessions')

  const conflictItems = useMemo(() =>
    capabilities.filter(c =>
      c.conflict !== null && selectedKeys.has(capKey(c.category, c.name)),
    ),
  [capabilities, selectedKeys])

  const resolutionOptions: Array<{ value: CloneConflictResolution; label: string; desc: string }> = [
    {
      value: 'skip',
      label: t('cloneCapabilities.resolutionSkip', 'Skip'),
      desc: t('cloneCapabilities.resolutionSkipDesc', 'Keep existing, don\'t copy conflicting items'),
    },
    {
      value: 'overwrite',
      label: t('cloneCapabilities.resolutionOverwrite', 'Overwrite'),
      desc: t('cloneCapabilities.resolutionOverwriteDesc', 'Replace existing with source version'),
    },
    {
      value: 'rename',
      label: t('cloneCapabilities.resolutionRename', 'Keep Both'),
      desc: t('cloneCapabilities.resolutionRenameDesc', 'Copy with a new name (e.g. name-copy)'),
    },
  ]

  return (
    <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.3)] px-4 py-3">
      {/* Resolution strategy selector */}
      <div className="mb-4">
        <p className="text-xs font-medium text-[hsl(var(--muted-foreground))] mb-2">
          {t('cloneCapabilities.forAllConflicts', 'For all conflicts:')}
        </p>
        <div className="flex gap-2">
          {resolutionOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onResolutionChange(opt.value)}
              className={cn(
                'flex-1 px-3 py-2 rounded-lg border text-left transition-colors',
                conflictResolution === opt.value
                  ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.08)]'
                  : 'border-[hsl(var(--border))] hover:bg-[hsl(var(--foreground)/0.04)]',
              )}
            >
              <div className="flex items-center gap-1.5">
                {conflictResolution === opt.value && (
                  <Check className="h-3 w-3 text-[hsl(var(--primary))]" />
                )}
                <span className="text-xs font-medium">{opt.label}</span>
              </div>
              <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-0.5">{opt.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Conflict items list */}
      <div className="border-t border-[hsl(var(--border))] pt-3 space-y-1 max-h-[200px] overflow-y-auto">
        {conflictItems.map((cap) => {
          const config = CATEGORY_MAP[cap.category]
          const Icon = config?.icon
          return (
            <div
              key={capKey(cap.category, cap.name)}
              className="flex items-center gap-2.5 p-2 rounded-lg"
            >
              <AlertTriangle className="h-3.5 w-3.5 text-[hsl(var(--warning,40_100%_50%))] shrink-0" />
              {Icon && <Icon className={cn('h-3.5 w-3.5 shrink-0', config?.textColor)} />}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{cap.name}</p>
                <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
                  {t('cloneCapabilities.alreadyExists', 'Already exists in target project')}
                </p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
