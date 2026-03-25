// SPDX-License-Identifier: Apache-2.0

import { memo } from 'react'
import { cn } from '@/lib/utils'

/**
 * Regex to detect URLs in plain text.
 *
 * Matches:
 *  - `https://example.com/path?q=1&b=2#frag`
 *  - `http://example.com`
 *  - `www.example.com/path`
 *
 * The pattern avoids trailing punctuation (.,;:!?) and balanced parentheses so
 * that URLs embedded in prose like "see https://x.com." don't swallow the period.
 */
const URL_REGEX =
  /(?:https?:\/\/|www\.)(?:[^\s<>[\](){}]|\([^\s<>[\](){}]*\))+(?<=[^\s<>[\](){}.,:;!?'")\]])/gu

/** A segment of parsed text — either plain text or a detected URL */
interface Segment {
  type: 'text' | 'url'
  value: string
}

/** Parse plain text into an array of text/url segments */
function parseSegments(text: string): Segment[] {
  const segments: Segment[] = []
  let lastIndex = 0

  // Reset regex state (global flag means stateful)
  URL_REGEX.lastIndex = 0

  let match: RegExpExecArray | null = URL_REGEX.exec(text)
  while (match !== null) {
    // Push preceding plain text (if any)
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, match.index) })
    }

    segments.push({ type: 'url', value: match[0] })
    lastIndex = match.index + match[0].length
    match = URL_REGEX.exec(text)
  }

  // Push remaining plain text
  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) })
  }

  return segments
}

/** Ensure a URL has a protocol prefix for the href attribute */
function ensureProtocol(url: string): string {
  if (/^https?:\/\//i.test(url)) return url
  return `https://${url}`
}

const LINK_CLASS =
  'text-[hsl(var(--primary))] underline decoration-[hsl(var(--primary)/0.4)] hover:decoration-[hsl(var(--primary))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))] rounded-sm transition-colors'

interface LinkifiedTextProps {
  /** The plain text that may contain URLs */
  text: string
  /** Additional class names applied to the wrapper <span> */
  className?: string
}

/**
 * Renders plain text with auto-detected HTTP(S) URLs converted to clickable
 * links.  All links open in a new tab with `rel="noopener noreferrer"`.
 *
 * If the text contains no URLs, it renders a simple text node (zero overhead).
 */
export const LinkifiedText = memo(function LinkifiedText({
  text,
  className
}: LinkifiedTextProps): React.JSX.Element {
  const segments = parseSegments(text)

  // Fast path — no URLs detected, render plain text without extra wrapper
  if (segments.length === 1 && segments[0].type === 'text') {
    return <span className={className}>{text}</span>
  }

  return (
    <span className={cn(className)}>
      {segments.map((seg, i) =>
        seg.type === 'url' ? (
          <a
            key={i}
            href={ensureProtocol(seg.value)}
            className={LINK_CLASS}
            target="_blank"
            rel="noopener noreferrer"
          >
            {seg.value}
          </a>
        ) : (
          <span key={i}>{seg.value}</span>
        )
      )}
    </span>
  )
})
