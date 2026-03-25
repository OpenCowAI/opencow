// SPDX-License-Identifier: Apache-2.0

import { useState, useCallback, useRef, useMemo } from 'react'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface RecentEntry {
  text: string
  timestamp: number
}

interface StorageRecord {
  queries: RecentEntry[]
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const STORAGE_KEY = 'opencow:capability-search:recent'
const MAX_ITEMS = 8
/** Entries older than 30 days are auto-discarded. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function readFromStorage(): RecentEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const record = JSON.parse(raw) as StorageRecord
    if (!Array.isArray(record.queries)) return []

    const now = Date.now()
    return record.queries.filter((e) => now - e.timestamp < MAX_AGE_MS)
  } catch {
    localStorage.removeItem(STORAGE_KEY)
    return []
  }
}

function writeToStorage(entries: RecentEntry[]): void {
  try {
    const record: StorageRecord = { queries: entries }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record))
  } catch {
    // localStorage full — silently ignore
  }
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export interface UseRecentSearchesReturn {
  /** Recent search texts, newest first. */
  recentSearches: string[]
  /** Add a query to the recent list (deduplicates & promotes to top). */
  addRecent: (text: string) => void
  /** Clear all recent searches. */
  clearRecent: () => void
}

export function useRecentSearches(): UseRecentSearchesReturn {
  // Lazy init from localStorage on first render
  const initRef = useRef<RecentEntry[] | null>(null)
  if (initRef.current === null) {
    initRef.current = readFromStorage()
  }

  const [entries, setEntries] = useState<RecentEntry[]>(initRef.current)

  // Keep a ref in sync so addRecent can read current entries synchronously
  // (avoids stale closure + ensures localStorage write happens outside React updater)
  const entriesRef = useRef(entries)
  entriesRef.current = entries

  const addRecent = useCallback((text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return

    // Compute new list from ref (synchronous, no React updater dependency)
    const prev = entriesRef.current
    const filtered = prev.filter((e) => e.text.toLowerCase() !== trimmed.toLowerCase())
    const next = [{ text: trimmed, timestamp: Date.now() }, ...filtered].slice(0, MAX_ITEMS)

    // Write to localStorage FIRST — synchronous, survives component unmount
    writeToStorage(next)
    // Then update React state (may be discarded if component unmounts, but that's fine)
    setEntries(next)
  }, [])

  const clearRecent = useCallback(() => {
    setEntries([])
    localStorage.removeItem(STORAGE_KEY)
  }, [])

  const recentSearches = useMemo(() => entries.map((e) => e.text), [entries])

  return { recentSearches, addRecent, clearRecent }
}
