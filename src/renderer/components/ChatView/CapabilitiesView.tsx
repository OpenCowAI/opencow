// SPDX-License-Identifier: Apache-2.0

import { useEffect, useLayoutEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore, selectProjectId } from '@/stores/appStore'
import { useDialogState } from '@/hooks/useModalAnimation'
import { Blocks, Search, Download, Plus, Sparkles, Store, GitFork, Copy, Cpu, AlertTriangle } from 'lucide-react'
import { createLogger } from '@/lib/logger'
import { fireAndForget } from '@/lib/asyncUtils'
import { isAICreatableCategory } from '@shared/types'

const log = createLogger('Capabilities')
import type {
  AICreatableCategory,
  ClaudeCapabilities,
  CapabilityIdentifier,
  CapabilityCategory,
  CapabilityEntryBase,
  CapabilityEntry,
  ManagedCapabilityIdentifier,
  ManagedCapabilityCategory,
  CapabilityDiagnostic,
} from '@shared/types'
import { cn } from '@/lib/utils'
import { InlineCapabilityDetail } from './InlineCapabilityDetail'
import { InlineCapabilityEdit } from './InlineCapabilityEdit'
import { InlineLegacyDetail } from './InlineLegacyDetail'
import { CATEGORY_REGISTRY } from './categoryRegistry'
import { CapabilitySideNav } from './CapabilitySideNav'
import { CategoryEmptyState } from './CategoryEmptyState'
import { ImportDialog } from './ImportDialog'
import { ImportPopover } from './ImportPopover'
import { CloneCapabilitiesDialog } from './CloneCapabilitiesDialog'
import { RepoSourceList } from './RepoSourceList'
import { MarketDialog } from '@/components/MarketView'
import { CapabilitySearchOverlay } from './CapabilitySearchOverlay'
import { SkillCreatorView } from './SkillCreatorView'
import { AgentCreatorView } from './AgentCreatorView'
import { CommandCreatorView } from './CommandCreatorView'
import { RuleCreatorView } from './RuleCreatorView'
import { useCapabilitySnapshot } from '@/hooks/useCapabilitySnapshot'
import { useCapabilityFilters } from '@/hooks/useCapabilityFilters'
import { useRepoSources } from '@/hooks/useRepoSources'
import {
  flattenSnapshot,
  buildCapabilityMap,
  capabilityKey,
  toCapabilityId,
  isManagedCategory
} from '@/lib/capabilityAdapter'
import { getOriginConfig, ORIGIN_REGISTRY } from '@/lib/originConfig'
import type { OriginFilterValue, SourceOrigin } from '@/lib/originConfig'
import { getAppAPI } from '@/windowAPI'

const MAX_DIAGNOSTICS_IN_MEMORY = 20

