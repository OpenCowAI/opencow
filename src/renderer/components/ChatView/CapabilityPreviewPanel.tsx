// SPDX-License-Identifier: Apache-2.0

/**
 * CapabilityPreviewPanel — Right-side panel for previewing and editing an
 * AI-generated capability (skill, agent, command, rule) before saving.
 *
 * Slides in when the AI produces a `xxx-output` code fence. The user can
 * review/edit name, description, body (+ type-specific fields), choose scope, and save.
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Globe, FolderOpen, Check, Upload, AlertTriangle } from 'lucide-react'
import { CodeEditor } from '@/components/ui/code-editor'
import { ProjectPicker } from '@/components/ui/ProjectPicker'
import { useAppStore, selectProjectId } from '@/stores/appStore'
import { useCapabilitySave } from '@/hooks/useCapabilitySave'
import { buildSaveParams } from '@/lib/capabilityFormHelpers'
import { validateCapabilityName } from '@shared/capabilityValidation'
import { cn } from '@/lib/utils'
import type { ParsedCapabilityOutput } from '@shared/capabilityOutputParser'
import type { AICreatableCategory, ManagedCapabilityIdentifier } from '@shared/types'

// ── Model options (for Agent) ──────────────────────────────────────────

const MODEL_OPTIONS = [
  { value: '', i18nKey: 'capabilityCreator.preview.modelDefault' },
  { value: 'sonnet', i18nKey: 'capabilityCreator.preview.modelSonnet' },
  { value: 'opus', i18nKey: 'capabilityCreator.preview.modelOpus' },
  { value: 'haiku', i18nKey: 'capabilityCreator.preview.modelHaiku' }
] as const

// ── Props ────────────────────────────────────────────────────────────

interface CapabilityPreviewPanelProps {
  category: AICreatableCategory
  parsedOutput: ParsedCapabilityOutput
  /** Whether the AI is currently generating (streaming). */
  isProcessing?: boolean
  onSaved: (identifier: ManagedCapabilityIdentifier) => void
  onClose: () => void
}

// ── Component ────────────────────────────────────────────────────────

