// SPDX-License-Identifier: Apache-2.0

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Check, Tag, ImagePlus, Plus, Pencil, Trash2, ChevronDown } from 'lucide-react'
import { EditorContent } from '@tiptap/react'
import { useAppStore } from '../../stores/appStore'
import { useIssueStore } from '../../stores/issueStore'
import { selectIssue } from '../../actions/issueActions'
import { startSession } from '@/actions/commandActions'
import { ATTACHMENT_LIMITS } from '@shared/types'
import type { IssueStatus, IssuePriority, Issue, CreateIssueInput, ContextRef } from '@shared/types'
import { cn } from '../../lib/utils'
import { buildIssueSessionPrompt } from '../../lib/issueSessionUtils'
import { processImageFile, issueImagesToAttachments, attachmentsToIssueImages, type ImageAttachment } from '../../lib/attachmentUtils'
import { ProjectPicker } from '../ui/ProjectPicker'
import { PillDropdown, PILL_TRIGGER } from '../ui/PillDropdown'
import { IssueStatusIcon, IssuePriorityIcon } from '../IssuesView/IssueIcons'
import { ConfirmDialog } from '../ui/confirm-dialog'
import { Switch } from '../ui/switch'
import { createLogger } from '@/lib/logger'
import { toast } from '@/lib/toast'
import { useIssueDraftCache } from '../../hooks/useIssueDraftCache'
import { useNoteEditor } from '../../hooks/useNoteEditor'
import { ContextRefsPicker } from './ContextRefsPicker'
import { useExitAnimation, useModalAnimation } from '../../hooks/useModalAnimation'
import { ProjectScopeProvider } from '../../contexts/ProjectScopeContext'
import { ImageLightbox } from '../DetailPanel/ImageLightbox'
import { getAppAPI } from '@/windowAPI'

const log = createLogger('IssueForm')

/** localStorage key for persisting the "Continue creating" toggle preference. */
const CONTINUE_CREATING_KEY = 'issue-form:continue-creating'

// ─── Default values for pre-filling create mode ─────────────────────────

/** Pre-fill values for create mode (e.g. from AI issue creator). */
export interface IssueFormDefaultValues {
  title?: string
  description?: string
  status?: IssueStatus
  priority?: IssuePriority
  labels?: string[]
}

// ─── Props ──────────────────────────────────────────────────────────────

export interface IssueFormModalProps {
  /** Pass issueId to open in edit mode — the full issue is fetched internally. */
  issueId?: string
  defaultProjectId?: string | null
  parentIssueId?: string | null
  onClose: () => void
  /** Pre-fill values for create mode. Takes precedence over draft cache. */
  defaultValues?: IssueFormDefaultValues
  /** Called after a new issue is created (not called on edit-mode save). */
  onCreated?: (issue: Issue) => void
  /** Override z-index for nested modal scenarios (default: 50). */
  zIndex?: number
}

const STATUS_OPTIONS: { value: IssueStatus; labelKey: string }[] = [
  { value: 'backlog', labelKey: 'form.statusOptions.backlog' },
  { value: 'todo', labelKey: 'form.statusOptions.todo' },
  { value: 'in_progress', labelKey: 'form.statusOptions.inProgress' },
  { value: 'done', labelKey: 'form.statusOptions.done' },
  { value: 'cancelled', labelKey: 'form.statusOptions.cancelled' }
]

const PRIORITY_OPTIONS: { value: IssuePriority; labelKey: string; shortLabelKey: string }[] = [
  { value: 'urgent', labelKey: 'form.priorityOptions.urgent', shortLabelKey: 'priority.urgent' },
  { value: 'high', labelKey: 'form.priorityOptions.high', shortLabelKey: 'priority.high' },
  { value: 'medium', labelKey: 'form.priorityOptions.medium', shortLabelKey: 'priority.medium' },
  { value: 'low', labelKey: 'form.priorityOptions.low', shortLabelKey: 'priority.low' }
]

/**
 * Outer wrapper that owns data-fetching (edit mode) and `ProjectScopeProvider`.
 *
 * Responsibilities:
 *   1. Fetch full issue data when `issueId` is provided (edit mode).
 *   2. Gate `IssueFormContent` behind loading — the inner form only mounts
 *      once data is ready, so all `useState` initialisers receive the correct
 *      values on the first render.  This eliminates the need for a "populate"
 *      effect and the subtle bugs it caused (identity-unstable deps, stale
 *      closures, `eslint-disable`).
 *   3. Provide `ProjectScopeProvider` so the TipTap editor's slash command
 *      suggestions include project-scoped capabilities.
 */
