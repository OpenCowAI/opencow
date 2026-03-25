// SPDX-License-Identifier: Apache-2.0

import { useState, useCallback, useEffect } from 'react'
import { useAppStore, selectProjectId } from '@/stores/appStore'
import { X, ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCapabilitySave } from '@/hooks/useCapabilitySave'
import { useCapabilitySnapshot } from '@/hooks/useCapabilitySnapshot'
import { resolveCapability } from '@/lib/capabilityAdapter'
import { buildFormMode, buildSaveParams } from '@/lib/capabilityFormHelpers'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { CATEGORY_MAP } from '../ChatView/categoryRegistry'
import { CommandForm } from './forms/CommandForm'
import { AgentForm } from './forms/AgentForm'
import { SkillForm } from './forms/SkillForm'
import { RuleForm } from './forms/RuleForm'
import { HookForm } from './forms/HookForm'
import { MCPServerForm } from './forms/MCPServerForm'
import type {
  ManagedCapabilityIdentifier,
  ManagedCapabilityCategory,
  CommandFormData,
  AgentFormData,
  SkillFormData,
  RuleFormData,
  HookFormData,
  MCPServerFormData,
} from '@shared/types'

// ── Types ────────────────────────────────────────────────────────────

interface CapabilityEditViewProps {
  mode: 'create' | 'edit'
  category: ManagedCapabilityCategory
  scope?: 'global' | 'project'
  identifier?: ManagedCapabilityIdentifier
  projectId?: string
  onClose?: () => void
}

// ── Main Component ───────────────────────────────────────────────────

