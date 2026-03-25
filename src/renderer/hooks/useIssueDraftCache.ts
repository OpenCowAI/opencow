// SPDX-License-Identifier: Apache-2.0

import { useState, useCallback, useRef, useEffect } from 'react'
import { createLogger } from '@/lib/logger'
import type { IssueStatus, IssuePriority } from '@shared/types'
import type { ImageAttachment } from '../lib/attachmentUtils'

const log = createLogger('IssueDraftCache')

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/**
 * Consumer-facing form state — contains only the fields the form cares about.
 * Storage metadata (e.g. savedAt) is kept internal to the hook.
 */
export interface IssueDraftFormState {
  title: string
  description: string
  /** TipTap document JSON — preserves slash mention nodes across modal close/reopen. */
  richContent: string | null
  status: IssueStatus
  priority: IssuePriority
  labels: string[]
  projectId: string | null
  autoStartSession: boolean
  images: ImageAttachment[]
}

/** Internal storage record persisted to localStorage (excludes images). */
interface IssueDraftRecord {
  title: string
  description: string
  /** TipTap document JSON. Typically ~1-2KB, well within localStorage quota. */
  richContent: string | null
  status: IssueStatus
  priority: IssuePriority
  labels: string[]
  projectId: string | null
  autoStartSession: boolean
  savedAt: number
}

export interface UseIssueDraftCacheOptions {
  /** When true (edit mode), draft caching is completely disabled. */
  disabled?: boolean
  /** Parent issue ID — scopes the cache key for sub-issue drafts. */
  parentIssueId?: string | null
  /** Known project IDs for validating cached projectId on restore. */
  validProjectIds?: string[]
}

