// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react'
import { ImageOff } from 'lucide-react'

interface ImageThumbnailProps {
  src: string
  alt: string
  onClick: () => void
}

export function ImageThumbnail({ src, alt, onClick }: ImageThumbnailProps): React.JSX.Element {
  const [error, setError] = useState(false)

  return (
    <button
      type="button"
      className="h-8 w-8 shrink-0 rounded border border-[hsl(var(--border))] overflow-hidden hover:ring-2 hover:ring-[hsl(var(--ring))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] transition-shadow"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      aria-label={alt}
    >
      {error ? (
        <span className="flex items-center justify-center h-full w-full bg-[hsl(var(--muted))]">
          <ImageOff className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
        </span>
      ) : (
        <img
          src={src}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setError(true)}
        />
      )}
    </button>
  )
}
