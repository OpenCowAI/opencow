// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest'
import { BrowserService } from '../../../electron/browser/browserService'

describe('BrowserService profile selection', () => {
  it('uses preferred profile when preferredProfileId exists', async () => {
    const storeGetById = vi.fn().mockResolvedValue({
      id: 'preferred-1',
      name: 'Preferred Profile',
    })
    const service = new BrowserService({
      dispatch: vi.fn() as never,
      store: {
        getById: storeGetById,
      } as never,
    })
    const resolveDefaultSpy = vi.fn().mockResolvedValue('default-1')
    ;(
      service as unknown as {
        resolveDefaultProfileId: () => Promise<string>
      }
    ).resolveDefaultProfileId = resolveDefaultSpy

    const resolved = await (
      service as unknown as {
        resolveProfileId: (preferredProfileId?: string) => Promise<string>
      }
    ).resolveProfileId('preferred-1')

    expect(resolved).toBe('preferred-1')
    expect(storeGetById).toHaveBeenCalledWith('preferred-1')
    expect(resolveDefaultSpy).not.toHaveBeenCalled()
  })

  it('falls back to default profile when preferredProfileId is missing', async () => {
    const storeGetById = vi.fn().mockResolvedValue(null)

    const service = new BrowserService({
      dispatch: vi.fn() as never,
      store: {
        getById: storeGetById,
      } as never,
    })
    const resolveDefaultSpy = vi.fn().mockResolvedValue('default-1')
    ;(
      service as unknown as {
        resolveDefaultProfileId: () => Promise<string>
      }
    ).resolveDefaultProfileId = resolveDefaultSpy

    const resolved = await (
      service as unknown as {
        resolveProfileId: (preferredProfileId?: string) => Promise<string>
      }
    ).resolveProfileId('missing-preferred')

    expect(resolved).toBe('default-1')
    expect(storeGetById).toHaveBeenCalledWith('missing-preferred')
    expect(resolveDefaultSpy).toHaveBeenCalledTimes(1)
  })
})
