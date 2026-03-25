// SPDX-License-Identifier: Apache-2.0

/**
 * InlineCapabilityEdit — Full-width inline edit/create view for a managed capability.
 *
 * Replaces the narrow sidebar CapabilityEditView + CapabilityCreateModal with
 * a Linear-style in-page experience:
 *   - Breadcrumb navigation bar (back + category + name/title)
 *   - Full-width form using variant='inline'
 *   - Scope & project selector (create mode)
 *   - Unsaved-changes guard with ConfirmDialog
 */

import { useState, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ChevronRight, Globe, FolderOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore, selectProjectId } from '@/stores/appStore'
import { useCapabilitySave } from '@/hooks/useCapabilitySave'
import { useCapabilitySnapshot } from '@/hooks/useCapabilitySnapshot'
import { resolveCapability } from '@/lib/capabilityAdapter'
import {
  buildFormMode,
  buildSaveParams,
  resolveTemplateOptions,
  buildTemplateFormMode,
} from '@/lib/capabilityFormHelpers'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { ProjectPicker } from '@/components/ui/ProjectPicker'
import { CATEGORY_MAP } from './categoryRegistry'
import { MCPTemplateSelector } from './MCPTemplateSelector'
import { MCPTemplateOptions } from './MCPTemplateOptions'
import { CommandForm } from '../DetailPanel/forms/CommandForm'
import { AgentForm } from '../DetailPanel/forms/AgentForm'
import { SkillForm } from '../DetailPanel/forms/SkillForm'
import { RuleForm } from '../DetailPanel/forms/RuleForm'
import { HookForm } from '../DetailPanel/forms/HookForm'
import { MCPServerForm } from '../DetailPanel/forms/MCPServerForm'
import { SectionDivider } from '../DetailPanel/forms/SectionDivider'
import type {
  ManagedCapabilityIdentifier,
  ManagedCapabilityCategory,
  MCPServerTemplate,
  CommandFormData,
  AgentFormData,
  SkillFormData,
  RuleFormData,
  HookFormData,
  MCPServerFormData,
} from '@shared/types'
import type { FormMode } from '../DetailPanel/forms/types'

// ── Types ────────────────────────────────────────────────────────────

interface InlineCapabilityEditProps {
  mode: 'create' | 'edit'
  category: ManagedCapabilityCategory
  /** Required for edit mode */
  identifier?: ManagedCapabilityIdentifier
  /** Hint project ID for create mode */
  projectId?: string
  onBack: () => void
  /** Called after a successful save — passes the new/updated identifier */
  onSaved: (identifier: ManagedCapabilityIdentifier) => void
}

// ── Component ────────────────────────────────────────────────────────

