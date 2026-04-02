// SPDX-License-Identifier: Apache-2.0

interface ContextFileDragPreviewInput {
  name: string
  isDirectory: boolean
  sourceElement?: HTMLElement | null
  pointerClient?: { clientX: number; clientY: number }
}

/**
 * Installs a custom rounded drag preview for internal context-file drag events.
 *
 * Browser default drag images are inconsistent across platforms and often ignore
 * expected rounded-corner appearance. This helper enforces a stable visual token.
 */
export function setContextFileDragPreview(
  dataTransfer: DataTransfer,
  input: ContextFileDragPreviewInput,
): void {
  if (typeof document === 'undefined' || typeof dataTransfer.setDragImage !== 'function') return

  if (
    input.sourceElement &&
    setDragPreviewFromSourceElement(dataTransfer, input.sourceElement, input.pointerClient)
  ) {
    return
  }

  setFallbackDragPreview(dataTransfer, input)
}

function setDragPreviewFromSourceElement(
  dataTransfer: DataTransfer,
  sourceElement: HTMLElement,
  pointerClient?: { clientX: number; clientY: number },
): boolean {
  if (!sourceElement.isConnected) return false

  const rect = sourceElement.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return false

  const clone = sourceElement.cloneNode(true)
  if (!(clone instanceof HTMLElement)) return false

  clone.removeAttribute('id')
  Object.assign(clone.style, {
    position: 'fixed',
    top: '-10000px',
    left: '-10000px',
    pointerEvents: 'none',
    margin: '0',
    width: `${Math.ceil(rect.width)}px`,
    height: `${Math.ceil(rect.height)}px`,
    transform: 'none',
    zIndex: '2147483647',
  } satisfies Partial<CSSStyleDeclaration>)

  document.body.appendChild(clone)
  const { x, y } = resolveDragAnchor(rect, pointerClient)
  dataTransfer.setDragImage(clone, x, y)

  requestAnimationFrame(() => {
    clone.remove()
  })

  return true
}

function resolveDragAnchor(
  rect: DOMRect,
  pointerClient?: { clientX: number; clientY: number },
): { x: number; y: number } {
  if (
    pointerClient &&
    Number.isFinite(pointerClient.clientX) &&
    Number.isFinite(pointerClient.clientY)
  ) {
    const rawX = pointerClient.clientX - rect.left
    const rawY = pointerClient.clientY - rect.top
    const maxX = Math.max(0, rect.width - 1)
    const maxY = Math.max(0, rect.height - 1)
    return {
      x: Math.round(Math.min(maxX, Math.max(0, rawX))),
      y: Math.round(Math.min(maxY, Math.max(0, rawY))),
    }
  }

  return {
    x: Math.round(rect.width / 2),
    y: Math.round(rect.height / 2),
  }
}

function setFallbackDragPreview(
  dataTransfer: DataTransfer,
  input: ContextFileDragPreviewInput,
): void {
  const container = document.createElement('div')
  Object.assign(container.style, {
    position: 'fixed',
    top: '-10000px',
    left: '-10000px',
    pointerEvents: 'none',
    zIndex: '2147483647',
    maxWidth: '260px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 10px',
    borderRadius: '10px',
    border: '1px solid hsl(var(--border))',
    background: 'hsl(var(--card))',
    color: 'hsl(var(--foreground))',
    boxShadow: '0 8px 20px hsl(var(--foreground) / 0.18)',
    fontSize: '12px',
    lineHeight: '1.2',
  } satisfies Partial<CSSStyleDeclaration>)

  const badge = document.createElement('span')
  badge.textContent = input.isDirectory ? 'DIR' : 'FILE'
  Object.assign(badge.style, {
    flexShrink: '0',
    borderRadius: '999px',
    border: '1px solid hsl(var(--border))',
    background: 'hsl(var(--muted))',
    color: 'hsl(var(--muted-foreground))',
    fontSize: '10px',
    lineHeight: '1',
    padding: '2px 6px',
    fontWeight: '600',
  } satisfies Partial<CSSStyleDeclaration>)

  const name = document.createElement('span')
  name.textContent = input.name
  Object.assign(name.style, {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    minWidth: '0',
  } satisfies Partial<CSSStyleDeclaration>)

  container.append(badge, name)
  document.body.appendChild(container)
  dataTransfer.setDragImage(container, 14, 14)

  requestAnimationFrame(() => {
    container.remove()
  })
}
