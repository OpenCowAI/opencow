// SPDX-License-Identifier: Apache-2.0

/**
 * ProviderQuickSwitcher — Compact dropdown to filter issues by remote provider.
 *
 * Shows a GitHub/GitLab icon + repo name; clicking reveals a popover list
 * of configured providers for the current project. Selecting one sets an
 * ephemeral filter that scopes the issue list to that provider.
 *
 * Displayed in the IssuesView header alongside other display controls.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GitBranch, ChevronDown, X } from 'lucide-react'
import { useIssueProviderStore } from '@/stores/issueProviderStore'
import { useAppStore, selectProjectId } from '@/stores/appStore'
import { setEphemeralFilters } from '@/actions/issueActions'
import { cn } from '@/lib/utils'
import { IssueProviderIcon } from '@/components/ProjectSettings/IssueProviderIcons'
import { issueProviderRepoLabel, type IssueProvider } from '@shared/types'

// ─── Component ──────────────────────────────────────────────────────

export function ProviderQuickSwitcher(): React.JSX.Element | null {
  const { t } = useTranslation('issues')
  const projectId = useAppStore(selectProjectId)
  const providers = useIssueProviderStore((s) => s.providers)
  const loadProviders = useIssueProviderStore((s) => s.loadProviders)
  const ephemeralFilters = useAppStore((s) => s.ephemeralFilters)

  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Load providers when the project changes (ensures store is populated on app start)
  useEffect(() => {
    if (projectId) loadProviders(projectId)
  }, [projectId, loadProviders])

  // Close popover on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Filter providers for the current project context
  const projectProviders = useMemo(
    () => providers.filter((p) => p.projectId === projectId && p.syncEnabled),
    [providers, projectId]
  )

  // Currently active provider filter (from ephemeral filters)
  const activeProviderId = ephemeralFilters.providerId ?? null

  const activeProvider = useMemo(
    () => activeProviderId ? projectProviders.find((p) => p.id === activeProviderId) ?? null : null,
    [activeProviderId, projectProviders]
  )

  const handleSelect = useCallback((provider: IssueProvider | null) => {
    setOpen(false)
    const current = useAppStore.getState().ephemeralFilters
    if (provider) {
      setEphemeralFilters({ ...current, providerId: provider.id })
    } else {
      const { providerId: _, ...rest } = current
      setEphemeralFilters(rest)
    }
  }, [])

  const handleClear = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    handleSelect(null)
  }, [handleSelect])

  // Don't render if no providers configured for this project
  if (projectProviders.length === 0) return null

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs transition-colors',
          activeProvider
            ? 'bg-[hsl(var(--primary)/0.1)] text-[hsl(var(--primary))]'
            : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)]'
        )}
        aria-label={t('providerSwitcher.label', 'Filter by repository')}
      >
        {activeProvider ? (
          <>
            <IssueProviderIcon platform={activeProvider.platform} />
            <span className="max-w-[100px] truncate">{issueProviderRepoLabel(activeProvider.platform, activeProvider.repoOwner, activeProvider.repoName)}</span>
            <span
              role="button"
              tabIndex={-1}
              onClick={handleClear}
              className="p-0.5 rounded-full hover:bg-[hsl(var(--primary)/0.2)]"
            >
              <X className="w-2.5 h-2.5" />
            </span>
          </>
        ) : (
          <>
            <GitBranch className="w-3.5 h-3.5" />
            <ChevronDown className="w-2.5 h-2.5" />
          </>
        )}
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1 min-w-[200px] rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--popover))] shadow-md py-1 z-50">
          {/* All repos option */}
          <button
            onClick={() => handleSelect(null)}
            className={cn(
              'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-[hsl(var(--foreground)/0.06)] transition-colors',
              !activeProviderId && 'text-[hsl(var(--primary))] font-medium'
            )}
          >
            <GitBranch className="w-3.5 h-3.5" />
            <span>{t('providerSwitcher.all', 'All repositories')}</span>
          </button>

          <div className="h-px bg-[hsl(var(--border)/0.5)] my-1" />

          {/* Provider list */}
          {projectProviders.map((provider) => (
            <button
              key={provider.id}
              onClick={() => handleSelect(provider)}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-[hsl(var(--foreground)/0.06)] transition-colors',
                activeProviderId === provider.id && 'text-[hsl(var(--primary))] font-medium'
              )}
            >
              <IssueProviderIcon platform={provider.platform} />
              <span className="flex-1 min-w-0 truncate">
                {issueProviderRepoLabel(provider.platform, provider.repoOwner, provider.repoName)}
              </span>
              {provider.syncDirection === 'bidirectional' && (
                <span className="text-[10px] opacity-50">sync</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
