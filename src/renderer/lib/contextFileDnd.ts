// SPDX-License-Identifier: Apache-2.0

import {
  CONTEXT_FILE_DRAG_MIME,
  decodeContextFileDragPayload,
  encodeContextFileDragPayload,
  type ContextFileDescriptor,
} from '@shared/contextFileDnd'

/**
 * Returns true when the drag event carries OpenCow context-file payload.
 */
export function hasContextFileDrag(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes(CONTEXT_FILE_DRAG_MIME)
}

/**
 * Writes OpenCow context-file payload into DataTransfer.
 */
export function writeContextFileDrag(
  dataTransfer: DataTransfer,
  file: ContextFileDescriptor,
): void {
  dataTransfer.setData(CONTEXT_FILE_DRAG_MIME, encodeContextFileDragPayload(file))
  dataTransfer.effectAllowed = 'copy'
}

/**
 * Reads and validates OpenCow context-file payload from DataTransfer.
 */
export function readContextFileDrag(dataTransfer: DataTransfer): ContextFileDescriptor | null {
  const raw = dataTransfer.getData(CONTEXT_FILE_DRAG_MIME)
  return decodeContextFileDragPayload(raw)
}
