// SPDX-License-Identifier: Apache-2.0

/**
 * Built-in Capability Templates — starter templates for new users.
 *
 * Extracted from ImportPipeline to keep import logic focused on I/O.
 * Each template is a complete capability that can be imported into the store
 * via the ImportPipeline's "template" source type.
 */

import type { ManagedCapabilityCategory } from '@shared/types'

export interface BuiltInTemplate {
  name: string
  category: ManagedCapabilityCategory
  description: string
  content: string
}

export const BUILT_IN_TEMPLATES: BuiltInTemplate[] = [
  {
    name: 'code-review',
    category: 'skill',
    description: 'Structured code review with focus on correctness, performance, and readability',
    content: `---
name: code-review
description: Structured code review with focus on correctness, performance, and readability
---

When reviewing code, follow this structured approach:

1. **Correctness**: Check for logic errors, edge cases, null/undefined handling
2. **Performance**: Identify N+1 queries, unnecessary re-renders, memory leaks
3. **Readability**: Evaluate naming, function length, comment quality
4. **Security**: Check for injection risks, auth bypass, data exposure
5. **Testing**: Assess test coverage and edge case handling

Format your review with severity levels: 🔴 Critical, 🟡 Warning, 🟢 Suggestion
`,
  },
  {
    name: 'commit-message',
    category: 'command',
    description: 'Generate a conventional commit message from staged changes',
    content: `---
name: commit-message
description: Generate a conventional commit message from staged changes
argument-hint: "[scope]"
---

Analyze the staged git changes and generate a commit message following Conventional Commits format:

\`<type>(<scope>): <description>\`

Types: feat, fix, refactor, docs, style, test, chore, perf, ci, build
- Keep the description under 72 characters
- Use imperative mood ("add" not "added")
- Include scope when changes are localized to a module
`,
  },
  {
    name: 'always-chinese',
    category: 'rule',
    description: 'Always respond in Chinese regardless of input language',
    content: `---
name: always-chinese
description: Always respond in Chinese regardless of input language
---

Always respond in Chinese, regardless of the language used in user messages.
`,
  },
  {
    name: 'tdd-workflow',
    category: 'skill',
    description: 'Test-Driven Development workflow: Red → Green → Refactor',
    content: `---
name: tdd-workflow
description: Test-Driven Development workflow - Red → Green → Refactor
---

Follow the TDD cycle for all implementation tasks:

1. **Red**: Write a failing test first that describes the desired behavior
2. **Green**: Write the minimum code needed to make the test pass
3. **Refactor**: Clean up the code while keeping all tests green

Rules:
- Never write production code without a failing test
- Each test should test one behavior
- Run the full test suite after each change
- Commit after each successful Green → Refactor cycle
`,
  },
  {
    name: 'no-comments',
    category: 'rule',
    description: 'Do not add inline comments — code should be self-documenting',
    content: `---
name: no-comments
description: Do not add inline comments — code should be self-documenting
---

Do not add inline code comments. Instead:
- Use descriptive variable and function names
- Extract complex logic into well-named helper functions
- Only add JSDoc/TSDoc for public API surfaces
`,
  },
]
