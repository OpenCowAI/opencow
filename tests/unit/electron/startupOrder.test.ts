// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import { readFile } from 'fs/promises'
import { join } from 'path'

const MAIN_TS = join(__dirname, '../../../electron/main.ts')

describe('Startup ordering', () => {
  it('event routing should be wired inside app.whenReady() after sources are started', async () => {
    const source = await readFile(MAIN_TS, 'utf-8')

    const wireRoutesIndex = source.indexOf('wireEventRoutes({')
    const whenReadyIndex = source.indexOf('app.whenReady()')
    const hookStartIndex = source.indexOf('hookSource.start()')

    expect(wireRoutesIndex).toBeGreaterThan(-1)
    expect(whenReadyIndex).toBeGreaterThan(-1)
    expect(hookStartIndex).toBeGreaterThan(-1)

    // Wiring lives in runtime startup flow, not module scope.
    expect(wireRoutesIndex).toBeGreaterThan(whenReadyIndex)
    // Routing is mounted after source startup to avoid historical replay side effects.
    expect(wireRoutesIndex).toBeGreaterThan(hookStartIndex)
  })

  it('inboxService.start() should be called before hookSource.start()', async () => {
    const source = await readFile(MAIN_TS, 'utf-8')

    const serviceBlock = source.match(/const serviceResults = await Promise\.allSettled\(\[([\s\S]*?)\]\)/)
    const sourceBlock = source.match(/const sourceResults = await Promise\.allSettled\(\[([\s\S]*?)\]\)/)

    expect(serviceBlock).toBeTruthy()
    expect(sourceBlock).toBeTruthy()
    expect(serviceBlock![1]).toContain('inboxService.start()')
    expect(sourceBlock![1]).toContain('hookSource.start()')

    // Service startup block runs before source startup block.
    const serviceBlockIndex = source.indexOf(serviceBlock![0])
    const sourceBlockIndex = source.indexOf(sourceBlock![0])
    expect(serviceBlockIndex).toBeLessThan(sourceBlockIndex)
  })
})
