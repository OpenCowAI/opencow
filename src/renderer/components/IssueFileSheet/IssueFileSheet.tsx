// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from 'react-resizable-panels'
import { X } from 'lucide-react'
import { useIssueFileOverlayStore } from '@/stores/issueFileOverlayStore'
import { useIssueStore } from '@/stores/issueStore'
import { useAppStore } from '@/stores/appStore'
import { useIssueSessionRuntime } from '@/hooks/useIssueSessionRuntime'
import { useBlockBrowserView } from '@/hooks/useBlockBrowserView'
import { cn } from '@/lib/utils'
import { resolveProjectPath } from '@/lib/issueSessionUtils'
import { ProjectScopeProvider } from '@/contexts/ProjectScopeContext'
import { ContextFilesProvider, useContextFiles } from '@/contexts/ContextFilesContext'
import { ComposeView } from '@/components/DetailPanel/SessionPanel/ComposeView'
import { SessionPanel } from '@/components/DetailPanel/SessionPanel/SessionPanel'
import { ContextFileDropZone } from '@/components/DetailPanel/ContextFileDropZone'
import { FilesViewForProject } from '@/components/FilesView/FilesView'
import type { Issue } from '@shared/types'
import type {
  IssueSessionHistoryContext,
  IssueSessionRuntimeCapabilities,
} from '@/types/issueSessionRuntime'

export function IssueFileSheet(): React.JSX.Element | null {
  const overlay = useIssueFileOverlayStore((s) => s.issueFileOverlay)
  if (!overlay) return null

  return <IssueFileSheetContent issueId={overlay.issueId} />
}

function IssueFileSheetContent({ issueId }: { issueId: string }): React.JSX.Element {
  const { t } = useTranslation('issues')
  const closeIssueFileOverlay = useIssueFileOverlayStore((s) => s.closeIssueFileOverlay)
  const finishIssueFileSheetExit = useIssueFileOverlayStore((s) => s.finishIssueFileSheetExit)
  const isExiting = useIssueFileOverlayStore((s) => s._issueFileSheetExiting)

  const issue = useIssueStore((s) => s.issueDetailCache.get(issueId) ?? null)
  const issueSummary = useIssueStore((s) => s.issueById[issueId] ?? null)
  const loadIssueDetail = useIssueStore((s) => s.loadIssueDetail)
  const projects = useAppStore((s) => s.projects)
  const [loadFailed, setLoadFailed] = useState(false)

  const {
    isStarting,
    composeMode,
    setComposeMode,
    initialPrompt,
    handleComposeStart,
    sessionBinding,
    capabilities,
    sessionHistoryCtx,
  } = useIssueSessionRuntime(issueId)

  useBlockBrowserView('issue-file-sheet', true)

  useEffect(() => {
    let cancelled = false
    setLoadFailed(false)

    loadIssueDetail(issueId).then((result) => {
      if (cancelled) return
      if (!result) {
        setLoadFailed(true)
        closeIssueFileOverlay()
      }
    })

    return () => {
      cancelled = true
    }
  }, [issueId, loadIssueDetail, closeIssueFileOverlay])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (isExiting) return
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        closeIssueFileOverlay()
      }
      if (e.key === 'w' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        e.stopPropagation()
        closeIssueFileOverlay()
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [closeIssueFileOverlay, isExiting])

  const handleAnimationEnd = useCallback(
    (e: React.AnimationEvent<HTMLDivElement>) => {
      if (e.currentTarget !== e.target) return
      if (isExiting) finishIssueFileSheetExit()
    },
    [isExiting, finishIssueFileSheetExit],
  )

  const displayTitle = issue?.title ?? issueSummary?.title ?? t('detail.issueFileSheetTitle')
  const filesProject = useMemo(() => {
    if (!issue?.projectId) return null
    const project = projects.find((p) => p.id === issue.projectId) ?? null
    const projectPath = project?.path ?? resolveProjectPath(issue.projectId, projects)
    if (!projectPath) return null
    return {
      id: issue.projectId,
      name: project?.name ?? issue.projectId,
      path: projectPath,
    }
  }, [issue?.projectId, projects])

  return (
    <div
      className={cn(
        'fixed inset-0 z-40 bg-[hsl(var(--background))] no-drag flex flex-col',
        isExiting
          ? 'animate-[sheet-slide-out_200ms_cubic-bezier(0.36,0,0.66,-0.56)_forwards]'
          : 'animate-[sheet-slide-in_300ms_cubic-bezier(0.16,1,0.3,1)_forwards]'
      )}
      onAnimationEnd={handleAnimationEnd}
    >
      <div className="drag-region flex items-center justify-between gap-3 px-4 py-2.5 pl-[80px] border-b border-[hsl(var(--border))] bg-[hsl(var(--card))]">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-[hsl(var(--foreground))] truncate" title={displayTitle}>
            {displayTitle}
          </h2>
        </div>

        <button
          type="button"
          onClick={closeIssueFileOverlay}
          className="no-drag p-1.5 rounded-md text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
          aria-label={t('detail.closeIssueFileSheetAria')}
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      <PanelGroup orientation="horizontal" className="flex-1 min-h-0">
        <Panel defaultSize={62} minSize={36}>
          {issue ? (
            filesProject ? (
              <FilesViewForProject project={filesProject} layout={{ searchFabBottomOffsetPx: 36 }} />
            ) : (
              <div className="h-full flex items-center justify-center px-6 text-center">
                <p className="text-sm text-[hsl(var(--muted-foreground))]">
                  {t('detail.issueFileSheetNoProjectFiles')}
                </p>
              </div>
            )
          ) : (
            <div className="h-full flex items-center justify-center px-6 text-center">
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                {loadFailed ? t('detail.notFound') : t('detail.loading')}
              </p>
            </div>
          )}
        </Panel>

        <PanelResizeHandle className="w-px bg-[hsl(var(--border)/0.5)] hover:bg-[hsl(var(--ring)/0.3)] transition-colors data-[resize-handle-state=drag]:bg-[hsl(var(--ring)/0.7)]" />

        <Panel defaultSize={38} minSize={24}>
          <ContextFilesProvider>
            <IssueFileWorkspace
              issue={issue}
              loadFailed={loadFailed}
              isStarting={isStarting}
              composeMode={composeMode}
              setComposeMode={setComposeMode}
              initialPrompt={initialPrompt}
              handleComposeStart={handleComposeStart}
              sessionBinding={sessionBinding}
              capabilities={capabilities}
              sessionHistoryCtx={sessionHistoryCtx}
            />
          </ContextFilesProvider>
        </Panel>
      </PanelGroup>
    </div>
  )
}

