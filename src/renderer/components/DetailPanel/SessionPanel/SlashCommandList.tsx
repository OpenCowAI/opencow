// SPDX-License-Identifier: Apache-2.0

import { forwardRef } from 'react'
import { Loader2 } from 'lucide-react'
import { surfaceProps } from '@/lib/surface'
import { SlashItemRow } from './SlashItemRow'
import type { SlashItem, SlashItemGroup } from '@shared/slashItems'

interface SlashCommandListProps {
  groups: SlashItemGroup[]
  activeIndex: number
  onSelect: (item: SlashItem) => void
  loading?: boolean
}

/**
 * SlashCommandList renders grouped slash items with active highlighting.
 * Used by the TipTap Suggestion renderer (tippy.js popup at cursor).
 */
export const SlashCommandList = forwardRef<HTMLDivElement, SlashCommandListProps>(
  function SlashCommandList({ groups, activeIndex, onSelect, loading }, ref) {
    let flatIndex = 0

    if (loading) {
      return (
        <div
          ref={ref}
          {...surfaceProps({ elevation: 'floating', color: 'popover' })}
          role="listbox"
          aria-label="Slash commands"
          className="border border-[hsl(var(--border))] rounded-lg bg-[hsl(var(--popover))] shadow-lg overflow-hidden"
        >
          <div className="flex items-center gap-1.5 px-2.5 py-2 text-xs text-[hsl(var(--muted-foreground))]">
            <Loader2 className="w-3 h-3 motion-safe:animate-spin" aria-hidden="true" />
            Loading commands...
          </div>
        </div>
      )
    }

    if (groups.length === 0) {
      return (
        <div
          ref={ref}
          {...surfaceProps({ elevation: 'floating', color: 'popover' })}
          role="listbox"
          aria-label="Slash commands"
          className="border border-[hsl(var(--border))] rounded-lg bg-[hsl(var(--popover))] shadow-lg overflow-hidden"
        >
          <div className="px-2.5 py-2 text-xs text-[hsl(var(--muted-foreground))]">
            No commands found
          </div>
        </div>
      )
    }

    return (
      <div
        ref={ref}
        {...surfaceProps({ elevation: 'floating', color: 'popover' })}
        role="listbox"
        aria-label="Slash commands"
        className="border border-[hsl(var(--border))] rounded-lg bg-[hsl(var(--popover))] shadow-lg overflow-hidden max-h-64 overflow-y-auto"
      >
        {groups.map((group) => (
          <div key={group.category}>
            <div className="px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] bg-[hsl(var(--muted)/0.5)] select-none">
              {group.label}
            </div>
            {group.items.map((item) => {
              const currentIndex = flatIndex++
              return (
                <SlashItemRow
                  key={item.id}
                  item={item}
                  isActive={currentIndex === activeIndex}
                  onSelect={onSelect}
                />
              )
            })}
          </div>
        ))}
      </div>
    )
  }
)
