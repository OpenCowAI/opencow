// SPDX-License-Identifier: Apache-2.0

import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Search, Star, FolderGit2, Package, Check } from 'lucide-react'
import { useGroupedProjects } from '@/hooks/useGroupedProjects'
import { useAppStore } from '@/stores/appStore'
import { cn } from '@/lib/utils'
import { surfaceProps } from '@/lib/surface'
import { useModalAnimation } from '@/hooks/useModalAnimation'
import type { Project, ProjectGroup } from '@shared/types'

interface ProjectPickerProps {
  value: string | null
  onChange: (projectId: string | null) => void
  placeholder?: string
  className?: string
  triggerClassName?: string
  position?: 'below' | 'above'
  ariaLabel?: string
  /** Render dropdown via portal to escape stacking-context constraints. */
  portal?: boolean
  /** Project IDs to exclude from the dropdown list (e.g. the current project in a clone dialog). */
  excludeIds?: string[]
}

interface GroupConfig {
  key: ProjectGroup
  label: string
  icon: React.ReactNode
}

const GROUP_CONFIGS: GroupConfig[] = [
  { key: 'pinned', label: 'Pinned', icon: <Star className="h-3 w-3" /> },
  { key: 'projects', label: 'Projects', icon: <FolderGit2 className="h-3 w-3" /> },
  { key: 'archived', label: 'Archived', icon: <Package className="h-3 w-3" /> }
]

