// SPDX-License-Identifier: Apache-2.0

import { useMemo, useState, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/appStore'
import type {
  ProjectBrowserStatePolicy,
  ProjectPreferences,
} from '@shared/types'
import { normalizeProjectPreferences } from '@shared/projectPreferences'
import { getAppAPI } from '@/windowAPI'
import {
  SettingOptionCardGroup,
  type SettingOptionCardSpec,
} from '@/components/ui/SettingOptionCards'
import { BrowserBehaviorPreview } from './previews/GeneralSettingPreviews'

interface ProjectBrowserSettingsPanelProps {
  projectId: string
}

function samePreferences(a: ProjectPreferences, b: ProjectPreferences): boolean {
  return a.defaultBrowserStatePolicy === b.defaultBrowserStatePolicy
}

export function ProjectBrowserSettingsPanel({ projectId }: ProjectBrowserSettingsPanelProps): React.JSX.Element {
  const { t } = useTranslation('projectSettings')
  const projects = useAppStore((s) => s.projects)
  const updateProjectById = useAppStore((s) => s.updateProjectById)
  const [saving, setSaving] = useState(false)
  const project = useMemo(() => projects.find((p) => p.id === projectId) ?? null, [projectId, projects])
  const canonical = normalizeProjectPreferences(project?.preferences)
  const [draft, setDraft] = useState<ProjectPreferences>(canonical)

  useEffect(() => {
    setDraft(canonical)
  }, [canonical.defaultBrowserStatePolicy])

  const dirty = !samePreferences(draft, canonical)

  const onSave = useCallback(async () => {
    if (!project || !dirty) return
    setSaving(true)
    try {
      const updated = await getAppAPI()['update-project'](project.id, {
        preferences: {
          defaultBrowserStatePolicy: draft.defaultBrowserStatePolicy,
        },
      })
      if (!updated) throw new Error(t('browser.saveFailed'))
      updateProjectById(project.id, () => updated)
      toast(t('browser.saved'))
    } catch (err) {
      toast(err instanceof Error ? err.message : t('browser.saveFailed'))
    } finally {
      setSaving(false)
    }
  }, [dirty, draft.defaultBrowserStatePolicy, project, t, updateProjectById])

  const setBrowserStatePolicy = useCallback((defaultBrowserStatePolicy: ProjectBrowserStatePolicy) => {
    setDraft((s) => ({ ...s, defaultBrowserStatePolicy }))
  }, [])

  const browserStatePolicyOptions = useMemo<readonly SettingOptionCardSpec<ProjectBrowserStatePolicy>[]>(
    () => ([
      {
        value: 'shared-global',
        label: t('browser.defaultStatePolicy.options.sharedGlobal'),
        description: t('browser.defaultStatePolicy.hints.sharedGlobal'),
        preview: <BrowserBehaviorPreview policy="shared-global" />,
      },
      {
        value: 'shared-project',
        label: t('browser.defaultStatePolicy.options.sharedProject'),
        description: t('browser.defaultStatePolicy.hints.sharedProject'),
        preview: <BrowserBehaviorPreview policy="shared-project" />,
      },
      {
        value: 'isolated-issue',
        label: t('browser.defaultStatePolicy.options.isolatedIssue'),
        description: t('browser.defaultStatePolicy.hints.isolatedIssue'),
        preview: <BrowserBehaviorPreview policy="isolated-issue" />,
      },
      {
        value: 'isolated-session',
        label: t('browser.defaultStatePolicy.options.isolatedSession'),
        description: t('browser.defaultStatePolicy.hints.isolatedSession'),
        preview: <BrowserBehaviorPreview policy="isolated-session" />,
      },
    ]),
    [t],
  )

  if (!project) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[hsl(var(--border))]">
          <div>
            <h3 className="text-sm font-medium">{t('browser.title')}</h3>
            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
              {t('browser.description')}
            </p>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="flex items-center justify-center h-40 text-sm text-[hsl(var(--muted-foreground))]">
            {t('browser.projectNotFound')}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-5 py-4 border-b border-[hsl(var(--border))]">
        <div>
          <h3 className="text-sm font-medium">{t('browser.title')}</h3>
          <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
            {t('browser.description')}
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="space-y-6">
          <section className="space-y-2.5 rounded-xl border border-[hsl(var(--border)/0.7)] bg-[hsl(var(--card)/0.6)] p-3.5">
            <h3 className="text-sm font-medium">{t('browser.defaultStatePolicy.title')}</h3>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">{t('browser.defaultStatePolicy.description')}</p>
            <SettingOptionCardGroup
              ariaLabel={t('browser.defaultStatePolicy.title')}
              value={draft.defaultBrowserStatePolicy}
              onChange={setBrowserStatePolicy}
              options={browserStatePolicyOptions}
              columns={2}
            />
          </section>

          <div className="pt-1">
            <button
              type="button"
              onClick={onSave}
              disabled={!dirty || saving}
              className={cn(
                'px-4 py-1.5 text-xs font-medium rounded-lg transition-colors',
                dirty && !saving
                  ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90'
                  : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] cursor-not-allowed',
              )}
            >
              {saving ? t('browser.saving') : t('browser.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
