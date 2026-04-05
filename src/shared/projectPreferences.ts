// SPDX-License-Identifier: Apache-2.0

import type { FilesDisplayMode, ProjectPreferences, ProjectPreferencesPatch } from './types'

export const DEFAULT_PROJECT_PREFERENCES: ProjectPreferences = Object.freeze({
  defaultTab: 'issues',
  defaultChatViewMode: 'default',
  defaultFilesDisplayMode: null,
  defaultBrowserStatePolicy: 'shared-global',
})

/**
 * Normalize possibly-partial project preference input into a fully-populated
 * runtime-safe object.
 */
export function normalizeProjectPreferences(
  input: ProjectPreferencesPatch | ProjectPreferences | null | undefined,
): ProjectPreferences {
  const defaultTab = input?.defaultTab
  const defaultChatViewMode = input?.defaultChatViewMode
  const defaultFilesDisplayMode = input?.defaultFilesDisplayMode
  const defaultBrowserStatePolicy = input?.defaultBrowserStatePolicy
  const normalizedDefaultTab =
    defaultTab === 'issues' || defaultTab === 'chat' || defaultTab === 'schedule'
      ? defaultTab
      : DEFAULT_PROJECT_PREFERENCES.defaultTab
  const normalizedDefaultChatViewMode =
    defaultChatViewMode === 'default' || defaultChatViewMode === 'files'
      ? defaultChatViewMode
      : DEFAULT_PROJECT_PREFERENCES.defaultChatViewMode
  const normalizedFilesMode: FilesDisplayMode | null =
    defaultFilesDisplayMode === 'ide' || defaultFilesDisplayMode === 'browser'
      ? defaultFilesDisplayMode
      : null
  const normalizedBrowserStatePolicy =
    defaultBrowserStatePolicy === 'shared-global' ||
    defaultBrowserStatePolicy === 'shared-project' ||
    defaultBrowserStatePolicy === 'isolated-issue' ||
    defaultBrowserStatePolicy === 'isolated-session'
      ? defaultBrowserStatePolicy
      : DEFAULT_PROJECT_PREFERENCES.defaultBrowserStatePolicy

  if (normalizedDefaultChatViewMode === 'files') {
    return {
      defaultTab: normalizedDefaultTab,
      defaultChatViewMode: 'files',
      defaultFilesDisplayMode: normalizedFilesMode ?? 'ide',
      defaultBrowserStatePolicy: normalizedBrowserStatePolicy,
    }
  }

  return {
    defaultTab: normalizedDefaultTab,
    defaultChatViewMode: 'default',
    defaultFilesDisplayMode: normalizedFilesMode,
    defaultBrowserStatePolicy: normalizedBrowserStatePolicy,
  }
}
