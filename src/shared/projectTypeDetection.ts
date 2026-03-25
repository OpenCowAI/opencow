// SPDX-License-Identifier: Apache-2.0

/**
 * Project type detection — determines whether a project is primarily
 * code-oriented (best served by an IDE editor) or general-purpose
 * (best served by a file browser).
 *
 * This module is shared between renderer and main processes.
 */

import type { FilesDisplayMode } from './types'

/** Marker files in the project root that indicate a code project. */
export const CODE_PROJECT_MARKERS = [
  'package.json',
  'Cargo.toml',
  'go.mod',
  'pyproject.toml',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'tsconfig.json',
  'Makefile',
  'CMakeLists.txt',
  'Gemfile',
  'requirements.txt',
  'setup.py',
  'mix.exs',
  'Dockerfile',
  'composer.json',
  '.sln',
  'Cargo.lock',
  'go.sum'
] as const

/**
 * Determine the recommended display mode for a project based on
 * the presence of code-oriented marker files in its root directory.
 */
export function inferDisplayModeFromFiles(rootFileNames: string[]): FilesDisplayMode {
  const hasCodeMarker = rootFileNames.some((name) => CODE_PROJECT_MARKERS.includes(name as typeof CODE_PROJECT_MARKERS[number]))
  return hasCodeMarker ? 'ide' : 'browser'
}
