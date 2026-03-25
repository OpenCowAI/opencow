// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from 'vitest'
import { ImportPipeline } from '../../../electron/services/capabilityCenter/importPipeline'
import { DiagnosticsCollector } from '../../../electron/services/capabilityCenter/diagnostics'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp',
    getName: () => 'OpenCow',
  },
}))

describe('ImportPipeline governance routing', () => {
  it('returns explicit unsupported error for codex hook import', async () => {
    const pipeline = new ImportPipeline(
      {} as any,
      {} as any,
      new DiagnosticsCollector(),
    )

    const result = await pipeline.importItems([
      {
        name: 'sample-hook',
        category: 'hook',
        description: '',
        sourcePath: '/tmp/.codex/config.toml#hooks.sample-hook',
        sourceType: 'codex',
        alreadyImported: false,
        sourceScope: 'global',
      },
    ])

    expect(result.imported).toEqual([])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.error).toContain('codex does not support category=hook')
  })
})
