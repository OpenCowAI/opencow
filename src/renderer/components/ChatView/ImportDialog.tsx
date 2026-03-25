// SPDX-License-Identifier: Apache-2.0

import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, Loader2, PackageOpen, Sparkles, X, Check, Globe, FolderOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Dialog } from '@/components/ui/Dialog'
import { ProjectPicker } from '@/components/ui/ProjectPicker'
import { useImportDiscover } from '@/hooks/useImportDiscover'
import { useImportExecute } from '@/hooks/useImportExecute'
import { useAppStore, selectProjectId } from '@/stores/appStore'
import { CATEGORY_MAP } from './categoryRegistry'
import type {
  CapabilityImportableItem,
  CapabilityImportSourceType,
  CapabilityImportResult,
  ManagedCapabilityCategory,
} from '@shared/types'

// ── Types ────────────────────────────────────────────────────────────

interface ImportDialogProps {
  open: boolean
  sourceType: CapabilityImportSourceType
  /** For sourceType='file': pre-selected file paths from native file picker */
  filePaths?: string[] | null
  onClose: () => void
}

type Step = 'select' | 'result'

type ScopeFilterValue = 'all' | CapabilityImportableItem['sourceScope']

interface CategoryGroup {
  category: ManagedCapabilityCategory
  items: CapabilityImportableItem[]
}

// ── Helpers ──────────────────────────────────────────────────────────

function itemKey(item: CapabilityImportableItem): string {
  return `${item.sourceScope}:${item.category}:${item.name}`
}

function groupByCategory(items: CapabilityImportableItem[]): CategoryGroup[] {
  const map = new Map<ManagedCapabilityCategory, CapabilityImportableItem[]>()
  for (const item of items) {
    const list = map.get(item.category) ?? []
    list.push(item)
    map.set(item.category, list)
  }
  return Array.from(map, ([category, items]) => ({ category, items }))
}

// ── Custom Checkbox ─────────────────────────────────────────────────

function Tick({
  checked,
  disabled,
}: {
  checked: boolean
  disabled?: boolean
}): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center w-4 h-4 rounded-[5px] border transition-all shrink-0',
        disabled
          ? 'border-[hsl(var(--border)/0.3)] bg-[hsl(var(--muted)/0.2)]'
          : checked
            ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))]'
            : 'border-[hsl(var(--border)/0.6)] hover:border-[hsl(var(--primary)/0.5)]',
      )}
      aria-hidden="true"
    >
      {checked && <Check className="h-2.5 w-2.5 text-[hsl(var(--primary-foreground))]" strokeWidth={3} />}
    </span>
  )
}

// ── Main Component ───────────────────────────────────────────────────

export function ImportDialog({ open, sourceType, filePaths, onClose }: ImportDialogProps): React.JSX.Element {
  const { t } = useTranslation('sessions')
  const [step, setStep] = useState<Step>('select')

  const selectedProjectId = useAppStore(selectProjectId)
  const { items, loading: discovering, error: discoverError, discover } = useImportDiscover()
  const { execute, importing, result, error: importError } = useImportExecute()

  // ── Auto-discover on open ─────────────────────────────────────

  const prevOpenRef = useRef(false)

  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setStep('select')
      if (sourceType === 'file') {
        discover({ sourceType, filePaths: filePaths ?? [], projectId: selectedProjectId ?? undefined })
      } else if (sourceType === 'claude-code' || sourceType === 'codex') {
        discover({ sourceType, projectId: selectedProjectId ?? undefined })
      } else {
        discover({ sourceType })
      }
    }
    prevOpenRef.current = open
  }, [open, sourceType, discover, selectedProjectId, filePaths])

  // ── Dynamic title ─────────────────────────────────────────────

  const dialogTitle = sourceType === 'claude-code'
    ? t('capabilityCenter.importTitleClaude', 'Import from Claude Code')
    : sourceType === 'codex'
      ? t('capabilityCenter.importTitleCodex', 'Import from Codex')
      : t('capabilityCenter.importTitleFile', 'Import from File')

  // ── Handlers ──────────────────────────────────────────────────

  const handleImport = useCallback(
    async (selected: CapabilityImportableItem[], targetProjectId: string | null) => {
      if (selected.length === 0) return
      await execute(selected, targetProjectId ?? undefined)
      setStep('result')
    },
    [execute],
  )

  const handleClose = useCallback(() => {
    setStep('select')
    onClose()
  }, [onClose])

  // ── Render ────────────────────────────────────────────────────

  return (
    <Dialog open={open} onClose={handleClose} title={dialogTitle} size="2xl">
      <div className="flex flex-col h-[580px]">
        {/* ── Header bar ─────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[hsl(var(--border)/0.4)]">
          <h2 className="text-[15px] font-semibold text-[hsl(var(--foreground))]">
            {dialogTitle}
          </h2>
          <button
            type="button"
            onClick={handleClose}
            className="p-1 rounded-md text-[hsl(var(--muted-foreground)/0.5)] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.05)] transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Body ───────────────────────────────────────────── */}
        {step === 'select' && (
          <SelectStep
            items={items}
            discovering={discovering}
            discoverError={discoverError}
            importing={importing}
            importError={importError}
            initialTargetProjectId={selectedProjectId}
            onImport={handleImport}
            onCancel={handleClose}
          />
        )}

        {step === 'result' && result && (
          <ResultStep result={result} onDone={handleClose} />
        )}
      </div>
    </Dialog>
  )
}

