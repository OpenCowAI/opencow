// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it } from 'vitest'
import { ensureSdkCompatEnv } from '../../../electron/command/sdkCompatEnv'

const ORIGINAL_VALUE = process.env.USE_BUILTIN_RIPGREP

describe('ensureSdkCompatEnv', () => {
  afterEach(() => {
    if (ORIGINAL_VALUE === undefined) {
      delete process.env.USE_BUILTIN_RIPGREP
    } else {
      process.env.USE_BUILTIN_RIPGREP = ORIGINAL_VALUE
    }
  })

  it('defaults SDK ripgrep to system rg when unset', () => {
    delete process.env.USE_BUILTIN_RIPGREP

    ensureSdkCompatEnv()

    expect(process.env.USE_BUILTIN_RIPGREP).toBe('0')
  })

  it('respects an explicit override', () => {
    process.env.USE_BUILTIN_RIPGREP = '1'

    ensureSdkCompatEnv()

    expect(process.env.USE_BUILTIN_RIPGREP).toBe('1')
  })
})
