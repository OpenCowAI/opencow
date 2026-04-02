// SPDX-License-Identifier: Apache-2.0

import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, FolderOpen } from 'lucide-react'
import { useAppStore } from '@/stores/appStore'
import { getAppAPI } from '@/windowAPI'
import type { UserConfigurableWorkspaceInput } from '@shared/types'

export function WorkspacePathPicker({
  workspace,
  onChange,
}: {
  workspace: UserConfigurableWorkspaceInput
  onChange: (workspace: UserConfigurableWorkspaceInput) => void
}): React.JSX.Element {
  const { t } = useTranslation('settings')
  const tc = useTranslation('common').t
  const projects = useAppStore((s) => s.projects)
  const selectedProjectId = workspace.scope === 'project' ? workspace.projectId : ''
  const [browsing, setBrowsing] = useState(false)

  const handleBrowse = useCallback(async () => {
    setBrowsing(true)
    try {
      const path = await getAppAPI()['select-directory']()
      if (!path) return
      const matched = projects.find((p) => p.path === path)
      if (matched) {
        onChange({ scope: 'project', projectId: matched.id })
      } else {
        onChange({ scope: 'global' })
      }
    } finally {
      setBrowsing(false)
    }
  }, [onChange, projects])

  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium">{t('messaging.defaultWorkspace')}</label>
      <p className="text-xs text-[hsl(var(--muted-foreground))]">
        {t('messaging.workspaceDesc')}
      </p>

      {/* Manual path input + folder picker */}
      <div className="flex gap-2">
        <select
          value={workspace.scope}
          onChange={(e) => onChange(e.target.value === 'project' ? { scope: 'project', projectId: '' } : { scope: 'global' })}
          className="flex-1 min-w-0 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
        >
          <option value="global">{t('messaging.workspaceGlobal')}</option>
          <option value="project">{t('messaging.workspaceProject')}</option>
        </select>
        <button
          type="button"
          onClick={handleBrowse}
          disabled={browsing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[hsl(var(--border))] text-sm hover:bg-[hsl(var(--accent))] transition-colors disabled:opacity-50 flex-none"
          title={t('messaging.chooseFolder')}
        >
          {browsing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderOpen className="h-3.5 w-3.5" />}
          {tc('browse')}
        </button>
      </div>

      {/* Project selector */}
      {projects.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-[hsl(var(--muted-foreground))]">{t('messaging.workspaceProject')}</span>
          <select
            value={selectedProjectId}
            onChange={(e) => {
              const projectId = e.target.value
              onChange(projectId ? { scope: 'project', projectId } : { scope: 'global' })
            }}
            disabled={workspace.scope !== 'project'}
            className="flex-1 min-w-0 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] pl-2 pr-7 py-1 text-xs outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
          >
            <option value="">{t('messaging.selectProject')}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  )
}
