// SPDX-License-Identifier: Apache-2.0

/**
 * ContextFileChips — reusable chip/badge display for context file references.
 *
 * Renders an inline list of file/directory chips extracted from user messages.
 * Used by SessionMessageList (full message view) and QueuedMessageList
 * (queue preview) to consistently display @-mentioned files.
 */

import { File, Folder } from 'lucide-react'
import type { ParsedContextFile } from '@/lib/contextFilesParsing'

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface ContextFileChipsProps {
  files: ParsedContextFile[]
  /**
   * Visual density of the chips.
   * - 'normal': standard size for message display (11px text)
   * - 'compact': smaller size for constrained layouts like queue items (10px text)
   */
  variant?: 'normal' | 'compact'
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function ContextFileChips({ files, variant = 'normal' }: ContextFileChipsProps): React.JSX.Element {
  const isCompact = variant === 'compact'

  return (
    <span className="inline-flex flex-wrap gap-1 py-0.5 align-middle">
      {files.map((f) => (
        <span
          key={f.path}
          className={
            isCompact
              ? 'inline-flex items-center gap-0.5 px-1 py-px rounded text-[10px] bg-[hsl(var(--primary)/0.08)] text-[hsl(var(--foreground)/0.75)]'
              : 'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] bg-[hsl(var(--primary)/0.08)] text-[hsl(var(--foreground)/0.75)]'
          }
        >
          {f.isDirectory ? (
            <Folder
              className={`${isCompact ? 'w-2.5 h-2.5' : 'w-3 h-3'} shrink-0 text-[hsl(var(--muted-foreground))]`}
              aria-hidden="true"
            />
          ) : (
            <File
              className={`${isCompact ? 'w-2.5 h-2.5' : 'w-3 h-3'} shrink-0 text-[hsl(var(--muted-foreground))]`}
              aria-hidden="true"
            />
          )}
          <span className={`${isCompact ? 'max-w-[150px]' : 'max-w-[200px]'} truncate`}>
            {f.path.split('/').pop()}
          </span>
        </span>
      ))}
    </span>
  )
}
