// SPDX-License-Identifier: Apache-2.0

import { useRef } from 'react'
import { cn } from '@/lib/utils'

interface KeepAliveTabProps {
  /** Whether this tab is currently visible. */
  active: boolean
  children: React.ReactNode
  className?: string
}

/**
 * Keep-alive tab container.
 *
 * Once a tab has been activated for the first time, it stays mounted
 * and is only hidden via CSS `display: none`. This preserves ALL
 * component-local state: scroll positions, input drafts, focus state,
 * animation state, and any future local state additions.
 *
 * Tabs that have never been visited are not mounted (lazy initialization),
 * so there is zero overhead for tabs the user hasn't opened yet.
 *
 * Pattern used by VS Code, Chrome, Figma, Linear.
 */
export function KeepAliveTab({ active, children, className }: KeepAliveTabProps): React.JSX.Element | null {
  // Once activated, stay mounted forever.
  const hasBeenActive = useRef(active)
  if (active) hasBeenActive.current = true

  // Never mount if never visited (lazy initialization).
  if (!hasBeenActive.current) return null

  return (
    <div
      className={cn('flex-1 flex flex-col min-h-0', className, !active && 'hidden')}
      role="tabpanel"
      aria-hidden={!active}
      // @ts-expect-error — inert is valid HTML but React types lag behind
      inert={!active ? '' : undefined}
    >
      {children}
    </div>
  )
}
