// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { resolveGenHtmlContent } from '../../../src/renderer/components/DetailPanel/SessionPanel/GenHtmlWidget'

describe('resolveGenHtmlContent', () => {
  it('returns the html markup from the canonical `html` field', () => {
    expect(
      resolveGenHtmlContent({ html: '<html><body>hello</body></html>' }),
    ).toBe('<html><body>hello</body></html>')
  })

  it('returns null when the html field is missing or whitespace', () => {
    expect(resolveGenHtmlContent({})).toBeNull()
    expect(resolveGenHtmlContent({ html: '' })).toBeNull()
    expect(resolveGenHtmlContent({ html: '   ' })).toBeNull()
    expect(resolveGenHtmlContent({ html: '\n\t' })).toBeNull()
  })

  it('ignores any leftover `content` field — it is no longer part of the schema', () => {
    // Schema previously accepted `content` as the canonical field with `html`
    // as a "legacy alias". The semantically loaded name caused models to
    // emit a textual page summary in `content` while the real HTML went to
    // `html`; the preferred-content resolution then silently rendered the
    // summary as the page. The whole alias was dropped.
    expect(
      resolveGenHtmlContent({
        content: 'a textual description that some models used to send here',
      }),
    ).toBeNull()
  })
})
