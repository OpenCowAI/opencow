// SPDX-License-Identifier: Apache-2.0

import { describe, it, expectTypeOf } from 'vitest'
import type {
  OpenCowAPI,
  TypedIPCInvokeAPI,
  IPCHandler
} from '../../../src/shared/ipc'
import type {
  SerializableAppState, Project,
  OnboardingState, FileEntry, ClaudeCapabilities
} from '../../../src/shared/types'

describe('IPC type derivation', () => {
  it('derives correct invoke API types for get-initial-state', () => {
    expectTypeOf<TypedIPCInvokeAPI['get-initial-state']>().toBeFunction()
    expectTypeOf<TypedIPCInvokeAPI['get-initial-state']>().returns.toEqualTypeOf<Promise<SerializableAppState>>()
  })

  it('derives correct args types', () => {
    expectTypeOf<TypedIPCInvokeAPI['pin-project']>().parameter(0).toBeString()
  })

  it('derives correct return types for pin/archive channels', () => {
    expectTypeOf<TypedIPCInvokeAPI['pin-project']>().returns.toEqualTypeOf<Promise<Project>>()
    expectTypeOf<TypedIPCInvokeAPI['unpin-project']>().returns.toEqualTypeOf<Promise<Project>>()
  })

  it('derives correct event API types', () => {
    type EventCb = OpenCowAPI['on:opencow:event']
    expectTypeOf<EventCb>().toBeFunction()
  })

  it('OpenCowAPI combines invoke and event APIs', () => {
    expectTypeOf<OpenCowAPI['get-initial-state']>().toBeFunction()
    expectTypeOf<OpenCowAPI['on:opencow:event']>().toBeFunction()
  })

  it('derives correct handler types for main process', () => {
    expectTypeOf<IPCHandler<'get-initial-state'>>().returns.toMatchTypeOf<
      Promise<SerializableAppState> | SerializableAppState
    >()
    expectTypeOf<IPCHandler<'pin-project'>>().parameter(0).toBeString()
  })

  it('derives correct types for list-claude-capabilities', () => {
    expectTypeOf<TypedIPCInvokeAPI['list-claude-capabilities']>().toBeFunction()
    expectTypeOf<TypedIPCInvokeAPI['list-claude-capabilities']>().returns.toEqualTypeOf<Promise<ClaudeCapabilities>>()
  })
})
