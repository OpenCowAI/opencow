// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { surfaceProps } from '@/lib/surface'
import { useModalAnimation } from '@/hooks/useModalAnimation'
import { cn } from '@/lib/utils'

export const PILL_TRIGGER =
  'flex items-center gap-1.5 px-3 py-1 text-xs rounded-full border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--foreground)/0.04)] hover:text-[hsl(var(--accent-foreground))] transition-colors'

export function PillDropdown({
  open,
  onOpenChange,
  trigger,
  children,
  position = 'above',
  align = 'left',
  hoverMode = false,
  className,
  dropdownClassName
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger: React.ReactNode
  children: React.ReactNode
  position?: 'above' | 'below'
  align?: 'left' | 'right'
  /** When true, open/close on hover instead of relying on external click handlers */
  hoverMode?: boolean
  /** Extra classes for the container element */
  className?: string
  /** Extra classes for the dropdown panel element */
  dropdownClassName?: string
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { mounted, phase } = useModalAnimation(open)
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({})

  // Recalculate dropdown position whenever it opens
  useEffect(() => {
    if (!open || !containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    if (position === 'below') {
      setDropdownStyle({
        top: rect.bottom + 4,
        left: align === 'right' ? undefined : rect.left,
        right: align === 'right' ? window.innerWidth - rect.right : undefined
      })
    } else {
      setDropdownStyle({
        bottom: window.innerHeight - rect.top + 4,
        left: align === 'right' ? undefined : rect.left,
        right: align === 'right' ? window.innerWidth - rect.right : undefined
      })
    }
  }, [open, position, align])

  // Close on outside click (checks both the trigger container and the portal dropdown)
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent): void => {
      const target = e.target as Node
      if (!containerRef.current?.contains(target) && !dropdownRef.current?.contains(target)) {
        onOpenChange(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, onOpenChange])

  // Close on Escape key
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onOpenChange(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onOpenChange])

  // Clean up hover timeout on unmount
  useEffect(() => {
    return () => {
      if (hoverTimeout.current) clearTimeout(hoverTimeout.current)
    }
  }, [])

  const handleMouseEnter = useCallback(() => {
    if (!hoverMode) return
    if (hoverTimeout.current) {
      clearTimeout(hoverTimeout.current)
      hoverTimeout.current = null
    }
    onOpenChange(true)
  }, [hoverMode, onOpenChange])

  const handleMouseLeave = useCallback(() => {
    if (!hoverMode) return
    // Small delay to allow cursor to travel across the gap between trigger and dropdown
    hoverTimeout.current = setTimeout(() => {
      onOpenChange(false)
    }, 150)
  }, [hoverMode, onOpenChange])

  return (
    <div
      ref={containerRef}
      className={cn('relative', className)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {trigger}
      {mounted &&
        createPortal(
          <div
            ref={dropdownRef}
            {...surfaceProps({ elevation: 'floating', color: 'popover' })}
            style={dropdownStyle}
            className={cn(
              'fixed min-w-[160px] rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--popover))] text-[hsl(var(--popover-foreground))] shadow-md py-1 z-[9999]',
              dropdownClassName,
              phase === 'enter' && 'dropdown-enter',
              phase === 'exit' && 'dropdown-exit'
            )}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            {children}
          </div>,
          document.body
        )}
    </div>
  )
}
