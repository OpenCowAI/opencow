// SPDX-License-Identifier: Apache-2.0

import { IssueViewStore } from './issueViewStore'
import type { IssueView, CreateIssueViewInput, UpdateIssueViewInput } from '../../src/shared/types'

export class IssueViewService {
  constructor(private readonly store: IssueViewStore) {}

  async listViews(): Promise<IssueView[]> {
    return this.store.list()
  }

  async createView(input: CreateIssueViewInput): Promise<IssueView> {
    return this.store.create(input)
  }

  async updateView(id: string, patch: UpdateIssueViewInput): Promise<IssueView | null> {
    return this.store.update(id, patch)
  }

  async deleteView(id: string): Promise<boolean> {
    return this.store.delete(id)
  }

  async reorderViews(orderedIds: string[]): Promise<void> {
    return this.store.reorder(orderedIds)
  }

  // ── Label lifecycle cascade ────────────────────────────────────────

  /** Remove a deleted label from all views' filter configs. */
  async purgeLabel(label: string): Promise<number> {
    return this.store.purgeLabel(label)
  }

  /** Rename a label across all views' filter configs. */
  async renameLabel(oldLabel: string, newLabel: string): Promise<number> {
    return this.store.renameLabel(oldLabel, newLabel)
  }
}
