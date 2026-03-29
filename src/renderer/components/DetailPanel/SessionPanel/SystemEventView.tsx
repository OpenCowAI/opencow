// SPDX-License-Identifier: Apache-2.0

import { memo } from 'react'
import { ListChecks, CheckCircle2, XCircle, Square, Zap, Scissors, Loader2, ArrowRightLeft } from 'lucide-react'
import type { SystemEvent } from '@shared/types'

interface SystemEventViewProps {
  event: SystemEvent
}

export const SystemEventView = memo(function SystemEventView({ event }: SystemEventViewProps): React.JSX.Element {
  switch (event.type) {
    case 'task_started':
      return (
        <li className="flex items-center gap-2 py-0.5 text-xs font-mono text-[hsl(var(--muted-foreground))]">
          <ListChecks className="w-3.5 h-3.5 text-blue-500 shrink-0" aria-hidden="true" />
          <span>Task started: {event.description}</span>
        </li>
      )

    case 'task_notification': {
      const isError = event.status === 'failed'
      const isStopped = event.status === 'stopped'
      const Icon = isError ? XCircle : isStopped ? Square : CheckCircle2
      const color = isError ? 'text-red-500' : isStopped ? 'text-yellow-500' : 'text-green-500'
      const durationLabel = event.usage
        ? ` (${(event.usage.durationMs / 1000).toFixed(1)}s)`
        : ''

      return (
        <li className="flex items-start gap-2 py-0.5 text-xs font-mono text-[hsl(var(--muted-foreground))]">
          <Icon className={`w-3.5 h-3.5 ${color} shrink-0 mt-0.5`} aria-hidden="true" />
          <div className="min-w-0">
            <span className="capitalize">{event.status}{durationLabel}</span>
            {event.summary && (
              <p className="text-[hsl(var(--muted-foreground)/0.7)] truncate">{event.summary}</p>
            )}
          </div>
        </li>
      )
    }

    case 'hook': {
      const isRunning = event.outcome === undefined
      const isError = event.outcome === 'error'
      const color = isError ? 'text-red-500' : isRunning ? 'text-yellow-500' : 'text-[hsl(var(--muted-foreground)/0.5)]'
      const label = isRunning
        ? `Hook: ${event.hookName}`
        : `Hook: ${event.hookName} (${event.outcome})`

      return (
        <li className="flex items-center gap-2 py-0.5 text-xs font-mono text-[hsl(var(--muted-foreground)/0.6)]">
          <Zap className={`w-3.5 h-3.5 ${color} shrink-0`} aria-hidden="true" />
          <span>{label}</span>
        </li>
      )
    }

    case 'compact_boundary': {
      const phase = event.phase ?? 'done'

      // Phase: Compacting in progress — animated indicator
      if (phase === 'compacting') {
        return (
          <li
            className="flex items-center gap-2.5 py-1 text-xs font-mono text-orange-400/80 motion-safe:animate-pulse"
            aria-label="Optimizing conversation memory"
            aria-live="polite"
          >
            <div className="flex-1 h-px bg-orange-400/20" />
            <Loader2 className="w-3.5 h-3.5 shrink-0 motion-safe:animate-spin" aria-hidden="true" />
            <span>Optimizing conversation memory{'\u2026'}</span>
            <div className="flex-1 h-px bg-orange-400/20" />
          </li>
        )
      }

      // Phase: Done — static divider with token count
      const tokenLabel = event.preTokens >= 1000
        ? `${(event.preTokens / 1000).toFixed(0)}k`
        : `${event.preTokens}`

      return (
        <li
          className="flex items-center gap-2.5 py-1 text-xs font-mono text-[hsl(var(--muted-foreground)/0.5)]"
          aria-label={`Memory optimized, saved ${tokenLabel} tokens`}
        >
          <div className="flex-1 h-px bg-[hsl(var(--border))]" />
          <Scissors className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>Memory optimized {'\u00b7'} saved {tokenLabel} tokens</span>
          <div className="flex-1 h-px bg-[hsl(var(--border))]" />
        </li>
      )
    }

    case 'engine_switch': {
      return (
        <li
          className="flex items-center gap-2.5 py-1 text-xs font-mono text-[hsl(var(--muted-foreground)/0.5)]"
          aria-label={`Engine switched from ${event.fromEngine} to ${event.toEngine}`}
        >
          <div className="flex-1 h-px bg-[hsl(var(--border))]" />
          <ArrowRightLeft className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>Engine switched {'\u00b7'} {event.fromEngine} → {event.toEngine}</span>
          <div className="flex-1 h-px bg-[hsl(var(--border))]" />
        </li>
      )
    }
  }
})
