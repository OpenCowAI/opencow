// SPDX-License-Identifier: Apache-2.0

import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderOpen, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Dialog } from '../ui/Dialog'
import { getAppAPI } from '@/windowAPI'
import { useAppStore } from '@/stores/appStore'

// ─── Types ───────────────────────────────────────────────────────────────────

interface CreateProjectDialogProps {
  open: boolean
  onClose: () => void
}

type Phase = 'idle' | 'creating'

interface FormState {
  parentPath: string
  name: string
}

// ─── Validation ──────────────────────────────────────────────────────────────

/** Characters that are forbidden in directory names across platforms. */
// eslint-disable-next-line no-control-regex -- intentional: reject NUL and C0 control chars in filenames
const INVALID_NAME_PATTERN = /[/\\<>:"|?*\x00-\x1f]/

function validateProjectName(name: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) return null // empty is not an error (just disables submit)
  if (INVALID_NAME_PATTERN.test(trimmed)) return 'createProject.invalidChars'
  if (trimmed.length > 255) return 'createProject.nameTooLong'
  if (trimmed.startsWith('.')) return 'createProject.dotPrefix'
  return null
}

/** Build a display path by joining parent and name with the platform separator. */
function buildPreviewPath(parentPath: string, name: string): string | null {
  if (!parentPath || !name) return null
  // Use the separator found in the parent path (Windows: \, POSIX: /)
  const sep = parentPath.includes('\\') ? '\\' : '/'
  const base = parentPath.endsWith(sep) ? parentPath.slice(0, -1) : parentPath
  return `${base}${sep}${name}`
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Dialog for creating a new project by creating a fresh directory on disk.
 *
 * The user selects a parent directory (via native OS picker) and enters a
 * project name.  On submit, the backend creates the directory and registers
 * it as a project.
 *
 * Uses a native `<form>` element so that Enter-to-submit only fires from
 * text inputs (not from the Browse button or other non-submit controls).
 */
export function CreateProjectDialog({
  open,
  onClose,
}: CreateProjectDialogProps): React.JSX.Element | null {
  const { t } = useTranslation('navigation')
  const createNewProject = useAppStore((s) => s.createNewProject)

  const [form, setForm] = useState<FormState>({ parentPath: '', name: '' })
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (open) {
      setForm({ parentPath: '', name: '' })
      setPhase('idle')
      setError(null)
      // Auto-focus the name input after mount
      requestAnimationFrame(() => nameInputRef.current?.focus())
    }
  }, [open])

  // ── Parent directory picker ─────────────────────────────────────────────

  const handleBrowseParent = useCallback(async () => {
    const selected = await getAppAPI()['select-directory']()
    if (selected) {
      setForm((prev) => ({ ...prev, parentPath: selected }))
      setError(null)
      // Focus the name input after selecting a directory
      requestAnimationFrame(() => nameInputRef.current?.focus())
    }
  }, [])

  // ── Form handlers ───────────────────────────────────────────────────────

  const handleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, name: e.target.value }))
    setError(null)
  }, [])

  // ── Derived state ───────────────────────────────────────────────────────

  const trimmedName = form.name.trim()
  const nameError = validateProjectName(form.name)
  const previewPath = buildPreviewPath(form.parentPath, trimmedName)
  const canSubmit =
    phase === 'idle' &&
    form.parentPath.length > 0 &&
    trimmedName.length > 0 &&
    nameError === null

  // ── Submit (via <form onSubmit>) ────────────────────────────────────────

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return

    setPhase('creating')
    setError(null)

    try {
      await createNewProject({ parentPath: form.parentPath, name: trimmedName })
      onClose()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      setPhase('idle')
    }
  }, [canSubmit, form.parentPath, trimmedName, createNewProject, onClose])

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('createProject.title', 'New Project')}
      size="sm"
    >
      <form className="p-6" onSubmit={(e) => void handleSubmit(e)}>
        {/* Header */}
        <h2 className="text-base font-semibold mb-1">
          {t('createProject.title', 'New Project')}
        </h2>
        <p className="text-sm text-[hsl(var(--muted-foreground))] mb-5">
          {t('createProject.description', 'Create a new directory as a project.')}
        </p>

        {/* Form fields */}
        <div className="space-y-4 mb-5">
          {/* Location field */}
          <div>
            <label className="text-xs font-medium text-[hsl(var(--muted-foreground))] mb-1.5 block">
              {t('createProject.location', 'Location')}
            </label>
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  'flex-1 min-w-0 px-3 py-2 rounded-lg border text-sm truncate',
                  'border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.3)]',
                  form.parentPath
                    ? 'text-[hsl(var(--foreground))]'
                    : 'text-[hsl(var(--muted-foreground)/0.5)]',
                )}
              >
                {form.parentPath || t('createProject.locationPlaceholder', 'Select parent directory…')}
              </div>
              <button
                type="button"
                onClick={() => void handleBrowseParent()}
                className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[hsl(var(--border))] text-sm hover:bg-[hsl(var(--foreground)/0.04)] transition-colors"
              >
                <FolderOpen className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
                <span>{t('createProject.browse', 'Browse')}</span>
              </button>
            </div>
          </div>

          {/* Project name field */}
          <div>
            <label
              htmlFor="create-project-name"
              className="text-xs font-medium text-[hsl(var(--muted-foreground))] mb-1.5 block"
            >
              {t('createProject.name', 'Project name')}
            </label>
            <input
              ref={nameInputRef}
              id="create-project-name"
              type="text"
              value={form.name}
              onChange={handleNameChange}
              placeholder={t('createProject.namePlaceholder', 'my-project')}
              autoComplete="off"
              spellCheck={false}
              className={cn(
                'w-full px-3 py-2 rounded-lg border text-sm outline-none transition-colors',
                'bg-[hsl(var(--muted)/0.3)] placeholder:text-[hsl(var(--muted-foreground)/0.4)]',
                nameError
                  ? 'border-[hsl(var(--destructive)/0.5)] focus:border-[hsl(var(--destructive))]'
                  : 'border-[hsl(var(--border))] focus:border-[hsl(var(--primary)/0.5)]',
              )}
            />
            {nameError && (
              <p className="mt-1 text-xs text-[hsl(var(--destructive))]">
                {t(nameError)}
              </p>
            )}
          </div>

          {/* Path preview */}
          {previewPath && (
            <div className="rounded-lg bg-[hsl(var(--muted)/0.3)] border border-[hsl(var(--border)/0.5)] px-3 py-2">
              <p className="text-[10px] font-medium text-[hsl(var(--muted-foreground))] mb-0.5">
                {t('createProject.pathPreview', 'Will create')}
              </p>
              <p className="text-xs text-[hsl(var(--foreground)/0.8)] font-mono truncate">
                {previewPath}
              </p>
            </div>
          )}
        </div>

        {/* Error message */}
        {error && (
          <div className="mb-4 rounded-lg bg-[hsl(var(--destructive)/0.08)] border border-[hsl(var(--destructive)/0.2)] px-3 py-2">
            <p className="text-xs text-[hsl(var(--destructive))]">{error}</p>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={phase === 'creating'}
            className="px-3 py-1.5 text-sm rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors disabled:opacity-50"
          >
            {t('createProject.cancel', 'Cancel')}
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="px-4 py-1.5 rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] font-medium text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {phase === 'creating' ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                {t('createProject.creating', 'Creating…')}
              </span>
            ) : (
              t('createProject.create', 'Create')
            )}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
