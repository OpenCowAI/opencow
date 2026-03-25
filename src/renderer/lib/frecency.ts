// SPDX-License-Identifier: Apache-2.0

/**
 * Frecency — frequency + recency scoring with exponential decay.
 *
 * Stateful functions backed by localStorage. No class, no hook.
 * Mirrors the localStorage pattern from useRecentSearches.ts.
 *
 * Algorithm (Raycast-inspired):
 *   decayedScore = currentScore × 2^(-elapsed / halfLife) + visitBoost
 *
 * @module frecency
 */

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface FrecencyEntry {
  /** Accumulated (pre-decay) score */
  score: number
  /** Timestamp of last visit */
  lastVisitAt: number
}

interface FrecencyStore {
  entries: Record<string, FrecencyEntry>
}

/** Pre-computed frecency scores keyed by entity key (e.g. "issue:abc123"). */
export type FrecencyScoreMap = ReadonlyMap<string, number>

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const STORAGE_KEY = 'opencow:cmd-k:frecency'
const HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
const MAX_ENTRIES = 500

/* ------------------------------------------------------------------ */
/*  Internals                                                          */
/* ------------------------------------------------------------------ */

/** Exponential decay: score × 2^(-elapsed / halfLife) */
function decay(score: number, elapsedMs: number): number {
  if (elapsedMs <= 0) return score
  return score * Math.pow(2, -elapsedMs / HALF_LIFE_MS)
}

function loadStore(): FrecencyStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { entries: {} }
    const parsed = JSON.parse(raw) as FrecencyStore
    if (typeof parsed.entries !== 'object' || parsed.entries === null) return { entries: {} }
    return parsed
  } catch {
    localStorage.removeItem(STORAGE_KEY)
    return { entries: {} }
  }
}

function saveStore(store: FrecencyStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // localStorage full — silently ignore
  }
}

/**
 * Evict lowest-scored entries when exceeding MAX_ENTRIES.
 * Scores are decayed to current time before comparison.
 */
function pruneEntries(store: FrecencyStore): void {
  const keys = Object.keys(store.entries)
  if (keys.length <= MAX_ENTRIES) return

  const now = Date.now()
  const scored = keys.map((key) => {
    const entry = store.entries[key]
    return { key, currentScore: decay(entry.score, now - entry.lastVisitAt) }
  })

  scored.sort((a, b) => b.currentScore - a.currentScore)

  const keep = new Set(scored.slice(0, MAX_ENTRIES).map((s) => s.key))
  for (const key of keys) {
    if (!keep.has(key)) {
      delete store.entries[key]
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Record a visit for an entity. Applies decay to existing score,
 * then adds +1 boost.
 *
 * @param entityKey - Unique key, e.g. `"issue:abc123"` or `"session:xyz"`
 */
export function recordFrecencyVisit(entityKey: string): void {
  const store = loadStore()
  const now = Date.now()
  const existing = store.entries[entityKey]
  const decayed = existing ? decay(existing.score, now - existing.lastVisitAt) : 0

  store.entries[entityKey] = {
    score: decayed + 1,
    lastVisitAt: now,
  }

  pruneEntries(store)
  saveStore(store)
}

/**
 * Load all frecency scores as an immutable Map.
 *
 * Reads localStorage **once**, decays all entries to `now`, and returns
 * a Map<entityKey, decayedScore>. Use this to pass frecency data into
 * pure search functions without coupling them to localStorage.
 */
export function loadFrecencyScoreMap(): FrecencyScoreMap {
  const store = loadStore()
  const now = Date.now()
  const map = new Map<string, number>()

  for (const [key, entry] of Object.entries(store.entries)) {
    const score = decay(entry.score, now - entry.lastVisitAt)
    if (score > 0.01) {
      map.set(key, score)
    }
  }

  return map
}

/**
 * Get the top N entity keys by frecency score (decayed to now).
 * Returns entity keys sorted by score descending.
 *
 * Accepts an optional pre-loaded score map to avoid redundant localStorage reads.
 */
export function getTopFrecencyItems(limit: number, scoreMap?: FrecencyScoreMap): string[] {
  const map = scoreMap ?? loadFrecencyScoreMap()
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key]) => key)
}

/** Clear all frecency data. */
export function clearFrecency(): void {
  localStorage.removeItem(STORAGE_KEY)
}
