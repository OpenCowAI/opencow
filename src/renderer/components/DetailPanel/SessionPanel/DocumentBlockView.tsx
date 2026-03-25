// SPDX-License-Identifier: Apache-2.0

import { memo } from 'react'
import { FileText, FileCode } from 'lucide-react'
import type { DocumentBlock } from '@shared/types'
import { formatBytes, getDocumentIconName } from '@/lib/attachmentUtils'

interface DocumentBlockViewProps {
  block: DocumentBlock
}

const ICON_MAP = { 'file-text': FileText, 'file-code': FileCode } as const

/**
 * Inline chip for document attachments (PDF / plain text) within the message list.
 *
 * Design: minimal rounded chip — icon · filename · size.
 */
export const DocumentBlockView = memo(function DocumentBlockView({ block }: DocumentBlockViewProps) {
  const Icon = ICON_MAP[getDocumentIconName(block.mediaType)]

  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[hsl(var(--muted)/0.3)] border border-[hsl(var(--border))] text-[hsl(var(--foreground)/0.8)] text-xs">
      <Icon className="w-3.5 h-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
      <span className="truncate max-w-[200px]">{block.title}</span>
      <span className="text-[hsl(var(--muted-foreground)/0.6)]">·</span>
      <span className="text-[hsl(var(--muted-foreground))] whitespace-nowrap">{formatBytes(block.sizeBytes)}</span>
    </span>
  )
})
