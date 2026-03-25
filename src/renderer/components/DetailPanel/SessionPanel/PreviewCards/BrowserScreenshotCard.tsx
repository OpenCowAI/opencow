// SPDX-License-Identifier: Apache-2.0

/**
 * BrowserScreenshotCard — Browser-style inline screenshot preview card.
 *
 * Displays a compact browser-chrome thumbnail of a browser screenshot
 * in the session console. Reuses the visual language from HtmlFileCard
 * (traffic-light dots, URL bar) for consistency.
 *
 * ## Design
 * - Browser chrome header with "Screenshot" label
 * - Image preview in a 16:10 viewport with `object-contain`
 * - Click opens ImageLightbox for full-screen viewing
 * - Compact `max-w-sm` to match HtmlFileCard width
 *
 * ## Security
 * No special concerns — we render a base64 data URI, not external content.
 */

import { useState } from 'react'
import { Camera } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ImageLightbox } from '../../ImageLightbox'

// ─── Types ───────────────────────────────────────────────────────────────────

interface BrowserScreenshotCardProps {
  /** Base64-encoded image data (no data URI prefix) */
  imageData: string
  /** MIME type of the image (e.g. 'image/png') */
  mediaType: string
}

// ─── Component ───────────────────────────────────────────────────────────────

export function BrowserScreenshotCard({
  imageData,
  mediaType,
}: BrowserScreenshotCardProps): React.JSX.Element {
  const [showLightbox, setShowLightbox] = useState(false)
  const dataUri = `data:${mediaType};base64,${imageData}`

  return (
    <>
      <div
        className={cn(
          'max-w-sm rounded-xl border border-[hsl(var(--border)/0.5)]',
          'bg-[hsl(var(--card))] text-[hsl(var(--card-foreground))]',
          'transition-colors group overflow-hidden',
          'cursor-pointer hover:border-[hsl(var(--primary)/0.5)]',
        )}
        onClick={() => setShowLightbox(true)}
        role="button"
        tabIndex={0}
        aria-label="View screenshot"
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setShowLightbox(true)
          }
        }}
      >
        {/* Browser chrome header */}
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[hsl(var(--border)/0.5)] bg-[hsl(var(--muted)/0.3)]">
          {/* Traffic-light dots (decorative) */}
          <div className="flex items-center gap-1 shrink-0" aria-hidden="true">
            <div className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--muted-foreground)/0.2)]" />
            <div className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--muted-foreground)/0.2)]" />
            <div className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--muted-foreground)/0.2)]" />
          </div>
          {/* URL bar */}
          <div className="flex items-center gap-1.5 flex-1 min-w-0 rounded-md bg-[hsl(var(--background)/0.6)] px-2 py-0.5">
            <Camera
              className="w-2.5 h-2.5 shrink-0 text-[hsl(var(--muted-foreground)/0.5)]"
              aria-hidden="true"
            />
            <span className="text-[10px] text-[hsl(var(--muted-foreground))] truncate font-mono">
              Screenshot
            </span>
          </div>
        </div>

        {/* Viewport — screenshot image */}
        <div className="relative aspect-[16/10] overflow-hidden bg-white">
          <img
            src={dataUri}
            alt="Browser screenshot"
            className="w-full h-full object-contain"
          />
        </div>

        {/* Hover hint */}
        <div className="px-3 py-1 text-[10px] text-[hsl(var(--primary))] opacity-0 group-hover:opacity-100 transition-opacity">
          Click to view full screenshot
        </div>
      </div>

      {/* Lightbox */}
      {showLightbox && (
        <ImageLightbox
          src={dataUri}
          alt="Browser screenshot"
          onClose={() => setShowLightbox(false)}
        />
      )}
    </>
  )
}
