// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { setContextFileDragPreview } from '../../../src/renderer/lib/contextFileDragPreview'

describe('setContextFileDragPreview', () => {
  it('anchors drag image at the pointer position within source element bounds', () => {
    const source = document.createElement('div')
    source.textContent = 'card'
    source.style.width = '120px'
    source.style.height = '80px'
    document.body.appendChild(source)

    const setDragImage = vi.fn()
    const dataTransfer = { setDragImage } as unknown as DataTransfer

    vi.spyOn(source, 'getBoundingClientRect').mockReturnValue({
      x: 10,
      y: 20,
      top: 20,
      left: 10,
      right: 130,
      bottom: 100,
      width: 120,
      height: 80,
      toJSON: () => ({}),
    } as DOMRect)

    setContextFileDragPreview(dataTransfer, {
      name: 'a.ts',
      isDirectory: false,
      sourceElement: source,
      pointerClient: { clientX: 70, clientY: 60 },
    })

    expect(setDragImage).toHaveBeenCalledTimes(1)
    const [, offsetX, offsetY] = setDragImage.mock.calls[0] as [Element, number, number]
    expect(offsetX).toBe(60) // 70 - 10
    expect(offsetY).toBe(40) // 60 - 20
  })
})

