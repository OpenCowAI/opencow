// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { ThinkingBlock } from '@shared/types'

interface ThinkingBlockViewProps {
  block: ThinkingBlock
}

export function ThinkingBlockView({ block }: ThinkingBlockViewProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)

  return (
    <div>
      <button
        onClick={() => setExpanded((prev) => !prev)}
        className="flex items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))] rounded-sm py-0.5"
        aria-expanded={expanded}
        aria-label={expanded ? 'Collapse thinking' : 'Expand thinking'}
      >
        <ChevronRight
          className={`w-3.5 h-3.5 shrink-0 transition-transform motion-reduce:transition-none ${expanded ? 'rotate-90' : ''}`}
          aria-hidden="true"
        />
        <span className="italic">{'Thinking\u2026'}</span>
      </button>
      {expanded && (
        <p className="mt-0.5 pl-4 text-xs text-[hsl(var(--muted-foreground))] italic whitespace-pre-wrap break-words leading-normal">
          {block.thinking}
        </p>
      )}
    </div>
  )
}
