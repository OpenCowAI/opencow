// SPDX-License-Identifier: Apache-2.0

/**
 * IssueConfirmationCard — In-conversation preview card for AI-generated issues.
 *
 * A read-only preview of the parsed issue output within the chat flow.
 * Supports a 4-state lifecycle:
 *   - preview:   Read-only display with Create / Edit / Discard actions
 *   - creating:  API call in flight (spinner, disabled actions)
 *   - created:   Success state (green check, "View" link)
 *   - discarded: Collapsed strike-through state
 *
 * Editing is delegated to `IssueFormModal` (opened by the parent via `onEdit`),
 * ensuring full feature parity with the standard issue creation flow.
 *
 * @module
 */

import { useState, useCallback, memo } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Loader2, Pencil, Trash2, ExternalLink } from 'lucide-react'
import { IssueStatusIcon, IssuePriorityIcon } from '../IssuesView/IssueIcons'
import { ISSUE_STATUS_THEME, ISSUE_PRIORITY_THEME } from '../../constants/issueStatus'
import { cn } from '@/lib/utils'
import type { Issue } from '@shared/types'
import type { ParsedIssueOutput } from '@shared/issueOutputParser'

// ─── Types ───────────────────────────────────────────────────────────────────

type CardState = 'preview' | 'creating' | 'created' | 'discarded'

export interface IssueConfirmationCardProps {
  /** The AI-parsed issue data */
  issue: ParsedIssueOutput
  /** Called when user confirms creation. Returns the created Issue. */
  onConfirm: (issue: ParsedIssueOutput) => Promise<Issue>
  /** Called when user discards the issue */
  onDiscard?: () => void
  /** Called after successful creation to navigate to the issue */
  onNavigate?: (issueId: string) => void
  /** Called when user wants to edit — parent opens IssueFormModal. */
  onEdit?: (issue: ParsedIssueOutput) => void
  /**
   * Externally-created issue reference.
   *
   * Keep this as a minimal ref model (id only) so callers can restore created
   * state without fabricating full Issue entities.
   */
  createdIssueRef?: { id: string } | null
  /** Optional container class override for placement differences across contexts. */
  className?: string
}

// ─── Component ──────────────────────────────────────────────────────────────

