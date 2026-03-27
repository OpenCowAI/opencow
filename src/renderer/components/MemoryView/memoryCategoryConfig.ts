// SPDX-License-Identifier: Apache-2.0

/**
 * Memory category configuration — icons, grouping, and metadata.
 *
 * Groups follow the MECE principle (Mutually Exclusive, Collectively Exhaustive):
 *   - About You:  who the user is and how they work
 *   - Knowledge:  what they know, think, and have decided
 *   - Project:    project-specific context and agreements
 *
 * Shared across MemoryCreateModal, MemoryCard, MemoryDetailView, and MemoryView.
 */

import {
  Heart,
  UserCircle,
  MousePointerClick,
  Route,
  BookCheck,
  MessageCircle,
  GraduationCap,
  Scale,
  FolderKanban,
  ListChecks,
  Handshake,
  Lightbulb,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { MemoryCategory } from '@shared/types'

// ─── Types ─────────────────────────────────────────────────────────

export interface CategoryMeta {
  key: MemoryCategory
  icon: LucideIcon
}

export interface CategoryGroup {
  /** i18n key — use with t(`categoryGroup.${key}`) */
  key: string
  categories: CategoryMeta[]
}

// ─── Groups (MECE) ─────────────────────────────────────────────────

export const CATEGORY_GROUPS: CategoryGroup[] = [
  {
    key: 'aboutYou',
    categories: [
      { key: 'preference', icon: Heart },
      { key: 'background', icon: UserCircle },
      { key: 'behavior', icon: MousePointerClick },
      { key: 'workflow', icon: Route },
    ],
  },
  {
    key: 'knowledge',
    categories: [
      { key: 'fact', icon: BookCheck },
      { key: 'opinion', icon: MessageCircle },
      { key: 'domain_knowledge', icon: GraduationCap },
      { key: 'decision', icon: Scale },
    ],
  },
  {
    key: 'project',
    categories: [
      { key: 'project_context', icon: FolderKanban },
      { key: 'requirement', icon: ListChecks },
      { key: 'convention', icon: Handshake },
      { key: 'lesson_learned', icon: Lightbulb },
    ],
  },
]

/** Flat list of all categories (preserves group ordering). */
export const CATEGORY_METAS: CategoryMeta[] = CATEGORY_GROUPS.flatMap((g) => g.categories)

/** Lookup icon by category key. */
export const CATEGORY_ICON_MAP = new Map<MemoryCategory, LucideIcon>(
  CATEGORY_METAS.map((m) => [m.key, m.icon]),
)
