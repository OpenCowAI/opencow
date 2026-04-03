// SPDX-License-Identifier: Apache-2.0

import type { SessionSnapshot, UserMessageContent } from '@shared/types'

export interface IssueSessionHistoryContext {
  archivedSessions: SessionSnapshot[]
  onRestore: (sessionId: string) => void
  onView: (sessionId: string) => void
  isViewingArchived: boolean
  onExitView: () => void
}

export interface IssueSessionRuntimeCapabilities {
  create?: () => void
  retry?: () => void
  stop?: () => void
  newSession?: () => void
  newBlankSession?: () => void
  compose?: () => void
  send: (message: UserMessageContent) => Promise<boolean>
  resume: (message: UserMessageContent) => Promise<boolean>
}
