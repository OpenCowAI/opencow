// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.cwd()

function readSource(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), 'utf8')
}

describe('Main/detail header style contract', () => {
  it('keeps MainPanel tab header on fixed 48px height with full border color token', () => {
    const source = readSource('src/renderer/components/MainPanel/MainPanel.tsx')
    expect(source).toContain('className="drag-region shrink-0 h-12 border-b border-[hsl(var(--border)/0.5)] px-2 flex gap-1 items-center"')
    expect(source).not.toContain('items-center py-2')
  })

  it('uses the same fixed-height header contract in IssueDetailView top bars', () => {
    const source = readSource('src/renderer/components/DetailPanel/IssueDetailView.tsx')
    const matches = source.match(/className="(?:drag-region )?flex items-center justify-between px-4 shrink-0 h-12 border-b border-\[hsl\(var\(--border\)\/0\.5\)\]"/g)
    expect(matches?.length).toBe(2)
    expect(source).not.toContain('px-4 py-3 border-b border-[hsl(var(--border))]')
  })
})
