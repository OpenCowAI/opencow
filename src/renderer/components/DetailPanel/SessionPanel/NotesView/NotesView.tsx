// SPDX-License-Identifier: Apache-2.0

import { memo, useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StickyNote, Send, X } from 'lucide-react'
import { NoteItem } from './NoteItem'
import { NoteInput } from './NoteInput'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/toast'
import { useNoteContentResolver } from '@/hooks/useNoteContentResolver'
import type { UserMessageBlock } from '@shared/contentBuilder'
import type { SessionNote, NoteContent, UserMessageContent } from '@shared/types'

// ─── Props ──────────────────────────────────────────────────────────────────

interface NotesViewProps {
  notes: SessionNote[]
  onAdd: (content: NoteContent, sourceFilePath?: string) => Promise<void>
  onUpdate: (id: string, content: NoteContent) => Promise<void>
  onDelete: (id: string) => Promise<void>
  /**
   * Resolve a note's slash commands, send to chat, and delete the note.
   * Consolidated workflow — single source of truth lives in SessionPanel.
   */
  onSendAndDeleteNote: (id: string) => Promise<void>
  /** Send structured content directly to chat (used by batch send). */
  onSendToChat: (content: UserMessageContent) => void
  /** Switch SessionPanel tab to Console (for toast action) */
  onSwitchToConsole?: () => void
}

// ─── Component ──────────────────────────────────────────────────────────────

export const NotesView = memo(function NotesView({
  notes,
  onAdd,
  onUpdate,
  onDelete,
  onSendAndDeleteNote,
  onSendToChat,
  onSwitchToConsole,
}: NotesViewProps): React.JSX.Element {
  const { t } = useTranslation('sessions')
  const listRef = useRef<HTMLDivElement>(null)
  const resolveNoteContent = useNoteContentResolver()

  // ── Batch selection state ──
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isBatchMode, setIsBatchMode] = useState(false)

  // ── Handlers ──

  const handleAdd = useCallback(
    (content: NoteContent) => {
      onAdd(content)
      requestAnimationFrame(() => {
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
      })
    },
    [onAdd],
  )

  const showSentToast = useCallback(
    (count: number) => {
      const message = count > 1 ? t('notes.notesSentToChat', { count }) : t('notes.sentToChat')
      toast(message, onSwitchToConsole
        ? { action: { label: t('notes.switchToChat'), onClick: onSwitchToConsole } }
        : undefined,
      )
    },
    [onSwitchToConsole],
  )

  const handleSendSingle = useCallback(
    async (id: string) => {
      await onSendAndDeleteNote(id)
      showSentToast(1)
    },
    [onSendAndDeleteNote, showSentToast],
  )

  /**
   * Batch send: resolve each note individually, build a combined
   * `UserMessageBlock[]` that preserves slash_command structure,
   * then send as a single message.
   */
  const handleSendBatch = useCallback(async () => {
    if (selectedIds.size === 0) return
    const selected = notes
      .filter((n) => selectedIds.has(n.id))
      .sort((a, b) => a.createdAt - b.createdAt)

    // Resolve each note and combine into a single block array
    const combinedBlocks: UserMessageBlock[] = []
    for (let i = 0; i < selected.length; i++) {
      const resolved = await resolveNoteContent(selected[i])
      // Insert separator between notes
      if (i > 0) {
        combinedBlocks.push({ type: 'text', text: '\n\n' })
      }
      if (typeof resolved === 'string') {
        combinedBlocks.push({ type: 'text', text: resolved })
      } else {
        // Structured blocks — preserve slash_command identity
        for (const block of resolved) {
          combinedBlocks.push(block as UserMessageBlock)
        }
      }
    }

    // Send: if all blocks are text, join to a plain string for simplicity;
    // otherwise send structured blocks to preserve slash_command metadata
    const hasStructuredBlocks = combinedBlocks.some((b) => b.type !== 'text')
    if (hasStructuredBlocks) {
      onSendToChat(combinedBlocks)
    } else {
      onSendToChat(combinedBlocks.map((b) => (b as { type: 'text'; text: string }).text).join(''))
    }

    const count = selected.length
    // Delete sent notes
    for (const n of selected) {
      onDelete(n.id)
    }
    setIsBatchMode(false)
    setSelectedIds(new Set())
    showSentToast(count)
  }, [notes, selectedIds, resolveNoteContent, onSendToChat, onDelete, showSentToast])

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(notes.map((n) => n.id)))
  }, [notes])

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const enterBatchMode = useCallback(() => setIsBatchMode(true), [])

  const exitBatchMode = useCallback(() => {
    setIsBatchMode(false)
    setSelectedIds(new Set())
  }, [])

  // ── Empty state ──
  if (notes.length === 0) {
    return (
      <div className="h-full flex flex-col">
        {/* ── Top input ── */}
        <div className="shrink-0 border-b border-[hsl(var(--border))] px-3 py-2">
          <NoteInput onAdd={handleAdd} />
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-[hsl(var(--muted-foreground))] px-4">
          <StickyNote className="w-8 h-8 opacity-30" aria-hidden="true" />
          <p className="text-sm font-medium">No notes yet</p>
          <p className="text-xs text-center leading-relaxed opacity-70">
            Jot down questions or context while reviewing the session.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* ── Top input ── */}
      <div className="shrink-0 border-b border-[hsl(var(--border))] px-3 py-2">
        <NoteInput onAdd={handleAdd} />
      </div>

      {/* ── Batch toolbar ── */}
      {isBatchMode && (
        <div
          className="flex items-center gap-2 px-3 py-1.5 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.5)] shrink-0"
          role="toolbar"
          aria-label="Batch note actions"
        >
          <button
            onClick={selectAll}
            className="text-xs text-[hsl(var(--primary))] hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))] rounded-sm px-1"
          >
            Select all
          </button>
          <button
            onClick={clearSelection}
            className="text-xs text-[hsl(var(--muted-foreground))] hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))] rounded-sm px-1"
          >
            Deselect
          </button>
          <span className="text-xs text-[hsl(var(--muted-foreground))]">
            {selectedIds.size} selected
          </span>
          <div className="flex-1" />
          <button
            onClick={handleSendBatch}
            disabled={selectedIds.size === 0}
            className={cn(
              'inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
              selectedIds.size > 0
                ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90'
                : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] cursor-not-allowed',
            )}
            aria-label={`Send ${selectedIds.size} notes to chat`}
          >
            <Send className="w-3 h-3" aria-hidden="true" />
            Send ({selectedIds.size})
          </button>
          <button
            onClick={exitBatchMode}
            className="p-1 rounded text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]"
            aria-label="Exit batch mode"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* ── Note list ── */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5"
        role="list"
        aria-label="Session notes"
      >
        {notes.map((note) => (
          <NoteItem
            key={note.id}
            note={note}
            isSelected={selectedIds.has(note.id)}
            isBatchMode={isBatchMode}
            onUpdate={onUpdate}
            onDelete={onDelete}
            onSendToChat={handleSendSingle}
            onToggleSelect={toggleSelect}
            onEnterBatchMode={enterBatchMode}
          />
        ))}
      </div>
    </div>
  )
})