export function ProjectPicker({
  value,
  onChange,
  placeholder = 'All Projects',
  className,
  triggerClassName,
  position = 'below',
  ariaLabel = 'Select project',
  portal = false,
  excludeIds,
}: ProjectPickerProps): React.JSX.Element {
  const grouped = useGroupedProjects()
  const projects = useAppStore((s) => s.projects)

  const [open, setOpen] = useState(false)
  const { mounted, phase } = useModalAnimation(open)
  const [search, setSearch] = useState('')
  const [focusIndex, setFocusIndex] = useState(-1)

  const containerRef = useRef<HTMLDivElement>(null)
  const triggerBtnRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // ── Portal positioning ──────────────────────────────────────────
  const [portalPos, setPortalPos] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    if (!portal || !open || !triggerBtnRef.current) return
    const rect = triggerBtnRef.current.getBoundingClientRect()
    const DROPDOWN_W = 256 // w-64
    let top = position === 'above' ? rect.top - 4 : rect.bottom + 4
    let left = rect.left

    // Clamp to viewport so the dropdown never overflows the window edge
    if (left + DROPDOWN_W > window.innerWidth - 8) {
      left = window.innerWidth - DROPDOWN_W - 8
    }
    if (left < 8) left = 8

    // If opening above, measure dropdown height and shift up
    if (position === 'above' && dropdownRef.current) {
      top -= dropdownRef.current.offsetHeight
    }

    setPortalPos({ top, left })
  }, [portal, open, position])

  // Resolve selected project name
  const selectedName = useMemo(() => {
    if (!value) return null
    return projects.find((p) => p.id === value)?.name ?? null
  }, [value, projects])

  // Filter projects by search term and excludeIds
  const filteredGroups = useMemo(() => {
    const term = search.toLowerCase().trim()
    const excludeSet = excludeIds?.length ? new Set(excludeIds) : null

    const filterList = (list: Project[]): Project[] =>
      list.filter((p) => {
        if (excludeSet?.has(p.id)) return false
        if (term && !p.name.toLowerCase().includes(term) && !p.path.toLowerCase().includes(term)) return false
        return true
      })

    return {
      pinned: filterList(grouped.pinned),
      projects: filterList(grouped.projects),
      archived: filterList(grouped.archived)
    }
  }, [grouped, search, excludeIds])

  // Build flat list of selectable items for keyboard navigation
  const flatItems = useMemo(() => {
    const items: Array<{ id: string | null; name: string }> = [{ id: null, name: placeholder }]
    for (const config of GROUP_CONFIGS) {
      const groupItems = filteredGroups[config.key]
      for (const project of groupItems) {
        items.push({ id: project.id, name: project.name })
      }
    }
    return items
  }, [filteredGroups, placeholder])

  // Close on outside click (check both container and portal dropdown)
  useEffect(() => {
    if (!open) return
    function handleMouseDown(e: MouseEvent): void {
      const target = e.target as Node
      if (containerRef.current?.contains(target)) return
      if (dropdownRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [open])

  // Focus search input when opening
  useEffect(() => {
    if (open) {
      searchRef.current?.focus()
      setFocusIndex(-1)
      setSearch('')
    }
  }, [open])

  const handleSelect = useCallback(
    (projectId: string | null) => {
      onChange(projectId)
      setOpen(false)
    },
    [onChange]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setFocusIndex((prev) => Math.min(prev + 1, flatItems.length - 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setFocusIndex((prev) => Math.max(prev - 1, 0))
          break
        case 'Enter':
          e.preventDefault()
          if (focusIndex >= 0 && focusIndex < flatItems.length) {
            handleSelect(flatItems[focusIndex].id)
          }
          break
        case 'Escape':
          e.preventDefault()
          e.stopPropagation()
          setOpen(false)
          break
      }
    },
    [flatItems, focusIndex, handleSelect]
  )

  // Scroll focused item into view
  useEffect(() => {
    if (focusIndex < 0 || !listRef.current) return
    const items = listRef.current.querySelectorAll('[data-picker-item]')
    items[focusIndex]?.scrollIntoView({ block: 'nearest' })
  }, [focusIndex])

  const hasAnyResults = GROUP_CONFIGS.some((c) => filteredGroups[c.key].length > 0)

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      {/* Trigger button */}
      <button
        ref={triggerBtnRef}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md border border-[hsl(var(--border))] transition-colors',
          'hover:bg-[hsl(var(--foreground)/0.04)]',
          open && 'ring-1 ring-[hsl(var(--ring))]',
          value ? 'text-[hsl(var(--foreground))]' : 'text-[hsl(var(--muted-foreground))]',
          triggerClassName
        )}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="truncate max-w-[140px]">{selectedName ?? placeholder}</span>
        <ChevronDown
          className={cn('h-3 w-3 shrink-0 transition-transform', open && 'rotate-180')}
          aria-hidden="true"
        />
      </button>

      {/* Dropdown */}
      {mounted && !portal && (
        <DropdownPanel
          ref={dropdownRef}
          listRef={listRef}
          searchRef={searchRef}
          position={position}
          phase={phase}
          ariaLabel={ariaLabel}
          search={search}
          setSearch={setSearch}
          focusIndex={focusIndex}
          setFocusIndex={setFocusIndex}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          value={value}
          handleSelect={handleSelect}
          filteredGroups={filteredGroups}
          flatItems={flatItems}
          hasAnyResults={hasAnyResults}
        />
      )}

      {/* Portal-rendered dropdown — escapes stacking context */}
      {mounted && portal && createPortal(
        <DropdownPanel
          ref={dropdownRef}
          listRef={listRef}
          searchRef={searchRef}
          position={position}
          phase={phase}
          ariaLabel={ariaLabel}
          search={search}
          setSearch={setSearch}
          focusIndex={focusIndex}
          setFocusIndex={setFocusIndex}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          value={value}
          handleSelect={handleSelect}
          filteredGroups={filteredGroups}
          flatItems={flatItems}
          hasAnyResults={hasAnyResults}
          portalStyle={portalPos ? { position: 'fixed' as const, top: portalPos.top, left: portalPos.left, zIndex: 9999 } : undefined}
        />,
        document.body,
      )}
    </div>
  )
}

// ─── Dropdown Panel (shared by inline and portal modes) ─────────────────────