export interface UseIssueDraftCacheReturn {
  /**
   * Draft state restored on first mount.
   * If no draft was found, returns DEFAULT_FORM_STATE.
   * Stable reference — does not change across renders.
   */
  initialState: IssueDraftFormState
  /** Whether a non-empty draft was successfully restored on mount. */
  wasRestored: boolean
  /** Persist current form state as a draft (debounced, 300ms). */
  saveDraft: (state: IssueDraftFormState) => void
  /** Immediately clear the draft from all storage layers. */
  clearDraft: () => void
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const DRAFT_KEY_PREFIX = 'opencow:issue-draft'
const DEBOUNCE_MS = 300
/** Drafts older than 7 days are considered stale and auto-discarded. */
const MAX_DRAFT_AGE_MS = 7 * 24 * 60 * 60 * 1000

export const DEFAULT_FORM_STATE: IssueDraftFormState = {
  title: '',
  description: '',
  richContent: null,
  status: 'backlog',
  priority: 'medium',
  labels: [],
  projectId: null,
  autoStartSession: false,
  images: [],
}

/* ------------------------------------------------------------------ */
/*  Module-level image cache                                           */
/*                                                                     */
/*  Images are stored in-memory only (not localStorage) because base64 */
/*  image data can easily exceed the ~5-10 MB localStorage quota.      */
/*  This survives component remounts within the same app session,      */
/*  matching the primary use case (accidental modal close).            */
/*  Images are NOT persisted across app restarts — this is by design.  */
/* ------------------------------------------------------------------ */

const imageDraftCache = new Map<string, ImageAttachment[]>()

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getCacheKey(parentIssueId?: string | null): string {
  return parentIssueId
    ? `${DRAFT_KEY_PREFIX}:sub:${parentIssueId}`
    : DRAFT_KEY_PREFIX
}

/**
 * A draft is considered "empty" (i.e. identical to defaults) when no field
 * has been meaningfully changed. Saving an empty draft is pointless and
 * would cause a misleading "Draft restored" banner on next open.
 */
function isDraftEmpty(state: IssueDraftFormState): boolean {
  return (
    !state.title.trim() &&
    !state.description.trim() &&
    state.status === 'backlog' &&
    state.priority === 'medium' &&
    state.labels.length === 0 &&
    state.projectId === null &&
    !state.autoStartSession &&
    state.images.length === 0
  )
}

function readRecord(cacheKey: string): IssueDraftRecord | null {
  try {
    const raw = localStorage.getItem(cacheKey)
    if (!raw) return null
    return JSON.parse(raw) as IssueDraftRecord
  } catch {
    // Corrupt data — remove silently
    localStorage.removeItem(cacheKey)
    return null
  }
}

function writeRecord(cacheKey: string, record: IssueDraftRecord): void {
  try {
    localStorage.setItem(cacheKey, JSON.stringify(record))
  } catch (err) {
    log.warn('Failed to write draft to localStorage', err)
  }
}

function removeAll(cacheKey: string): void {
  localStorage.removeItem(cacheKey)
  imageDraftCache.delete(cacheKey)
}

/**
 * Restore a draft from storage. Returns null if:
 * - No draft exists
 * - Draft is stale (older than MAX_DRAFT_AGE_MS)
 * - Draft is effectively empty
 * - Draft references a deleted project
 */
function restoreFromStorage(
  cacheKey: string,
  validProjectIds?: string[]
): IssueDraftFormState | null {
  const record = readRecord(cacheKey)
  if (!record) return null

  // Staleness check
  if (Date.now() - record.savedAt > MAX_DRAFT_AGE_MS) {
    log.info('Discarding stale draft', { cacheKey, age: Date.now() - record.savedAt })
    removeAll(cacheKey)
    return null
  }

  // Validate projectId still exists
  let projectId = record.projectId
  if (projectId && validProjectIds && !validProjectIds.includes(projectId)) {
    log.info('Draft references deleted project, resetting projectId', { projectId })
    projectId = null
  }

  const images = imageDraftCache.get(cacheKey) ?? []

  const state: IssueDraftFormState = {
    title: record.title,
    description: record.description,
    richContent: record.richContent ?? null,
    status: record.status,
    priority: record.priority,
    labels: record.labels,
    projectId,
    autoStartSession: record.autoStartSession,
    images,
  }

  // Don't restore effectively empty drafts
  if (isDraftEmpty(state)) {
    removeAll(cacheKey)
    return null
  }

  return state
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useIssueDraftCache(
  options: UseIssueDraftCacheOptions = {}
): UseIssueDraftCacheReturn {
  const { disabled = false, parentIssueId, validProjectIds } = options
  const cacheKey = getCacheKey(parentIssueId)

  // --- Guard: once clearDraft() is called, block all subsequent saves ---
  const clearedRef = useRef(false)

  // --- Lazy one-time restore on first render ---
  const initRef = useRef<{ state: IssueDraftFormState; wasRestored: boolean } | null>(null)
  if (initRef.current === null) {
    if (disabled) {
      initRef.current = { state: DEFAULT_FORM_STATE, wasRestored: false }
    } else {
      const restored = restoreFromStorage(cacheKey, validProjectIds)
      initRef.current = restored
        ? { state: restored, wasRestored: true }
        : { state: DEFAULT_FORM_STATE, wasRestored: false }
    }
  }

  const [wasRestored, setWasRestored] = useState(initRef.current.wasRestored)

  // --- Debounced save ---
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingWriteRef = useRef<IssueDraftRecord | null>(null)

  const saveDraft = useCallback(
    (state: IssueDraftFormState): void => {
      if (disabled || clearedRef.current) return

      // Dirty check — don't save empty drafts
      if (isDraftEmpty(state)) {
        // If previously had a draft, clean it up
        if (debounceRef.current) clearTimeout(debounceRef.current)
        pendingWriteRef.current = null
        removeAll(cacheKey)
        return
      }

      // Images: write immediately to in-memory cache (no debounce needed)
      imageDraftCache.set(cacheKey, state.images)

      // Text fields: debounced localStorage write
      const record: IssueDraftRecord = {
        title: state.title,
        description: state.description,
        richContent: state.richContent,
        status: state.status,
        priority: state.priority,
        labels: state.labels,
        projectId: state.projectId,
        autoStartSession: state.autoStartSession,
        savedAt: Date.now(),
      }
      pendingWriteRef.current = record

      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        writeRecord(cacheKey, record)
        pendingWriteRef.current = null
      }, DEBOUNCE_MS)
    },
    [cacheKey, disabled]
  )

  const clearDraft = useCallback((): void => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    pendingWriteRef.current = null
    removeAll(cacheKey)
    clearedRef.current = true // block any subsequent saves (e.g. auto-save re-firing)
    setWasRestored(false)
  }, [cacheKey])

  // --- Flush pending debounced write on unmount ---
  // This ensures the draft is persisted even if the component unmounts
  // within the debounce window (e.g. user closes the modal quickly).
  // Skip the flush if clearDraft() was called (e.g. after successful submit).
  useEffect(() => {
    return () => {
      if (pendingWriteRef.current && !clearedRef.current) {
        if (debounceRef.current) clearTimeout(debounceRef.current)
        writeRecord(cacheKey, pendingWriteRef.current)
        pendingWriteRef.current = null
      }
    }
  }, [cacheKey])

  return {
    initialState: initRef.current.state,
    wasRestored,
    saveDraft,
    clearDraft,
  }
}
