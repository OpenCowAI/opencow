// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { OnboardingStore } from '../../../electron/services/onboardingStore'
import { join } from 'path'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'

let tempDir: string
let store: OnboardingStore

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'opencow-onboarding-'))
  store = new OnboardingStore(join(tempDir, 'onboarding.json'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('OnboardingStore', () => {
  it('returns default state when file does not exist', async () => {
    const state = await store.load()
    expect(state).toEqual({
      completed: false,
      hooksInstalled: false
    })
  })

  it('getState returns default before load', () => {
    const state = store.getState()
    expect(state).toEqual({
      completed: false,
      hooksInstalled: false
    })
  })

  it('getState returns loaded state after load', async () => {
    await store.complete()
    const state = store.getState()
    expect(state.completed).toBe(true)
  })

  it('marks onboarding as completed', async () => {
    const result = await store.complete()
    expect(result.completed).toBe(true)
    expect(result.hooksInstalled).toBe(false)
  })

  it('sets hooksInstalled to true', async () => {
    const result = await store.setHooksInstalled(true)
    expect(result.hooksInstalled).toBe(true)
    expect(result.completed).toBe(false)
  })

  it('sets hooksInstalled to false', async () => {
    await store.setHooksInstalled(true)
    const result = await store.setHooksInstalled(false)
    expect(result.hooksInstalled).toBe(false)
  })

  it('persists state across instances', async () => {
    const filePath = join(tempDir, 'onboarding.json')
    const store1 = new OnboardingStore(filePath)
    await store1.complete()
    await store1.setHooksInstalled(true)

    const store2 = new OnboardingStore(filePath)
    const state = await store2.load()
    expect(state.completed).toBe(true)
    expect(state.hooksInstalled).toBe(true)
  })

  it('handles corrupted JSON gracefully', async () => {
    const filePath = join(tempDir, 'onboarding.json')
    await writeFile(filePath, 'not valid json', 'utf-8')

    const svc = new OnboardingStore(filePath)
    const state = await svc.load()
    expect(state).toEqual({
      completed: false,
      hooksInstalled: false
    })
  })

  it('handles partial JSON gracefully', async () => {
    const filePath = join(tempDir, 'onboarding.json')
    await writeFile(filePath, JSON.stringify({ completed: true }), 'utf-8')

    const svc = new OnboardingStore(filePath)
    const state = await svc.load()
    expect(state.completed).toBe(true)
    expect(state.hooksInstalled).toBe(false)
  })

  it('returns copies to prevent external mutation', async () => {
    const state1 = await store.load()
    state1.completed = true
    const state2 = store.getState()
    expect(state2.completed).toBe(false)
  })

  it('caches after first load', async () => {
    const state1 = await store.load()
    const state2 = await store.load()
    expect(state1).toEqual(state2)
  })
})
