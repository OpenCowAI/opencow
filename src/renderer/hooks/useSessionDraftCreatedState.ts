// SPDX-License-Identifier: Apache-2.0

/**
 * useSessionDraftCreatedState — Persist created-state for session draft cards.
 *
 * Purpose:
 * - Prevent duplicate create submissions after refresh/re-entry for the same
 *   session draft (`sessionId + draftType + draftKey` identity).
 *
 * Persistence:
 * - localStorage only (no DB schema changes), aligned with project constraints.
 * - Per-session store key with bounded entry count + TTL pruning.
 *
 * @module
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SessionDraftType } from '@shared/sessionDraftOutputParser'

const STORAGE_PREFIX = 'opencow:session-draft-created:v1'
const MAX_ENTRY_AGE_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
const MAX_ENTRIES_PER_SESSION = 200

interface CreatedEntry {
  draftType: Exclude<SessionDraftType, null>
  draftKey: string
  entityId: string
  updatedAt: number
}

interface CreatedStore {
  entries: CreatedEntry[]
}

interface UseSessionDraftCreatedStateParams {
  sessionId: string | null
  draftType: SessionDraftType
  draftKey: string | null
}

export interface SessionDraftCreatedState {
  createdIssueId: string | null
  createdScheduleId: string | null
  markIssueCreated: (issueId: string) => void
  markScheduleCreated: (scheduleId: string) => void
}

function storageKey(sessionId: string): string {
  return `${STORAGE_PREFIX}:${sessionId}`
}

function readStore(sessionId: string): CreatedStore {
  try {
    const raw = localStorage.getItem(storageKey(sessionId))
    if (!raw) return { entries: [] }
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return { entries: [] }

    // v2 schema
    const directEntries = (parsed as { entries?: unknown }).entries
    if (Array.isArray(directEntries)) {
      return { entries: directEntries.filter(isCreatedEntry) }
    }

    // v1 fallback schema: Record<string, CreatedEntry>
    const legacyEntries = Object.values(parsed as Record<string, unknown>)
    return { entries: legacyEntries.filter(isCreatedEntry) }
  } catch {
    localStorage.removeItem(storageKey(sessionId))
    return { entries: [] }
  }
}

function writeStore(sessionId: string, store: CreatedStore): void {
  try {
    localStorage.setItem(storageKey(sessionId), JSON.stringify(store))
  } catch {
    // Ignore storage quota / transient failures — non-critical UX cache.
  }
}

function pruneStore(store: CreatedStore): CreatedStore {
  const now = Date.now()
  const freshEntries = store.entries
    .filter((entry) => now - entry.updatedAt <= MAX_ENTRY_AGE_MS)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_ENTRIES_PER_SESSION)

  return { entries: freshEntries }
}

function isCreatedEntry(value: unknown): value is CreatedEntry {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<CreatedEntry>
  return (
    (candidate.draftType === 'issue' || candidate.draftType === 'schedule') &&
    typeof candidate.draftKey === 'string' &&
    candidate.draftKey.length > 0 &&
    typeof candidate.entityId === 'string' &&
    candidate.entityId.length > 0 &&
    typeof candidate.updatedAt === 'number' &&
    Number.isFinite(candidate.updatedAt)
  )
}

function storesEqual(a: CreatedStore, b: CreatedStore): boolean {
  if (a.entries.length !== b.entries.length) return false
  for (let i = 0; i < a.entries.length; i++) {
    const left = a.entries[i]
    const right = b.entries[i]
    if (
      left.draftType !== right.draftType ||
      left.draftKey !== right.draftKey ||
      left.entityId !== right.entityId ||
      left.updatedAt !== right.updatedAt
    ) {
      return false
    }
  }
  return true
}

function resolveEntry(params: UseSessionDraftCreatedStateParams): {
  entry: CreatedEntry | null
  storeChanged: boolean
} {
  const { sessionId, draftType, draftKey } = params
  if (!sessionId || !draftType || !draftKey) return { entry: null, storeChanged: false }

  const raw = readStore(sessionId)
  const pruned = pruneStore(raw)
  const entry = pruned.entries.find((candidate) =>
    candidate.draftType === draftType && candidate.draftKey === draftKey
  ) ?? null
  return { entry, storeChanged: !storesEqual(raw, pruned) }
}

export function useSessionDraftCreatedState({
  sessionId,
  draftType,
  draftKey,
}: UseSessionDraftCreatedStateParams): SessionDraftCreatedState {
  const [revision, setRevision] = useState(0)
  const { entry, storeChanged } = useMemo(
    () => resolveEntry({ sessionId, draftType, draftKey }),
    [sessionId, draftType, draftKey, revision]
  )

  // Keep storage bounded even on read-only re-entry paths.
  useEffect(() => {
    if (!storeChanged || !sessionId) return
    const prunedStore = pruneStore(readStore(sessionId))
    writeStore(sessionId, prunedStore)
  }, [storeChanged, sessionId])

  const writeCurrentEntry = useCallback((next: CreatedEntry) => {
    if (!sessionId || !draftType || !draftKey) return

    const currentStore = readStore(sessionId)
    const nextEntries = currentStore.entries.filter((entry) =>
      !(entry.draftType === draftType && entry.draftKey === draftKey)
    )
    nextEntries.unshift(next)

    const nextStore = pruneStore({ entries: nextEntries })
    writeStore(sessionId, nextStore)
    setRevision((v) => v + 1)
  }, [sessionId, draftType, draftKey])

  const markIssueCreated = useCallback((issueId: string) => {
    if (!issueId.trim() || !draftKey) return
    writeCurrentEntry({
      draftType: 'issue',
      draftKey,
      entityId: issueId,
      updatedAt: Date.now(),
    })
  }, [writeCurrentEntry, draftKey])

  const markScheduleCreated = useCallback((scheduleId: string) => {
    if (!scheduleId.trim() || !draftKey) return
    writeCurrentEntry({
      draftType: 'schedule',
      draftKey,
      entityId: scheduleId,
      updatedAt: Date.now(),
    })
  }, [writeCurrentEntry, draftKey])

  const createdIssueId = useMemo<string | null>(() => {
    if (entry?.draftType !== 'issue') return null
    return entry.entityId
  }, [entry])

  const createdScheduleId = useMemo<string | null>(() => {
    if (entry?.draftType !== 'schedule') return null
    return entry.entityId
  }, [entry])

  return {
    createdIssueId,
    createdScheduleId,
    markIssueCreated,
    markScheduleCreated,
  }
}
