// SPDX-License-Identifier: Apache-2.0

/**
 * ── Label ──────── [action]
 * Section divider with label and optional trailing action (e.g. "+ Add" button).
 * Used inside modal-variant forms to visually group related fields.
 */
export function SectionDivider({
  label,
  action,
}: {
  label: string
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 pt-1 pb-0.5">
      <span className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))] opacity-60 shrink-0">
        {label}
      </span>
      <div className="flex-1 border-t border-[hsl(var(--border)/0.3)]" />
      {action}
    </div>
  )
}
