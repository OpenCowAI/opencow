// SPDX-License-Identifier: Apache-2.0

import type { IPCChannels, IPCEventChannels } from './types'

// Derive the typed API that the renderer sees via window.opencow
// For invoke channels: (...args) => Promise<return>
export type TypedIPCInvokeAPI = {
  [K in keyof IPCChannels]: (...args: IPCChannels[K]['args']) => Promise<IPCChannels[K]['return']>
}

// For event channels: (callback: (data: T) => void) => unsubscribe
export type TypedIPCEventAPI = {
  [K in keyof IPCEventChannels as `on:${K}`]: (
    callback: (data: IPCEventChannels[K]) => void
  ) => () => void
}

// Dynamic per-terminal output listener (channel = `terminal:output:${id}`)
export interface TerminalOutputAPI {
  'terminal:onOutput': (
    terminalId: string,
    callback: (data: string) => void,
  ) => () => void
}

// The complete API exposed to renderer
export type OpenCowAPI = TypedIPCInvokeAPI & TypedIPCEventAPI & TerminalOutputAPI

// Handler types for main process registration
export type IPCHandler<K extends keyof IPCChannels> = (
  ...args: IPCChannels[K]['args']
) => Promise<IPCChannels[K]['return']> | IPCChannels[K]['return']
