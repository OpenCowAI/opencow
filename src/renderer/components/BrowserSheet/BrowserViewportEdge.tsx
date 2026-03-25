// SPDX-License-Identifier: Apache-2.0

/**
 * BrowserViewportEdge (BrowserSheet version).
 *
 * Animated boundary between NativeViewport and BrowserSheetChat.
 * Reads agent state from commandStore (canonical source), falling back
 * to overlay's optimistic agentState during session creation.
 */

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import {
  Camera,
  MousePointer2,
  ScrollText,
  Keyboard,
  Globe,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { useCommandStore } from '@/stores/commandStore'
import { useBrowserOverlayStore } from '@/stores/browserOverlayStore'
import { cn } from '@/lib/utils'
import type { BrowserExecutorState, ManagedSessionState } from '@shared/types'

// ─── Action Icon Mapping ─────────────────────────────────────────────

interface ActionIconInfo {
  icon: LucideIcon
  label: string
}

function resolveActionIcon(activity: string | null, t: TFunction<'navigation'>): ActionIconInfo | null {
  if (!activity) return null
  const lower = activity.toLowerCase()
  if (lower.includes('screenshot') || lower.includes('capture')) {
    return { icon: Camera, label: t('browser.activities.screenshot') }
  }
  if (lower.includes('scroll')) {
    return { icon: ScrollText, label: t('browser.activities.scrolling') }
  }
  if (lower.includes('click') || lower.includes('mouse') || lower.includes('tap') || lower.includes('hover')) {
    return { icon: MousePointer2, label: t('browser.activities.clicking') }
  }
  if (lower.includes('type') || lower.includes('key') || lower.includes('input')) {
    return { icon: Keyboard, label: t('browser.activities.typing') }
  }
  if (lower.includes('navigat') || lower.includes('goto') || lower.includes('open')) {
    return { icon: Globe, label: t('browser.activities.navigating') }
  }
  return { icon: Zap, label: activity }
}

function resolveGlowClass(
  agentState: ManagedSessionState | null,
  _executorState: BrowserExecutorState
): string {
  if (agentState === 'streaming') return 'glow-breathe-strong'
  if (agentState === 'creating' || agentState === 'stopping') return 'glow-breathe'
  return ''
}

export function BrowserViewportEdge(): React.JSX.Element {
  const { t } = useTranslation('navigation')

  // Read agent session identity + optimistic state from overlay
  const agentSessionId = useBrowserOverlayStore((s) => s.browserOverlay?.agentSessionId ?? null)
  const optimisticState = useBrowserOverlayStore((s) => s.browserOverlay?.agentState ?? null)

  // Canonical source: commandStore.sessionById
  const sessionData = useCommandStore((s) =>
    agentSessionId ? s.sessionById[agentSessionId] : null,
  )
  const agentState = sessionData?.state ?? optimisticState
  const agentActivity = sessionData?.activity ?? null

  const executorState = useBrowserOverlayStore((s) => s.browserOverlay?.executorState ?? 'idle')

  const glowClass = useMemo(
    () => resolveGlowClass(agentState, executorState),
    [agentState, executorState]
  )

  const actionIcon = useMemo(() => resolveActionIcon(agentActivity, t), [agentActivity, t])
  const isActive = agentState === 'streaming' || agentState === 'creating'

  return (
    <div
      className={cn(
        'relative flex-shrink-0 w-px overflow-visible',
        'bg-[hsl(var(--border))]',
        glowClass,
        'transition-shadow duration-700'
      )}
      aria-hidden="true"
    >
      {isActive && actionIcon && (
        <div
          key={actionIcon.label}
          className={cn(
            'absolute top-1/2 -translate-y-1/2',
            'left-1/2 -translate-x-1/2',
            'flex items-center gap-1',
            'bg-[hsl(var(--card))] border border-[hsl(var(--border))]',
            'rounded-full px-1.5 py-1',
            'shadow-sm z-10',
            'animate-[modal-content-enter_0.2s_ease-out]'
          )}
          title={actionIcon.label}
        >
          <actionIcon.icon
            className={cn(
              'h-3 w-3',
              agentState === 'streaming'
                ? 'text-[hsl(var(--ring))] motion-safe:animate-pulse'
                : 'text-[hsl(var(--muted-foreground))]'
            )}
          />
        </div>
      )}
    </div>
  )
}