export function CapabilityPreviewPanel({
  category,
  parsedOutput,
  isProcessing,
  onSaved,
  onClose
}: CapabilityPreviewPanelProps): React.JSX.Element {
  const { t } = useTranslation('sessions')
  const projects = useAppStore((s) => s.projects)
  const storeProjectId = useAppStore(selectProjectId)

  // ── Editable fields (initialized from parsed output) ─────────────

  const [name, setName] = useState(parsedOutput.name)
  const [description, setDescription] = useState(parsedOutput.description)
  const [body, setBody] = useState(parsedOutput.body)
  const [nameError, setNameError] = useState<string | null>(null)

  // Agent-specific
  const [model, setModel] = useState(parsedOutput.model ?? '')
  const [color, setColor] = useState(parsedOutput.color ?? '#8B5CF6')

  // Command-specific
  const [argumentHint, setArgumentHint] = useState(parsedOutput.argumentHint ?? '')

  // ── Scope picker ────────────────────────────────────────────────

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    () => storeProjectId ?? projects[0]?.id ?? null
  )
  const scope: 'global' | 'project' = selectedProjectId ? 'project' : 'global'

  // ── Update fields when AI produces a new version ─────────────────

  useEffect(() => {
    setName(parsedOutput.name)
    setDescription(parsedOutput.description)
    setBody(parsedOutput.body)
    setNameError(null)
    if (parsedOutput.model !== undefined) setModel(parsedOutput.model)
    if (parsedOutput.color !== undefined) setColor(parsedOutput.color)
    if (parsedOutput.argumentHint !== undefined) setArgumentHint(parsedOutput.argumentHint)
  }, [parsedOutput])

  // ── Save ────────────────────────────────────────────────────────

  const { save, saving, error: saveError } = useCapabilitySave()
  const [saved, setSaved] = useState(false)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clean up timer on unmount to prevent setState-on-unmounted
  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    }
  }, [])

  const handleSave = useCallback(async () => {
    const error = validateCapabilityName(name)
    if (error) {
      setNameError(error)
      return
    }
    setNameError(null)

    // Build form data based on category
    let formData: Record<string, string>
    switch (category) {
      case 'agent':
        formData = { description, model, color, body }
        break
      case 'command':
        formData = { description, argumentHint, body }
        break
      default:
        // skill, rule
        formData = { description, body }
    }

    const params = buildSaveParams(
      category,
      scope,
      name.trim(),
      selectedProjectId ?? undefined,
      formData
    )
    const result = await save(params)
    if (result.success) {
      setSaved(true)
      savedTimerRef.current = setTimeout(() => {
        savedTimerRef.current = null
        onSaved({
          category,
          name: name.trim(),
          scope,
          filePath: result.filePath,
          projectId: selectedProjectId ?? undefined
        })
      }, 600) // brief pause so user sees the success state
    }
  }, [
    name,
    category,
    scope,
    selectedProjectId,
    description,
    body,
    model,
    color,
    argumentHint,
    save,
    onSaved
  ])

  // ── Title based on category ──────────────────────────────────────

  const previewTitle = t(`capabilityCreator.preview.title`, {
    defaultValue: t(`capabilityCreator.categories.${category}`, category)
  })

  // ── Render ──────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full border-l border-[hsl(var(--border)/0.4)] bg-[hsl(var(--background))]">
      {/* Header */}
      <div className="flex items-center justify-between h-11 px-4 border-b border-[hsl(var(--border)/0.4)] shrink-0">
        <h3 className="text-sm font-medium text-[hsl(var(--foreground))]">{previewTitle}</h3>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-md hover:bg-[hsl(var(--foreground)/0.04)] transition-colors"
          aria-label="Close preview"
        >
          <X className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4">
        {/* Error */}
        {(nameError || saveError) && (
          <p className="text-xs text-red-500" role="alert">
            {nameError || saveError}
          </p>
        )}

        {/* Name */}
        <FieldGroup label={t('capabilityCreator.preview.name', 'Name')} htmlFor="cap-preview-name">
          <input
            id="cap-preview-name"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setNameError(null)
              setSaved(false)
            }}
            placeholder="kebab-case-name"
            autoComplete="off"
            spellCheck={false}
            className={cn(fieldInputClass, nameError && 'border-red-500/50')}
          />
        </FieldGroup>

        {/* Description */}
        <FieldGroup
          label={t('capabilityCreator.preview.description', 'Description')}
          htmlFor="cap-preview-desc"
        >
          <textarea
            id="cap-preview-desc"
            value={description}
            onChange={(e) => {
              setDescription(e.target.value)
              setSaved(false)
            }}
            rows={3}
            placeholder="What this does…"
            className={cn(fieldInputClass, 'resize-none')}
          />
        </FieldGroup>

        {/* ── Agent-specific: Model ── */}
        {category === 'agent' && (
          <FieldGroup
            label={t('capabilityCreator.preview.model', 'Model')}
            htmlFor="cap-preview-model"
          >
            <select
              id="cap-preview-model"
              value={model}
              onChange={(e) => {
                setModel(e.target.value)
                setSaved(false)
              }}
              className={fieldInputClass}
            >
              {MODEL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t(opt.i18nKey)}
                </option>
              ))}
            </select>
          </FieldGroup>
        )}

        {/* ── Agent-specific: Color ── */}
        {category === 'agent' && (
          <FieldGroup
            label={t('capabilityCreator.preview.color', 'Color')}
            htmlFor="cap-preview-color"
          >
            <div className="flex items-center gap-2">
              <input
                id="cap-preview-color"
                type="color"
                value={color}
                onChange={(e) => {
                  setColor(e.target.value)
                  setSaved(false)
                }}
                className="h-8 w-8 rounded-lg border border-[hsl(var(--border)/0.5)] cursor-pointer bg-transparent"
              />
              <input
                type="text"
                value={color}
                onChange={(e) => {
                  setColor(e.target.value)
                  setSaved(false)
                }}
                placeholder="#8B5CF6"
                className={cn(fieldInputClass, 'flex-1')}
              />
            </div>
          </FieldGroup>
        )}

        {/* ── Command-specific: Argument Hint ── */}
        {category === 'command' && (
          <FieldGroup
            label={t('capabilityCreator.preview.argumentHint', 'Argument Hint')}
            htmlFor="cap-preview-arghint"
          >
            <input
              id="cap-preview-arghint"
              type="text"
              value={argumentHint}
              onChange={(e) => {
                setArgumentHint(e.target.value)
                setSaved(false)
              }}
              placeholder="<file> [--verbose]"
              autoComplete="off"
              spellCheck={false}
              className={fieldInputClass}
            />
          </FieldGroup>
        )}

        {/* Truncation warning — shown when AI output was incomplete and no longer streaming */}
        {parsedOutput.isPartial && !isProcessing && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-600 dark:text-amber-400">
              {t(
                'capabilityCreator.preview.truncationWarning',
                'Content may be incomplete — the AI output appears to have been truncated. You can ask the AI to continue or regenerate.'
              )}
            </p>
          </div>
        )}

        {/* Body (CodeEditor) */}
        <FieldGroup label={t('capabilityCreator.preview.body', 'Body')}>
          <div className="h-[280px] rounded-lg border border-[hsl(var(--border)/0.5)] overflow-hidden">
            <CodeEditor
              value={body}
              language="markdown"
              onChange={(v) => {
                setBody(v)
                setSaved(false)
              }}
              label="Capability body editor"
            />
          </div>
        </FieldGroup>

        {/* Scope */}
        <FieldGroup label={t('capabilityCreator.preview.scope', 'Save to')}>
          <div className="flex items-center gap-2">
            <ProjectPicker
              value={selectedProjectId}
              onChange={setSelectedProjectId}
              placeholder={t('capabilityCenter.scopeGlobal')}
              ariaLabel={t('capabilityCreator.preview.scope', 'Save to')}
              triggerClassName="rounded-lg py-1.5 px-3 text-xs border border-[hsl(var(--border)/0.5)] bg-[hsl(var(--foreground)/0.02)] hover:border-[hsl(var(--border)/0.8)] transition-colors"
              position="below"
            />
            <span className="text-[10px] text-[hsl(var(--muted-foreground)/0.35)] flex items-center gap-1">
              {scope === 'global' ? (
                <>
                  <Globe className="h-3 w-3" />
                  {t('capabilityCenter.scopeHintGlobal', 'Available in all projects')}
                </>
              ) : (
                <>
                  <FolderOpen className="h-3 w-3" />
                  {t('capabilityCenter.scopeHintProject', 'Only in this project')}
                </>
              )}
            </span>
          </div>
        </FieldGroup>
      </div>

      {/* Footer actions */}
      <div className="px-4 py-3 border-t border-[hsl(var(--border)/0.4)] shrink-0">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || saved}
          className={cn(
            'w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all',
            saved
              ? 'bg-green-500/10 text-green-600 border border-green-500/20'
              : 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]'
          )}
        >
          {saved ? (
            <>
              <Check className="h-4 w-4" />
              {t('capabilityCreator.preview.saved', 'Saved!')}
            </>
          ) : saving ? (
            t('capabilityCreator.preview.saving', 'Saving…')
          ) : (
            <>
              <Upload className="h-4 w-4" />
              {t('capabilityCreator.preview.save', 'Save')}
            </>
          )}
        </button>
      </div>
    </div>
  )
}

// ── Shared field group ────────────────────────────────────────────────

const fieldInputClass =
  'w-full px-3 py-1.5 text-sm rounded-lg border transition-colors bg-[hsl(var(--foreground)/0.02)] border-[hsl(var(--border)/0.5)] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))] focus:border-transparent'

function FieldGroup({
  label,
  htmlFor,
  children
}: {
  label: string
  htmlFor?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="space-y-1">
      <label
        htmlFor={htmlFor}
        className="block text-[11px] font-medium text-[hsl(var(--muted-foreground)/0.6)]"
      >
        {label}
      </label>
      {children}
    </div>
  )
}
