// SPDX-License-Identifier: Apache-2.0

import { useMemo, useState, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/appStore'
import type {
  ProjectDefaultTab,
  ProjectPreferences,
  FilesDisplayMode,
} from '@shared/types'
import { normalizeProjectPreferences } from '@shared/projectPreferences'
import { getAppAPI } from '@/windowAPI'
import {
  SettingOptionCardGroup,
  type SettingOptionCardSpec,
} from '@/components/ui/SettingOptionCards'
import {
  ChatLayoutPreview,
  FilesLayoutPreview,
  TopTabPreview,
} from './previews/GeneralSettingPreviews'

interface ProjectGeneralSettingsPanelProps {
  projectId: string
}

interface GeneralPreferencesDraft {
  defaultTab: ProjectDefaultTab
  defaultChatViewMode: 'default' | 'files'
  defaultFilesDisplayMode: FilesDisplayMode | null
}

function toGeneralDraft(preferences: ProjectPreferences): GeneralPreferencesDraft {
  return {
    defaultTab: preferences.defaultTab,
    defaultChatViewMode: preferences.defaultChatViewMode,
    defaultFilesDisplayMode: preferences.defaultFilesDisplayMode,
  }
}

function sameGeneralPreferences(a: GeneralPreferencesDraft, b: GeneralPreferencesDraft): boolean {
  return (
    a.defaultTab === b.defaultTab &&
    a.defaultChatViewMode === b.defaultChatViewMode &&
    a.defaultFilesDisplayMode === b.defaultFilesDisplayMode
  )
}

export function ProjectGeneralSettingsPanel({ projectId }: ProjectGeneralSettingsPanelProps): React.JSX.Element {
  const { t } = useTranslation('projectSettings')
  const projects = useAppStore((s) => s.projects)
  const updateProjectById = useAppStore((s) => s.updateProjectById)
  const [saving, setSaving] = useState(false)
  const project = useMemo(() => projects.find((p) => p.id === projectId) ?? null, [projectId, projects])
  const canonical = useMemo(
    () => toGeneralDraft(normalizeProjectPreferences(project?.preferences)),
    [project?.preferences],
  )
  const [draft, setDraft] = useState<GeneralPreferencesDraft>(canonical)

  useEffect(() => {
    setDraft(canonical)
  }, [
    canonical.defaultChatViewMode,
    canonical.defaultFilesDisplayMode,
    canonical.defaultTab,
  ])

  const dirty = !sameGeneralPreferences(draft, canonical)

  const onSave = useCallback(async () => {
    if (!project || !dirty) return
    setSaving(true)
    try {
      const updated = await getAppAPI()['update-project'](project.id, {
        preferences: {
          defaultTab: draft.defaultTab,
          defaultChatViewMode: draft.defaultChatViewMode,
          defaultFilesDisplayMode: draft.defaultFilesDisplayMode,
        },
      })
      if (!updated) throw new Error(t('general.saveFailed'))
      updateProjectById(project.id, () => updated)
      toast(t('general.saved'))
    } catch (err) {
      toast(err instanceof Error ? err.message : t('general.saveFailed'))
    } finally {
      setSaving(false)
    }
  }, [dirty, draft, project, t, updateProjectById])

  const setDefaultTab = useCallback((defaultTab: ProjectDefaultTab) => {
    setDraft((s) => ({ ...s, defaultTab }))
  }, [])

  const setChatViewMode = useCallback((defaultChatViewMode: 'default' | 'files') => {
    setDraft((s) => {
      if (defaultChatViewMode === 'files') {
        return {
          ...s,
          defaultChatViewMode: 'files',
          defaultFilesDisplayMode: s.defaultFilesDisplayMode ?? 'ide',
        }
      }
      return { ...s, defaultChatViewMode: 'default' }
    })
  }, [])

  const setFilesMode = useCallback((defaultFilesDisplayMode: FilesDisplayMode) => {
    setDraft((s) => ({ ...s, defaultFilesDisplayMode }))
  }, [])

  const defaultTabOptions = useMemo<readonly SettingOptionCardSpec<ProjectDefaultTab>[]>(
    () => ([
      {
        value: 'issues',
        label: t('general.defaultTab.options.issues'),
        description: t('general.defaultTab.hints.issues'),
        preview: <TopTabPreview tab="issues" />,
      },
      {
        value: 'chat',
        label: t('general.defaultTab.options.chat'),
        description: t('general.defaultTab.hints.chat'),
        preview: <TopTabPreview tab="chat" />,
      },
      {
        value: 'schedule',
        label: t('general.defaultTab.options.schedule'),
        description: t('general.defaultTab.hints.schedule'),
        preview: <TopTabPreview tab="schedule" />,
      },
    ]),
    [t],
  )

  const chatDefaultOptions = useMemo<readonly SettingOptionCardSpec<'default' | 'files'>[]>(
    () => ([
      {
        value: 'default',
        label: t('general.chatDefaultMode.options.default'),
        description: t('general.chatDefaultMode.hints.default'),
        preview: <ChatLayoutPreview mode="default" />,
      },
      {
        value: 'files',
        label: t('general.chatDefaultMode.options.files'),
        description: t('general.chatDefaultMode.hints.files'),
        preview: <ChatLayoutPreview mode="files" />,
      },
    ]),
    [t],
  )

  const filesDefaultOptions = useMemo<readonly SettingOptionCardSpec<FilesDisplayMode>[]>(
    () => ([
      {
        value: 'ide',
        label: t('general.filesDefaultMode.options.ide'),
        description: t('general.filesDefaultMode.hints.ide'),
        preview: <FilesLayoutPreview mode="ide" />,
      },
      {
        value: 'browser',
        label: t('general.filesDefaultMode.options.browser'),
        description: t('general.filesDefaultMode.hints.browser'),
        preview: <FilesLayoutPreview mode="browser" />,
      },
    ]),
    [t],
  )

  if (!project) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[hsl(var(--border))]">
          <div>
            <h3 className="text-sm font-medium">{t('general.title')}</h3>
            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
              {t('general.description')}
            </p>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="flex items-center justify-center h-40 text-sm text-[hsl(var(--muted-foreground))]">
            {t('general.projectNotFound')}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-5 py-4 border-b border-[hsl(var(--border))]">
        <div>
          <h3 className="text-sm font-medium">{t('general.title')}</h3>
          <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
            {t('general.description')}
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="space-y-6">
          <section className="space-y-2.5 rounded-xl border border-[hsl(var(--border)/0.7)] bg-[hsl(var(--card)/0.6)] p-3.5">
            <h3 className="text-sm font-medium">{t('general.defaultTab.title')}</h3>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">{t('general.defaultTab.description')}</p>
            <SettingOptionCardGroup
              ariaLabel={t('general.defaultTab.title')}
              value={draft.defaultTab}
              onChange={setDefaultTab}
              options={defaultTabOptions}
              columns={3}
            />
          </section>

          <section className="space-y-2.5 rounded-xl border border-[hsl(var(--border)/0.7)] bg-[hsl(var(--card)/0.6)] p-3.5">
            <h3 className="text-sm font-medium">{t('general.chatDefaultMode.title')}</h3>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">{t('general.chatDefaultMode.description')}</p>
            <SettingOptionCardGroup
              ariaLabel={t('general.chatDefaultMode.title')}
              value={draft.defaultChatViewMode}
              onChange={setChatViewMode}
              options={chatDefaultOptions}
              columns={2}
            />
          </section>

          {draft.defaultChatViewMode === 'files' && (
            <section className="space-y-2.5 rounded-xl border border-[hsl(var(--border)/0.7)] bg-[hsl(var(--card)/0.6)] p-3.5">
              <h3 className="text-sm font-medium">{t('general.filesDefaultMode.title')}</h3>
              <p className="text-xs text-[hsl(var(--muted-foreground))]">{t('general.filesDefaultMode.description')}</p>
              <SettingOptionCardGroup
                ariaLabel={t('general.filesDefaultMode.title')}
                value={draft.defaultFilesDisplayMode ?? 'ide'}
                onChange={setFilesMode}
                options={filesDefaultOptions}
                columns={2}
              />
            </section>
          )}

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
              {saving ? t('general.saving') : t('general.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