// ═════════════════════════════════════════════════════════════════════
// ── Select Step
// ═════════════════════════════════════════════════════════════════════

function SelectStep({
  items,
  discovering,
  discoverError,
  importing,
  importError,
  initialTargetProjectId,
  onImport,
  onCancel,
}: {
  items: CapabilityImportableItem[]
  discovering: boolean
  discoverError: string | null
  importing: boolean
  importError: string | null
  initialTargetProjectId: string | null
  onImport: (selected: CapabilityImportableItem[], targetProjectId: string | null) => void
  onCancel: () => void
}): React.JSX.Element {
  const { t } = useTranslation('sessions')

  // ── Import target scope ────────────────────────────────────────
  const [importTargetProjectId, setImportTargetProjectId] = useState<string | null>(initialTargetProjectId)

  // ── Scope filter ──────────────────────────────────────────────
  const [scopeFilter, setScopeFilter] = useState<ScopeFilterValue>('all')

  const scopeCounts = useMemo(() => {
    let global = 0
    let project = 0
    for (const item of items) {
      if (item.sourceScope === 'project') project++
      else global++
    }
    return { all: items.length, global, project }
  }, [items])

  const hasMultipleScopes = scopeCounts.global > 0 && scopeCounts.project > 0

  const effectiveScopeFilter = useMemo(() => {
    if (scopeFilter === 'all') return 'all'
    const count = scopeFilter === 'project' ? scopeCounts.project : scopeCounts.global
    return count > 0 ? scopeFilter : 'all'
  }, [scopeFilter, scopeCounts])

  const filteredItems = useMemo(() => {
    if (effectiveScopeFilter === 'all') return items
    return items.filter((i) => i.sourceScope === effectiveScopeFilter)
  }, [items, effectiveScopeFilter])

  const filteredImportable = useMemo(
    () => filteredItems.filter((i) => !i.alreadyImported),
    [filteredItems],
  )

  const filteredGroups = useMemo(() => groupByCategory(filteredItems), [filteredItems])

  // ── Selection ─────────────────────────────────────────────────
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => {
    const importable = items.filter((i) => !i.alreadyImported)
    return new Set(importable.map(itemKey))
  })

  const prevItemsLenRef = useRef(0)
  useEffect(() => {
    if (items.length > 0 && items.length !== prevItemsLenRef.current) {
      const importable = items.filter((i) => !i.alreadyImported)
      setSelectedKeys(new Set(importable.map(itemKey)))
    }
    prevItemsLenRef.current = items.length
  }, [items])

  const handleToggleItem = useCallback((item: CapabilityImportableItem) => {
    const key = itemKey(item)
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const allFilteredSelected =
    filteredImportable.length > 0 && filteredImportable.every((i) => selectedKeys.has(itemKey(i)))

  const handleToggleAll = useCallback(() => {
    const importableKeys = new Set(filteredImportable.map(itemKey))
    if (allFilteredSelected) {
      setSelectedKeys((prev) => {
        const next = new Set(prev)
        for (const k of importableKeys) next.delete(k)
        return next
      })
    } else {
      setSelectedKeys((prev) => new Set([...prev, ...importableKeys]))
    }
  }, [filteredImportable, allFilteredSelected])

  const handleImportClick = useCallback(() => {
    const selected = items.filter((i) => selectedKeys.has(itemKey(i)) && !i.alreadyImported)
    onImport(selected, importTargetProjectId)
  }, [items, selectedKeys, onImport, importTargetProjectId])

  // ── Counts ────────────────────────────────────────────────────
  const totalSelectedCount = useMemo(
    () => items.filter((i) => selectedKeys.has(itemKey(i)) && !i.alreadyImported).length,
    [items, selectedKeys],
  )

  // ── Scope tabs config ─────────────────────────────────────────
  const scopeTabs: Array<{ value: ScopeFilterValue; labelKey: string }> = [
    { value: 'all', labelKey: 'capabilityCenter.filters.scopeAll' },
    { value: 'global', labelKey: 'capabilityCenter.scopeGlobal' },
    { value: 'project', labelKey: 'capabilityCenter.scopeProject' },
  ]

  // ─── Loading ──────────────────────────────────────────────────

  if (discovering) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-5">
        <div className="relative flex items-center justify-center">
          <span className="absolute h-12 w-12 rounded-full bg-[hsl(var(--primary)/0.06)] animate-ping opacity-75" />
          <span className="absolute h-9 w-9 rounded-full bg-[hsl(var(--primary)/0.05)]" />
          <Loader2 className="relative h-5 w-5 text-[hsl(var(--primary)/0.55)] animate-spin" />
        </div>
        <div className="text-center space-y-1">
          <p className="text-sm text-[hsl(var(--foreground)/0.7)]">
            {t('capabilityCenter.importDiscovering')}
          </p>
          <p className="text-[11px] text-[hsl(var(--muted-foreground)/0.45)]">
            {t('capabilityCenter.importDiscoverHint')}
          </p>
        </div>
      </div>
    )
  }

  // ─── Error ────────────────────────────────────────────────────

  if (discoverError) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-10">
        <div className="p-3.5 rounded-full bg-red-500/8">
          <AlertCircle className="h-6 w-6 text-red-500/70" />
        </div>
        <p className="text-sm text-red-500/90 font-medium text-center">{discoverError}</p>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-[hsl(var(--primary))] hover:underline"
        >
          {t('capabilityCenter.importCancel')}
        </button>
      </div>
    )
  }

  // ─── Empty ────────────────────────────────────────────────────

  if (items.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-10">
        <div className="p-4 rounded-2xl bg-[hsl(var(--muted)/0.2)]">
          <PackageOpen className="h-7 w-7 text-[hsl(var(--muted-foreground)/0.4)]" />
        </div>
        <div className="text-center space-y-1.5">
          <p className="text-sm font-medium text-[hsl(var(--foreground)/0.65)]">
            {t('capabilityCenter.importDetected_zero')}
          </p>
          <p className="text-[11px] text-[hsl(var(--muted-foreground)/0.45)] max-w-[300px] leading-relaxed">
            {t('capabilityCenter.importEmptyHint')}
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="mt-1 px-5 py-1.5 text-xs rounded-lg border border-[hsl(var(--border)/0.5)] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.03)] transition-colors"
        >
          {t('capabilityCenter.importCancel')}
        </button>
      </div>
    )
  }

  // ─── Main ─────────────────────────────────────────────────────

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* ── Toolbar: scope pills — select all ── */}
      <div className="flex items-center justify-between px-6 py-2.5">
        <div className="flex items-center gap-2.5">
          {/* Scope filter pills */}
          {hasMultipleScopes && (
            <div
              className="flex items-center gap-0.5 p-0.5 rounded-lg bg-[hsl(var(--foreground)/0.03)]"
              role="tablist"
              aria-label={t('capabilityCenter.filters.ariaScope')}
            >
              {scopeTabs.map(({ value, labelKey }) => {
                const count = scopeCounts[value]
                if (value !== 'all' && count === 0) return null
                const isActive = effectiveScopeFilter === value
                return (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setScopeFilter(value)}
                    className={cn(
                      'px-2.5 py-1 text-[11px] rounded-md transition-all tabular-nums',
                      isActive
                        ? 'bg-[hsl(var(--background))] text-[hsl(var(--foreground))] font-medium shadow-[0_1px_2px_hsl(var(--foreground)/0.06)]'
                        : 'text-[hsl(var(--muted-foreground)/0.55)] hover:text-[hsl(var(--foreground)/0.8)]',
                    )}
                  >
                    {t(labelKey)}
                    <span className={cn('ml-1', isActive ? 'opacity-50' : 'opacity-35')}>
                      {count}
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          {/* Item count — subtle */}
          <span className="text-[11px] text-[hsl(var(--muted-foreground)/0.4)] tabular-nums">
            {t('capabilityCenter.importFound', { count: filteredItems.length })}
          </span>
        </div>

        {/* Select all */}
        <button
          type="button"
          onClick={handleToggleAll}
          className="flex items-center gap-2 text-[11px] text-[hsl(var(--muted-foreground)/0.6)] hover:text-[hsl(var(--foreground))] transition-colors"
        >
          <Tick checked={allFilteredSelected} />
          {t('capabilityCenter.importSelectAll', { count: filteredImportable.length })}
        </button>
      </div>

      {/* ── Scrollable item list ── */}
      <div className="flex-1 overflow-y-auto px-6 pb-4 space-y-5">
        {filteredGroups.map((group) => {
          const config = CATEGORY_MAP[group.category]
          const Icon = config?.icon
          return (
            <section key={group.category}>
              {/* Category header */}
              <div className="flex items-center gap-2.5 mb-2 px-1">
                {Icon && (
                  <span className={cn('flex items-center justify-center w-5 h-5 rounded-md', config?.bgColor)}>
                    <Icon className={cn('h-3 w-3', config?.textColor)} />
                  </span>
                )}
                <span className="text-xs font-semibold text-[hsl(var(--foreground)/0.7)]">
                  {config ? t(`capabilityCenter.categories.${config.titleKey}`) : group.category}
                </span>
                <span className="text-[10px] tabular-nums text-[hsl(var(--muted-foreground)/0.35)]">
                  {group.items.length}
                </span>
              </div>

              {/* Items — bordered card group */}
              <div className="rounded-xl border border-[hsl(var(--border)/0.35)] overflow-hidden divide-y divide-[hsl(var(--border)/0.2)]">
                {group.items.map((item) => {
                  const key = itemKey(item)
                  const isSelected = selectedKeys.has(key)
                  const disabled = item.alreadyImported

                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={disabled}
                      onClick={() => !disabled && handleToggleItem(item)}
                      className={cn(
                        'w-full flex items-center gap-3.5 px-4 py-3 text-left transition-colors',
                        disabled
                          ? 'opacity-40 cursor-not-allowed'
                          : isSelected
                            ? 'bg-[hsl(var(--primary)/0.03)] hover:bg-[hsl(var(--primary)/0.05)]'
                            : 'hover:bg-[hsl(var(--foreground)/0.02)]',
                      )}
                    >
                      {/* Checkbox */}
                      <Tick checked={isSelected} disabled={disabled} />

                      {/* Name + description */}
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-[hsl(var(--foreground))] truncate">
                          {item.name}
                        </p>
                        {item.description && (
                          <p className="text-[11px] leading-relaxed text-[hsl(var(--muted-foreground)/0.55)] mt-0.5 truncate">
                            {item.description}
                          </p>
                        )}
                      </div>

                      {/* Badges */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        {item.sourceScope === 'global' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-[hsl(var(--foreground)/0.04)] text-[hsl(var(--muted-foreground)/0.6)] font-medium">
                            {t('capabilityCenter.scopeGlobal')}
                          </span>
                        )}
                        {item.sourceScope === 'project' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-blue-500/8 text-blue-500 dark:text-blue-400 font-medium">
                            {t('capabilityCenter.scopeProject')}
                          </span>
                        )}
                        {disabled && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-[hsl(var(--muted)/0.4)] text-[hsl(var(--muted-foreground)/0.7)]">
                            {t('capabilityCenter.importAlreadyImported')}
                          </span>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>

      {/* Import error toast */}
      {importError && (
        <div className="mx-6 mb-2 px-3.5 py-2 text-xs text-red-500 bg-red-500/5 rounded-lg border border-red-500/10" role="alert">
          {importError}
        </div>
      )}

      {/* ── Footer ── */}
      <div className="flex items-center justify-between px-6 py-4 border-t border-[hsl(var(--border)/0.4)]">
        {/* Import target scope picker */}
        <div className="flex items-center gap-2.5">
          <span className="text-[11px] font-medium text-[hsl(var(--muted-foreground)/0.5)] shrink-0">
            {t('capabilityCenter.importTo', 'Import to')}
          </span>
          <ProjectPicker
            value={importTargetProjectId}
            onChange={setImportTargetProjectId}
            placeholder={t('capabilityCenter.scopeGlobal')}
            ariaLabel={t('capabilityCenter.importTo', 'Import to')}
            triggerClassName="rounded-lg py-1.5 px-3 text-xs border border-[hsl(var(--border)/0.5)] bg-[hsl(var(--foreground)/0.02)] hover:border-[hsl(var(--border)/0.8)] transition-colors"
            position="above"
            portal
          />
          <span className="text-[10px] text-[hsl(var(--muted-foreground)/0.35)] flex items-center gap-1">
            {importTargetProjectId ? (
              <><FolderOpen className="h-3 w-3" />{t('capabilityCenter.scopeHintProject', 'Only in this project')}</>
            ) : (
              <><Globe className="h-3 w-3" />{t('capabilityCenter.scopeHintGlobal', 'Available in all projects')}</>
            )}
          </span>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-1.5 text-[13px] rounded-lg text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors"
          >
            {t('capabilityCenter.importCancel')}
          </button>
          <button
            type="button"
            onClick={handleImportClick}
            disabled={totalSelectedCount === 0 || importing}
            className={cn(
              'px-5 py-1.5 text-[13px] font-medium rounded-lg transition-all',
              'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]',
              'hover:brightness-110 disabled:opacity-35 disabled:pointer-events-none',
            )}
          >
            {importing
              ? t('capabilityCenter.importing')
              : t('capabilityCenter.importSelected', { count: totalSelectedCount })}
          </button>
        </div>
      </div>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════
// ── Result Step
// ═════════════════════════════════════════════════════════════════════

function ResultStep({
  result,
  onDone,
}: {
  result: CapabilityImportResult
  onDone: () => void
}): React.JSX.Element {
  const { t } = useTranslation('sessions')
  const hasErrors = result.errors.length > 0
  const hasSuccess = result.imported.length > 0

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* ── Hero area ── */}
      <div className="flex flex-col items-center gap-5 pt-12 pb-6 px-10">
        {/* Icon with glow */}
        <div className="relative flex items-center justify-center">
          {!hasErrors && (
            <span className="absolute h-14 w-14 rounded-full bg-green-500/8 animate-pulse" />
          )}
          <div
            className={cn(
              'relative p-4 rounded-2xl',
              hasErrors ? 'bg-amber-500/8' : 'bg-green-500/8',
            )}
          >
            {hasErrors ? (
              <AlertCircle className="h-7 w-7 text-amber-500" />
            ) : (
              <Sparkles className="h-7 w-7 text-green-500" />
            )}
          </div>
        </div>

        {/* Title */}
        <h3 className="text-base font-semibold text-[hsl(var(--foreground))]">
          {t('capabilityCenter.importComplete')}
        </h3>

        {/* Stat pills */}
        <div className="flex flex-wrap items-center justify-center gap-2.5">
          {hasSuccess && (
            <span className="px-3 py-1 rounded-full text-xs font-medium bg-green-500/8 text-green-600 dark:text-green-400">
              {t('capabilityCenter.importSuccessCount', { count: result.imported.length })}
            </span>
          )}
          {result.skipped.length > 0 && (
            <span className="px-3 py-1 rounded-full text-xs bg-[hsl(var(--muted)/0.3)] text-[hsl(var(--muted-foreground)/0.7)]">
              {t('capabilityCenter.importSkippedCount', { count: result.skipped.length })}
            </span>
          )}
          {hasErrors && (
            <span className="px-3 py-1 rounded-full text-xs font-medium bg-red-500/8 text-red-500">
              {t('capabilityCenter.importErrorCount', { count: result.errors.length })}
            </span>
          )}
        </div>

        {/* Success guide */}
        {hasSuccess && !hasErrors && (
          <p className="text-xs text-[hsl(var(--muted-foreground)/0.5)] text-center max-w-[320px] leading-relaxed">
            {t('capabilityCenter.importSuccessSummary', { count: result.imported.length })}
          </p>
        )}
      </div>

      {/* ── Error list ── */}
      {hasErrors && (
        <div className="flex-1 overflow-y-auto px-8 pb-4 min-h-0">
          <div className="rounded-xl border border-red-500/10 overflow-hidden divide-y divide-red-500/5">
            {result.errors.map((err, i) => (
              <div key={i} className="flex items-start gap-3 px-4 py-3 bg-red-500/[0.02]">
                <AlertCircle className="h-3.5 w-3.5 text-red-500/50 mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-[hsl(var(--foreground))] truncate">{err.name}</p>
                  <p className="text-[11px] text-red-500/60 mt-0.5 break-words">{err.error}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Done ── */}
      <div
        className={cn(
          'flex justify-center px-8',
          hasErrors ? 'py-4 border-t border-[hsl(var(--border)/0.4)]' : 'pb-10',
        )}
      >
        <button
          type="button"
          onClick={onDone}
          className="px-8 py-2 text-[13px] font-medium rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:brightness-110 transition-all"
        >
          {t('capabilityCenter.importDone')}
        </button>
      </div>
    </div>
  )
}