export function CapabilityEditView({
  mode,
  category,
  scope: initialScope = 'project',
  identifier,
  projectId: initialProjectId,
  onClose,
}: CapabilityEditViewProps): React.JSX.Element {
  const storeCloseDetail = useAppStore((s) => s.closeDetail)
  const openDetail = useAppStore((s) => s.openDetail)
  const closeDetail = onClose ?? storeCloseDetail
  const projects = useAppStore((s) => s.projects)
  const storeProjectId = useAppStore(selectProjectId)

  const [scope, setScope] = useState<'global' | 'project'>(
    mode === 'edit' ? (identifier?.scope ?? initialScope) : initialScope,
  )
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>(() => {
    if (mode === 'edit') return identifier?.projectId ?? storeProjectId ?? undefined
    if (initialProjectId) return initialProjectId
    return storeProjectId ?? projects[0]?.id
  })
  const [isDirty, setIsDirty] = useState(false)
  const [showDiscardDialog, setShowDiscardDialog] = useState(false)

  // Resolve entry from snapshot in edit mode (live data, no stale props)
  const editProjectId = mode === 'edit' ? identifier?.projectId : undefined
  const { snapshot } = useCapabilitySnapshot(editProjectId)
  const entry =
    mode === 'edit' && identifier && snapshot
      ? resolveCapability(snapshot, identifier.category, identifier.name, identifier.scope)
      : undefined

  const { save, saving, error: saveError } = useCapabilitySave()

  // Warn before closing with unsaved changes
  useEffect(() => {
    if (!isDirty) return
    const handler = (e: BeforeUnloadEvent): void => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  const handleSave = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (formData: any) => {
      const data = formData as Record<string, unknown>
      const name = (data['name'] ?? data['eventName']) as string
      const params = buildSaveParams(category, scope, name, selectedProjectId, data)
      const result = await save(params)
      if (result.success) {
        setIsDirty(false)
        // Navigate to the detail view — snapshot will auto-refresh with real data
        openDetail({
          type: 'capability',
          identifier: {
            category,
            name,
            scope,
            filePath: result.filePath,
            projectId: selectedProjectId,
          },
        })
      }
    },
    [category, scope, selectedProjectId, save, openDetail],
  )

  const requestClose = useCallback(() => {
    if (isDirty) {
      setShowDiscardDialog(true)
    } else {
      closeDetail()
    }
  }, [isDirty, closeDetail])

  const config = CATEGORY_MAP[category]
  const Icon = config?.icon
  const categoryLabel = config?.titleKey ?? category
  const title = mode === 'create' ? `New ${categoryLabel}` : `Edit ${categoryLabel}`

  // In edit mode, show loading state while snapshot resolves
  const editLoading = mode === 'edit' && !entry

  return (
    <aside className="h-full flex flex-col bg-[hsl(var(--card))]" aria-label={title}>
      {/* Header */}
      <div className="p-4 border-b border-[hsl(var(--border))] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={requestClose}
            className="p-1 -ml-1 rounded-md hover:bg-[hsl(var(--foreground)/0.04)] transition-colors shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
            aria-label="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          {Icon && (
            <Icon className={cn('h-4 w-4 shrink-0', config?.textColor)} aria-hidden="true" />
          )}
          <h3 className="font-semibold text-sm truncate">{title}</h3>
        </div>
        <button
          onClick={requestClose}
          className="p-1 rounded-md hover:bg-[hsl(var(--foreground)/0.04)] transition-colors shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Scope + Project Selector (create mode only) */}
      {mode === 'create' && (
        <div className="px-4 py-3 border-b border-[hsl(var(--border))] space-y-3">
          <div>
            <label htmlFor="scope-select" className="block text-xs font-medium mb-1">
              Scope
            </label>
            <select
              id="scope-select"
              name="scope"
              value={scope}
              onChange={(e) => setScope(e.target.value as 'global' | 'project')}
              aria-label="Scope"
              className="w-full px-2 py-1.5 text-sm rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
            >
              <option value="project">Project</option>
              <option value="global">Global</option>
            </select>
          </div>

          {scope === 'project' && (
            <div>
              <label htmlFor="project-select" className="block text-xs font-medium mb-1">
                Project
              </label>
              {projects.length > 0 ? (
                <select
                  id="project-select"
                  name="project"
                  value={selectedProjectId ?? ''}
                  onChange={(e) => {
                    setSelectedProjectId(e.target.value || undefined)
                    setIsDirty(true)
                  }}
                  aria-label="Project"
                  className="w-full px-2 py-1.5 text-sm rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-xs text-[hsl(var(--muted-foreground))]">
                  No projects available. Switch to Global scope.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {saveError && (
        <div className="px-4 py-2 text-xs text-red-500 bg-red-500/5" role="alert">
          {saveError}
        </div>
      )}

      {/* Form */}
      {editLoading ? (
        <div className="flex-1 flex items-center justify-center text-sm text-[hsl(var(--muted-foreground))]">
          Loading...
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col [&>div]:flex-1 [&>div]:min-h-0">
          {category === 'command' && (
            <CommandForm
              mode={buildFormMode<CommandFormData & { name: string }>(mode, entry)}
              saving={saving}
              onSave={handleSave}
              onCancel={requestClose}
              onDirty={setIsDirty}
            />
          )}
          {category === 'agent' && (
            <AgentForm
              mode={buildFormMode<AgentFormData & { name: string }>(mode, entry)}
              saving={saving}
              onSave={handleSave}
              onCancel={requestClose}
              onDirty={setIsDirty}
            />
          )}
          {category === 'skill' && (
            <SkillForm
              mode={buildFormMode<SkillFormData & { name: string }>(mode, entry)}
              saving={saving}
              onSave={handleSave}
              onCancel={requestClose}
              onDirty={setIsDirty}
            />
          )}
          {category === 'rule' && (
            <RuleForm
              mode={buildFormMode<RuleFormData & { name: string }>(mode, entry)}
              saving={saving}
              onSave={handleSave}
              onCancel={requestClose}
              onDirty={setIsDirty}
            />
          )}
          {category === 'hook' && (
            <HookForm
              mode={buildFormMode<HookFormData & { eventName: string }>(mode, entry)}
              saving={saving}
              onSave={handleSave}
              onCancel={requestClose}
              onDirty={setIsDirty}
            />
          )}
          {category === 'mcp-server' && (
            <MCPServerForm
              mode={buildFormMode<MCPServerFormData & { name: string }>(mode, entry)}
              saving={saving}
              onSave={handleSave}
              onCancel={requestClose}
              onDirty={setIsDirty}
            />
          )}
        </div>
      )}

      {/* Discard confirmation dialog (replaces window.confirm) */}
      <ConfirmDialog
        open={showDiscardDialog}
        title="Unsaved changes"
        message="You have unsaved changes. Discard them?"
        confirmLabel="Discard"
        variant="destructive"
        onConfirm={closeDetail}
        onCancel={() => setShowDiscardDialog(false)}
      />
    </aside>
  )
}
