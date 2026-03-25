// SPDX-License-Identifier: Apache-2.0

/**
 * ConnectedContentViewer — Context-connected content/diff viewer dialog.
 *
 * Reads viewer state from ContentViewerContext and dispatches to
 * ContentViewerDialog or DiffViewerDialog based on payload type.
 *
 * Render this component as a **sibling** of your main content (not inside
 * conditional blocks) so the dialog persists across virtualisation, tab
 * switches, and processing-state changes.
 *
 * Consumed by:
 *   - SessionPanel (Issue Session Console)
 *   - SessionChatLayout (Chat view)
 *   - BrowserSheetChat (Browser overlay chat)
 */
import { useContentViewerContext } from './ContentViewerContext'
import { ContentViewerDialog } from './ContentViewerDialog'
import { DiffViewerDialog } from './DiffViewerDialog'

export function ConnectedContentViewer(): React.JSX.Element | null {
  const { viewerOpen, payload, closeViewer } = useContentViewerContext()
  if (!payload) return null

  if (payload.type === 'content') {
    return (
      <ContentViewerDialog
        open={viewerOpen}
        onClose={closeViewer}
        content={payload.data.content}
        fileName={payload.data.fileName}
        filePath={payload.data.filePath}
        language={payload.data.language}
        isLoading={payload.data.isLoading}
      />
    )
  }

  return (
    <DiffViewerDialog
      open={viewerOpen}
      onClose={closeViewer}
      oldString={payload.data.oldString}
      newString={payload.data.newString}
      filePath={payload.data.filePath}
      sessionId={payload.data.sessionId}
    />
  )
}
