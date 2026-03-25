// SPDX-License-Identifier: Apache-2.0

import { readFile, writeFile, mkdir } from 'fs/promises'
import { dirname } from 'path'
import type { OnboardingState } from '@shared/types'

const DEFAULT_STATE: OnboardingState = {
  completed: false,
  hooksInstalled: false
}

export class OnboardingStore {
  private filePath: string
  private state: OnboardingState | null = null

  constructor(filePath: string) {
    this.filePath = filePath
  }

  async load(): Promise<OnboardingState> {
    if (this.state) return { ...this.state }

    try {
      const raw = await readFile(this.filePath, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<OnboardingState>
      this.state = {
        completed: typeof parsed.completed === 'boolean' ? parsed.completed : false,
        hooksInstalled: typeof parsed.hooksInstalled === 'boolean' ? parsed.hooksInstalled : false
      }
    } catch {
      this.state = { ...DEFAULT_STATE }
    }

    return { ...this.state }
  }

  async complete(): Promise<OnboardingState> {
    await this.load()
    this.state!.completed = true
    await this.save()
    return { ...this.state! }
  }

  async setHooksInstalled(installed: boolean): Promise<OnboardingState> {
    await this.load()
    this.state!.hooksInstalled = installed
    await this.save()
    return { ...this.state! }
  }

  getState(): OnboardingState {
    if (!this.state) {
      return { ...DEFAULT_STATE }
    }
    return { ...this.state }
  }

  private async save(): Promise<void> {
    if (!this.state) return
    const dir = dirname(this.filePath)
    await mkdir(dir, { recursive: true })
    await writeFile(this.filePath, JSON.stringify(this.state, null, 2) + '\n', 'utf-8')
  }
}
