// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { mapScheduleDraftToCreateInput } from '../../../src/renderer/lib/scheduleDraftMapper'

describe('scheduleDraftMapper', () => {
  it('maps systemPrompt into create input session action', () => {
    const input = {
      name: 'Daily digest',
      description: 'Daily at 09:00',
      frequency: 'daily' as const,
      timeOfDay: '09:00',
      prompt: 'Generate daily digest',
      systemPrompt: 'Act as strict reviewer',
      priority: 'normal' as const,
      projectId: 'project-1',
    }

    const mapped = mapScheduleDraftToCreateInput(input, 'project-1')
    expect(mapped.action).toEqual(
      expect.objectContaining({
        type: 'start_session',
        projectId: 'project-1',
        session: expect.objectContaining({
          promptTemplate: 'Generate daily digest',
          systemPrompt: 'Act as strict reviewer',
        }),
      })
    )
  })
})