export function IssueFormModal(props: IssueFormModalProps): React.JSX.Element {
  const projects = useAppStore((s) => s.projects)

  const [projectId, setProjectId] = useState<string | null>(
    props.defaultProjectId ?? null,
  )

  const projectPath = useMemo(
    () => (projectId ? projects.find((p) => p.id === projectId)?.path : undefined),
    [projectId, projects],
  )

  // --- Fetch full issue data for edit mode ---
  const [fetchedIssue, setFetchedIssue] = useState<Issue | null>(null)
  const [loadedIssueId, setLoadedIssueId] = useState<string | null>(null)
  const fetchRequestRef = useRef(0)
  const isLoading = !!props.issueId && loadedIssueId !== props.issueId

  useEffect(() => {
    if (!props.issueId) return
    const targetIssueId = props.issueId
    const requestId = ++fetchRequestRef.current

    getAppAPI()['get-issue'](targetIssueId)
      .then((result) => {
        if (requestId !== fetchRequestRef.current) return
        setFetchedIssue(result ?? null)
        // Batch projectId update so IssueFormContent mounts with the
        // correct value on the very first render.
        setProjectId(result?.projectId ?? props.defaultProjectId ?? null)
      })
      .catch((err) => {
        if (requestId !== fetchRequestRef.current) return
        log.error('Failed to fetch issue for edit', err)
        setFetchedIssue(null)
        setProjectId(props.defaultProjectId ?? null)
      })
      .finally(() => {
        if (requestId !== fetchRequestRef.current) return
        setLoadedIssueId(targetIssueId)
      })
  }, [props.issueId, props.defaultProjectId])

  return (
    <ProjectScopeProvider projectPath={projectPath} projectId={projectId ?? undefined}>
      {props.issueId && isLoading ? (
        <IssueFormLoadingOverlay onClose={props.onClose} zIndex={props.zIndex} />
      ) : (
        <IssueFormContent
          {...props}
          issue={props.issueId ? fetchedIssue : null}
          projectId={projectId}
          setProjectId={setProjectId}
        />
      )}
    </ProjectScopeProvider>
  )
}

// ─── Loading overlay ─────────────────────────────────────────────────────

/** Minimal overlay shown while fetching issue data for edit mode. */
function IssueFormLoadingOverlay({ onClose, zIndex }: { onClose: () => void; zIndex?: number }): React.JSX.Element {
  const { t } = useTranslation('issues')
  const { phase, requestClose } = useExitAnimation(onClose)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    dialogRef.current?.focus()
  }, [])

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 flex items-center justify-center overscroll-contain no-drag outline-none"
      style={{ zIndex: zIndex ?? 50 }}
      role="dialog"
      aria-modal="true"
      aria-label={t('form.loadingIssue')}
      tabIndex={-1}
      onKeyDown={(e) => { if (e.key === 'Escape') requestClose() }}
    >
      <div
        className={cn(
          'absolute inset-0 bg-black/50',
          phase === 'enter' && 'modal-overlay-enter',
          phase === 'exit' && 'modal-overlay-exit',
        )}
        onClick={requestClose}
        aria-hidden="true"
      />
      <div className={cn(
        'relative z-10 bg-[hsl(var(--background))] border border-[hsl(var(--border))] rounded-2xl shadow-lg w-full max-w-[720px] mx-4 flex items-center justify-center min-h-[520px]',
        phase === 'enter' && 'modal-content-enter',
        phase === 'exit' && 'modal-content-exit',
      )}>
        <div className="text-sm text-[hsl(var(--muted-foreground))] animate-pulse">
          {t('form.loadingIssue')}
        </div>
      </div>
    </div>
  )
}

// ─── Inner form ──────────────────────────────────────────────────────────

interface IssueFormContentProps extends IssueFormModalProps {
  /** Full issue data — non-null in edit mode (guaranteed by the loading gate). */
  issue: Issue | null
  projectId: string | null
  setProjectId: (id: string | null) => void
}

