// SPDX-License-Identifier: Apache-2.0

/**
 * IssueAICreatorModal — Centered modal for conversational issue creation.
 *
 * Composes:
 *   - `CreatorModalControlled` for the full modal layout and lifecycle
 *   - `useIssueCreatorSession` for domain-specific session management
 *   - `useCreatorModalBehavior` for modal behavior (needs `markConfirmed`)
 *
 * Domain-specific concerns only:
 *   - `IssueConfirmationCard` footer for create/edit/navigate
 *   - `IssueFormModal` for full-featured editing
 *   - Issue creation via `createIssue` store action
 *
 * @module
 */

import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { IssueConfirmationCard } from './IssueConfirmationCard'
import { IssueFormModal } from '../IssueForm/IssueFormModal'
import { CreatorModalControlled, type CreatorModalI18n } from '../AICreator'
import {
  useIssueCreatorSession,
  type IssueCreatorSessionConfig
} from '@/hooks/useIssueCreatorSession'
import { useCreatorModalBehavior } from '@/hooks/useCreatorModalBehavior'
import { useAppStore, selectProjectId } from '@/stores/appStore'
import { useIssueStore } from '@/stores/issueStore'
import { selectIssue } from '@/actions/issueActions'
import { toast } from '@/lib/toast'
import type { Issue, CreateIssueInput } from '@shared/types'
import type { ParsedIssueOutput } from '@shared/issueOutputParser'

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

/** Derive a stable identity key from parsed issue output for discard-guard comparison. */
function issueOutputKey(p: ParsedIssueOutput | null): string | null {
  if (!p) return null
  return `${p.title}\0${p.status}\0${(p.description ?? '').slice(0, 100)}`
}

// ═══════════════════════════════════════════════════════════════════
// Props
// ═══════════════════════════════════════════════════════════════════

export interface IssueAICreatorModalProps {
  /** Controls modal visibility. */
  open: boolean
  /** Called when the modal should close. */
  onClose: () => void
  /** Configuration for the issue creator session. */
  config?: IssueCreatorSessionConfig
}

// ═══════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════

export function IssueAICreatorModal({
  open,
  onClose,
  config = {}
}: IssueAICreatorModalProps): React.JSX.Element | null {
  const { t } = useTranslation('issues')
  const createIssue = useIssueStore((s) => s.createIssue)
  const projectId = useAppStore(selectProjectId)
  const projects = useAppStore((s) => s.projects)

  // ── Session config — merge props with current project context ──
  const sessionConfig: IssueCreatorSessionConfig = useMemo(
    () => ({
      projectId: config.projectId ?? projectId,
      parentIssueId: config.parentIssueId,
      availableLabels: config.availableLabels
    }),
    [config.projectId, config.parentIssueId, config.availableLabels, projectId]
  )

  // ── Resolve project context ────────────────────────────────────
  const project = useMemo(
    () => {
      const id = sessionConfig.projectId
      const path = id ? projects.find((p) => p.id === id)?.path : undefined
      return { id: id ?? undefined, path }
    },
    [projects, sessionConfig.projectId]
  )

  const creator = useIssueCreatorSession(sessionConfig)

  // ── Modal behavior (needs markConfirmed for create/edit flows) ─
  const modal = useCreatorModalBehavior({
    open,
    onClose,
    cleanup: creator.cleanup,
    outputKey: issueOutputKey(creator.parsedIssue),
    hasSession: creator.session !== null
  })

  // ── i18n strings ───────────────────────────────────────────────
  const i18n = useMemo<CreatorModalI18n>(
    () => ({
      header: { title: t('aiCreator.title'), closeLabel: t('aiCreator.close') },
      discard: {
        title: t('aiCreator.discardTitle'),
        message: t('aiCreator.discardMessage'),
        confirm: t('aiCreator.discardConfirm'),
        cancel: t('aiCreator.discardCancel')
      },
      welcome: {
        title: t('aiCreator.welcomeTitle'),
        description: t('aiCreator.welcomeDescription'),
        inputPlaceholder: t('aiCreator.inputPlaceholder')
      },
      pausedPlaceholder: t('aiCreator.inputPlaceholderPaused'),
      suggestions: [
        t('aiCreator.suggestion.bug'),
        t('aiCreator.suggestion.feature'),
        t('aiCreator.suggestion.task')
      ]
    }),
    [t]
  )

  // ── Edit via IssueFormModal ────────────────────────────────────
  const [editingIssue, setEditingIssue] = useState<ParsedIssueOutput | null>(null)
  const [createdIssueFromForm, setCreatedIssueFromForm] = useState<Issue | null>(null)

  const handleEditIssue = useCallback((parsed: ParsedIssueOutput) => {
    setEditingIssue(parsed)
  }, [])

  const handleIssueCreatedFromForm = useCallback((created: Issue) => {
    setCreatedIssueFromForm(created)
    setEditingIssue(null)
    modal.markConfirmed()
    toast(
      `${t('aiCreator.issueCreated')}: ${created.title}`,
      {
        action: {
          label: t('aiCreator.card.view'),
          onClick: () => selectIssue(created.id)
        }
      }
    )
  }, [t, modal])

  const handleEditFormClose = useCallback(() => {
    setEditingIssue(null)
  }, [])

  // ── Issue creation handler (direct from card) ──────────────────
  const handleConfirmIssue = useCallback(
    async (parsed: ParsedIssueOutput): Promise<Issue> => {
      const input: CreateIssueInput = {
        title: parsed.title,
        description: parsed.description,
        status: parsed.status,
        priority: parsed.priority,
        labels: parsed.labels,
        projectId: sessionConfig.projectId,
        parentIssueId: parsed.parentIssueId ?? sessionConfig.parentIssueId
      }
      const created = await createIssue(input)
      modal.markConfirmed()
      toast(
        `${t('aiCreator.issueCreated')}: ${created.title}`,
        {
          action: {
            label: t('aiCreator.card.view'),
            onClick: () => selectIssue(created.id)
          }
        }
      )
      return created
    },
    [createIssue, sessionConfig, t, modal]
  )

  const handleNavigateToIssue = useCallback(
    (issueId: string) => {
      selectIssue(issueId)
    },
    []
  )

  // ── Footer node: IssueConfirmationCard ─────────────────────────
  const footerNode = useMemo(() => {
    if (!creator.parsedIssue) return undefined
    return (
      <IssueConfirmationCard
        issue={creator.parsedIssue}
        onConfirm={handleConfirmIssue}
        onNavigate={handleNavigateToIssue}
        onEdit={handleEditIssue}
        createdIssue={createdIssueFromForm}
      />
    )
  }, [creator.parsedIssue, handleConfirmIssue, handleNavigateToIssue, handleEditIssue, createdIssueFromForm])

  // ── Render ─────────────────────────────────────────────────────
  return (
    <CreatorModalControlled
      modal={modal}
      creator={creator}
      i18n={i18n}
      project={project}
      footerNode={footerNode}
      extraPortals={
        editingIssue ? (
          <IssueFormModal
            defaultProjectId={sessionConfig.projectId}
            parentIssueId={editingIssue.parentIssueId ?? sessionConfig.parentIssueId}
            defaultValues={{
              title: editingIssue.title,
              description: editingIssue.description,
              status: editingIssue.status,
              priority: editingIssue.priority,
              labels: editingIssue.labels,
            }}
            onCreated={handleIssueCreatedFromForm}
            onClose={handleEditFormClose}
            zIndex={101}
          />
        ) : undefined
      }
    />
  )
}
