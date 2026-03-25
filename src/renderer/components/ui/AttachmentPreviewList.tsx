// SPDX-License-Identifier: Apache-2.0

import { memo, useState } from 'react'
import { X, FileText, FileCode } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ProcessedAttachment } from '@/lib/attachmentUtils'
import { getDocumentIconName } from '@/lib/attachmentUtils'
import { ImageLightbox } from '@/components/DetailPanel/ImageLightbox'

// ─── Size variants ───────────────────────────────────────────────────────────

type PreviewSize = 'sm' | 'md' | 'lg'

const SIZE_CONFIG = {
  sm: {
    thumbnail: 'h-10 w-10 rounded',
    chipHeight: 'h-10',
    chipPx: 'px-2',
    chipText: 'text-[10px]',
    chipMaxW: 'max-w-[140px]',
    iconSize: 'w-3 h-3',
    removeOffset: '-top-1 -right-1',
    removeIcon: 'w-2.5 h-2.5',
    gap: 'gap-1.5',
  },
  md: {
    thumbnail: 'h-12 w-12 rounded-md',
    chipHeight: 'h-12',
    chipPx: 'px-2.5',
    chipText: 'text-[11px]',
    chipMaxW: 'max-w-[160px]',
    iconSize: 'w-3.5 h-3.5',
    removeOffset: '-top-1 -right-1',
    removeIcon: 'w-2.5 h-2.5',
    gap: 'gap-1.5',
  },
  lg: {
    thumbnail: 'h-14 w-14 rounded-lg',
    chipHeight: 'h-14',
    chipPx: 'px-3',
    chipText: 'text-xs',
    chipMaxW: 'max-w-[180px]',
    iconSize: 'w-4 h-4',
    removeOffset: '-top-1.5 -right-1.5',
    removeIcon: 'w-3 h-3',
    gap: 'gap-2',
  },
} as const

// ─── Icon resolver (lucide) ──────────────────────────────────────────────────

const ICON_MAP = {
  'file-text': FileText,
  'file-code': FileCode,
} as const

// ─── Props ───────────────────────────────────────────────────────────────────

interface AttachmentPreviewListProps {
  attachments: ProcessedAttachment[]
  onRemove: (id: string) => void
  /** Visual size variant. Defaults to `sm`. */
  size?: PreviewSize
  /** Image rendering behavior. */
  image?: {
    previewMode?: 'none' | 'lightbox'
  }
  /** Container class overrides (e.g. padding). */
  className?: string
  /** ARIA label for the list container. */
  ariaLabel?: string
  /** Structured i18n labels for preview/remove/fallback copy. */
  labels?: {
    previewImage: string
    removeFile: string
    attachedImageFallbackAlt: string
    fallbackFileName: string
  }
}

const DEFAULT_LABELS: NonNullable<AttachmentPreviewListProps['labels']> = {
  previewImage: 'Preview image',
  removeFile: 'Remove file',
  attachedImageFallbackAlt: 'Attached image',
  fallbackFileName: 'file',
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Shared attachment preview strip — renders images as thumbnails and
 * documents as minimal chips. Used across all input bars.
 */
export const AttachmentPreviewList = memo(function AttachmentPreviewList({
  attachments,
  onRemove,
  size = 'sm',
  image,
  className,
  ariaLabel = 'Attached files',
  labels = DEFAULT_LABELS,
}: AttachmentPreviewListProps) {
  const [previewAttachmentId, setPreviewAttachmentId] = useState<string | null>(null)

  if (attachments.length === 0) return null

  const s = SIZE_CONFIG[size]
  const imagePreviewMode = image?.previewMode ?? 'none'
  const previewAttachment = previewAttachmentId
    ? attachments.find(
      (att): att is Extract<ProcessedAttachment, { kind: 'image' }> =>
        att.id === previewAttachmentId && att.kind === 'image'
    ) ?? null
    : null

  return (
    <>
      <div
        className={cn('flex overflow-x-auto', s.gap, className)}
        role="list"
        aria-label={ariaLabel}
      >
        {attachments.map((att) => (
          <div key={att.id} className="relative group shrink-0" role="listitem">
            {att.kind === 'image' ? (
              imagePreviewMode === 'lightbox' ? (
                <button
                  type="button"
                  onClick={() => setPreviewAttachmentId(att.id)}
                  className={cn(
                    s.thumbnail,
                    'shrink-0 border border-[hsl(var(--border))] overflow-hidden',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
                  )}
                  aria-label={labels.previewImage}
                >
                  <img
                    src={att.dataUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                </button>
              ) : (
                <div
                  className={cn(
                    s.thumbnail,
                    'shrink-0 border border-[hsl(var(--border))] overflow-hidden',
                  )}
                >
                  <img
                    src={att.dataUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                </div>
              )
            ) : (
              <span
                className={cn(
                  'inline-flex items-center gap-1',
                  s.chipHeight,
                  s.chipPx,
                  'rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.3)]',
                  s.chipText,
                  'text-[hsl(var(--foreground)/0.8)]',
                )}
              >
                {(() => {
                  const Icon = ICON_MAP[getDocumentIconName(att.mediaType)]
                  return (
                    <Icon
                      className={cn(s.iconSize, 'shrink-0 text-[hsl(var(--muted-foreground))]')}
                      aria-hidden="true"
                    />
                  )
                })()}
                <span className={cn(s.chipMaxW, 'truncate')}>{att.fileName || labels.fallbackFileName}</span>
              </span>
            )}

            {/* Remove button */}
            <button
              onClick={() => onRemove(att.id)}
              className={cn(
                'absolute p-0.5 rounded-full',
                'bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))]',
                'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                'transition-opacity',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
                s.removeOffset,
              )}
              aria-label={labels.removeFile}
            >
              <X className={s.removeIcon} />
            </button>
          </div>
        ))}
      </div>

      {previewAttachment && (
        <ImageLightbox
          src={previewAttachment.dataUrl}
          alt={previewAttachment.fileName || labels.attachedImageFallbackAlt}
          onClose={() => setPreviewAttachmentId(null)}
        />
      )}
    </>
  )
})
