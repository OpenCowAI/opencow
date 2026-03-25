// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('codex sdk import guard', () => {
  it('uses runtime dynamic import and avoids static value import for @openai/codex-sdk', () => {
    const source = readFileSync(
      join(process.cwd(), 'electron/command/codexQueryLifecycle.ts'),
      'utf-8',
    )

    // Prevent accidental regression to CJS-incompatible static value import.
    const staticValueImport = /import\s+(?!type\b)[^;]*from\s+['"]@openai\/codex-sdk['"]/
    expect(source).not.toMatch(staticValueImport)

    // Keep an explicit dynamic-import path for ESM-only SDK loading.
    expect(source).toContain("new Function('specifier', 'return import(specifier)')")
    expect(source).toContain("nativeDynamicImport('@openai/codex-sdk')")
  })
})