export const IssueConfirmationCard = memo(function IssueConfirmationCard({
  issue,
  onConfirm,
  onDiscard,
  onNavigate,
  onEdit,
  createdIssueRef: externalCreatedIssueRef,
  className,
}: IssueConfirmationCardProps): React.JSX.Element {
  const { t } = useTranslation('issues')

  const [cardState, setCardState] = useState<CardState>('preview')
  const [internalCreatedIssueId, setInternalCreatedIssueId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Merge internal + external created refs (external comes from parent-managed flows).
  const createdIssueId = externalCreatedIssueRef?.id ?? internalCreatedIssueId
  const isCreated = cardState === 'created' || !!createdIssueId
  const isCreating = cardState === 'creating'
  const isDiscarded = cardState === 'discarded'

  // ── Actions ────────────────────────────────────────────────────

  const handleConfirm = useCallback(async () => {
    setCardState('creating')
    setError(null)
    try {
      const created = await onConfirm(issue)
      setInternalCreatedIssueId(created.id)
      setCardState('created')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('aiCreator.card.createFailed'))
      setCardState('preview')
    }
  }, [issue, onConfirm, t])

  const handleDiscard = useCallback(() => {
    setCardState('discarded')
    onDiscard?.()
  }, [onDiscard])

  const handleEdit = useCallback(() => {
    onEdit?.(issue)
  }, [onEdit, issue])

  // ── Derived ────────────────────────────────────────────────────

  const statusTheme = ISSUE_STATUS_THEME[issue.status] ?? ISSUE_STATUS_THEME.backlog
  const priorityTheme = ISSUE_PRIORITY_THEME[issue.priority] ?? ISSUE_PRIORITY_THEME.medium

  // ── Render: Discarded ──────────────────────────────────────────

  if (isDiscarded) {
    return (
      <div className={cn('ml-4 mt-2 max-w-md rounded-xl border border-[hsl(var(--border)/0.3)] bg-[hsl(var(--card)/0.5)] p-3 opacity-50', className)}>
        <span className="text-xs text-[hsl(var(--muted-foreground))] line-through">
          {issue.title}
        </span>
        <span className="ml-2 text-[10px] text-[hsl(var(--muted-foreground)/0.5)] italic">
          {t('aiCreator.card.discarded')}
        </span>
      </div>
    )
  }

  // ── Render: Main card ──────────────────────────────────────────

  return (
    <div
      className={cn(
        'ml-4 mt-2 max-w-md rounded-xl border overflow-hidden transition-colors',
        isCreated
          ? 'border-green-500/30 bg-[hsl(var(--card))]'
          : 'border-[hsl(var(--border)/0.5)] bg-[hsl(var(--card))]',
        className,
      )}
      role="region"
      aria-label={t('aiCreator.card.confirmationAria')}
    >
      {/* ── Status + Priority row ────────────────────────────── */}
      <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
        <div className="flex items-center gap-1.5">
          <IssueStatusIcon status={issue.status} className="w-3.5 h-3.5" />
          <span className="text-xs text-[hsl(var(--muted-foreground))]">
            {statusTheme.label}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <IssuePriorityIcon priority={issue.priority} className="w-3 h-3" />
          <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
            {priorityTheme.label}
          </span>
        </div>
      </div>

      {/* ── Title ────────────────────────────────────────────── */}
      <div className="px-3 pb-1.5">
        <h4 className={cn(
          'text-sm font-medium truncate',
          isCreated
            ? 'text-green-600 dark:text-green-400'
            : 'text-[hsl(var(--foreground))]'
        )}>
          {isCreated && <Check className="w-3.5 h-3.5 inline mr-1" aria-hidden />}
          {issue.title}
        </h4>
      </div>

      {/* ── Labels ───────────────────────────────────────────── */}
      {issue.labels.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 px-3 pb-2">
          {issue.labels.map((label) => (
            <span
              key={label}
              className="px-1.5 py-0.5 text-[10px] rounded-full bg-[hsl(var(--muted)/0.6)] text-[hsl(var(--muted-foreground))]"
            >
              {label}
            </span>
          ))}
        </div>
      )}

      {/* ── Description preview ──────────────────────────────── */}
      {issue.description && (
        <div className="relative border-t border-[hsl(var(--border)/0.3)]">
          <div className="px-3 py-2 max-h-20 overflow-hidden text-xs text-[hsl(var(--muted-foreground))] leading-relaxed whitespace-pre-wrap">
            {issue.description}
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-6 pointer-events-none bg-gradient-to-t from-[hsl(var(--card))] to-transparent" />
        </div>
      )}

      {/* ── Error message ────────────────────────────────────── */}
      {error && (
        <div className="px-3 py-1.5 text-xs text-red-500 border-t border-[hsl(var(--border)/0.3)]">
          {error}
        </div>
      )}

      {/* ── Actions footer ───────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-[hsl(var(--border)/0.3)]">
        {/* Left: Edit / View */}
        <div>
          {isCreated ? (
            <button
              onClick={() => createdIssueId && onNavigate?.(createdIssueId)}
              className="inline-flex items-center gap-1 text-[11px] text-[hsl(var(--primary))] hover:underline"
            >
              <ExternalLink className="w-3 h-3" aria-hidden />
              {t('aiCreator.card.view')}
            </button>
          ) : (
            <button
              onClick={handleEdit}
              disabled={isCreating || !onEdit}
              className="inline-flex items-center gap-1 text-[11px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Pencil className="w-3 h-3" aria-hidden />
              {t('aiCreator.card.editFields')}
            </button>
          )}
        </div>

        {/* Right: Discard + Create */}
        {!isCreated && (
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleDiscard}
              disabled={isCreating}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--foreground)/0.04)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              aria-label={t('aiCreator.card.discardAria')}
            >
              <Trash2 className="w-3 h-3" aria-hidden />
              {t('aiCreator.card.discard')}
            </button>
            <button
              onClick={handleConfirm}
              disabled={isCreating || !issue.title.trim()}
              className="inline-flex items-center gap-1 px-3 py-1 text-[11px] font-medium rounded-md bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
              aria-label={t('aiCreator.card.createAria')}
            >
              {isCreating ? (
                <Loader2 className="w-3 h-3 motion-safe:animate-spin" aria-hidden />
              ) : (
                <Check className="w-3 h-3" aria-hidden />
              )}
              {isCreating ? t('aiCreator.card.creating') : t('aiCreator.card.create')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
})
