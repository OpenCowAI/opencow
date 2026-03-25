// SPDX-License-Identifier: Apache-2.0

import { useState, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { X, ArrowLeft } from 'lucide-react'
import { useBlockBrowserView } from '@/hooks/useBlockBrowserView'
import { useAppStore, selectProjectId } from '@/stores/appStore'
import { useCapabilitySave } from '@/hooks/useCapabilitySave'
import { useExitAnimation } from '@/hooks/useModalAnimation'
import {
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
import { cn } from '@/lib/utils'
import type {
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

interface CapabilityCreateModalProps {
  category: ManagedCapabilityCategory
  projectId?: string
  onClose: () => void
}

// ── Component ────────────────────────────────────────────────────────

export function CapabilityCreateModal({
  category,
  projectId: initialProjectId,
  onClose,
}: CapabilityCreateModalProps): React.JSX.Element {
  const { t } = useTranslation('sessions')
  const { t: tCommon } = useTranslation('common')
  useBlockBrowserView('capability-create-modal', true)
  const { phase, requestClose: animatedClose } = useExitAnimation(onClose)

  const openDetail = useAppStore((s) => s.openDetail)
  const projects = useAppStore((s) => s.projects)
  const storeProjectId = useAppStore(selectProjectId)

  // ── Scope & Project state ──────────────────────────────────────────
  // null = Global scope, string = Project scope (project id)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(() => {
    if (initialProjectId) return initialProjectId
    return storeProjectId ?? projects[0]?.id ?? null
  })

  const scope: 'global' | 'project' = selectedProjectId ? 'project' : 'global'

  // ── Form state ─────────────────────────────────────────────────────
  const [isDirty, setIsDirty] = useState(false)
  const [showDiscardDialog, setShowDiscardDialog] = useState(false)
  /** Tracks what should happen when the discard dialog is confirmed */
  const [discardAction, setDiscardAction] = useState<'close' | 'back-to-templates'>('close')
  const { save, saving, error: saveError } = useCapabilitySave()

  // ── MCP Template state (mcp-server category only) ────────────────
  const [mcpTemplate, setMcpTemplate] = useState<{
    template: MCPServerTemplate
    variantId: string | undefined
  } | null>(null)
  const [mcpOptionValues, setMcpOptionValues] = useState<Record<string, boolean | string>>({})

  const isMcpTemplateStep = category === 'mcp-server' && !mcpTemplate
  const isMcpFormStep = category === 'mcp-server' && mcpTemplate !== null

  const handleTemplateSelect = useCallback(
    (template: MCPServerTemplate, variantId?: string) => {
      setMcpTemplate({ template, variantId })
      // Initialize option values from template defaults
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

  // Prevent accidental page unload with unsaved changes
  useEffect(() => {
    if (!isDirty) return
    const handler = (e: BeforeUnloadEvent): void => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  // ── Close handling ─────────────────────────────────────────────────
  const requestClose = useCallback(() => {
    if (isDirty) {
      setDiscardAction('close')
      setShowDiscardDialog(true)
    } else {
      animatedClose()
    }
  }, [isDirty, animatedClose])

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        requestClose()
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [requestClose])

  // ── Save handling ──────────────────────────────────────────────────
  const handleSave = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (formData: any) => {
      let finalData = formData as Record<string, unknown>

      // Resolve MCP template options into CLI args before saving
      if (category === 'mcp-server' && mcpTemplate && mcpTemplate.template.options.length > 0) {
        const resolvedArgs = resolveTemplateOptions(
          (formData['args'] as string[]) ?? [],
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
        // Navigate to the detail view
        openDetail({
          type: 'capability',
          identifier: {
            category,
            name,
            scope,
            filePath: result.filePath,
            projectId: selectedProjectId ?? undefined,
          },
        })
        animatedClose()
      }
    },
    [category, scope, selectedProjectId, save, openDetail, animatedClose, mcpTemplate, mcpOptionValues],
  )

  // ── Config ─────────────────────────────────────────────────────────
  const config = CATEGORY_MAP[category]
  const Icon = config?.icon
  const categoryName = t(`capabilityCenter.categories.${config?.titleKey ?? category}`)

  // Document types have CodeEditor → larger modal; Config types → compact
  const isDocumentType = ['skill', 'command', 'agent', 'rule'].includes(category)

  const createMode: FormMode<never> = { type: 'create' }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overscroll-contain no-drag"
      role="dialog"
      aria-modal="true"
      aria-label={t('capabilityCenter.newCapability', { category: categoryName })}
    >
      {/* Overlay */}
      <div
        className={cn(
          'absolute inset-0 bg-black/50',
          phase === 'enter' && 'modal-overlay-enter',
          phase === 'exit' && 'modal-overlay-exit',
        )}
        onClick={requestClose}
        aria-hidden="true"
      />

      {/* Modal card */}
      <div
        className={cn(
          'relative z-10 bg-[hsl(var(--background))] border border-[hsl(var(--border))] rounded-2xl shadow-lg w-full mx-4 flex flex-col max-h-[85vh] overflow-hidden transition-[max-width] duration-200',
          isDocumentType
            ? 'max-w-[720px] min-h-[520px]'
            : isMcpTemplateStep
              ? 'max-w-[520px]'
              : 'max-w-[560px]',
          phase === 'enter' && 'modal-content-enter',
          phase === 'exit' && 'modal-content-exit',
        )}
      >
        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[hsl(var(--border))]">
          <div className="flex items-center gap-1.5 min-w-0">
            {/* Back button (MCP form step only) */}
            {isMcpFormStep && (
              <button
                onClick={handleBackToTemplates}
                className="p-1 -ml-1 rounded-md text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors shrink-0"
                aria-label={t('capabilityCenter.mcpTemplates.backToTemplates', 'Back')}
              >
                <ArrowLeft className="w-3.5 h-3.5" />
              </button>
            )}

            {/* Project picker — selecting null = Global scope */}
            <ProjectPicker
              value={selectedProjectId}
              onChange={setSelectedProjectId}
              placeholder={t('capabilityCenter.scopeGlobal')}
              ariaLabel={t('capabilityCenter.scope')}
              triggerClassName="rounded-full py-1 px-2.5 text-xs"
              position="below"
            />

            <span className="text-[hsl(var(--muted-foreground))] text-xs shrink-0">&rsaquo;</span>

            {/* Category icon + title */}
            {Icon && (
              <Icon
                className={cn('h-3.5 w-3.5 shrink-0', config?.textColor)}
                aria-hidden="true"
              />
            )}
            <span className="text-sm text-[hsl(var(--foreground))] font-medium truncate">
              {t('capabilityCenter.newCapability', { category: categoryName })}
            </span>

            {/* Template name breadcrumb */}
            {isMcpFormStep && mcpTemplate.template.id !== '__custom__' && (
              <>
                <span className="text-[hsl(var(--muted-foreground))] text-xs shrink-0">&rsaquo;</span>
                <span className="text-xs text-[hsl(var(--muted-foreground))] truncate">
                  {mcpTemplate.template.name}
                </span>
              </>
            )}
          </div>

          <button
            onClick={requestClose}
            className="p-1 rounded-md text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors shrink-0"
            aria-label={tCommon('close')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Save error */}
        {saveError && (
          <div className="px-5 py-2 text-xs text-red-500 bg-red-500/5" role="alert">
            {saveError}
          </div>
        )}

        {/* ── Content: Form component ────────────────────────────── */}
        <div className="flex-1 min-h-0 flex flex-col [&>div]:flex-1 [&>div]:min-h-0">
          {category === 'command' && (
            <CommandForm
              mode={createMode as FormMode<CommandFormData & { name: string }>}
              saving={saving}
              onSave={handleSave}
              onCancel={requestClose}
              onDirty={setIsDirty}
              variant="modal"
            />
          )}
          {category === 'agent' && (
            <AgentForm
              mode={createMode as FormMode<AgentFormData & { name: string }>}
              saving={saving}
              onSave={handleSave}
              onCancel={requestClose}
              onDirty={setIsDirty}
              variant="modal"
            />
          )}
          {category === 'skill' && (
            <SkillForm
              mode={createMode as FormMode<SkillFormData & { name: string }>}
              saving={saving}
              onSave={handleSave}
              onCancel={requestClose}
              onDirty={setIsDirty}
              variant="modal"
            />
          )}
          {category === 'rule' && (
            <RuleForm
              mode={createMode as FormMode<RuleFormData & { name: string }>}
              saving={saving}
              onSave={handleSave}
              onCancel={requestClose}
              onDirty={setIsDirty}
              variant="modal"
            />
          )}
          {category === 'hook' && (
            <HookForm
              mode={createMode as FormMode<HookFormData & { eventName: string }>}
              saving={saving}
              onSave={handleSave}
              onCancel={requestClose}
              onDirty={setIsDirty}
              variant="modal"
            />
          )}
          {/* MCP Server: Step 1 — template selector */}
          {isMcpTemplateStep && (
            <MCPTemplateSelector
              onSelect={handleTemplateSelect}
              onCancel={requestClose}
            />
          )}
          {/* MCP Server: Step 2 — form (pre-filled from template) */}
          {isMcpFormStep && (
            <MCPServerForm
              mode={buildTemplateFormMode(mcpTemplate.template, mcpTemplate.variantId)}
              saving={saving}
              onSave={handleSave}
              onCancel={requestClose}
              onDirty={setIsDirty}
              variant="modal"
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
            animatedClose()
          }
        }}
        onCancel={() => setShowDiscardDialog(false)}
      />
    </div>
  )
}