function mergeDiagnostics(
  prev: CapabilityDiagnostic[],
  incoming: CapabilityDiagnostic[],
): CapabilityDiagnostic[] {
  const seen = new Set<string>()
  const merged: CapabilityDiagnostic[] = []
  for (const item of [...incoming, ...prev]) {
    const key = `${item.timestamp ?? 0}:${item.level}:${item.category}:${item.name ?? ''}:${item.message}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(item)
    if (merged.length >= MAX_DIAGNOSTICS_IN_MEMORY) break
  }
  return merged
}

function cleanDiagnosticMessage(message: string): string {
  const prefix = 'unsupported-category: '
  return message.startsWith(prefix) ? message.slice(prefix.length) : message
}

const emptyCapabilities = Object.fromEntries(
  CATEGORY_REGISTRY.map((c) => [c.id, { project: [], global: [] }])
) as unknown as ClaudeCapabilities

// ── Inline view state (replaces global DetailPanel for managed capabilities) ──

type CapabilityInlineView =
  | null
  | { mode: 'detail'; identifier: ManagedCapabilityIdentifier }
  | { mode: 'edit'; identifier: ManagedCapabilityIdentifier }
  | { mode: 'create'; category: ManagedCapabilityCategory }
  | { mode: 'legacy-detail'; identifier: CapabilityIdentifier; entry?: CapabilityEntryBase }

// === Main CapabilitiesView ===

export function CapabilitiesView(): React.JSX.Element {
  const { t } = useTranslation('sessions')
  const { t: tCommon } = useTranslation('common')
  const projects = useAppStore((s) => s.projects)
  const selectedProjectId = useAppStore(selectProjectId)
  const [showMarket, setShowMarket] = useState(false)
  const [showRepoSources, setShowRepoSources] = useState(false)
  const [showAICreator, setShowAICreator] = useState<AICreatableCategory | null>(null)
  const cloneDialog = useDialogState<{ targetProjectId: string }>()
  const selectedProject = projects.find((p) => p.id === selectedProjectId)
  const [governanceDiagnostics, setGovernanceDiagnostics] = useState<CapabilityDiagnostic[]>([])

  // openDetail removed — all categories now use inline views

  // ── Repo sources ──────────────────────────────────────────────────
  const repoSourcesHook = useRepoSources()

  // ── Inline view — Linear-style full-width detail/edit/create ──────
  const [inlineView, setInlineView] = useState<CapabilityInlineView>(null)

  // ── Scroll position preservation ──────────────────────────────────
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const savedScrollRef = useRef<Record<string, number>>({})

  // ── Active category (hoisted — used by handleSelect scroll save) ──
  const [activeId, setActiveId] = useState<string>(CATEGORY_REGISTRY[0].id)

  // ── Data Sources ─────────────────────────────────────────────────

  // Managed categories → Capability Center snapshot
  const { snapshot, loading: snapshotLoading } = useCapabilitySnapshot(selectedProject?.id)

  // Flatten once per snapshot, memoized — avoids redundant flattenSnapshot calls
  const flatEntries = useMemo(
    () => (snapshot ? flattenSnapshot(snapshot, { excludeProjected: true }) : null),
    [snapshot],
  )

  // O(1) lookup map: "category:scope:name" → CapabilityEntry
  const capMap = useMemo(
    () => (snapshot ? buildCapabilityMap(snapshot) : new Map<string, CapabilityEntry>()),
    [snapshot]
  )

  // Legacy categories (plugin + lsp-server) → old API
  const [legacyCapabilities, setLegacyCapabilities] =
    useState<ClaudeCapabilities>(emptyCapabilities)
  const [legacyLoading, setLegacyLoading] = useState(false)

  const loadLegacy = useCallback(async () => {
    setLegacyLoading(true)
    try {
      const result = await getAppAPI()['list-claude-capabilities'](selectedProject?.path)
      setLegacyCapabilities(result)
    } catch {
      setLegacyCapabilities(emptyCapabilities)
    } finally {
      setLegacyLoading(false)
    }
  }, [selectedProject?.path])

  useEffect(() => {
    fireAndForget(loadLegacy(), 'CapabilitiesView.loadLegacy')
  }, [loadLegacy])

  // Auto-refresh legacy data when capabilities are saved/deleted
  useEffect(() => {
    const unsub = getAppAPI()['on:opencow:event']((event) => {
      if (event.type === 'capabilities:updated') {
        fireAndForget(loadLegacy(), 'DataBus.capabilities:updated.loadLegacy')
      }
    })
    return unsub
  }, [loadLegacy])

  const loading = snapshotLoading || legacyLoading

  const loadGovernanceDiagnostics = useCallback(async () => {
    try {
      const diagnostics = await getAppAPI()['capability:diagnostics']()
      if (diagnostics.length === 0) return
      setGovernanceDiagnostics((prev) => mergeDiagnostics(prev, diagnostics))
    } catch (err) {
      log.debug('Failed to load capability diagnostics', err)
    }
  }, [])

  useEffect(() => {
    fireAndForget(loadGovernanceDiagnostics(), 'CapabilitiesView.loadGovernanceDiagnostics')
  }, [loadGovernanceDiagnostics])

  useEffect(() => {
    const unsub = getAppAPI()['on:opencow:event']((event) => {
      if (event.type === 'capabilities:changed') {
        fireAndForget(loadGovernanceDiagnostics(), 'DataBus.capabilities:changed.loadGovernanceDiagnostics')
      }
    })
    return unsub
  }, [loadGovernanceDiagnostics])

  // ── Handlers ─────────────────────────────────────────────────────

  const handleSelect = useCallback(
    (identifier: CapabilityIdentifier) => {
      // Save scroll position before navigating to detail
      if (scrollContainerRef.current) {
        savedScrollRef.current[activeId] = scrollContainerRef.current.scrollTop
      }
      // For managed categories, show inline detail (full-width, in-page)
      if (isManagedCategory(identifier.category)) {
        const key = capabilityKey(identifier.category, identifier.source.scope, identifier.name)
        const capEntry = capMap.get(key)
        if (capEntry) {
          setInlineView({
            mode: 'detail',
            identifier: toCapabilityId(capEntry)
          })
          return
        }
      }
      // Legacy categories (plugin, lsp-server) — inline detail with entry data
      const scoped = legacyCapabilities[identifier.category]
      const allLegacy = scoped ? [...scoped.project, ...scoped.global] : []
      const matchedEntry = allLegacy.find(
        (e) => e.name === identifier.name && e.source.scope === identifier.source.scope
      )
      setInlineView({ mode: 'legacy-detail', identifier, entry: matchedEntry })
    },
    [capMap, legacyCapabilities, activeId]
  )

  const handleCreate = useCallback(
    (category: CapabilityCategory) => {
      if (isManagedCategory(category)) {
        setInlineView({ mode: 'create', category })
      }
      // Non-managed categories (plugin, lsp-server) are not creatable — no-op
    },
    []
  )

  const handleToggle = useCallback(async (entry: CapabilityEntry, enabled: boolean) => {
    try {
      await getAppAPI()['capability:toggle']({
        scope: entry.scope,
        category: entry.category,
        name: entry.name,
        enabled,
        projectId: entry.projectId
      })
      // Snapshot auto-refreshes via capabilities:changed event
    } catch (err) {
      log.error('Failed to toggle capability:', err)
    }
  }, [])

  const isCapabilitySelected = useCallback(
    (_category: string, _name: string, _scope?: string): boolean => {
      // All categories now use inline views — card highlight not needed
      // (inline view replaces the content area, cards aren't visible)
      return false
    },
    []
  )

  // ── Inline view callbacks ─────────────────────────────────────────

  const handleInlineBack = useCallback(() => {
    setInlineView(null)
  }, [])

  const handleInlineEdit = useCallback((identifier: ManagedCapabilityIdentifier) => {
    setInlineView({ mode: 'edit', identifier })
  }, [])

  const handleInlineSaved = useCallback((identifier: ManagedCapabilityIdentifier) => {
    setInlineView({ mode: 'detail', identifier })
  }, [])

  const handleEditBack = useCallback(() => {
    // From edit → back to detail (if editing existing), or back to list (if creating)
    setInlineView((prev) => {
      if (prev?.mode === 'edit') {
        return { mode: 'detail', identifier: prev.identifier }
      }
      return null
    })
  }, [])

  // ── Scroll restoration — restore position when returning from detail ──
  useLayoutEffect(() => {
    if (!inlineView && scrollContainerRef.current) {
      const saved = savedScrollRef.current[activeId]
      if (saved != null && saved > 0) {
        scrollContainerRef.current.scrollTop = saved
        delete savedScrollRef.current[activeId]
      }
    }
  }, [inlineView, activeId])

  // ── Import — welcome page detection count + CTA dialog ─────────

  const [importableCounts, setImportableCounts] = useState({ claude: 0, codex: 0 })
  const [welcomeImportOpen, setWelcomeImportOpen] = useState(false)
  const [welcomeImportSource, setWelcomeImportSource] = useState<'claude-code' | 'codex'>('claude-code')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const projectId = selectedProjectId ?? undefined
        const [claudeItems, codexItems] = await Promise.all([
          getAppAPI()['capability:import:discover']({ sourceType: 'claude-code', projectId }),
          getAppAPI()['capability:import:discover']({ sourceType: 'codex', projectId }),
        ])
        if (cancelled) return
        setImportableCounts({
          claude: claudeItems.filter((i) => !i.alreadyImported).length,
          codex: codexItems.filter((i) => !i.alreadyImported).length,
        })
      } catch {
        if (!cancelled) setImportableCounts({ claude: 0, codex: 0 })
      }
    })()
    return () => { cancelled = true }
  }, [selectedProjectId])

  // ── Search overlay ──────────────────────────────────────────────

  const [searchOverlayOpen, setSearchOverlayOpen] = useState(false)

  // ── Filtering ────────────────────────────────────────────────────

  const filteredByCategory = useMemo(() => {
    const result: Record<string, CapabilityEntryBase[]> = {}

    for (const config of CATEGORY_REGISTRY) {
      if (config.managed) {
        // Managed categories from cached flatEntries (single flattenSnapshot call).
        // Provider-projected entries (e.g. Evose apps) are already excluded by
        // the { excludeProjected: true } option passed to flattenSnapshot above.
        result[config.id] = flatEntries
          ? (flatEntries[config.id as ManagedCapabilityCategory] ?? [])
          : []
      } else {
        // Legacy categories (plugin, lsp-server)
        const scoped = legacyCapabilities[config.id]
        result[config.id] = scoped ? [...scoped.project, ...scoped.global] : []
      }
    }
    return result
  }, [flatEntries, legacyCapabilities])

  // Derive activeConfig & activeItems before hooks (avoid conditional hook call)
  const activeConfig = CATEGORY_REGISTRY.find((c) => c.id === activeId)!
  const activeItems = filteredByCategory[activeId] ?? []

  // ── Filter hook (scope + origin) ──────────────────────────────────

  const filters = useCapabilityFilters({ activeConfig, activeItems, capMap })

  const counts = useMemo(
    () =>
      Object.fromEntries(
        CATEGORY_REGISTRY.map((c) => [c.id, filteredByCategory[c.id]?.length ?? 0])
      ),
    [filteredByCategory]
  )

  const totalCount = useMemo(() => Object.values(counts).reduce((a, b) => a + b, 0), [counts])

  // Reset activeId if current category becomes invisible (e.g. legacy category data cleared)
  useEffect(() => {
    const visible = CATEGORY_REGISTRY.filter((c) => c.managed || (counts[c.id] ?? 0) > 0)
    if (visible.length > 0 && !visible.some((c) => c.id === activeId)) {
      setActiveId(visible[0].id)
    }
  }, [activeId, counts])

  // ── Persistent dialogs — rendered in ALL branches to prevent unmount ──

  const closeAICreator = useCallback(() => setShowAICreator(null), [])
  const openCloneDialog = useCallback(() => {
    if (!selectedProjectId) return
    cloneDialog.show({ targetProjectId: selectedProjectId })
  }, [cloneDialog, selectedProjectId])

  const persistentDialogs = (
    <>
      <CapabilitySearchOverlay
        open={searchOverlayOpen}
        onClose={() => setSearchOverlayOpen(false)}
        entriesByCategory={filteredByCategory}
        onSelect={handleSelect}
        onNavigateCategory={(categoryId) => setActiveId(categoryId)}
      />
      <MarketDialog open={showMarket} onClose={() => setShowMarket(false)} />
      <RepoSourceList
        open={showRepoSources}
        onClose={() => setShowRepoSources(false)}
        sources={repoSourcesHook.sources}
        loading={repoSourcesHook.loading}
        hook={repoSourcesHook}
      />
      <SkillCreatorView
        open={showAICreator === 'skill'}
        onClose={closeAICreator}
        onSaved={handleInlineSaved}
      />
      <AgentCreatorView
        open={showAICreator === 'agent'}
        onClose={closeAICreator}
        onSaved={handleInlineSaved}
      />
      <CommandCreatorView
        open={showAICreator === 'command'}
        onClose={closeAICreator}
        onSaved={handleInlineSaved}
      />
      <RuleCreatorView
        open={showAICreator === 'rule'}
        onClose={closeAICreator}
        onSaved={handleInlineSaved}
      />
      {cloneDialog.data && (
        <CloneCapabilitiesDialog
          open={cloneDialog.open}
          onClose={cloneDialog.close}
          targetProjectId={cloneDialog.data.targetProjectId}
        />
      )}
    </>
  )

  // ── Derived values needed by normal view (safe to compute unconditionally) ──

  const CardComponent = activeConfig.card

  const {
    effectiveScopeFilter,
    setScopeFilter,
    effectiveOriginFilter,
    setOriginFilter,
    scopeCounts,
    hasMultipleScopes,
    hasMultipleOrigins,
    originFilterOptions,
    visibleItems
  } = filters

  // ═══════════════════════════════════════════════════════════════════
  // RENDER — Single return.
  //
  // CRITICAL: `persistentDialogs` MUST be the last child of the
  // outermost Fragment in ALL branches.  React reconciles by tree
  // position — if the Fragment index changes across branches, React
  // unmounts + remounts the portaled dialogs, destroying their
  // internal state (MarketView search, InstallDialog progress, etc.).
  //
  // Previous bug: 4 early returns placed `persistentDialogs` at
  // different tree positions.  When `capabilities:updated` toggled
  // `legacyLoading`, the branch switched and MarketDialog remounted
  // fresh — wiping all marketplace state mid-install.
  // ═══════════════════════════════════════════════════════════════════

  let mainContent: React.JSX.Element

  const diagnosticsBanner = governanceDiagnostics.length > 0
    ? (
        <div className="mx-4 mt-3 shrink-0 rounded-lg border border-amber-500/20 bg-amber-500/5">
          <div className="flex items-center gap-2 px-3 py-2">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
            <p className="text-xs font-medium text-[hsl(var(--foreground))]">
              {t('capabilityCenter.diagnostics.title', { count: governanceDiagnostics.length })}
            </p>
            <button
              type="button"
              onClick={() => setGovernanceDiagnostics([])}
              className="ml-auto text-[11px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
            >
              {t('capabilityCenter.diagnostics.clear', 'Clear')}
            </button>
          </div>
          <div className="px-3 pb-2 space-y-1.5">
            {governanceDiagnostics.slice(0, 3).map((diag, idx) => (
              <p
                key={`${diag.timestamp ?? 0}:${diag.category}:${diag.name ?? ''}:${idx}`}
                className="text-[11px] leading-relaxed text-[hsl(var(--muted-foreground))]"
              >
                <span className="font-medium text-[hsl(var(--foreground))]">{diag.category}</span>
                {diag.name ? <span className="text-[hsl(var(--muted-foreground)/0.8)]">/{diag.name}</span> : null}
                {': '}
                {cleanDiagnosticMessage(diag.message)}
              </p>
            ))}
          </div>
        </div>
      )
    : null

  if (loading) {
    // ── Loading state ──
    mainContent = (
      <div className="flex-1 flex items-center justify-center text-[hsl(var(--muted-foreground))] text-sm">
        {t('capabilities.loadingCapabilities')}
      </div>
    )
  } else if (inlineView) {
    // ── Inline view: full-width detail / edit / create ──
    mainContent = (
      <div className="flex-1 flex min-h-0">
        {inlineView.mode === 'legacy-detail' ? (
          <InlineLegacyDetail
            identifier={inlineView.identifier}
            entry={inlineView.entry}
            onBack={handleInlineBack}
          />
        ) : inlineView.mode === 'detail' ? (
          <InlineCapabilityDetail
            identifier={inlineView.identifier}
            onBack={handleInlineBack}
            onEdit={handleInlineEdit}
          />
        ) : inlineView.mode === 'edit' ? (
          <InlineCapabilityEdit
            mode="edit"
            category={inlineView.identifier.category as ManagedCapabilityCategory}
            identifier={inlineView.identifier}
            onBack={handleEditBack}
            onSaved={handleInlineSaved}
          />
        ) : (
          <InlineCapabilityEdit
            mode="create"
            category={inlineView.category}
            projectId={selectedProject?.id}
            onBack={handleInlineBack}
            onSaved={handleInlineSaved}
          />
        )}
      </div>
    )
  } else if (totalCount === 0) {
    // ── Empty state → Welcome page with import detection + quick-create ──
    const managedCategories = CATEGORY_REGISTRY.filter((c) => c.managed)

    mainContent = (
      <>
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-lg w-full text-center space-y-6">
            <div className="space-y-2">
              <h2 className="text-lg font-semibold text-[hsl(var(--foreground))]">
                {t('capabilityCenter.title')}
              </h2>
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                {t('capabilityCenter.welcome')}
              </p>
            </div>

            {/* Import from Claude Code CTA */}
            <button
              type="button"
              onClick={() => {
                setWelcomeImportSource('claude-code')
                setWelcomeImportOpen(true)
              }}
              className="w-full flex items-center gap-4 p-4 rounded-xl border border-[hsl(var(--border))] hover:border-[hsl(var(--ring))] hover:shadow-sm transition-all text-left outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
            >
              <div className="p-2.5 rounded-lg bg-[hsl(var(--primary)/0.08)]">
                <Download className="h-5 w-5 text-[hsl(var(--primary))]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{t('capabilityCenter.importFromClaude')}</p>
                {importableCounts.claude > 0 && (
                  <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
                    {t('capabilityCenter.importDetected', { count: importableCounts.claude })}
                  </p>
                )}
              </div>
              <span className="text-[hsl(var(--muted-foreground))] text-sm">&rarr;</span>
            </button>

            {/* Import from Codex CTA */}
            <button
              type="button"
              onClick={() => {
                setWelcomeImportSource('codex')
                setWelcomeImportOpen(true)
              }}
              className="w-full flex items-center gap-4 p-4 rounded-xl border border-[hsl(var(--border))] hover:border-[hsl(var(--ring))] hover:shadow-sm transition-all text-left outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
            >
              <div className="p-2.5 rounded-lg bg-cyan-500/10">
                <Cpu className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{t('capabilityCenter.importFromCodex')}</p>
                {importableCounts.codex > 0 && (
                  <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
                    {t('capabilityCenter.importDetected', { count: importableCounts.codex })}
                  </p>
                )}
              </div>
              <span className="text-[hsl(var(--muted-foreground))] text-sm">&rarr;</span>
            </button>

            {/* Copy from existing project CTA */}
            {selectedProjectId && (
              <button
                type="button"
                onClick={openCloneDialog}
                className="w-full flex items-center gap-4 p-4 rounded-xl border border-[hsl(var(--border))] hover:border-[hsl(var(--ring))] hover:shadow-sm transition-all text-left outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
              >
                <div className="p-2.5 rounded-lg bg-violet-500/8">
                  <Copy className="h-5 w-5 text-violet-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{t('cloneCapabilities.fromProject')}</p>
                  <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
                    {t('cloneCapabilities.fromProjectDesc')}
                  </p>
                </div>
                <span className="text-[hsl(var(--muted-foreground))] text-sm">&rarr;</span>
              </button>
            )}

            {/* Quick-create buttons */}
            <div className="space-y-2">
              <p className="text-xs text-[hsl(var(--muted-foreground))]">
                {t('capabilityCenter.createFirst')}
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {managedCategories.map((config) => {
                  const Icon = config.icon
                  return (
                    <button
                      key={config.id}
                      type="button"
                      onClick={() => handleCreate(config.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[hsl(var(--border))] text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:border-[hsl(var(--ring))] hover:shadow-sm transition-all outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                    >
                      <Icon className={`h-3.5 w-3.5 ${config.textColor}`} />
                      {t(`capabilityCenter.categories.${config.titleKey}`)}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Welcome-page CTA dialog */}
        <ImportDialog
          open={welcomeImportOpen}
          sourceType={welcomeImportSource}
          onClose={() => setWelcomeImportOpen(false)}
        />
      </>
    )
  } else {
    // ── Active category content ── sidebar + items list ──
    mainContent = (
      <div className="flex-1 flex min-h-0">
        {/* ── Left sidebar column ── title + search + nav + import */}
        <aside className="w-52 shrink-0 flex flex-col border-r border-[hsl(var(--border)/0.4)]">
          {/* Page header */}
          <div className="px-4 pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <Blocks className="h-4 w-4 text-[hsl(var(--primary))]" />
              <h2 className="text-sm font-semibold text-[hsl(var(--foreground))]">
                {t('capabilityCenter.title')}
              </h2>
            </div>
            <p className="text-[11px] leading-relaxed text-[hsl(var(--muted-foreground)/0.7)]">
              {t('capabilityCenter.subtitle')}
            </p>
          </div>

          {/* Search trigger → opens Spotlight overlay */}
          <div className="px-3 pb-2">
            <button
              type="button"
              onClick={() => setSearchOverlayOpen(true)}
              className="flex items-center gap-1.5 px-2.5 h-7 w-full rounded-md bg-[hsl(var(--foreground)/0.02)] border border-[hsl(var(--border)/0.35)] hover:border-[hsl(var(--border)/0.6)] hover:bg-[hsl(var(--foreground)/0.03)] transition-colors text-left"
            >
              <Search
                className="h-3 w-3 text-[hsl(var(--muted-foreground)/0.5)] shrink-0"
                aria-hidden="true"
              />
              <span className="flex-1 text-xs text-[hsl(var(--muted-foreground)/0.5)]">
                {t('capabilities.searchPlaceholder')}
              </span>
            </button>
          </div>

          {/* Category navigation */}
          <CapabilitySideNav counts={counts} activeId={activeId} onNavigate={setActiveId} />

          {/* Skills Market + Import — bottom */}
          <div className="mt-auto border-t border-[hsl(var(--border)/0.4)]">
            <div className="px-3 pt-2.5 pb-1">
              <button
                type="button"
                onClick={() => setShowMarket(true)}
                className={cn(
                  'flex items-center gap-2 w-full px-3 py-1.5 rounded-md text-xs transition-colors outline-none',
                  'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)]',
                  'focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]'
                )}
              >
                <Store className="h-3.5 w-3.5" aria-hidden="true" />
                {t('mainTabs.market', { ns: 'navigation' })}
              </button>
            </div>
            <div className="px-3 pb-1">
              <button
                type="button"
                onClick={() => setShowRepoSources(true)}
                className={cn(
                  'flex items-center gap-2 w-full px-3 py-1.5 rounded-md text-xs transition-colors outline-none',
                  'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)]',
                  'focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]'
                )}
              >
                <GitFork className="h-3.5 w-3.5" aria-hidden="true" />
                {t('repoSource.title', 'Repository Sources')}
              </button>
            </div>
            {selectedProjectId && (
              <div className="px-3 pb-1">
                <button
                  type="button"
                  onClick={openCloneDialog}
                  className={cn(
                    'flex items-center gap-2 w-full px-3 py-1.5 rounded-md text-xs transition-colors outline-none',
                    'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)]',
                    'focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]'
                  )}
                >
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('cloneCapabilities.fromProject')}
                </button>
              </div>
            )}
            <div className="px-3 pb-2.5">
              <ImportPopover />
            </div>
          </div>
        </aside>

        {/* ── Content area ── keyed by activeId for enter animation */}
        <div key={activeId} className="capability-content-enter flex-1 min-w-0 flex flex-col min-h-0">
          {activeItems.length === 0 ? (
            /* Empty state — beautiful per-category onboarding */
            <CategoryEmptyState
              config={activeConfig}
              onCreate={activeConfig.creatable ? () => handleCreate(activeConfig.id) : undefined}
              onAICreate={
                isAICreatableCategory(activeId)
                  ? () => setShowAICreator(activeId as AICreatableCategory)
                  : undefined
              }
            />
          ) : (
            <>
              {/* ── Fixed Toolbar: title + filters + new button ── */}
              <div className="shrink-0 px-6 pt-5 pb-3">
                <div className="flex items-center gap-3">
                  {/* Left: icon + title + count */}
                  <activeConfig.icon
                    className={cn('h-4 w-4 shrink-0', activeConfig.textColor)}
                    aria-hidden="true"
                  />
                  <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">
                    {t(`capabilityCenter.categories.${activeConfig.titleKey}`)}
                  </h3>
                  <span className="text-xs tabular-nums text-[hsl(var(--muted-foreground)/0.5)]">
                    {visibleItems.length}
                  </span>

                  {/* Center: filter pills (scope + origin) */}
                  {(hasMultipleScopes || (hasMultipleOrigins && activeConfig.managed)) && (
                    <div className="flex items-center gap-1.5 ml-2">
                      {/* Scope filter pills */}
                      {hasMultipleScopes && (
                        <div
                          className="flex items-center gap-0.5 p-0.5 rounded-lg bg-[hsl(var(--foreground)/0.03)]"
                          role="tablist"
                          aria-label={t('capabilityCenter.filters.ariaScope', 'Filter by scope')}
                        >
                          {(
                            [
                              {
                                id: 'all' as const,
                                label: t('capabilityCenter.filters.scopeAll', 'All'),
                                count: scopeCounts.all
                              },
                              {
                                id: 'global' as const,
                                label: t('capabilityCenter.scopeGlobal', 'Global'),
                                count: scopeCounts.global
                              },
                              {
                                id: 'project' as const,
                                label: t('capabilityCenter.scopeProject', 'Project'),
                                count: scopeCounts.project
                              }
                            ] as const
                          ).map((tab) => (
                            <button
                              key={tab.id}
                              type="button"
                              role="tab"
                              aria-selected={effectiveScopeFilter === tab.id}
                              onClick={() => setScopeFilter(tab.id)}
                              className={cn(
                                'px-2 py-0.5 text-[11px] rounded-md transition-all tabular-nums',
                                effectiveScopeFilter === tab.id
                                  ? 'bg-[hsl(var(--background))] text-[hsl(var(--foreground))] font-medium shadow-[0_1px_2px_hsl(var(--foreground)/0.06)]'
                                  : 'text-[hsl(var(--muted-foreground)/0.6)] hover:text-[hsl(var(--foreground))]'
                              )}
                            >
                              {tab.label}
                              <span
                                className={cn(
                                  'ml-1',
                                  effectiveScopeFilter === tab.id ? 'opacity-50' : 'opacity-40'
                                )}
                              >
                                {tab.count}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Separator */}
                      {hasMultipleScopes && hasMultipleOrigins && activeConfig.managed && (
                        <div className="h-3.5 w-px bg-[hsl(var(--border)/0.4)]" aria-hidden="true" />
                      )}

                      {/* Origin filter pills */}
                      {hasMultipleOrigins && activeConfig.managed && (
                        <div
                          className="flex items-center gap-0.5 p-0.5 rounded-lg bg-[hsl(var(--foreground)/0.03)]"
                          role="tablist"
                          aria-label={t('capabilityCenter.filters.ariaOrigin', 'Filter by origin')}
                        >
                          {originFilterOptions.map((opt) => {
                            const label =
                              opt.id === 'all'
                                ? t('capabilityCenter.filters.allOrigins', 'All')
                                : opt.id === 'local'
                                  ? t('capabilityCenter.filters.local', 'Custom')
                                  : (ORIGIN_REGISTRY[opt.id as SourceOrigin]?.label ?? opt.id)
                            const activeColor =
                              getOriginConfig(opt.id as Exclude<OriginFilterValue, 'all'>)
                                ?.filterActiveClass ?? 'text-[hsl(var(--foreground))]'

                            return (
                              <button
                                key={opt.id}
                                type="button"
                                role="tab"
                                aria-selected={effectiveOriginFilter === opt.id}
                                onClick={() => setOriginFilter(opt.id)}
                                className={cn(
                                  'px-2 py-0.5 text-[11px] rounded-md transition-all tabular-nums',
                                  effectiveOriginFilter === opt.id
                                    ? cn(
                                        'bg-[hsl(var(--background))] font-medium shadow-[0_1px_2px_hsl(var(--foreground)/0.06)]',
                                        activeColor
                                      )
                                    : 'text-[hsl(var(--muted-foreground)/0.6)] hover:text-[hsl(var(--foreground))]'
                                )}
                              >
                                {label}
                                <span
                                  className={cn(
                                    'ml-1',
                                    effectiveOriginFilter === opt.id ? 'opacity-50' : 'opacity-40'
                                  )}
                                >
                                  {opt.count}
                                </span>
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Right: AI create + new button */}
                  <div className="ml-auto flex items-center gap-1.5">
                    {isAICreatableCategory(activeId) && (
                      <button
                        type="button"
                        onClick={() => setShowAICreator(activeId as AICreatableCategory)}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs text-violet-600 hover:text-violet-700 hover:bg-violet-500/5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                      >
                        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                        {t('capabilityCreator.aiCreate')}
                      </button>
                    )}
                    {activeConfig.creatable && (
                      <button
                        type="button"
                        onClick={() => handleCreate(activeConfig.id)}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                      >
                        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                        {tCommon('new')}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* ── Scrollable items list ── */}
              <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-6 pb-6">
                <div
                  className={
                    activeConfig.layout === 'rows'
                      ? 'rounded-xl border border-[hsl(var(--border)/0.4)] divide-y divide-[hsl(var(--border)/0.25)] overflow-hidden'
                      : activeConfig.layout === 'grid'
                        ? 'grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2'
                        : 'space-y-2'
                  }
                >
                  {visibleItems.map((entry) => {
                    const cap = activeConfig.managed
                      ? capMap.get(capabilityKey(activeConfig.id, entry.source.scope, entry.name))
                      : undefined
                    return (
                      <CardComponent
                        key={`${entry.source.scope}:${entry.name}`}
                        entry={entry}
                        onSelect={handleSelect}
                        isSelected={isCapabilitySelected(
                          activeConfig.id,
                          entry.name,
                          entry.source.scope
                        )}
                        capability={cap}
                        onToggle={activeConfig.managed ? handleToggle : undefined}
                      />
                    )
                  })}
                </div>

                {/* Filter active but no results */}
                {visibleItems.length === 0 && activeItems.length > 0 && (
                  <div className="flex items-center justify-center py-12">
                    <p className="text-xs text-[hsl(var(--muted-foreground)/0.6)]">
                      {t('capabilityCenter.filters.noFilterResults', 'No items match the current filter')}
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    )
  }

  // Single return — persistentDialogs is ALWAYS the 2nd child of the
  // outermost Fragment, guaranteeing a stable React tree position
  // regardless of which content branch is active.
  return (
    <>
      <div className="flex-1 flex flex-col min-h-0">
        {diagnosticsBanner}
        {mainContent}
      </div>
      {persistentDialogs}
    </>
  )
}
