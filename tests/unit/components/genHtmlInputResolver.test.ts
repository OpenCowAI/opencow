// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { resolveGenHtmlContent } from '../../../src/renderer/components/DetailPanel/SessionPanel/GenHtmlWidget'

describe('resolveGenHtmlContent', () => {
  it('prefers input.content when present', () => {
    const content = resolveGenHtmlContent({
      content: '<html><body>from-content</body></html>',
      html: '<html><body>from-html</body></html>',
    })

    expect(content).toBe('<html><body>from-content</body></html>')
  })

  it('falls back to input.html alias when content is absent', () => {
    const content = resolveGenHtmlContent({
      html: '<html><body>from-html</body></html>',
    })

    expect(content).toBe('<html><body>from-html</body></html>')
  })

  it('returns null for empty or whitespace-only payloads', () => {
    expect(resolveGenHtmlContent({ content: '' })).toBeNull()
    expect(resolveGenHtmlContent({ content: '   ' })).toBeNull()
    expect(resolveGenHtmlContent({ html: '\n\t' })).toBeNull()
  })
})

