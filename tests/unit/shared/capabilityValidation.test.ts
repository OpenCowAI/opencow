// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import { validateCapabilityName } from '@shared/capabilityValidation'

describe('validateCapabilityName', () => {
  it('returns null for valid names', () => {
    expect(validateCapabilityName('deploy')).toBeNull()
    expect(validateCapabilityName('my-command')).toBeNull()
    expect(validateCapabilityName('skill_v2')).toBeNull()
    expect(validateCapabilityName('a123')).toBeNull()
  })

  it('rejects empty name', () => {
    expect(validateCapabilityName('')).toBe('Name is required')
    expect(validateCapabilityName('  ')).toBe('Name is required')
  })

  it('rejects names with path traversal characters', () => {
    expect(validateCapabilityName('../etc/passwd')).not.toBeNull()
    expect(validateCapabilityName('foo/bar')).not.toBeNull()
    expect(validateCapabilityName('foo\\bar')).not.toBeNull()
  })

  it('rejects names starting with dot or hyphen', () => {
    expect(validateCapabilityName('.hidden')).not.toBeNull()
    expect(validateCapabilityName('-flag')).not.toBeNull()
  })

  it('rejects names with spaces or special characters', () => {
    expect(validateCapabilityName('has space')).not.toBeNull()
    expect(validateCapabilityName('has@symbol')).not.toBeNull()
  })
})