interface IssueFileWorkspaceProps {
  issue: Issue | null
  loadFailed: boolean
  isStarting: boolean
  composeMode: boolean
  setComposeMode: (next: boolean) => void
  initialPrompt: { text: string; attachments: import('@/lib/attachmentUtils').ImageAttachment[] }
  handleComposeStart: (content: import('@shared/types').UserMessageContent) => Promise<boolean | void>
  sessionBinding: import('@/hooks/useSessionForIssue').SessionBinding
  capabilities: IssueSessionRuntimeCapabilities
  sessionHistoryCtx: IssueSessionHistoryContext | undefined
}

function IssueFileWorkspace({
  issue,
  loadFailed,
  isStarting,
  composeMode,
  setComposeMode,
  initialPrompt,
  handleComposeStart,
  sessionBinding,
  capabilities,
  sessionHistoryCtx,
}: IssueFileWorkspaceProps): React.JSX.Element {
  const { t } = useTranslation('issues')
  const { addFiles } = useContextFiles()
  const projects = useAppStore((s) => s.projects)

  const projectPath = useMemo(
    () => resolveProjectPath(issue?.projectId, projects),
    [issue?.projectId, projects],
  )

  if (!issue) {
    return (
      <div className="h-full flex items-center justify-center px-6 text-center">
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          {loadFailed ? t('detail.notFound') : t('detail.loading')}
        </p>
      </div>
    )
  }

  return (
    <ContextFileDropZone className="h-full flex flex-col" onFilesDrop={({ files }) => addFiles(files)}>
      <ProjectScopeProvider projectPath={projectPath} projectId={issue.projectId ?? undefined}>
        {composeMode && !issue.sessionId ? (
          <ComposeView
            initialPrompt={initialPrompt}
            onSubmit={handleComposeStart}
            onCancel={() => setComposeMode(false)}
          />
        ) : (
          <SessionPanel
            binding={sessionBinding}
            lifecycle={issue.status === 'done' || issue.status === 'cancelled' ? 'readonly' : 'active'}
            isStarting={isStarting}
            capabilities={capabilities}
            history={sessionHistoryCtx}
          />
        )}
      </ProjectScopeProvider>
    </ContextFileDropZone>
  )
}
