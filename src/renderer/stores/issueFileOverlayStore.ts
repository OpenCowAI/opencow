// SPDX-License-Identifier: Apache-2.0

import { create } from 'zustand'

export interface IssueFileOverlayState {
  issueId: string
}

interface IssueFileOverlayStore {
  /** Current open issue-file sheet state; null means closed */
  issueFileOverlay: IssueFileOverlayState | null
  /** Two-phase exit animation flag */
  _issueFileSheetExiting: boolean

  openIssueFileOverlay: (issueId: string) => void
  closeIssueFileOverlay: () => void
  finishIssueFileSheetExit: () => void
  reset: () => void
}

const initialState = {
  issueFileOverlay: null as IssueFileOverlayState | null,
  _issueFileSheetExiting: false,
}

export const useIssueFileOverlayStore = create<IssueFileOverlayStore>((set, get) => ({
  ...initialState,

  openIssueFileOverlay: (issueId) => {
    set({
      issueFileOverlay: { issueId },
      _issueFileSheetExiting: false,
    })
  },

  closeIssueFileOverlay: () => {
    if (!get().issueFileOverlay) return
    set({ _issueFileSheetExiting: true })
  },

  finishIssueFileSheetExit: () => {
    set({
      issueFileOverlay: null,
      _issueFileSheetExiting: false,
    })
  },

  reset: () => set(initialState),
}))

