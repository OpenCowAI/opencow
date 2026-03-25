// SPDX-License-Identifier: Apache-2.0

import { createContext, useContext } from 'react'
import type { SessionNote, NoteContent, UserMessageContent } from '@shared/types'

// ─── Context value ──────────────────────────────────────────────────────

export interface SessionNotesContextValue {
  /** Current issue ID (scope for notes) */
  issueId: string
  /** Notes for the current issue */
  notes: SessionNote[]
  /** Create a new note (optionally with a source file path) */
  addNote: (content: NoteContent, sourceFilePath?: string) => Promise<void>
  /** Update an existing note's content */
  updateNote: (id: string, content: NoteContent) => Promise<void>
  /** Delete a note */
  deleteNote: (id: string) => Promise<void>
  /**
   * Resolve a note's slash commands, send the resulting content to chat,
   * and delete the note — the complete "send note to chat" workflow.
   *
   * Consolidates the find → resolve → send → delete sequence that was
   * previously duplicated in both NotesView and NotePopover.
   */
  sendAndDeleteNote: (id: string) => Promise<void>
  /**
   * Send structured content to the chat input directly (for batch sends
   * where resolution is handled by the caller).
   */
  sendToChat: (content: UserMessageContent) => void
}

// ─── Context ────────────────────────────────────────────────────────────

const SessionNotesCtx = createContext<SessionNotesContextValue | null>(null)

export const SessionNotesProvider = SessionNotesCtx.Provider

/**
 * Consume the SessionNotes context.
 * Returns `null` when outside a SessionPanel (e.g. non-session detail views).
 * Callers should guard with `if (!ctx) return null` before rendering note UI.
 */
export function useSessionNotesContext(): SessionNotesContextValue | null {
  return useContext(SessionNotesCtx)
}
