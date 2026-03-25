// SPDX-License-Identifier: Apache-2.0

import { memo, useState, useCallback, useMemo, useRef } from 'react'
import { StickyNote } from 'lucide-react'
import { NotePopover } from './NotePopover'
import { useSessionNotesContext } from './SessionNotesContext'
import { cn } from '@/lib/utils'
import type { NoteContent } from '@shared/types'

// ─── Props ──────────────────────────────────────────────────────────────────

interface NotePopoverTriggerProps {
  /** Absolute file path associated with the viewer dialog */
  sourceFilePath: string
}

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * Floating action button (FAB) rendered at the bottom-right of file viewer
 * Dialogs. Clicking it toggles a NotePopover overlay.
 *
 * Consumes `SessionNotesContext` — renders nothing when outside a session.
 */
export const NotePopoverTrigger = memo(function NotePopoverTrigger({
  sourceFilePath,
}: NotePopoverTriggerProps): React.JSX.Element | null {
  const ctx = useSessionNotesContext()
  const [isOpen, setIsOpen] = useState(false)
  /** Cached draft text that survives popover close/reopen */
  const draftRef = useRef('')

  const toggle = useCallback(() => setIsOpen((prev) => !prev), [])
  const close = useCallback(() => setIsOpen(false), [])
  const handleDraftChange = useCallback((text: string) => {
    draftRef.current = text
  }, [])

  const handleAdd = useCallback(
    async (content: NoteContent, filePath?: string) => {
      await ctx?.addNote(content, filePath)
      draftRef.current = ''
    },
    [ctx],
  )

  // Not inside a session context — don't render
  if (!ctx) return null

  const { notes, updateNote, deleteNote, sendAndDeleteNote } = ctx

  // Count notes from this specific file (memoized via useMemo would require
  // moving above the early return; keep inline since memo() guards re-renders)
  const fileNoteCount = notes.filter((n) => n.sourceFilePath === sourceFilePath).length

  return (
    <div className="absolute bottom-4 right-4 z-10">
      {/* Popover (above button) */}
      {isOpen && (
        <div className="absolute bottom-full right-0 mb-2">
          <NotePopover
            notes={notes}
            sourceFilePath={sourceFilePath}
            onAdd={handleAdd}
            onUpdate={updateNote}
            onDelete={deleteNote}
            onSendAndDeleteNote={sendAndDeleteNote}
            onClose={close}
            initialDraft={draftRef.current}
            onDraftChange={handleDraftChange}
          />
        </div>
      )}

      {/* FAB trigger */}
      <button
        onClick={toggle}
        className={cn(
          'relative flex items-center gap-1.5 px-3 h-8',
          'rounded-full shadow-lg transition-all duration-200',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2',
          isOpen
            ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] scale-95'
            : 'bg-[hsl(var(--card))] text-[hsl(var(--muted-foreground))] border border-[hsl(var(--border))] hover:border-[hsl(var(--primary)/0.5)] hover:text-[hsl(var(--foreground))]',
        )}
        aria-label={isOpen ? 'Close notes panel' : 'Open notes panel'}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
      >
        <StickyNote className="w-3.5 h-3.5" aria-hidden="true" />
        <span className="text-xs font-medium">Notes</span>
        {/* Badge */}
        {fileNoteCount > 0 && !isOpen && (
          <span
            className="absolute -top-1 -right-1 flex items-center justify-center min-w-[1rem] h-4 rounded-full bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] text-[9px] font-bold px-1"
            aria-label={`${fileNoteCount} notes`}
          >
            {fileNoteCount}
          </span>
        )}
      </button>
    </div>
  )
})
