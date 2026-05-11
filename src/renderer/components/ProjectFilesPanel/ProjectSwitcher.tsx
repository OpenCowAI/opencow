// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, FolderGit2, List, Pin } from 'lucide-react'
import { useAppStore } from '@/stores/appStore'
import { useModalAnimation } from '@/hooks/useModalAnimation'
import { cn } from '@/lib/utils'
import { surfaceProps } from '@/lib/surface'
import type { Project } from '@shared/types'

const VIEWPORT_MARGIN = 8

interface ProjectSwitcherProps {
  project: Project
}

/**
 * In-panel project switcher.
 *
 * Lives in the Files panel header. Trigger shows current project; clicking
 * opens a dropdown with all projects (alphabetical by display order; pinned
 * surfaced with an amber pin) plus a footer link back to the project list.
 */
export function ProjectSwitcher({ project }: ProjectSwitcherProps): React.JSX.Element {
  const { t } = useTranslation('navigation')
  const projects = useAppStore((s) => s.projects)
  const navigateToProject = useAppStore((s) => s.navigateToProject)

  const [open, setOpen] = useState(false)
  const { mounted, phase } = useModalAnimation(open)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => setOpen(false), [])

  // ── Outside click + Escape ────────────────────────────────
  useEffect(() => {
    if (!open) return
    const handleMouseDown = (e: MouseEvent): void => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        close()
      }
    }
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open, close])

  // ── Viewport-aware positioning (anchor below trigger) ─────
  const [pos, setPos] = useState<{ x: number; y: number; width: number } | null>(null)
  useLayoutEffect(() => {
    if (!mounted || !triggerRef.current || !menuRef.current) return
    const trig = triggerRef.current.getBoundingClientRect()
    const { width, height } = menuRef.current.getBoundingClientRect()
    let x = trig.left
    let y = trig.bottom + 4
    if (x + width + VIEWPORT_MARGIN > window.innerWidth) {
      x = Math.max(VIEWPORT_MARGIN, trig.right - width)
    }
    if (y + height + VIEWPORT_MARGIN > window.innerHeight) {
      y = Math.max(VIEWPORT_MARGIN, trig.top - height - 4)
    }
    setPos({ x, y, width: Math.max(trig.width, 280) })
  }, [mounted])

  useEffect(() => {
    if (!mounted) setPos(null)
  }, [mounted])

  const handleSwitch = (id: string): void => {
    close()
    if (id !== project.id) navigateToProject(id)
  }

  const handleShowAll = (): void => {
    close()
    navigateToProject(null)
  }

  // Sort: pinned (by pinOrder) → regular (by displayOrder) → archived
  // (by displayOrder, then archivedAt). A project is archived if it has
  // `archivedAt !== null` and is NOT pinned (pinned trumps archived).
  const rank = (p: Project): number => {
    if (p.pinOrder !== null) return 0
    if (p.archivedAt !== null) return 2
    return 1
  }
  const sorted = [...projects].sort((a, b) => {
    const ra = rank(a)
    const rb = rank(b)
    if (ra !== rb) return ra - rb
    if (ra === 0) return (a.pinOrder ?? 0) - (b.pinOrder ?? 0)
    return a.displayOrder - b.displayOrder
  })

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={project.name}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          'no-drag group flex min-w-0 max-w-full flex-1 items-center gap-2 rounded-lg p-1.5 transition-colors',
          open ? 'bg-[hsl(var(--foreground)/0.06)]' : 'hover:bg-[hsl(var(--foreground)/0.04)]',
        )}
      >
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]">
          <FolderGit2 className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-[hsl(var(--foreground))]">
          {project.name}
        </span>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))] transition-transform duration-200',
            open && 'rotate-180',
          )}
          aria-hidden="true"
        />
      </button>

      {mounted && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={t('sidebar.projectList')}
          {...surfaceProps({ elevation: 'floating', color: 'popover' })}
          className={cn(
            'fixed z-[60] rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--popover))] text-[hsl(var(--popover-foreground))] shadow-lg p-2',
            phase === 'enter' && 'dropdown-enter',
            phase === 'exit' && 'dropdown-exit',
          )}
          style={{
            top: pos?.y ?? -9999,
            left: pos?.x ?? -9999,
            minWidth: pos?.width ?? 280,
            visibility: pos ? 'visible' : 'hidden',
          }}
        >
          <div className="px-2 pb-2 text-[11px] text-[hsl(var(--muted-foreground))]">
            {t('sidebar.projects')}
          </div>

          <div
            className="mb-1 max-h-[min(50vh,400px)] overflow-y-auto"
            style={{ scrollbarWidth: 'thin' }}
          >
            {sorted.map((p) => {
              const isActive = p.id === project.id
              const isPinned = p.pinOrder !== null
              const isArchived = p.archivedAt !== null
              return (
                <button
                  key={p.id}
                  type="button"
                  role="menuitem"
                  onClick={() => handleSwitch(p.id)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-lg p-2 text-left transition-colors',
                    isActive
                      ? 'bg-[hsl(var(--foreground)/0.06)]'
                      : 'hover:bg-[hsl(var(--foreground)/0.04)]',
                  )}
                >
                  <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]">
                    <FolderGit2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div
                      className={cn(
                        'flex items-center gap-1 text-sm',
                        isActive
                          ? 'font-semibold text-[hsl(var(--foreground))]'
                          : 'text-[hsl(var(--foreground)/0.85)]',
                      )}
                    >
                      {isPinned && (
                        <Pin className="h-3 w-3 shrink-0 fill-amber-500 text-amber-500" aria-hidden="true" />
                      )}
                      <span className="truncate">{p.name}</span>
                      {isArchived && (
                        <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
                          ({t('sidebar.archived')})
                        </span>
                      )}
                    </div>
                    <div
                      className="truncate text-[11px] text-[hsl(var(--muted-foreground)/0.85)]"
                      title={p.path}
                    >
                      {p.path}
                    </div>
                  </div>
                  {isActive && (
                    <Check className="ml-auto h-4 w-4 shrink-0 text-[hsl(var(--primary))]" aria-hidden="true" />
                  )}
                </button>
              )
            })}
          </div>

          <div className="mx-1 my-1 h-px bg-[hsl(var(--border)/0.5)]" />

          <button
            type="button"
            onClick={handleShowAll}
            className="flex w-full items-center gap-2 rounded-md p-2 text-sm text-[hsl(var(--foreground)/0.85)] transition-colors hover:bg-[hsl(var(--foreground)/0.04)] hover:text-[hsl(var(--foreground))]"
          >
            <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center text-[hsl(var(--muted-foreground))]">
              <List className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            <span className="truncate">{t('sidebar.allProjects')}</span>
          </button>
        </div>,
        document.body,
      )}
    </>
  )
}
