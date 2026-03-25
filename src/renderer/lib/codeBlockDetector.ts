// SPDX-License-Identifier: Apache-2.0

/**
 * React-tree inspection utilities for detecting fenced code blocks.
 *
 * react-markdown renders `<pre><code class="language-xxx">…</code></pre>`.
 * However, when custom `components` are supplied (which OpenCow does), the
 * `child.type` of the `<code>` element is the *component function*, **not**
 * the native HTML tag string `'code'`.  We therefore identify code blocks
 * solely via their `className` containing `language-*`.
 *
 * These utilities are intentionally framework-agnostic pure functions
 * operating on `React.ReactNode`, making them straightforward to unit-test.
 */

import { Children, isValidElement } from 'react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The subset of props we inspect on code-block elements. */
interface CodeElementProps {
  className?: string
  children?: React.ReactNode
}

// ---------------------------------------------------------------------------
// Text extraction
// ---------------------------------------------------------------------------

/**
 * Recursively extract text content from a React element tree.
 *
 * Handles strings, numbers, and nested elements (e.g. syntax-highlighted
 * `<span>` trees produced by rehype-highlight).
 */
export function extractText(children: React.ReactNode): string {
  const parts: string[] = []

  Children.forEach(children, (child) => {
    if (typeof child === 'string') {
      parts.push(child)
    } else if (typeof child === 'number') {
      parts.push(String(child))
    } else if (isValidElement(child)) {
      const props = child.props as CodeElementProps
      if (props.children) {
        parts.push(extractText(props.children))
      }
    }
  })

  return parts.join('')
}

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

/**
 * Inspect the children of a `<pre>` element and, if a code block with the
 * given language class is found, return its raw text content.
 *
 * @param children  The `children` prop of a `<pre>` component.
 * @param language  The language identifier to match (e.g. `'mermaid'`).
 * @returns         The raw source text, or `null` if no match.
 *
 * @example
 * ```tsx
 * function SmartPre({ children }: { children?: React.ReactNode }) {
 *   const mermaid = detectLanguage(children, 'mermaid')
 *   if (mermaid) return <MermaidBlock code={mermaid} />
 *   return <pre>{children}</pre>
 * }
 * ```
 */
export function detectLanguage(children: React.ReactNode, language: string): string | null {
  const target = `language-${language}`
  let result: string | null = null

  Children.forEach(children, (child) => {
    if (isValidElement(child)) {
      const props = child.props as CodeElementProps
      if (
        typeof props.className === 'string' &&
        props.className.includes(target)
      ) {
        result = extractText(props.children).trim()
      }
    }
  })

  return result
}
