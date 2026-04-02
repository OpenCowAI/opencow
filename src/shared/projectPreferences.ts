// SPDX-License-Identifier: Apache-2.0

import type { FilesDisplayMode, ProjectPreferences, ProjectPreferencesPatch } from './types'

export const DEFAULT_PROJECT_PREFERENCES: ProjectPreferences = Object.freeze({
  defaultTab: 'issues',
  defaultChatViewMode: 'default',
  defaultFilesDisplayMode: null,
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

  if (normalizedDefaultChatViewMode === 'files') {
    return {
      defaultTab: normalizedDefaultTab,
      defaultChatViewMode: 'files',
      defaultFilesDisplayMode: normalizedFilesMode ?? 'ide',
    }
  }

  return {
    defaultTab: normalizedDefaultTab,
    defaultChatViewMode: 'default',
    defaultFilesDisplayMode: normalizedFilesMode,
  }
}
