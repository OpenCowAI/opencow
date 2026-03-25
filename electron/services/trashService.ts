// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { validateCapabilityPath } from '../security/pathValidator'

export interface TrashResult {
  success: boolean
  trashPath: string
}

function getTrashDir(sourcePath: string, projectPath?: string): string {
  if (projectPath) {
    const projectClaude = path.resolve(projectPath, '.claude')
    if (path.resolve(sourcePath).startsWith(projectClaude + path.sep)) {
      return path.join(projectClaude, '.trash')
    }
  }
  return path.join(os.homedir(), '.claude', '.trash')
}

export async function moveToTrash(sourcePath: string, projectPath?: string): Promise<TrashResult> {
  validateCapabilityPath(sourcePath, projectPath)

  const trashDir = getTrashDir(sourcePath, projectPath)
  await fs.mkdir(trashDir, { recursive: true })

  const basename = path.basename(sourcePath)
  const ext = path.extname(basename)
  const stem = ext ? basename.slice(0, -ext.length) : basename
  const trashName = ext ? `${stem}.${Date.now()}${ext}` : `${stem}.${Date.now()}`
  const trashPath = path.join(trashDir, trashName)

  await fs.rename(sourcePath, trashPath)
  return { success: true, trashPath }
}