function IssueFormContent({
  issueId,
  defaultProjectId,
  parentIssueId: propParentIssueId,
  onClose,
  defaultValues,
  onCreated,
  zIndex,
  issue,
  projectId,
  setProjectId,
}: IssueFormContentProps): React.JSX.Element {
  const { t } = useTranslation('issues')
  const { t: tc } = useTranslation('common')
  const { phase, requestClose } = useExitAnimation(onClose)
  const dialogRef = useRef<HTMLDivElement>(null)
  const createIssue = useIssueStore((s) => s.createIssue)
  const updateIssue = useIssueStore((s) => s.updateIssue)
  const projects = useAppStore((s) => s.projects)
  const customLabels = useIssueStore((s) => s.customLabels)
  const createCustomLabel = useIssueStore((s) => s.createCustomLabel)
  const deleteCustomLabel = useIssueStore((s) => s.deleteCustomLabel)
  const updateCustomLabel = useIssueStore((s) => s.updateCustomLabel)

  const isEdit = !!issueId
  const isCreatingSubIssue = !isEdit && !!propParentIssueId
  // Snapshot read: parent title only needed when creating a sub-issue.
  // O(1) via normalized issueById instead of O(N) array scan.
  const parentIssueTitle = isCreatingSubIssue
    ? useIssueStore.getState().issueById[propParentIssueId!]?.title ?? null
    : null
  // Show "Start Session" toggle when creating, or editing an issue that has no session yet
  const showStartSessionToggle = !isEdit || !issue?.sessionId

  // --- Draft cache ---
  // Disabled when editing an existing issue or when pre-filled values are provided
  // (e.g. from AI issue creator), since draft restoration would overwrite them.
  const hasDefaultValues = !!defaultValues
  const validProjectIds = useMemo(() => projects.map((p) => p.id), [projects])
  const draftCache = useIssueDraftCache({
    disabled: isEdit || hasDefaultValues,
    parentIssueId: propParentIssueId,
    validProjectIds,
  })
  const draft = draftCache.initialState

  // --- Form state ---
  // Priority: issue (edit mode) > defaultValues (AI pre-fill) > draft cache.
  // In edit mode, `issue` is guaranteed non-null by the loading gate in
  // IssueFormModal, so all initialisers receive the correct values on the
  // very first render — no "populate" effect needed.
  const [title, setTitle] = useState(issue?.title ?? defaultValues?.title ?? draft.title)
  const descriptionEditor = useNoteEditor({
    placeholder: t('form.addDescription'),
    initialContent: issue
      ? (issue.richContent ?? issue.description ?? undefined)
      : (defaultValues?.description || draft.richContent || draft.description || undefined),
    onPasteFiles: (files) => addImages(files),
  })
  const {
    editor: descriptionEditorInstance,
    hasContent: descriptionHasContent,
    revision: descriptionRevision,
    getText: getDescriptionText,
    getJson: getDescriptionJson,
    clear: clearDescriptionEditor,
  } = descriptionEditor
  const [status, setStatus] = useState<IssueStatus>(issue?.status ?? defaultValues?.status ?? draft.status)
  const [priority, setPriority] = useState<IssuePriority>(issue?.priority ?? defaultValues?.priority ?? draft.priority)
  const [labels, setLabels] = useState<string[]>(issue?.labels ?? defaultValues?.labels ?? draft.labels)
  // projectId is lifted to the wrapper (IssueFormModal) for ProjectScopeProvider.
  // Sync from draft on mount when defaultProjectId is not explicitly provided.
  const hasSyncedDraftProject = useRef(false)
  useEffect(() => {
    if (hasSyncedDraftProject.current || isEdit) return
    hasSyncedDraftProject.current = true
    if (defaultProjectId === undefined && draft.projectId) {
      setProjectId(draft.projectId)
    }
  }, [isEdit, defaultProjectId, draft.projectId, setProjectId])
  const [pendingImages, setPendingImages] = useState<ImageAttachment[]>(
    issue?.images
      ? issueImagesToAttachments(issue.images)
      : draft.images.length > 0
        ? draft.images
        : []
  )
  const [previewImageId, setPreviewImageId] = useState<string | null>(null)
  const [autoStartSession, setAutoStartSession] = useState(draft.autoStartSession)
  const [contextRefs, setContextRefs] = useState<ContextRef[]>(issue?.contextRefs ?? [])
  const [saving, setSaving] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)

  // ── Continue-creating mode ────────────────────────────────────────────
  const [continueCreating, setContinueCreating] = useState(() => {
    if (isEdit) return false
    try { return localStorage.getItem(CONTINUE_CREATING_KEY) === 'true' } catch { return false }
  })
  const [createdCount, setCreatedCount] = useState(0)
  const titleRef = useRef<HTMLInputElement>(null)

  // Persist continue-creating preference
  useEffect(() => {
    if (isEdit) return
    try { localStorage.setItem(CONTINUE_CREATING_KEY, String(continueCreating)) } catch { /* noop */ }
  }, [continueCreating, isEdit])

  const [showNoProjectConfirm, setShowNoProjectConfirm] = useState(false)

  // ── Submit split-button dropdown ─────────────────────────────────────
  const [submitMenuOpen, setSubmitMenuOpen] = useState(false)
  const { mounted: submitMenuMounted, phase: submitMenuPhase } = useModalAnimation(submitMenuOpen)
  const submitMenuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!submitMenuOpen) return
    const handleClickOutside = (e: MouseEvent): void => {
      if (submitMenuRef.current && !submitMenuRef.current.contains(e.target as Node)) {
        setSubmitMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [submitMenuOpen])

  const [statusOpen, setStatusOpen] = useState(false)
  const [priorityOpen, setPriorityOpen] = useState(false)
  const [labelsOpen, setLabelsOpen] = useState(false)
  const [newLabelInput, setNewLabelInput] = useState('')
  const [isCreatingLabel, setIsCreatingLabel] = useState(false)
  const newLabelInputRef = useRef<HTMLInputElement>(null)
  const [editingLabel, setEditingLabel] = useState<string | null>(null)
  const [editLabelInput, setEditLabelInput] = useState('')
  const editLabelInputRef = useRef<HTMLInputElement>(null)
  const [deletingLabel, setDeletingLabel] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // --- Auto-save draft on field changes (create mode only) ---
  //
  // Event-driven debounce: expensive getText()/getJson() calls are deferred
  // to the timer callback (300ms after last change), never called synchronously
  // on keystroke. The `descriptionRevision` counter is an O(1) trigger signal
  // from useNoteEditor — it increments on every editor update without
  // performing any DOM traversal.
  //
  // Refs hold stable references to the getter functions so the effect's
  // dependency array stays minimal and doesn't re-fire on identity changes.
  const getDescriptionTextRef = useRef(getDescriptionText)
  getDescriptionTextRef.current = getDescriptionText
  const getDescriptionJsonRef = useRef(getDescriptionJson)
  getDescriptionJsonRef.current = getDescriptionJson
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (isEdit) return
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(() => {
      draftCache.saveDraft({
        title,
        description: getDescriptionTextRef.current(),
        richContent: getDescriptionJsonRef.current() || null,
        status, priority, labels,
        projectId, autoStartSession, images: pendingImages,
      })
    }, 300)
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    }
  }, [title, descriptionRevision, status, priority, labels, projectId, autoStartSession, pendingImages, isEdit, draftCache])

  // Unmount flush: ensure the latest draft is persisted even when the
  // modal closes before the 300ms debounce fires. Reads from refs only —
  // safe even if the TipTap editor is already being destroyed (the ref
  // captures the getter, which returns '' if the editor is gone).
  const draftCacheRef = useRef(draftCache)
  draftCacheRef.current = draftCache
  const isEditRef = useRef(isEdit)
  isEditRef.current = isEdit
  // Capture latest form field values via refs (updated on every render, zero cost)
  const formFieldsRef = useRef({
    title, status, priority, labels, projectId, autoStartSession, pendingImages,
  })
  formFieldsRef.current = {
    title, status, priority, labels, projectId, autoStartSession, pendingImages,
  }
  useEffect(() => {
    return () => {
      if (isEditRef.current) return
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
      const f = formFieldsRef.current
      draftCacheRef.current.saveDraft({
        title: f.title,
        description: getDescriptionTextRef.current(),
        richContent: getDescriptionJsonRef.current() || null,
        status: f.status, priority: f.priority, labels: f.labels,
        projectId: f.projectId, autoStartSession: f.autoStartSession,
        images: f.pendingImages,
      })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- intentional: reads from refs

  const toggleLabel = (label: string): void => {
    setLabels((prev) => (prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]))
  }

  // All available labels — sourced entirely from the custom_labels registry
  // (built-in labels are seeded there by migration 021).
  const allLabels = customLabels

  const handleCreateLabel = async (): Promise<void> => {
    const trimmed = newLabelInput.trim().toLowerCase()
    if (!trimmed) return
    // Don't create duplicate
    if (allLabels.includes(trimmed)) {
      // Just toggle it on and clear input
      if (!labels.includes(trimmed)) toggleLabel(trimmed)
      setNewLabelInput('')
      setIsCreatingLabel(false)
      return
    }
    await createCustomLabel(trimmed)
    // Auto-select the newly created label
    if (!labels.includes(trimmed)) toggleLabel(trimmed)
    setNewLabelInput('')
    setIsCreatingLabel(false)
  }

  const handleDeleteLabel = async (label: string): Promise<void> => {
    try {
      await deleteCustomLabel(label)
      // Remove from current form selection if selected
      setLabels((prev) => prev.filter((l) => l !== label))
    } catch (err) {
      log.error('Failed to delete label', err)
    } finally {
      setDeletingLabel(null)
    }
  }

  const handleEditLabel = async (): Promise<void> => {
    if (!editingLabel) return
    const trimmed = editLabelInput.trim().toLowerCase()
    if (!trimmed || trimmed === editingLabel) {
      setEditingLabel(null)
      setEditLabelInput('')
      return
    }
    try {
      await updateCustomLabel(editingLabel, trimmed)
      // Update the current form selection to use the new name
      setLabels((prev) => prev.map((l) => (l === editingLabel ? trimmed : l)))
    } catch (err) {
      log.error('Failed to update label', err)
    } finally {
      setEditingLabel(null)
      setEditLabelInput('')
    }
  }

  // --- Image handlers (reuse imageUtils) ---
  const addImages = useCallback(async (files: File[]) => {
    for (const file of files) {
      try {
        const processed = await processImageFile(file)
        setPendingImages((prev) => {
          if (prev.length >= ATTACHMENT_LIMITS.maxPerMessage) return prev
          return [...prev, processed]
        })
      } catch (err) {
        log.error('Image processing error', err)
      }
    }
  }, [])

  const removeImage = useCallback((id: string) => {
    setPendingImages((prev) => prev.filter((img) => img.id !== id))
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragOver(true)
    }
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragOver(false)
      const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'))
      if (files.length > 0) addImages(files)
    },
    [addImages]
  )

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? [])
      if (files.length > 0) addImages(files)
      if (fileInputRef.current) fileInputRef.current.value = ''
    },
    [addImages]
  )

  /** Fire-and-forget: start a session linked to the given issue. */
  const fireStartSession = (targetIssue: Issue): void => {
    buildIssueSessionPrompt(targetIssue, { projects, actionText: t('pleaseWorkOnIssue') })
      .then(({ prompt, projectPath }) =>
        startSession({
          prompt,
          origin: { source: 'issue', issueId: targetIssue.id },
          projectPath,
          projectId: targetIssue.projectId ?? undefined,
        })
      )
      .catch((err) => {
        log.error('Failed to auto-start session', err)
      })
  }

  const doSubmit = async (forceContinue = false): Promise<void> => {
    // Resolve startSession override (from split-button direct action) then reset
    const shouldAutoStart = startSessionOverrideRef.current ?? autoStartSession
    startSessionOverrideRef.current = null

    setSaving(true)
    try {
      const images = attachmentsToIssueImages(pendingImages)
      const richContent = getDescriptionJson() || undefined
      if (isEdit && issueId) {
        await updateIssue(issueId, {
          title: title.trim(),
          richContent,
          status,
          priority,
          labels,
          projectId,
          images,
          contextRefs,
        })
        // Auto-start session for edited issue that has no session yet
        if (shouldAutoStart) {
          // Re-fetch the updated issue for session prompt building
          const updatedIssue = await getAppAPI()['get-issue'](issueId)
          if (updatedIssue) fireStartSession(updatedIssue)
        }
        draftCache.clearDraft()
        requestClose()
      } else {
        const input: CreateIssueInput = {
          title: title.trim(),
          richContent,
          status,
          priority,
          labels,
          projectId,
          parentIssueId: propParentIssueId ?? null,
          images,
          contextRefs,
        }
        const newIssue = await createIssue(input)
        selectIssue(newIssue.id)
        onCreated?.(newIssue)

        // Start session if requested (independent of continue mode)
        if (shouldAutoStart) {
          fireStartSession(newIssue)
        }

        const shouldContinue = forceContinue || continueCreating

        if (shouldContinue) {
          // ── Continue-creating: reset form, keep context fields ──────────
          const createdTitle = title.trim()

          // Clear content fields
          setTitle('')
          clearDescriptionEditor()
          setPendingImages([])
          setContextRefs([])
          // Keep: project, status, priority, labels, parentIssueId
          setAutoStartSession(false)

          setCreatedCount((c) => c + 1)
          draftCache.clearDraft()

          // Toast feedback with "View" action
          toast(t('form.issueCreated', { title: createdTitle }), {
            action: {
              label: t('form.issueCreatedView'),
              onClick: () => selectIssue(newIssue.id),
            },
          })

          // Re-focus title input for next issue
          requestAnimationFrame(() => titleRef.current?.focus())
        } else {
          draftCache.clearDraft()
          requestClose()
        }
      }
    } finally {
      setSaving(false)
    }
  }

  /** Ref to track whether the current submission is a force-continue (⌘⇧↵). */
  const forceContinueRef = useRef(false)
  /** Ref to override autoStartSession on the current submission (split-button direct action). */
  const startSessionOverrideRef = useRef<boolean | null>(null)

  const handleSubmit = async (): Promise<void> => {
    if (!title.trim()) return
    const force = forceContinueRef.current
    forceContinueRef.current = false
    // When creating a new issue without a project, prompt confirmation
    if (!isEdit && projectId === null) {
      setShowNoProjectConfirm(true)
      return
    }
    await doSubmit(force)
  }

  const statusOpt = STATUS_OPTIONS.find((o) => o.value === status)
  const statusLabel = statusOpt ? t(statusOpt.labelKey) : status
  const priorityOpt = PRIORITY_OPTIONS.find((o) => o.value === priority)
  const priorityLabel = priorityOpt ? tc(priorityOpt.shortLabelKey) : priority
  const labelsLabel =
    labels.length === 0 ? t('form.changeLabels') : labels.length === 1 ? labels[0] : `${labels.length} labels`
  const previewImage = previewImageId
    ? pendingImages.find((img) => img.id === previewImageId) ?? null
    : null

  // ── ESC to close ──────────────────────────────────────────────────────
  // Uses React onKeyDown on the dialog container so that child components
  // (ConfirmDialog, ProjectPicker) can stopPropagation to handle ESC first.
  const handleDialogKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        requestClose()
      }
    },
    [requestClose]
  )

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 flex items-center justify-center overscroll-contain no-drag"
      style={{ zIndex: zIndex ?? 50 }}
      role="dialog"
      aria-modal="true"
      aria-label={isEdit ? t('form.editIssueAria') : isCreatingSubIssue ? t('form.createSubIssueAria') : t('form.createIssueAria')}
      onKeyDown={handleDialogKeyDown}
    >
      <div
        className={cn(
          'absolute inset-0 bg-black/50',
          phase === 'enter' && 'modal-overlay-enter',
          phase === 'exit' && 'modal-overlay-exit'
        )}
        onClick={requestClose}
        aria-hidden="true"
      />
      <div className={cn(
        'relative z-10 bg-[hsl(var(--background))] border border-[hsl(var(--border))] rounded-2xl shadow-lg w-full max-w-[720px] mx-4 flex flex-col min-h-[520px] max-h-[calc(100vh-2rem)] overflow-hidden',
        phase === 'enter' && 'modal-content-enter',
        phase === 'exit' && 'modal-content-exit'
      )}>
        {/* Header: ProjectPicker > New Issue */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[hsl(var(--border))]">
          <div className="flex items-center gap-1.5 min-w-0">
            <ProjectPicker
              value={projectId}
              onChange={setProjectId}
              placeholder="Project"
              ariaLabel="Select project"
              triggerClassName="rounded-full py-1 px-2.5 text-xs"
              position="below"
            />
            <span className="text-[hsl(var(--muted-foreground))] text-xs shrink-0">&rsaquo;</span>
            <span className="text-sm text-[hsl(var(--foreground))] font-medium truncate">
              {isEdit ? t('form.editIssue') : isCreatingSubIssue ? t('form.newSubIssue') : t('form.newIssue')}
            </span>
            {createdCount > 0 && !isEdit && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[hsl(var(--primary)/0.1)] text-[hsl(var(--primary))] tabular-nums">
                {t('form.createdCount', { count: createdCount })}
              </span>
            )}
          </div>
          <button
            onClick={requestClose}
            className="p-1 rounded-md text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors shrink-0"
            aria-label={tc('close')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content: borderless title + description + images */}
        <div
          className={cn(
            'flex-1 flex flex-col px-5 py-4 transition-colors overflow-y-auto min-h-0',
            isDragOver && 'bg-[hsl(var(--accent)/0.3)]'
          )}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* Parent issue hint for sub-issue creation */}
          {isCreatingSubIssue && parentIssueTitle && (
            <div className="flex items-center gap-1.5 mb-2 text-xs text-[hsl(var(--muted-foreground))]">
              <span>Parent:</span>
              <span className="font-medium text-[hsl(var(--foreground))] truncate">{parentIssueTitle}</span>
            </div>
          )}
          <input
            ref={titleRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                if (e.shiftKey && !isEdit) {
                  forceContinueRef.current = true
                }
                void handleSubmit()
              }
            }}
            placeholder={isCreatingSubIssue ? t('form.subIssueTitle') : t('form.issueTitle')}
            className="w-full text-lg font-medium bg-transparent border-none outline-none placeholder:text-[hsl(var(--muted-foreground))] text-[hsl(var(--foreground))]"
            autoFocus
          />
          <div
            className="w-full flex-1 mt-3 issue-desc-editor"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                // ⌘⇧↵ = force continue creating (ignores toggle state)
                if (e.shiftKey && !isEdit) {
                  forceContinueRef.current = true
                }
                void handleSubmit()
              }
            }}
          >
            <EditorContent editor={descriptionEditorInstance} />
          </div>

          {/* Context References — shown in both create and edit modes */}
          <div className="mt-3">
            <ContextRefsPicker value={contextRefs} onChange={setContextRefs} />
          </div>

          {/* Image previews */}
          {pendingImages.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3" role="list" aria-label={tc('attachedImages')}>
              {pendingImages.map((img) => (
                <div key={img.id} className="relative group shrink-0" role="listitem">
                  <button
                    type="button"
                    onClick={() => setPreviewImageId(img.id)}
                    className="h-16 w-16 rounded-lg border border-[hsl(var(--border))] overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                    aria-label={tc('attachedImagePreview')}
                  >
                    <img src={img.dataUrl} alt="" className="h-full w-full object-cover" />
                  </button>
                  <button
                    onClick={() => removeImage(img.id)}
                    className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))] opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                    aria-label={tc('removeImage')}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer: metadata pills + attach + submit */}
        <div className="flex items-center gap-2 px-5 py-3 border-t border-[hsl(var(--border))]">
          {/* Status pill */}
          <PillDropdown
            open={statusOpen}
            onOpenChange={setStatusOpen}
            trigger={
              <button
                onClick={() => setStatusOpen((prev) => !prev)}
                className={PILL_TRIGGER}
                aria-label={t('form.changeStatus')}
              >
                <IssueStatusIcon status={status} className="w-3.5 h-3.5" />
                {statusLabel}
              </button>
            }
          >
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => {
                  setStatus(opt.value)
                  setStatusOpen(false)
                }}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors',
                  status === opt.value
                    ? 'bg-[hsl(var(--primary)/0.08)]'
                    : 'hover:bg-[hsl(var(--foreground)/0.04)]'
                )}
              >
                <IssueStatusIcon status={opt.value} className="w-3.5 h-3.5" />
                <span className="flex-1">{t(opt.labelKey)}</span>
                {status === opt.value && <Check className="w-3 h-3" />}
              </button>
            ))}
          </PillDropdown>

          {/* Priority pill */}
          <PillDropdown
            open={priorityOpen}
            onOpenChange={setPriorityOpen}
            trigger={
              <button
                onClick={() => setPriorityOpen((prev) => !prev)}
                className={PILL_TRIGGER}
                aria-label={t('form.changePriority')}
              >
                <IssuePriorityIcon priority={priority} className="w-3.5 h-3.5" />
                {priorityLabel}
              </button>
            }
          >
            {PRIORITY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => {
                  setPriority(opt.value)
                  setPriorityOpen(false)
                }}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors',
                  priority === opt.value
                    ? 'bg-[hsl(var(--primary)/0.08)]'
                    : 'hover:bg-[hsl(var(--foreground)/0.04)]'
                )}
              >
                <IssuePriorityIcon priority={opt.value} className="w-3.5 h-3.5" />
                <span className="flex-1">{t(opt.labelKey)}</span>
                {priority === opt.value && <Check className="w-3 h-3" />}
              </button>
            ))}
          </PillDropdown>

          {/* Labels pill */}
          <PillDropdown
            open={labelsOpen}
            onOpenChange={(open) => {
              setLabelsOpen(open)
              if (!open) {
                setIsCreatingLabel(false)
                setNewLabelInput('')
                setEditingLabel(null)
                setEditLabelInput('')
                setDeletingLabel(null)
              }
            }}
            trigger={
              <button
                onClick={() => setLabelsOpen((prev) => !prev)}
                className={PILL_TRIGGER}
                aria-label={t('form.changeLabels')}
              >
                <Tag className="w-3.5 h-3.5" />
                {labelsLabel}
              </button>
            }
          >
            {allLabels.map((label) => (
              <div key={label} className="group/label relative">
                {deletingLabel === label ? (
                  /* ── Delete confirmation inline ── */
                  <div className="flex items-center gap-1 px-3 py-1 text-xs">
                    <span className="flex-1 text-[hsl(var(--destructive))] truncate">{t('form.deleteConfirm', { label })}</span>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); e.preventDefault(); void handleDeleteLabel(label) }}
                      onMouseDown={(e) => e.stopPropagation()}
                      className="p-1 rounded text-[hsl(var(--destructive))] hover:bg-[hsl(var(--destructive)/0.1)] transition-colors"
                      aria-label={t('form.confirmDelete')}
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); e.preventDefault(); setDeletingLabel(null) }}
                      onMouseDown={(e) => e.stopPropagation()}
                      className="p-1 rounded text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors"
                      aria-label={tc('cancel')}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : editingLabel === label ? (
                  /* ── Inline rename ── */
                  <div className="flex items-center gap-1 px-2 py-1">
                    <input
                      ref={editLabelInputRef}
                      type="text"
                      value={editLabelInput}
                      onChange={(e) => setEditLabelInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); void handleEditLabel() }
                        else if (e.key === 'Escape') { setEditingLabel(null); setEditLabelInput('') }
                      }}
                      onMouseDown={(e) => e.stopPropagation()}
                      className="flex-1 min-w-0 text-xs bg-transparent border border-[hsl(var(--border))] rounded px-1.5 py-1 outline-none focus:border-[hsl(var(--ring))] text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))]"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={handleEditLabel}
                      onMouseDown={(e) => e.stopPropagation()}
                      disabled={!editLabelInput.trim()}
                      className="p-1 rounded text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/0.08)] disabled:opacity-30 transition-colors"
                      aria-label={tc('save')}
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => { setEditingLabel(null); setEditLabelInput('') }}
                      onMouseDown={(e) => e.stopPropagation()}
                      className="p-1 rounded text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors"
                      aria-label={tc('cancel')}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  /* ── Normal label row ── */
                  <button
                    onClick={() => toggleLabel(label)}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors',
                      labels.includes(label)
                        ? 'bg-[hsl(var(--primary)/0.08)]'
                        : 'hover:bg-[hsl(var(--foreground)/0.04)]'
                    )}
                  >
                    <Check
                      className={cn(
                        'w-3 h-3 shrink-0',
                        labels.includes(label) ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    <span className="flex-1 truncate">{label}</span>
                    {/* Edit / Delete actions — visible on hover */}
                    <span className="flex items-center gap-0.5 opacity-0 group-hover/label:opacity-100 transition-opacity">
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={(e) => {
                          e.stopPropagation()
                          setEditingLabel(label)
                          setEditLabelInput(label)
                          setTimeout(() => editLabelInputRef.current?.focus(), 0)
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                        className="p-1 rounded text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.06)] transition-colors"
                        aria-label={t('form.editLabel')}
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={(e) => {
                          e.stopPropagation()
                          setDeletingLabel(label)
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                        className="p-1 rounded text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--destructive))] hover:bg-[hsl(var(--destructive)/0.08)] transition-colors"
                        aria-label={t('form.deleteLabel')}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </span>
                  </button>
                )}
              </div>
            ))}
            {/* Divider + Create new label */}
            <div className="border-t border-[hsl(var(--border))] mt-1 pt-1">
              {isCreatingLabel ? (
                <div className="flex items-center gap-1 px-2 py-1">
                  <input
                    ref={newLabelInputRef}
                    type="text"
                    value={newLabelInput}
                    onChange={(e) => setNewLabelInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void handleCreateLabel()
                      } else if (e.key === 'Escape') {
                        setIsCreatingLabel(false)
                        setNewLabelInput('')
                      }
                    }}
                    placeholder={t('form.labelName')}
                    className="flex-1 min-w-0 text-xs bg-transparent border border-[hsl(var(--border))] rounded px-1.5 py-1 outline-none focus:border-[hsl(var(--ring))] text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))]"
                    autoFocus
                  />
                  <button
                    onClick={handleCreateLabel}
                    disabled={!newLabelInput.trim()}
                    className="p-1 rounded text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/0.08)] disabled:opacity-30 transition-colors"
                    aria-label={t('form.confirmNewLabel')}
                  >
                    <Check className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => {
                      setIsCreatingLabel(false)
                      setNewLabelInput('')
                    }}
                    className="p-1 rounded text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors"
                    aria-label={t('form.cancelNewLabel')}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setIsCreatingLabel(true)
                    // Focus input after render
                    setTimeout(() => newLabelInputRef.current?.focus(), 0)
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors"
                >
                  <Plus className="w-3 h-3 shrink-0" />
                  <span>{t('form.createLabel')}</span>
                </button>
              )}
            </div>
          </PillDropdown>

          {/* Attach image button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={pendingImages.length >= ATTACHMENT_LIMITS.maxPerMessage}
            className={cn(
              PILL_TRIGGER,
              'disabled:opacity-30 disabled:cursor-not-allowed'
            )}
            aria-label={tc('attachImage')}
          >
            <ImagePlus className="w-3.5 h-3.5" />
            {tc('image')}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            multiple
            className="hidden"
            onChange={handleFileSelect}
            aria-hidden="true"
            tabIndex={-1}
          />

          <div className="flex-1 min-w-0" />

          {/* Right group: continue toggle + split submit button */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Continue creating toggle — only in create mode */}
            {!isEdit && (
              <label className="flex items-center gap-1 cursor-pointer select-none" title={t('form.continueCreatingAria')}>
                <span className="text-xs text-[hsl(var(--muted-foreground))] whitespace-nowrap">{t('form.continueCreating')}</span>
                <Switch
                  checked={continueCreating}
                  onChange={setContinueCreating}
                  size="sm"
                  label={t('form.continueCreatingAria')}
                />
              </label>
            )}

            {/* Split submit button — "Create Issue" with optional "& Start" dropdown */}
            {(() => {
              // Whether the split dropdown is available (Start Session option)
              const canSplit = showStartSessionToggle
              const buttonLabel = saving
                ? tc('saving')
                : isEdit
                  ? autoStartSession ? t('form.saveAndStart') : t('form.saveChanges')
                  : autoStartSession
                    ? t('form.createAndStart')
                    : isCreatingSubIssue ? t('form.createSubIssue') : t('form.createIssue')

              // The two options for the dropdown
              const defaultLabel = isEdit ? t('form.saveChanges') : isCreatingSubIssue ? t('form.createSubIssue') : t('form.createIssue')
              const startLabel = isEdit ? t('form.saveAndStart') : t('form.createAndStart')

              return (
                <div className="relative" ref={submitMenuRef}>
                  <div className="flex">
                    {/* Main action */}
                    <button
                      onClick={handleSubmit}
                      disabled={!title.trim() || saving}
                      className={cn(
                        'px-4 py-1.5 text-xs font-medium bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90 disabled:opacity-50 transition-opacity whitespace-nowrap',
                        canSplit ? 'rounded-l-lg' : 'rounded-lg'
                      )}
                    >
                      {buttonLabel}
                    </button>
                    {/* Dropdown chevron */}
                    {canSplit && (
                      <button
                        type="button"
                        onClick={() => setSubmitMenuOpen((prev) => !prev)}
                        disabled={!title.trim() || saving}
                        className="px-1.5 py-1.5 rounded-r-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90 disabled:opacity-50 transition-opacity border-l border-[hsl(var(--primary-foreground)/0.2)]"
                        aria-label={t('form.startSessionAfterSaving')}
                      >
                        <ChevronDown className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  {/* Dropdown menu — opens upward, items directly trigger submit */}
                  {submitMenuMounted && canSplit && (
                    <div className={cn(
                      "absolute bottom-full right-0 mb-1 py-1 min-w-[160px] bg-[hsl(var(--popover))] border border-[hsl(var(--border))] rounded-lg shadow-lg z-20",
                      submitMenuPhase === 'enter' && 'dropdown-enter',
                      submitMenuPhase === 'exit' && 'dropdown-exit',
                    )}>
                      <button
                        type="button"
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors hover:bg-[hsl(var(--foreground)/0.04)]"
                        onClick={() => {
                          setAutoStartSession(false)
                          setSubmitMenuOpen(false)
                          startSessionOverrideRef.current = false
                          void handleSubmit()
                        }}
                      >
                        <span>{defaultLabel}</span>
                      </button>
                      <button
                        type="button"
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors hover:bg-[hsl(var(--foreground)/0.04)]"
                        onClick={() => {
                          setAutoStartSession(true)
                          setSubmitMenuOpen(false)
                          startSessionOverrideRef.current = true
                          void handleSubmit()
                        }}
                      >
                        <span>{startLabel}</span>
                      </button>
                    </div>
                  )}
                </div>
              )
            })()}
          </div>
        </div>
      </div>

      {previewImage && (
        <ImageLightbox
          src={previewImage.dataUrl}
          alt={tc('attachedImagePreview')}
          onClose={() => setPreviewImageId(null)}
        />
      )}

      {/* Confirm dialog when no project is selected */}
      <ConfirmDialog
        open={showNoProjectConfirm}
        title={t('form.noProjectSelected')}
        message={t('form.noProjectMessage')}
        confirmLabel={t('form.createAnyway')}
        cancelLabel={tc('goBack')}
        variant="default"
        onConfirm={() => {
          setShowNoProjectConfirm(false)
          void doSubmit(forceContinueRef.current)
        }}
        onCancel={() => setShowNoProjectConfirm(false)}
      />
    </div>
  )
}
