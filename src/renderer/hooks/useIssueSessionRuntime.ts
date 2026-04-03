// SPDX-License-Identifier: Apache-2.0

import { useCallback, useMemo, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useIssueStore } from '@/stores/issueStore'
import { useAppStore } from '@/stores/appStore'
import { useCommandStore } from '@/stores/commandStore'
import { startSession } from '@/actions/commandActions'
import { useSessionArchive } from './useSessionArchive'
import { selectSessionForIssue, useSessionHistoryForIssue, type SessionBinding } from './useSessionForIssue'
import { buildIssuePromptText } from '@shared/issuePromptBuilder'
import { buildIssueSessionPrompt } from '@/lib/issueSessionUtils'
import { issueImagesToAttachments, type ImageAttachment } from '@/lib/attachmentUtils'
import type { UserMessageContent } from '@shared/types'
import type {
  IssueSessionHistoryContext,
  IssueSessionRuntimeCapabilities,
} from '@/types/issueSessionRuntime'
import { createLogger } from '@/lib/logger'
import { toast } from '@/lib/toast'

const log = createLogger('useIssueSessionRuntime')

interface UseIssueSessionRuntimeResult {
  isStarting: boolean
  composeMode: boolean
  setComposeMode: (next: boolean) => void
  archivedSessions: IssueSessionHistoryContext['archivedSessions']
  isViewingArchived: boolean
  viewingArchivedSessionId: string | null
  viewArchivedSession: (sessionId: string) => void
  exitArchivedView: () => void
  restoreArchivedSession: (targetSessionId: string) => Promise<void>
  initialPrompt: { text: string; attachments: ImageAttachment[] }
  handleComposeStart: (content: UserMessageContent) => Promise<boolean | void>
  sessionBinding: SessionBinding
  capabilities: IssueSessionRuntimeCapabilities
  sessionHistoryCtx: IssueSessionHistoryContext | undefined
}

