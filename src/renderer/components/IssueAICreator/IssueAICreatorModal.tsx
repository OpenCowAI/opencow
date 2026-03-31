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

import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { useIssueProviderStore } from '@/stores/issueProviderStore'
import { selectIssue } from '@/actions/issueActions'
import { toast } from '@/lib/toast'
import { issueProviderPlatformLabel, issueProviderRepoLabel, type Issue, type CreateIssueInput } from '@shared/types'
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

  // ── Remote publish — load providers for current project ────────
  const providers = useIssueProviderStore((s) => s.providers)
  const loadProviders = useIssueProviderStore((s) => s.loadProviders)
  const [publishToRemote, setPublishToRemote] = useState(false)

  // Ensure provider store is populated (may not have been loaded yet if
  // the user hasn't opened ProjectSettings in this session).
  useEffect(() => {
    if (sessionConfig.projectId) loadProviders(sessionConfig.projectId)
  }, [sessionConfig.projectId, loadProviders])
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null)

  // Filter to writable providers (push or bidirectional) for the current project
  const writableProviders = useMemo(
    () => providers.filter((p) =>
      p.projectId === sessionConfig.projectId &&
      p.syncEnabled &&
      (p.syncDirection === 'push' || p.syncDirection === 'bidirectional')
    ),
    [providers, sessionConfig.projectId]
  )

  // Auto-select first writable provider
  const effectiveProviderId = publishToRemote
    ? (selectedProviderId ?? writableProviders[0]?.id ?? null)
    : null

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
        parentIssueId: parsed.parentIssueId ?? sessionConfig.parentIssueId,
        providerId: effectiveProviderId,
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
    [createIssue, sessionConfig, effectiveProviderId, t, modal]
  )

  const handleNavigateToIssue = useCallback(
    (issueId: string) => {
      selectIssue(issueId)
    },
    []
  )

  // ── Footer node: IssueConfirmationCard + optional remote publish toggle ──
  const footerNode = useMemo(() => {
    if (!creator.parsedIssue) return undefined
    return (
      <div>
        {/* Remote publish toggle — only shown when writable providers exist */}
        {writableProviders.length > 0 && (
          <div className="ml-4 mt-2 flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={publishToRemote}
                onChange={(e) => setPublishToRemote(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-[hsl(var(--border))] accent-[hsl(var(--primary))]"
              />
              <span>{t('aiCreator.publishToRemote', 'Publish to remote')}</span>
            </label>
            {publishToRemote && writableProviders.length > 1 && (
              <select
                value={selectedProviderId ?? writableProviders[0]?.id ?? ''}
                onChange={(e) => setSelectedProviderId(e.target.value)}
                className="text-xs px-1.5 py-0.5 rounded border border-[hsl(var(--border)/0.5)] bg-transparent"
              >
                {writableProviders.map((p) => (
                  <option key={p.id} value={p.id}>
                    {issueProviderPlatformLabel(p.platform)}: {issueProviderRepoLabel(p.platform, p.repoOwner, p.repoName)}
                  </option>
                ))}
              </select>
            )}
            {publishToRemote && writableProviders.length === 1 && (
              <span className="text-[10px] opacity-70">
                ({issueProviderPlatformLabel(writableProviders[0].platform)}: {issueProviderRepoLabel(writableProviders[0].platform, writableProviders[0].repoOwner, writableProviders[0].repoName)})
              </span>
            )}
          </div>
        )}
        <IssueConfirmationCard
          issue={creator.parsedIssue}
          onConfirm={handleConfirmIssue}
          onNavigate={handleNavigateToIssue}
          onEdit={handleEditIssue}
          createdIssue={createdIssueFromForm}
        />
      </div>
    )
  }, [creator.parsedIssue, handleConfirmIssue, handleNavigateToIssue, handleEditIssue, createdIssueFromForm, writableProviders, publishToRemote, selectedProviderId, t])

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
