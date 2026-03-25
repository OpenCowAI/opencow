// SPDX-License-Identifier: Apache-2.0

/**
 * noteStore — Session notes state.
 *
 * Manages notes keyed by issue ID, including CRUD operations
 * and per-issue note counts for list badge display.
 * Completely independent of all other stores.
 */

import { create } from 'zustand'
import type { SessionNote, NoteContent, CreateNoteInput } from '@shared/types'
import { getAppAPI } from '@/windowAPI'

// ─── Store Interface ──────────────────────────────────────────────────

export interface NoteStore {
  /** Notes keyed by issueId */
  notesByIssue: Record<string, SessionNote[]>
  /** Note counts keyed by issueId (for list badge display) */
  noteCountsByIssue: Record<string, number>
  loadNotes: (issueId: string) => Promise<void>
  loadNoteCountsByIssue: () => Promise<void>
  createNote: (input: CreateNoteInput) => Promise<SessionNote>
  updateNote: (id: string, issueId: string, content: NoteContent) => Promise<void>
  deleteNote: (id: string, issueId: string) => Promise<void>
  reset: () => void
}

// ─── Initial State ────────────────────────────────────────────────────

const initialState = {
  notesByIssue: {} as Record<string, SessionNote[]>,
  noteCountsByIssue: {} as Record<string, number>,
}

// ─── Store Instance ───────────────────────────────────────────────────

export const useNoteStore = create<NoteStore>((set) => ({
  ...initialState,

  loadNotes: async (issueId) => {
    const notes = await getAppAPI()['list-session-notes'](issueId)
    set((s) => ({
      notesByIssue: { ...s.notesByIssue, [issueId]: notes },
    }))
  },

  loadNoteCountsByIssue: async () => {
    const counts = await getAppAPI()['count-session-notes-by-issue']()
    set({ noteCountsByIssue: counts })
  },

  createNote: async (input) => {
    const note = await getAppAPI()['create-session-note'](input)
    set((s) => ({
      notesByIssue: {
        ...s.notesByIssue,
        [input.issueId]: [...(s.notesByIssue[input.issueId] ?? []), note],
      },
      noteCountsByIssue: {
        ...s.noteCountsByIssue,
        [input.issueId]: (s.noteCountsByIssue[input.issueId] ?? 0) + 1,
      },
    }))
    return note
  },

  updateNote: async (id, issueId, content) => {
    await getAppAPI()['update-session-note'](id, content)
    set((s) => ({
      notesByIssue: {
        ...s.notesByIssue,
        [issueId]: (s.notesByIssue[issueId] ?? []).map((n) =>
          n.id === id ? { ...n, content, updatedAt: Date.now() } : n,
        ),
      },
    }))
  },

  deleteNote: async (id, issueId) => {
    await getAppAPI()['delete-session-note'](id)
    set((s) => ({
      notesByIssue: {
        ...s.notesByIssue,
        [issueId]: (s.notesByIssue[issueId] ?? []).filter((n) => n.id !== id),
      },
      noteCountsByIssue: {
        ...s.noteCountsByIssue,
        [issueId]: Math.max(0, (s.noteCountsByIssue[issueId] ?? 0) - 1),
      },
    }))
  },

  reset: () => set(initialState),
}))
