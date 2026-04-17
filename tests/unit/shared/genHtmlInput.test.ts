// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { GEN_HTML_DEFAULT_TITLE, parseGenHtmlInput } from '../../../src/shared/genHtmlInput'

describe('parseGenHtmlInput', () => {
  it('reads html markup from the canonical `html` field', () => {
    const parsed = parseGenHtmlInput({
      title: 'AI Agent Intro',
      html: '<!doctype html><html><body>hello</body></html>',
    })

    expect(parsed.title).toBe('AI Agent Intro')
    expect(parsed.html).toBe('<!doctype html><html><body>hello</body></html>')
  })

  it('falls back to default title when title is missing or whitespace', () => {
    const parsed = parseGenHtmlInput({
      title: '   ',
      html: '<div>x</div>',
    })

    expect(parsed.title).toBe(GEN_HTML_DEFAULT_TITLE)
    expect(parsed.html).toBe('<div>x</div>')
  })

  it('returns null html for empty / whitespace markup', () => {
    expect(parseGenHtmlInput({ html: '' }).html).toBeNull()
    expect(parseGenHtmlInput({ html: ' \n\t ' }).html).toBeNull()
    expect(parseGenHtmlInput({}).html).toBeNull()
  })

  it('ignores the legacy `content` field — its ambiguity caused some models to send a description there while the real markup went to `html`', () => {
    // Bug repro from session ccb-5daD6389nAMh: GPT-5.4 emitted both fields,
    // putting a Chinese summary in `content` and the real HTML in `html`.
    // The old preferred-content resolution silently rendered the summary as
    // the page. After dropping `content`, only `html` is read.
    const parsed = parseGenHtmlInput({
      title: 'AI Agent 简介',
      content: '一个简单的 AI Agent 介绍页面，概述定义、能力、典型场景与注意事项。',
      html: '<!doctype html><html><body><h1>AI Agent</h1></body></html>',
    })

    expect(parsed.html).toBe('<!doctype html><html><body><h1>AI Agent</h1></body></html>')
  })
})
