// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { GEN_HTML_DEFAULT_TITLE, parseGenHtmlInput } from '../../../src/shared/genHtmlInput'

describe('parseGenHtmlInput', () => {
  it('prefers content over html alias', () => {
    const parsed = parseGenHtmlInput({
      title: 'AI Agent Intro',
      content: '<html><body>content</body></html>',
      html: '<html><body>alias</body></html>',
    })

    expect(parsed.title).toBe('AI Agent Intro')
    expect(parsed.content).toBe('<html><body>content</body></html>')
  })

  it('uses html alias when content is absent', () => {
    const parsed = parseGenHtmlInput({
      html: '<html><body>alias-only</body></html>',
    })

    expect(parsed.title).toBe(GEN_HTML_DEFAULT_TITLE)
    expect(parsed.content).toBe('<html><body>alias-only</body></html>')
  })

  it('returns null content for empty payloads', () => {
    const parsed = parseGenHtmlInput({
      title: '   ',
      content: ' \n\t ',
      html: '',
    })

    expect(parsed.title).toBe(GEN_HTML_DEFAULT_TITLE)
    expect(parsed.content).toBeNull()
  })
})