export function useIssueSessionRuntime(issueId: string): UseIssueSessionRuntimeResult {
  const { t } = useTranslation('issues')
  const actionText = t('pleaseWorkOnIssue')

  const stopSession = useCommandStore((s) => s.stopSession)
  const sendMessage = useCommandStore((s) => s.sendMessage)
  const resumeSession = useCommandStore((s) => s.resumeSession)
  const issue = useIssueStore((s) => s.issueDetailCache.get(issueId) ?? null)
  const archivedSessions = useSessionHistoryForIssue(issueId)
  const { archiveCurrentSession, restoreSession } = useSessionArchive()

  const [isStarting, setIsStarting] = useState(false)
  const [composeMode, setComposeMode] = useState(false)
  const [viewingArchivedSessionId, setViewingArchivedSessionId] = useState<string | null>(null)
  const isViewingArchived = viewingArchivedSessionId !== null

  // Reset transient UI state when switching between issues.
  useEffect(() => {
    setComposeMode(false)
    setIsStarting(false)
    setViewingArchivedSessionId(null)
  }, [issueId])

  const handleCreateSession = useCallback(async () => {
    const currentIssue = useIssueStore.getState().issueDetailCache.get(issueId)
    if (!currentIssue) return
    setIsStarting(true)
    try {
      const { prompt, workspace } = await buildIssueSessionPrompt(currentIssue, {
        projects: useAppStore.getState().projects,
        actionText,
      })
      await startSession({
        prompt,
        origin: { source: 'issue', issueId: currentIssue.id },
        workspace,
      })
    } catch (err) {
      log.error('Failed to create session', err)
      toast(t('sessionPanel.startSessionFailed', { defaultValue: 'Failed to start session' }))
    } finally {
      setIsStarting(false)
    }
  }, [actionText, issueId, t])

  const initialPrompt = useMemo(() => {
    if (!issue) return { text: '', attachments: [] as ImageAttachment[] }
    const text = buildIssuePromptText(issue, actionText)
    const attachments = issueImagesToAttachments(issue.images ?? [])
    return { text, attachments }
  }, [issue, actionText])

  const handleComposeStart = useCallback(async (content: UserMessageContent): Promise<boolean | void> => {
    const currentIssue = useIssueStore.getState().issueDetailCache.get(issueId)
    if (!currentIssue) return false
    const workspace = currentIssue.projectId
      ? { scope: 'project', projectId: currentIssue.projectId } as const
      : { scope: 'global' as const }
    setIsStarting(true)
    try {
      await startSession({
        prompt: content,
        origin: { source: 'issue', issueId: currentIssue.id },
        workspace,
      })
      setComposeMode(false)
    } catch (err) {
      log.error('Failed to start composed session', err)
      toast(t('sessionPanel.startSessionFailed', { defaultValue: 'Failed to start session' }))
      return false
    } finally {
      setIsStarting(false)
    }
  }, [issueId, t])

  const handleStopSession = useCallback(async () => {
    const currentSession = selectSessionForIssue(issueId)
    if (!currentSession) return
    await stopSession(currentSession.id)
  }, [issueId, stopSession])

  const handleSendMessage = useCallback(async (message: UserMessageContent): Promise<boolean> => {
    const currentSession = selectSessionForIssue(issueId)
    if (!currentSession) return false
    return sendMessage(currentSession.id, message)
  }, [issueId, sendMessage])

  const handleResumeMessage = useCallback(async (message: UserMessageContent): Promise<boolean> => {
    const currentSession = selectSessionForIssue(issueId)
    if (!currentSession) return false
    return resumeSession(currentSession.id, message)
  }, [issueId, resumeSession])

  const handleRetrySession = useCallback(async () => {
    const currentSession = selectSessionForIssue(issueId)
    if (!currentSession) {
      await handleCreateSession()
      return
    }
    await resumeSession(currentSession.id, t('sessions:sessionStatusBar.resumeMessage'))
  }, [issueId, resumeSession, handleCreateSession, t])

  const handleNewSession = useCallback(async () => {
    const currentIssue = useIssueStore.getState().issueDetailCache.get(issueId)
    if (!currentIssue) return
    const currentSession = selectSessionForIssue(issueId)
    setIsStarting(true)
    try {
      await archiveCurrentSession(currentIssue, currentSession)
      await handleCreateSession()
    } finally {
      setIsStarting(false)
    }
  }, [issueId, archiveCurrentSession, handleCreateSession])

  const handleNewBlankSession = useCallback(async () => {
    const currentIssue = useIssueStore.getState().issueDetailCache.get(issueId)
    if (!currentIssue) return
    const currentSession = selectSessionForIssue(issueId)
    setIsStarting(true)
    try {
      await archiveCurrentSession(currentIssue, currentSession, { clearSessionId: true })
    } finally {
      setIsStarting(false)
    }
  }, [issueId, archiveCurrentSession])

  const handleRestoreSession = useCallback(async (targetSessionId: string) => {
    const currentIssue = useIssueStore.getState().issueDetailCache.get(issueId)
    if (!currentIssue) return
    const currentSession = selectSessionForIssue(issueId)
    setIsStarting(true)
    try {
      setViewingArchivedSessionId(null)
      await restoreSession(currentIssue, currentSession, targetSessionId)
    } finally {
      setIsStarting(false)
    }
  }, [issueId, restoreSession])

  const handleViewArchivedSession = useCallback((sessionId: string) => {
    setViewingArchivedSessionId(sessionId)
  }, [])

  const handleExitArchivedView = useCallback(() => {
    setViewingArchivedSessionId(null)
  }, [])

  const capabilities = useMemo<IssueSessionRuntimeCapabilities>(() => ({
    create: handleCreateSession,
    retry: handleRetrySession,
    stop: handleStopSession,
    newSession: handleNewSession,
    newBlankSession: handleNewBlankSession,
    compose: () => setComposeMode(true),
    send: handleSendMessage,
    resume: handleResumeMessage,
  }), [handleCreateSession, handleRetrySession, handleStopSession, handleNewSession, handleNewBlankSession, handleSendMessage, handleResumeMessage])

  const sessionHistoryCtx = useMemo<IssueSessionHistoryContext | undefined>(
    () =>
      archivedSessions.length > 0 || isViewingArchived
        ? {
            archivedSessions,
            onRestore: handleRestoreSession,
            onView: handleViewArchivedSession,
            isViewingArchived,
            onExitView: handleExitArchivedView,
          }
        : undefined,
    [archivedSessions, handleRestoreSession, handleViewArchivedSession, isViewingArchived, handleExitArchivedView],
  )

  const sessionBinding = useMemo(() => ({
    kind: 'issue' as const,
    issueId,
    archivedSessionId: viewingArchivedSessionId,
  }), [issueId, viewingArchivedSessionId])

  return {
    isStarting,
    composeMode,
    setComposeMode,
    archivedSessions,
    isViewingArchived,
    viewingArchivedSessionId,
    viewArchivedSession: handleViewArchivedSession,
    exitArchivedView: handleExitArchivedView,
    restoreArchivedSession: handleRestoreSession,
    initialPrompt,
    handleComposeStart,
    sessionBinding,
    capabilities,
    sessionHistoryCtx,
  }
}
