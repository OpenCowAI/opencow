// SPDX-License-Identifier: Apache-2.0

/**
 * ExitPlanModeWidget — Widget Tool adapter for ExitPlanMode.
 *
 * Renders a compact plan-approval card showing the transition from plan mode
 * to execution mode, along with the permissions (allowedPrompts) granted.
 *
 * ## Design rationale
 * ExitPlanMode is a mode-transition tool — it signals the agent is ready to
 * proceed from planning to execution. The card communicates this state change
 * with a minimal visual: checkmark icon, status label, and permissions list.
 *
 * ## States
 * - **executing**: Spinner + "Approving plan…" — SDK is processing the transition
 * - **completed**: Checkmark + "Plan approved" — mode transition succeeded
 */

import { CheckCircle2, Loader2, Shield } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { WidgetToolProps } from './WidgetToolRegistry'

// ─── Types ───────────────────────────────────────────────────────────────────

interface AllowedPrompt {
  tool: string
  prompt: string
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ExitPlanModeWidget({ block, isExecuting }: WidgetToolProps): React.JSX.Element {
  const prompts = extractAllowedPrompts(block.input)

  return (
    <div
      className={cn(
        'max-w-sm rounded-xl border border-[hsl(var(--border)/0.5)]',
        'bg-[hsl(var(--card))] text-[hsl(var(--card-foreground))]',
        'overflow-hidden',
      )}
    >
      {/* Header — status indicator */}
      <div className="flex items-center gap-2 px-3 py-2">
        {isExecuting ? (
          <Loader2
            className="w-4 h-4 shrink-0 motion-safe:animate-spin text-[hsl(var(--muted-foreground)/0.5)]"
            aria-label="Approving plan"
          />
        ) : (
          <CheckCircle2
            className="w-4 h-4 shrink-0 text-[hsl(var(--primary))]"
            aria-hidden="true"
          />
        )}
        <span className="text-xs font-medium text-[hsl(var(--foreground))]">
          {isExecuting ? 'Approving plan…' : 'Plan approved'}
        </span>
      </div>

      {/* Permissions list */}
      {prompts.length > 0 && (
        <div className="border-t border-[hsl(var(--border)/0.3)] px-3 py-2 space-y-1">
          <div className="flex items-center gap-1.5 text-[10px] text-[hsl(var(--muted-foreground)/0.6)] uppercase tracking-wide font-medium">
            <Shield className="w-3 h-3" aria-hidden="true" />
            Permissions
          </div>
          {prompts.map((p, i) => (
            <div key={i} className="flex items-baseline gap-2 text-xs min-w-0">
              <span className="shrink-0 font-mono text-[hsl(var(--muted-foreground)/0.5)]">
                {p.tool}
              </span>
              <span className="text-[hsl(var(--muted-foreground))] break-words min-w-0">
                {p.prompt}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Defensively extract allowedPrompts from the block's raw input. */
function extractAllowedPrompts(input: Record<string, unknown>): AllowedPrompt[] {
  const raw = input.allowedPrompts
  if (!Array.isArray(raw)) return []

  return raw
    .filter((item): item is Record<string, unknown> => item != null && typeof item === 'object')
    .map((item) => ({
      tool: typeof item.tool === 'string' ? item.tool : 'Tool',
      prompt: typeof item.prompt === 'string' ? item.prompt : '',
    }))
    .filter((p) => p.prompt.length > 0)
}
