// SPDX-License-Identifier: Apache-2.0

/**
 * ContentViewerContext — lifts content/diff viewer dialog state above the
 * message list so that neither Virtuoso virtualisation, tab-switching,
 * nor isProcessing changes can unmount the dialog.
 *
 * Architecture (mirrors ArtifactViewerContext):
 * - Dialog state (useDialogState) lives here, keyed by ViewerPayload
 * - Child components (ToolUseBlockView, ToolBatchCollapsible) consume via context
 * - ConnectedContentViewer (ConnectedContentViewer.tsx) is rendered as a sibling
 *   of the main content, outside conditional blocks
 *
 * Providers are placed in:
 *   - SessionPanel (Issue Session Console)
 *   - SessionChatLayout (Chat view)
 *   - BrowserSheetChat (Browser overlay chat)
 *
 * Supports two viewer types:
 * - ContentViewer: syntax-highlighted file preview (Write, Read, gen_html, batch md)
 * - DiffViewer: side-by-side diff for Edit tool
 */
import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from 'react'
import { useDialogState } from '@/hooks/useModalAnimation'
import { detectLanguage } from '@shared/fileUtils'
import { getAppAPI } from '@/windowAPI'

// ─── Payload Types ──────────────────────────────────────────────────────────

export interface ContentViewerPayload {
  content: string
  fileName: string
  filePath: string
  language: string
  isLoading?: boolean
}

export interface DiffViewerPayload {
  oldString: string
  newString: string
  filePath: string
  sessionId?: string
}

export type ViewerPayload =
  | { type: 'content'; data: ContentViewerPayload }
  | { type: 'diff'; data: DiffViewerPayload }

export interface ToolFileViewerParams {
  sessionId: string
  filePath: string
}

// ─── Context ────────────────────────────────────────────────────────────────

interface ContentViewerContextValue {
  /** Whether the viewer dialog is open (drives Dialog `open` prop). */
  viewerOpen: boolean
  /** The payload currently being displayed, or null when closed. */
  payload: ViewerPayload | null
  /** Open the content viewer dialog with file preview data. */
  showContentViewer: (data: ContentViewerPayload) => void
  /** Open the diff viewer dialog with edit diff data. */
  showDiffViewer: (data: DiffViewerPayload) => void
  /** Load a tool file within session sandbox and open it in the content viewer. */
  openToolFileViewer: (params: ToolFileViewerParams) => Promise<void>
  /** Close the viewer dialog (plays exit animation). */
  closeViewer: () => void
}

const ContentViewerCtx = createContext<ContentViewerContextValue | null>(null)

/**
 * No-op fallback returned when the hook is used outside a ContentViewerProvider.
 *
 * All primary SessionMessageList consumers now provide a ContentViewerProvider.
 * ReviewChatPanel inherits context from SessionPanel via React portal propagation.
 *
 * Retained as a safety net for any future consumer that renders
 * SessionMessageList without a provider — preview clicks degrade gracefully.
 */
const NOOP_CONTENT_VIEWER: ContentViewerContextValue = {
  viewerOpen: false,
  payload: null,
  showContentViewer: () => {},
  showDiffViewer: () => {},
  openToolFileViewer: async () => {},
  closeViewer: () => {},
}

/** Consume the content viewer context. Returns a no-op fallback if used outside provider. */
export function useContentViewerContext(): ContentViewerContextValue {
  const ctx = useContext(ContentViewerCtx)
  return ctx ?? NOOP_CONTENT_VIEWER
}

// ─── Provider ───────────────────────────────────────────────────────────────

interface ContentViewerProviderProps {
  children: ReactNode
}

export function ContentViewerProvider({ children }: ContentViewerProviderProps): React.JSX.Element {
  const viewer = useDialogState<ViewerPayload>()
  const latestToolLoadRequestId = useRef(0)

  const openToolFileViewer = useCallback(async ({ sessionId, filePath }: ToolFileViewerParams) => {
    const normalizedSessionId = sessionId.trim()
    const normalizedPath = filePath.trim()
    if (!normalizedSessionId || !normalizedPath) return

    const fileName = normalizedPath.split('/').pop() ?? 'file'
    const language = detectLanguage(normalizedPath)
    const requestId = ++latestToolLoadRequestId.current

    viewer.show({
      type: 'content',
      data: {
        content: '',
        fileName,
        filePath: normalizedPath,
        language,
        isLoading: true,
      }
    })

    try {
      const result = await getAppAPI()['view-tool-file-content']({
        sessionId: normalizedSessionId,
        filePath: normalizedPath,
      })
      if (requestId !== latestToolLoadRequestId.current) return
      if (!result.ok) {
        viewer.show({
          type: 'content',
          data: {
            content: `// ${result.error.message || 'Failed to read file'}`,
            fileName,
            filePath: normalizedPath,
            language,
          }
        })
        return
      }
      viewer.show({
        type: 'content',
        data: {
          content: result.data.content,
          fileName,
          filePath: normalizedPath,
          language,
        }
      })
    } catch (err) {
      if (requestId !== latestToolLoadRequestId.current) return
      const message = err instanceof Error ? err.message : 'Failed to read file'
      viewer.show({
        type: 'content',
        data: {
          content: `// ${message}`,
          fileName,
          filePath: normalizedPath,
          language,
        }
      })
    }
  }, [viewer.show])

  const closeViewer = useCallback(() => {
    // Invalidate in-flight tool-file loads so stale responses cannot re-open content.
    latestToolLoadRequestId.current += 1
    viewer.close()
  }, [viewer.close])

  const value = useMemo<ContentViewerContextValue>(
    () => ({
      viewerOpen: viewer.open,
      payload: viewer.data,
      showContentViewer: (data: ContentViewerPayload) =>
        viewer.show({ type: 'content', data }),
      showDiffViewer: (data: DiffViewerPayload) =>
        viewer.show({ type: 'diff', data }),
      openToolFileViewer,
      closeViewer,
    }),
    [viewer.open, viewer.data, viewer.show, closeViewer, openToolFileViewer],
  )

  return <ContentViewerCtx.Provider value={value}>{children}</ContentViewerCtx.Provider>
}