export function InlineCapabilityEdit({
  mode,
  category,
  identifier,
  projectId: initialProjectId,
  onBack,
  onSaved,
}: InlineCapabilityEditProps): React.JSX.Element {
  const { t } = useTranslation('sessions')
  const projects = useAppStore((s) => s.projects)
  const storeProjectId = useAppStore(selectProjectId)

  // ── Scope & Project (create mode) ─────────────────────────────────

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(() => {
    if (mode === 'edit' && identifier) {
      if (identifier.scope === 'global') return null
      return identifier.projectId ?? null
    }
    if (initialProjectId) return initialProjectId
    return storeProjectId ?? projects[0]?.id ?? null
  })

  const scope: 'global' | 'project' = selectedProjectId ? 'project' : 'global'

  // ── Resolve entry in edit mode ────────────────────────────────────

  const editProjectId = mode === 'edit' ? identifier?.projectId : undefined
  const { snapshot } = useCapabilitySnapshot(editProjectId)
  const entry =
    mode === 'edit' && identifier && snapshot
      ? resolveCapability(snapshot, identifier.category, identifier.name, identifier.scope)
      : undefined

  // ── Form state ────────────────────────────────────────────────────

  const [isDirty, setIsDirty] = useState(false)
  const [showDiscardDialog, setShowDiscardDialog] = useState(false)
  const [discardAction, setDiscardAction] = useState<'back' | 'back-to-templates'>('back')
  const { save, saving, error: saveError } = useCapabilitySave()

  // ── MCP Template state (mcp-server create mode only) ─────────────

  const [mcpTemplate, setMcpTemplate] = useState<{
    template: MCPServerTemplate
    variantId: string | undefined
  } | null>(null)
  const [mcpOptionValues, setMcpOptionValues] = useState<Record<string, boolean | string>>({})

  const isMcpCreate = mode === 'create' && category === 'mcp-server'
  const isMcpTemplateStep = isMcpCreate && !mcpTemplate
  const isMcpFormStep = isMcpCreate && mcpTemplate !== null

  const handleTemplateSelect = useCallback(
    (template: MCPServerTemplate, variantId?: string) => {
      setMcpTemplate({ template, variantId })
      const defaults: Record<string, boolean | string> = {}
      for (const opt of template.options) {
        defaults[opt.id] = opt.defaultValue
      }
      setMcpOptionValues(defaults)
    },
    [],
  )

  const handleBackToTemplates = useCallback(() => {
    if (isDirty) {
      setDiscardAction('back-to-templates')
      setShowDiscardDialog(true)
    } else {
      setMcpTemplate(null)
      setMcpOptionValues({})
    }
  }, [isDirty])

  // Warn on page unload
  useEffect(() => {
    if (!isDirty) return
    const handler = (e: BeforeUnloadEvent): void => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  // ── Save ──────────────────────────────────────────────────────────

  const handleSave = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (formData: any) => {
      let finalData = formData as Record<string, unknown>

      // Resolve MCP template options into CLI args before saving
      if (category === 'mcp-server' && mcpTemplate && mcpTemplate.template.options.length > 0) {
        const resolvedArgs = resolveTemplateOptions(
          (finalData['args'] as string[]) ?? [],
          mcpTemplate.template.options,
          mcpOptionValues,
        )
        finalData = { ...formData, args: resolvedArgs }
      }

      const name = (finalData['name'] ?? finalData['eventName']) as string
      const params = buildSaveParams(category, scope, name, selectedProjectId ?? undefined, finalData)
      const result = await save(params)
      if (result.success) {
        setIsDirty(false)
        onSaved({
          category,
          name,
          scope,
          filePath: result.filePath,
          projectId: selectedProjectId ?? undefined,
        })
      }
    },
    [category, scope, selectedProjectId, save, onSaved, mcpTemplate, mcpOptionValues],
  )

  // ── Close with dirty guard ────────────────────────────────────────

  const requestBack = useCallback(() => {
    if (isDirty) {
      setDiscardAction('back')
      setShowDiscardDialog(true)
    } else {
      onBack()
    }
  }, [isDirty, onBack])

  // ── Config ────────────────────────────────────────────────────────

  const config = CATEGORY_MAP[category]
  const Icon = config?.icon
  const categoryLabel = config
    ? t(`capabilityCenter.categories.${config.titleKey}`)
    : category

  const editLoading = mode === 'edit' && !entry
  const displayName =
    mode === 'edit' && identifier
      ? identifier.category === 'command'
        ? `/${identifier.name}`
        : identifier.name
      : undefined

  const title = mode === 'create'
    ? t('capabilityCenter.newCapability', { category: categoryLabel })
    : `Edit ${displayName ?? categoryLabel}`

  const createMode: FormMode<never> = { type: 'create' }

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className="flex-1 flex flex-col min-h-0 capability-edit-enter">
      {/* ── Breadcrumb navigation bar ── */}
      <div className="flex items-center h-11 px-4 border-b border-[hsl(var(--border)/0.4)] shrink-0">
        {/* Left: back + breadcrumb */}
        <button
          type="button"
          onClick={isMcpFormStep ? handleBackToTemplates : requestBack}
          className="p-1 -ml-1 rounded-md hover:bg-[hsl(var(--foreground)/0.04)] transition-colors shrink-0"
          aria-label="Back"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>

        <nav className="flex items-center gap-1 ml-2 min-w-0 text-sm">
          <button
            type="button"
            onClick={requestBack}
            className="flex items-center gap-1.5 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors shrink-0"
          >
            {Icon && <Icon className={cn('h-3.5 w-3.5', config?.textColor)} />}
            <span>{categoryLabel}</span>
          </button>
          <ChevronRight className="h-3 w-3 text-[hsl(var(--muted-foreground)/0.4)] shrink-0" />
          <span className={cn(
            'truncate',
            isMcpFormStep ? 'text-[hsl(var(--muted-foreground))]' : 'font-medium text-[hsl(var(--foreground))]',
          )}>
            {title}
          </span>
          {/* Template name breadcrumb */}
          {isMcpFormStep && mcpTemplate.template.id !== '__custom__' && (
            <>
              <ChevronRight className="h-3 w-3 text-[hsl(var(--muted-foreground)/0.4)] shrink-0" />
              <span className="font-medium text-[hsl(var(--foreground))] truncate">
                {mcpTemplate.template.name}
              </span>
            </>
          )}
        </nav>

      </div>

      {/* ── Error ── */}
      {saveError && (
        <div className="px-4 py-2 text-xs text-red-500 bg-red-500/5" role="alert">
          {saveError}
        </div>
      )}

      {/* ── Scope picker (create mode) — visible & discoverable ── */}
      {mode === 'create' && (
        <div className="max-w-4xl mx-auto w-full px-6 pt-4 shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-medium text-[hsl(var(--muted-foreground)/0.5)] shrink-0">
              {t('capabilityCenter.saveTo', 'Save to')}
            </span>
            <div className="flex items-center gap-1.5">
              <ProjectPicker
                value={selectedProjectId}
                onChange={(id) => {
                  setSelectedProjectId(id)
                  setIsDirty(true)
                }}
                placeholder={t('capabilityCenter.scopeGlobal')}
                ariaLabel={t('capabilityCenter.saveTo', 'Save to')}
                triggerClassName="rounded-lg py-1.5 px-3 text-xs border border-[hsl(var(--border)/0.5)] bg-[hsl(var(--foreground)/0.02)] hover:border-[hsl(var(--border)/0.8)] transition-colors"
                position="below"
              />
            </div>
            {/* Scope hint */}
            <span className="text-[10px] text-[hsl(var(--muted-foreground)/0.35)] flex items-center gap-1">
              {scope === 'global' ? (
                <><Globe className="h-3 w-3" />{t('capabilityCenter.scopeHintGlobal', 'Available in all projects')}</>
              ) : (
                <><FolderOpen className="h-3 w-3" />{t('capabilityCenter.scopeHintProject', 'Only in this project')}</>
              )}
            </span>
          </div>
        </div>
      )}

      {/* ── Form content ── */}
      {editLoading ? (
        <div className="flex-1 flex items-center justify-center text-sm text-[hsl(var(--muted-foreground))]">
          Loading...
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="max-w-4xl mx-auto w-full flex-1 min-h-0 flex flex-col [&>div]:flex-1 [&>div]:min-h-0">
            {category === 'command' && (
              <CommandForm
                mode={mode === 'edit' ? buildFormMode<CommandFormData & { name: string }>(mode, entry) : createMode as FormMode<CommandFormData & { name: string }>}
                saving={saving}
                onSave={handleSave}
                onCancel={requestBack}
                onDirty={setIsDirty}
                variant="inline"
              />
            )}
            {category === 'agent' && (
              <AgentForm
                mode={mode === 'edit' ? buildFormMode<AgentFormData & { name: string }>(mode, entry) : createMode as FormMode<AgentFormData & { name: string }>}
                saving={saving}
                onSave={handleSave}
                onCancel={requestBack}
                onDirty={setIsDirty}
                variant="inline"
              />
            )}
            {category === 'skill' && (
              <SkillForm
                mode={mode === 'edit' ? buildFormMode<SkillFormData & { name: string }>(mode, entry) : createMode as FormMode<SkillFormData & { name: string }>}
                saving={saving}
                onSave={handleSave}
                onCancel={requestBack}
                onDirty={setIsDirty}
                variant="inline"
              />
            )}
            {category === 'rule' && (
              <RuleForm
                mode={mode === 'edit' ? buildFormMode<RuleFormData & { name: string }>(mode, entry) : createMode as FormMode<RuleFormData & { name: string }>}
                saving={saving}
                onSave={handleSave}
                onCancel={requestBack}
                onDirty={setIsDirty}
                variant="inline"
              />
            )}
            {category === 'hook' && (
              <HookForm
                mode={mode === 'edit' ? buildFormMode<HookFormData & { eventName: string }>(mode, entry) : createMode as FormMode<HookFormData & { eventName: string }>}
                saving={saving}
                onSave={handleSave}
                onCancel={requestBack}
                onDirty={setIsDirty}
                variant="inline"
              />
            )}
            {/* MCP Server: edit mode — normal form */}
            {category === 'mcp-server' && mode === 'edit' && (
              <MCPServerForm
                mode={buildFormMode<MCPServerFormData & { name: string }>(mode, entry)}
                saving={saving}
                onSave={handleSave}
                onCancel={requestBack}
                onDirty={setIsDirty}
                variant="inline"
              />
            )}
            {/* MCP Server create: Step 1 — template selector */}
            {isMcpTemplateStep && (
              <MCPTemplateSelector
                onSelect={handleTemplateSelect}
                onCancel={requestBack}
              />
            )}
            {/* MCP Server create: Step 2 — form (pre-filled from template) */}
            {isMcpFormStep && (
              <MCPServerForm
                mode={buildTemplateFormMode(mcpTemplate.template, mcpTemplate.variantId)}
                saving={saving}
                onSave={handleSave}
                onCancel={requestBack}
                onDirty={setIsDirty}
                variant="inline"
                templateOptionsSlot={
                  mcpTemplate.template.options.length > 0 ? (
                    <>
                      <SectionDivider
                        label={t('capabilityCenter.formSections.templateOptions', 'Options')}
                      />
                      <MCPTemplateOptions
                        options={mcpTemplate.template.options}
                        values={mcpOptionValues}
                        onChange={(id, val) =>
                          setMcpOptionValues((prev) => ({ ...prev, [id]: val }))
                        }
                      />
                    </>
                  ) : undefined
                }
              />
            )}
          </div>
        </div>
      )}

      {/* Discard confirmation dialog */}
      <ConfirmDialog
        open={showDiscardDialog}
        title={t('capabilityCenter.unsavedTitle')}
        message={t('capabilityCenter.unsavedMessage')}
        confirmLabel={t('capabilityCenter.discard')}
        variant="destructive"
        onConfirm={() => {
          setIsDirty(false)
          setShowDiscardDialog(false)
          if (discardAction === 'back-to-templates') {
            setMcpTemplate(null)
            setMcpOptionValues({})
          } else {
            onBack()
          }
        }}
        onCancel={() => setShowDiscardDialog(false)}
      />
    </div>
  )
}
