// SPDX-License-Identifier: Apache-2.0

import { useEffect } from 'react'
import { useAppStore } from '@/stores/appStore'
import { useInboxStore } from '@/stores/inboxStore'
import { isInsideEditor, isInsideDialog } from '@/lib/domUtils'

export function useInboxKeyboard(): void {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      // Skip if user is interacting with an editor (input, textarea, contenteditable, Monaco, etc.)
      if (isInsideEditor(e.target)) return

      // Skip if focus is inside a modal dialog (e.g. DiffChangesDialog)
      if (isInsideDialog(e.target)) return

      // Cmd+I: toggle inbox
      if (e.metaKey && !e.shiftKey && e.key === 'i') {
        e.preventDefault()
        const { appView, navigateToInbox, navigateToProject } = useAppStore.getState()
        if (appView.mode === 'inbox') {
          navigateToProject(null)
        } else {
          navigateToInbox()
        }
        return
      }

      // Only handle remaining shortcuts in inbox mode
      const { appView } = useAppStore.getState()
      if (appView.mode !== 'inbox') return

      switch (e.key) {
        case 'Escape': {
          e.preventDefault()
          useAppStore.getState().navigateToProject(null)
          break
        }
        case 'ArrowUp':
        case 'ArrowDown': {
          e.preventDefault()
          const appState = useAppStore.getState()
          const messages = useInboxStore.getState().inboxMessages
          if (messages.length === 0) break

          const currentId = appState.appView.mode === 'inbox' ? appState.appView.selectedMessageId : null
          const currentIdx = currentId ? messages.findIndex(m => m.id === currentId) : -1

          let nextIdx: number
          if (e.key === 'ArrowUp') {
            nextIdx = currentIdx <= 0 ? messages.length - 1 : currentIdx - 1
          } else {
            nextIdx = currentIdx >= messages.length - 1 ? 0 : currentIdx + 1
          }

          appState.navigateToInbox(messages[nextIdx].id)
          break
        }
        case 'Enter': {
          // Select current message (already handled by ArrowUp/Down navigation)
          break
        }
        case 'r': {
          if (e.metaKey || e.ctrlKey) break
          const appState = useAppStore.getState()
          if (appState.appView.mode !== 'inbox') break
          const selectedId = appState.appView.selectedMessageId
          if (!selectedId) break

          const msg = useInboxStore.getState().inboxMessages.find(m => m.id === selectedId)
          if (msg?.status === 'unread') {
            useInboxStore.getState().markInboxRead(selectedId)
          }
          break
        }
        case 'e': {
          if (e.metaKey || e.ctrlKey) break
          const appState = useAppStore.getState()
          if (appState.appView.mode !== 'inbox') break
          const selectedId = appState.appView.selectedMessageId
          if (selectedId) {
            useInboxStore.getState().archiveInboxMessage(selectedId)
          }
          break
        }
      }

      // Cmd+Shift+R: mark all read
      if (e.metaKey && e.shiftKey && e.key === 'R') {
        e.preventDefault()
        useInboxStore.getState().markAllInboxRead()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])
}