interface DropdownPanelProps {
  listRef: React.RefObject<HTMLDivElement | null>
  searchRef: React.RefObject<HTMLInputElement | null>
  position: 'below' | 'above'
  phase: 'enter' | 'exit' | null
  ariaLabel: string
  search: string
  setSearch: (v: string) => void
  focusIndex: number
  setFocusIndex: (v: number | ((prev: number) => number)) => void
  onKeyDown: (e: React.KeyboardEvent) => void
  placeholder: string
  value: string | null
  handleSelect: (id: string | null) => void
  filteredGroups: Record<ProjectGroup, Project[]>
  flatItems: Array<{ id: string | null; name: string }>
  hasAnyResults: boolean
  /** When rendered via portal, position with fixed style instead of absolute. */
  portalStyle?: React.CSSProperties
}

const DropdownPanel = React.forwardRef<HTMLDivElement, DropdownPanelProps>(
  function DropdownPanel(
    {
      listRef,
      searchRef,
      position,
      phase,
      ariaLabel,
      search,
      setSearch,
      focusIndex,
      setFocusIndex,
      onKeyDown,
      placeholder,
      value,
      handleSelect,
      filteredGroups,
      flatItems,
      hasAnyResults,
      portalStyle,
    },
    ref,
  ) {
    return (
      <div
        ref={ref}
        {...surfaceProps({ elevation: 'floating', color: 'popover' })}
        style={portalStyle}
        className={cn(
          'w-64 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--popover))] text-[hsl(var(--popover-foreground))] shadow-md overflow-hidden',
          // Inline mode: use absolute positioning
          !portalStyle && 'absolute left-0 z-50',
          !portalStyle && (position === 'above' ? 'bottom-full mb-1' : 'top-full mt-1'),
          phase === 'enter' && 'dropdown-enter',
          phase === 'exit' && 'dropdown-exit',
        )}
        role="listbox"
        aria-label={ariaLabel}
        onKeyDown={onKeyDown}
      >
        {/* Search input */}
        <div className="p-2 border-b border-[hsl(var(--border))]">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-[hsl(var(--muted-foreground))]" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setFocusIndex(-1)
              }}
              placeholder="Search projects..."
              className="w-full pl-7 pr-2 py-1 text-xs rounded border border-[hsl(var(--border))] bg-transparent placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--ring))]"
              aria-label="Search projects"
            />
          </div>
        </div>

        {/* Options list */}
        <div ref={listRef} className="max-h-64 overflow-y-auto py-1">
          {/* "All Projects" option */}
          <PickerItem
            label={placeholder}
            isSelected={value === null}
            isFocused={focusIndex === 0}
            onClick={() => handleSelect(null)}
          />

          {/* Grouped projects */}
          {GROUP_CONFIGS.map((config) => {
            const items = filteredGroups[config.key]
            if (items.length === 0) return null

            return (
              <div key={config.key}>
                <div className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider">
                  <span className="flex items-center" aria-hidden="true">
                    {config.icon}
                  </span>
                  {config.label}
                </div>
                {items.map((project) => {
                  const itemIndex = flatItems.findIndex((fi) => fi.id === project.id)
                  return (
                    <PickerItem
                      key={project.id}
                      label={project.name}
                      isSelected={value === project.id}
                      isFocused={focusIndex === itemIndex}
                      onClick={() => handleSelect(project.id)}
                    />
                  )
                })}
              </div>
            )
          })}

          {/* No results */}
          {!hasAnyResults && search && (
            <div className="px-3 py-2 text-xs text-[hsl(var(--muted-foreground))]">
              No projects found
            </div>
          )}
        </div>
      </div>
    )
  },
)

// ─── Picker Item ────────────────────────────────────────────────────────────

function PickerItem({
  label,
  isSelected,
  isFocused,
  onClick
}: {
  label: string
  isSelected: boolean
  isFocused: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      data-picker-item
      role="option"
      aria-selected={isSelected}
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors',
        isFocused && 'bg-[hsl(var(--primary)/0.08)]',
        !isFocused && 'hover:bg-[hsl(var(--foreground)/0.04)]'
      )}
    >
      <Check
        className={cn('h-3 w-3 shrink-0', isSelected ? 'opacity-100' : 'opacity-0')}
        aria-hidden="true"
      />
      <span className="truncate">{label}</span>
    </button>
  )
}
