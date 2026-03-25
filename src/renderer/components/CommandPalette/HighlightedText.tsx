// SPDX-License-Identifier: Apache-2.0

/**
 * Renders text with fuzzy-match character highlights.
 * Reuses buildHighlightRuns from shared/fileSearch.ts.
 */

import { buildHighlightRuns } from '@shared/fileSearch'

interface HighlightedTextProps {
  text: string
  highlights: number[]
  className?: string
}

export function HighlightedText({ text, highlights, className }: HighlightedTextProps): React.JSX.Element {
  if (highlights.length === 0) {
    return <span className={className}>{text}</span>
  }

  const runs = buildHighlightRuns(text, highlights)

  return (
    <span className={className}>
      {runs.map((run, i) =>
        run.highlighted ? (
          <mark key={i} className="bg-transparent text-[hsl(var(--primary))] font-semibold">
            {run.text}
          </mark>
        ) : (
          <span key={i}>{run.text}</span>
        ),
      )}
    </span>
  )
}
