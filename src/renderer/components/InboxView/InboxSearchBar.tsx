// SPDX-License-Identifier: Apache-2.0

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/stores/appStore'
import { useInboxStore } from '@/stores/inboxStore'
import { Search, FolderOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { InboxMessage } from '@shared/types'

type CategoryTab = 'all' | 'hook_event' | 'smart_reminder'

const CATEGORY_TABS: { value: CategoryTab; labelKey: string }[] = [
  { value: 'all', labelKey: 'tabs.all' },
  { value: 'hook_event', labelKey: 'tabs.events' },
  { value: 'smart_reminder', labelKey: 'tabs.reminders' }
]

/** Derive unique projects that have inbox messages */
function deriveMessageProjects(
  messages: InboxMessage[],
  projectMap: Map<string, string>
): { id: string; name: string }[] {
  const seen = new Set<string>()
  const result: { id: string; name: string }[] = []

  for (const msg of messages) {
    if (msg.category === 'hook_event' && msg.projectId && !seen.has(msg.projectId)) {
      seen.add(msg.projectId)
      result.push({
        id: msg.projectId,
        name: projectMap.get(msg.projectId) ?? msg.projectId
      })
    }
  }

  return result.sort((a, b) => a.name.localeCompare(b.name))
}

export function InboxSearchBar(): React.JSX.Element {
  const { t } = useTranslation('inbox')
  const inboxFilter = useInboxStore((s) => s.inboxFilter)
  const setInboxFilter = useInboxStore((s) => s.setInboxFilter)
  const messages = useInboxStore((s) => s.inboxMessages)
  const projects = useAppStore((s) => s.projects)

  const [searchInput, setSearchInput] = useState(inboxFilter.search ?? '')

  const activeCategory: CategoryTab = inboxFilter.category ?? 'all'

  const projectMap = useMemo(
    () => new Map(projects.map((p) => [p.id, p.name])),
    [projects]
  )

  const messageProjects = useMemo(
    () => deriveMessageProjects(messages, projectMap),
    [messages, projectMap]
  )

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      setInboxFilter({ ...inboxFilter, search: searchInput || undefined })
    }, 300)
    return () => clearTimeout(timer)
  }, [searchInput]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleCategoryChange = useCallback((category: CategoryTab) => {
    const newFilter = { ...inboxFilter }
    if (category === 'all') {
      delete newFilter.category
    } else {
      newFilter.category = category as InboxMessage['category']
    }
    setInboxFilter(newFilter)
  }, [inboxFilter, setInboxFilter])

  const handleProjectChange = useCallback((projectId: string) => {
    const newFilter = { ...inboxFilter }
    if (projectId === '') {
      delete newFilter.projectId
    } else {
      newFilter.projectId = projectId
    }
    setInboxFilter(newFilter)
  }, [inboxFilter, setInboxFilter])

  return (
    <div className="border-b border-[hsl(var(--border))] p-3 space-y-2">
      {/* Search input */}
      <div className="relative">
        <Search
          className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]"
          aria-hidden="true"
        />
        <input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder={t('search.placeholder')}
          aria-label={t('search.aria')}
          className="w-full pl-8 pr-3 py-1.5 text-sm bg-[hsl(var(--muted))] rounded-md border-none outline-none focus:ring-2 focus:ring-[hsl(var(--ring))] placeholder:text-[hsl(var(--muted-foreground))]"
        />
      </div>

      {/* Category tabs + Project filter */}
      <div className="flex items-center gap-2">
        <div className="flex gap-1" role="tablist" aria-label={t('search.categoryAria')}>
          {CATEGORY_TABS.map((tab) => (
            <button
              key={tab.value}
              role="tab"
              aria-selected={activeCategory === tab.value}
              onClick={() => handleCategoryChange(tab.value)}
              className={cn(
                'px-2.5 py-1 text-xs rounded-md transition-colors',
                activeCategory === tab.value
                  ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] font-medium'
                  : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]'
              )}
            >
              {t(tab.labelKey)}
            </button>
          ))}
        </div>

        {messageProjects.length > 0 && (
          <>
            <span className="h-4 w-px bg-[hsl(var(--border))]" aria-hidden="true" />
            <div className="relative flex items-center">
              <FolderOpen
                className="absolute left-1.5 h-3 w-3 text-[hsl(var(--muted-foreground))] pointer-events-none"
                aria-hidden="true"
              />
              <select
                value={inboxFilter.projectId ?? ''}
                onChange={(e) => handleProjectChange(e.target.value)}
                aria-label={t('search.projectAria')}
                className={cn(
                  'pl-5.5 pr-5 py-1 text-xs rounded-md appearance-none cursor-pointer',
                  'bg-[hsl(var(--muted))] border-none outline-none',
                  'focus:ring-2 focus:ring-[hsl(var(--ring))]',
                  inboxFilter.projectId
                    ? 'text-[hsl(var(--foreground))] font-medium'
                    : 'text-[hsl(var(--muted-foreground))]'
                )}
                style={{ paddingLeft: '1.375rem' }}
              >
                <option value="">{t('search.allProjects')}</option>
                {messageProjects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
