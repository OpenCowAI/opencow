// SPDX-License-Identifier: Apache-2.0

/**
 * Shared slash item rendering primitives.
 *
 * Used by both SlashCommandList (TipTap Suggestion popup) and
 * SlashCommandPopover (button-triggered popover) to ensure a
 * consistent visual language across all slash command surfaces.
 */
import { memo, useRef, useEffect, useMemo, useState } from 'react'
import { Terminal, FileText, Zap } from 'lucide-react'
import type { SlashItem, SlashItemCategory } from '@shared/slashItems'
import type { CapabilityScope } from '@shared/types'

// ─── Shared Constants ────────────────────────────────────────────────────────

export const CATEGORY_ICONS: Record<SlashItemCategory, React.ElementType> = {
  builtin: Terminal,
  command: FileText,
  skill: Zap,
}

export const SCOPE_BADGE_CLASSES: Record<CapabilityScope, string> = {
  project: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  global: 'bg-gray-500/10 text-gray-600 dark:text-gray-400',
}

// ─── Sub-components ──────────────────────────────────────────────────────────

export function ScopeBadge({ scope }: { scope: CapabilityScope }): React.JSX.Element {
  return (
    <span
      className={`text-[9px] leading-none px-1 py-0.5 rounded-full shrink-0 ${SCOPE_BADGE_CLASSES[scope]}`}
      aria-label={`${scope} scope`}
    >
      {scope}
    </span>
  )
}

function AppAvatar({
  title,
  avatarUrl,
}: {
  title: string
  avatarUrl?: string
}): React.JSX.Element {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const firstChar = title.trim().charAt(0).toUpperCase() || 'A'
  const hue = useMemo(
    () => [...title].reduce((acc, char) => acc + char.charCodeAt(0), 0) % 360,
    [title],
  )
  const canRenderImage = Boolean(avatarUrl) && avatarUrl !== failedUrl

  if (canRenderImage) {
    return (
      <img
        src={avatarUrl}
        alt=""
        className="w-5 h-5 shrink-0 rounded-full object-cover"
        onError={() => setFailedUrl(avatarUrl)}
      />
    )
  }

  return (
    <span
      className="flex items-center justify-center w-5 h-5 shrink-0 rounded-full text-[9px] font-semibold leading-none select-none"
      style={{
        backgroundColor: `hsl(${hue} 50% 92%)`,
        color: `hsl(${hue} 45% 40%)`,
      }}
      aria-hidden="true"
    >
      {firstChar}
    </span>
  )
}

// ─── SlashItemRow ────────────────────────────────────────────────────────────

interface SlashItemRowProps {
  item: SlashItem
  isActive?: boolean
  onSelect: (item: SlashItem) => void
}

/**
 * A single slash item row with icon, name, argument hint, scope badge,
 * and description. Supports active highlighting and auto-scroll.
 */
export const SlashItemRow = memo(function SlashItemRow({
  item,
  isActive = false,
  onSelect,
}: SlashItemRowProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const Icon = CATEGORY_ICONS[item.category]
  const isAppVariant = item.presentation?.variant === 'app'

  useEffect(() => {
    if (isActive && ref.current && typeof ref.current.scrollIntoView === 'function') {
      ref.current.scrollIntoView({ block: 'nearest' })
    }
  }, [isActive])

  return (
    <div
      ref={ref}
      role="option"
      aria-selected={isActive}
      id={`slash-item-${item.id}`}
      className={`flex items-center gap-1.5 px-2.5 py-1 cursor-pointer transition-colors ${
        isActive
          ? 'bg-[hsl(var(--primary)/0.08)] text-[hsl(var(--accent-foreground))]'
          : 'text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)]'
      }`}
      onClick={() => onSelect(item)}
      onMouseDown={(e) => e.preventDefault()}
    >
      {isAppVariant ? (
        <>
          <AppAvatar
            title={item.presentation?.title ?? item.name}
            avatarUrl={item.presentation?.avatarUrl}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1 min-w-0">
              <span className="text-xs font-medium truncate min-w-0">
                {item.presentation?.title ?? item.name}
              </span>
              {item.argumentHint && (
                <span className="text-[10px] text-[hsl(var(--muted-foreground))] font-mono shrink-0">
                  {item.argumentHint}
                </span>
              )}
            </div>
            <div className="text-[11px] text-[hsl(var(--muted-foreground))] truncate">
              {item.presentation?.subtitle || item.description}
            </div>
          </div>
        </>
      ) : (
        <>
          <Icon className="w-3 h-3 shrink-0 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
          <span className="font-mono text-xs font-medium shrink-0">/{item.name}</span>
          {item.argumentHint && (
            <span className="text-[11px] text-[hsl(var(--muted-foreground))] font-mono shrink-0">
              {item.argumentHint}
            </span>
          )}
          <span className="text-[11px] text-[hsl(var(--muted-foreground))] truncate min-w-0 flex-1 text-right">
            {item.description}
          </span>
          {item.scope && <ScopeBadge scope={item.scope} />}
        </>
      )}
    </div>
  )
})
