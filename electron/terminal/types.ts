// SPDX-License-Identifier: Apache-2.0

import type { IPty } from 'node-pty'
import type { TerminalScope, DataBusEvent } from '@shared/types'

/** Dependency injection for Terminal Service */
export interface TerminalServiceDeps {
  dispatch: (event: DataBusEvent) => void
  resolveCwd: (scope: TerminalScope) => string
}

/** Ring Buffer — fixed-size output buffer */
export interface RingBuffer {
  /** Append data to the buffer */
  push(data: string): void
  /** Read all contents from the buffer */
  drain(): string
  /** Current buffer size in bytes */
  readonly size: number
}

/** Internal Terminal instance in the main process */
export interface ManagedTerminal {
  id: string
  scope: TerminalScope
  pty: IPty
  shell: string
  /** Output history Ring Buffer (used for replay on scope switch) */
  outputBuffer: RingBuffer
  createdAt: number
}
