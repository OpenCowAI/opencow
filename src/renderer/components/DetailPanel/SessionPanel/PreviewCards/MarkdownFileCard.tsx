// SPDX-License-Identifier: Apache-2.0

/**
 * MarkdownFileCard — Compact inline preview card for Markdown files.
 *
 * Shows a rendered Markdown preview below the Write tool row.
 * Clicking the card opens the ContentViewerDialog modal.
 *
 * Migrated from ToolUseBlockView.tsx to reduce God Component size.
 */

import { FileText } from 'lucide-react'
import { MarkdownContent } from '../../../ui/MarkdownContent'

interface MarkdownFileCardProps {
  content: string
  filePath: string
  onClick: () => void
}

export function MarkdownFileCard({
  content,
  filePath,
  onClick
}: MarkdownFileCardProps): React.JSX.Element {
  const fileName = filePath.split('/').pop() ?? filePath
  const lineCount = content.split('\n').length

  return (
    <div
      className="ml-4 mt-1 max-w-lg rounded-xl border border-[hsl(var(--border)/0.5)] bg-[hsl(var(--card))] text-[hsl(var(--card-foreground))] cursor-pointer hover:border-[hsl(var(--primary)/0.5)] transition-colors group"
      onClick={onClick}
      role="button"
      tabIndex={0}
      aria-label={`Preview ${fileName}`}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[hsl(var(--border)/0.5)]">
        <FileText className="w-3.5 h-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
        <span className="text-xs font-medium text-[hsl(var(--foreground))] truncate">{fileName}</span>
        <span className="text-[10px] text-[hsl(var(--muted-foreground)/0.6)] shrink-0 ml-auto">
          {lineCount} lines
        </span>
      </div>
      {/* Rendered Markdown preview with fade-out */}
      <div className="relative">
        <div className="px-3 py-2 max-h-36 overflow-hidden" aria-label="Markdown preview">
          <MarkdownContent content={content} />
        </div>
        {/* Bottom fade-out gradient to hint at more content */}
        <div
          className="absolute bottom-0 left-0 right-0 h-8 pointer-events-none bg-gradient-to-t from-[hsl(var(--card))] to-transparent"
          aria-hidden="true"
        />
      </div>
      {/* Footer hint */}
      <div className="px-3 py-1 text-[10px] text-[hsl(var(--primary))] opacity-0 group-hover:opacity-100 transition-opacity">
        Click to open full preview
      </div>
    </div>
  )
}
