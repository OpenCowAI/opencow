// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react'
import { ImageThumbnail } from '../ImageThumbnail'
import { ImageLightbox } from '../ImageLightbox'
import type { ImageBlock } from '@shared/types'

interface ImageBlockViewProps {
  block: ImageBlock
}

export function ImageBlockView({ block }: ImageBlockViewProps): React.JSX.Element {
  const [showLightbox, setShowLightbox] = useState(false)
  const dataUri = `data:${block.mediaType};base64,${block.data}`

  return (
    <>
      <ImageThumbnail
        src={dataUri}
        alt="Image attachment"
        onClick={() => setShowLightbox(true)}
      />
      {showLightbox && (
        <ImageLightbox
          src={dataUri}
          alt="Image attachment"
          onClose={() => setShowLightbox(false)}
        />
      )}
    </>
  )
}
