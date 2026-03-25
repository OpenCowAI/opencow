// SPDX-License-Identifier: Apache-2.0

import { memo, useCallback, useMemo, useRef, useEffect } from 'react'
import { StickyNote, X } from 'lucide-react'
import { NoteItem } from './NoteItem'
import { NoteInput } from './NoteInput'
import { cn } from '@/lib/utils'
import { surfaceProps } from '@/lib/surface'
import { toast } from '@/lib/toast'
import { useExitAnimation } from '@/hooks/useModalAnimation'
import type { SessionNote, NoteContent } from '@shared/types'

// ─── Props ──────────────────────────────────────────────────────────────────

interface NotePopoverProps {
  notes: SessionNote[]
  /** File path context for notes created from this popover */
  sourceFilePath: string
  onAdd: (content: NoteContent, sourceFilePath?: string) => Promise<void>
  onUpdate: (id: string, content: NoteContent) => Promise<void>
  onDelete: (id: string) => Promise<void>
  /** Resolve, send to chat, and delete a note in one step */
  onSendAndDeleteNote: (id: string) => Promise<void>
  onClose: () => void
  /** Cached draft text for the input */
  initialDraft?: string
  /** Called when draft text changes so trigger can cache it */
  onDraftChange?: (text: string) => void
}

// ─── Component ──────────────────────────────────────────────────────────────

export const NotePopover = memo(function NotePopover({
  notes,
  sourceFilePath,
  onAdd,
  onUpdate,
  onDelete,
  onSendAndDeleteNote,
  onClose,
  initialDraft = '',
  onDraftChange,
}: NotePopoverProps): React.JSX.Element {
  const popoverRef = useRef<HTMLDivElement>(null)
  const { phase, requestClose } = useExitAnimation(onClose)

  // Escape closes popover (stopPropagation prevents closing outer Dialog)
  useEffect(() => {
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        requestClose()
      }
    }
    document.addEventListener('keydown', handleKey, true)
    return () => document.removeEventListener('keydown', handleKey, true)
  }, [requestClose])

  // Click outside closes popover
  useEffect(() => {
    const handleClick = (e: MouseEvent): void => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        requestClose()
      }
    }
    const timer = setTimeout(() => document.addEventListener('mousedown', handleClick), 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleClick)
    }
  }, [requestClose])

  const handleAdd = useCallback(
    (content: NoteContent) => {
      onAdd(content, sourceFilePath)
    },
    [onAdd, sourceFilePath],
  )

  const handleSendSingle = useCallback(
    async (id: string) => {
      await onSendAndDeleteNote(id)
      toast('Sent to Chat')
    },
    [onSendAndDeleteNote],
  )

  // Prioritise notes from this file, then others (memoized)
  const displayNotes = useMemo(() => {
    const fileNotes = notes.filter((n) => n.sourceFilePath === sourceFilePath)
    const otherNotes = notes.filter((n) => n.sourceFilePath !== sourceFilePath)
    return [...fileNotes, ...otherNotes]
  }, [notes, sourceFilePath])

  return (
    <div
      ref={popoverRef}
      {...surfaceProps({ elevation: 'floating', color: 'popover' })}
      className={cn(
        'w-80 max-h-96 flex flex-col',
        'rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--popover))] shadow-lg',
        phase === 'exit' ? 'modal-content-exit' : 'modal-content-enter',
      )}
      role="dialog"
      aria-label="Session notes"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[hsl(var(--border)/0.5)]">
        <div className="flex items-center gap-1.5">
          <StickyNote className="w-3.5 h-3.5 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
          <span className="text-xs font-medium text-[hsl(var(--foreground))]">Notes</span>
          {notes.length > 0 && (
            <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
              ({notes.length})
            </span>
          )}
        </div>
        <button
          onClick={requestClose}
          className="p-0.5 rounded text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]"
          aria-label="Close notes"
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-1.5 py-1 space-y-0.5" role="list" aria-label="Notes list">
        {displayNotes.length === 0 && (
          <p className="text-[11px] text-[hsl(var(--muted-foreground)/0.6)] text-center py-3 italic">
            No notes yet.
          </p>
        )}
        {displayNotes.map((note) => (
          <NoteItem
            key={note.id}
            note={note}
            isSelected={false}
            isBatchMode={false}
            onUpdate={onUpdate}
            onDelete={onDelete}
            onSendToChat={handleSendSingle}
            onToggleSelect={() => {/* no-op in popover */}}
            onEnterBatchMode={() => {/* no-op in popover */}}
            compact
          />
        ))}
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-[hsl(var(--border)/0.5)] p-2">
        <NoteInput onAdd={handleAdd} compact placeholder={'Add note for this file\u2026'} initialValue={initialDraft} onDraftChange={onDraftChange} />
      </div>
    </div>
  )
})
