// SPDX-License-Identifier: Apache-2.0

import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useInboxStore } from '@/stores/inboxStore'
import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ProjectPicker } from '@/components/ui/ProjectPicker'
import type { InboxMessage } from '@shared/types'

type CategoryTab = 'all' | 'hook_event' | 'smart_reminder'

const CATEGORY_TABS: { value: CategoryTab; labelKey: string }[] = [
  { value: 'all', labelKey: 'tabs.all' },
  { value: 'hook_event', labelKey: 'tabs.events' },
  { value: 'smart_reminder', labelKey: 'tabs.reminders' }
]

export function InboxSearchBar(): React.JSX.Element {
  const { t } = useTranslation('inbox')
  const inboxFilter = useInboxStore((s) => s.inboxFilter)
  const setInboxFilter = useInboxStore((s) => s.setInboxFilter)

  const [searchInput, setSearchInput] = useState(inboxFilter.search ?? '')

  const activeCategory: CategoryTab = inboxFilter.category ?? 'all'

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

  const handleProjectChange = useCallback((projectId: string | null) => {
    const newFilter = { ...inboxFilter }
    if (!projectId) {
      delete newFilter.projectId
    } else {
      newFilter.projectId = projectId
    }
    setInboxFilter(newFilter)
  }, [inboxFilter, setInboxFilter])

  return (
    <div className="px-3 pb-2 space-y-2">
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

        {/* Shared ProjectPicker — same component the Starred page uses,
            so the filter affordance reads identically across views.
            `portal` lets the dropdown escape the narrow inbox column. */}
        <div className="ml-1">
          <ProjectPicker
            value={inboxFilter.projectId ?? null}
            onChange={handleProjectChange}
            placeholder={t('search.allProjects')}
            ariaLabel={t('search.projectAria')}
            portal
          />
        </div>
      </div>
    </div>
  )
}
