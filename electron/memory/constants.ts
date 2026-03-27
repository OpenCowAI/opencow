// SPDX-License-Identifier: Apache-2.0

/**
 * Named constants for the memory system.
 * Centralizes all magic numbers for discoverability and tunability.
 */

// ─── Retrieval & Ranking ───────────────────────────────────────────

/** Token overhead per memory item in formatted injection output. */
export const PER_ITEM_TOKEN_OVERHEAD = 15

/** Token estimate for the injection header/footer. */
export const HEADER_TOKEN_ESTIMATE = 50

/** Default token budget for memory context injection. */
export const DEFAULT_TOKEN_BUDGET = 2000

/** Half-life in days for temporal decay scoring. */
export const HALF_LIFE_DAYS = 60

/** Boost factor for project-scope memories over user-scope. */
export const PROJECT_SCOPE_BOOST = 1.2

/** Ranking score weights (must sum to 1.0). */
export const SCORE_WEIGHT_CONFIDENCE = 0.4
export const SCORE_WEIGHT_RECENCY = 0.3
export const SCORE_WEIGHT_USAGE = 0.2
export const SCORE_WEIGHT_SCOPE = 0.1

// ─── Extraction ────────────────────────────────────────────────────

/** Max existing memories to include in the LLM extraction prompt. */
export const MAX_EXISTING_MEMORIES_IN_PROMPT = 30

/** Hard timeout for a single LLM extraction query (ms). */
export const EXTRACTION_TIMEOUT_MS = 30_000

/** Max content chars from a session result for extraction input. */
export const MAX_SESSION_CONTENT_LENGTH = 6000

/** Number of recent messages to include when resolving session content for extraction. */
export const RECENT_MESSAGE_WINDOW = 10

// ─── Pre-Filter ────────────────────────────────────────────────────

/** Min content length to trigger extraction (below this is likely noise). */
export const MIN_PRE_FILTER_CONTENT_LENGTH = 30

/** Max content length for extraction input (truncated beyond this). */
export const MAX_PRE_FILTER_CONTENT_LENGTH = 8000

/** Max LLM extractions per minute (sliding window). */
export const MAX_EXTRACTIONS_PER_MINUTE = 5

// ─── Quality Gate ──────────────────────────────────────────────────

/** Jaccard threshold above which a candidate with richer content is routed to merge. */
export const JACCARD_MERGE_THRESHOLD = 0.5

/** Jaccard threshold above which a candidate is considered the same memory. */
export const JACCARD_DUPLICATE_THRESHOLD = 0.7

/** Content hash hex length (128-bit = 32 hex chars). */
export const CONTENT_HASH_LENGTH = 32

// ─── Lifecycle ─────────────────────────────────────────────────────

/** Interval (ms) for periodic expired memory cleanup. */
export const CLEANUP_INTERVAL_MS = 60 * 60 * 1000 // 1 hour
