// SPDX-License-Identifier: Apache-2.0

import {
  ATTACHMENT_LIMITS,
  type AttachmentMediaType,
  type ImageMediaType,
  type DocumentMediaType,
  type IssueImage,
} from '@shared/types'

// ─── Discriminated Union ─────────────────────────────────────────────────────
//
// Two concrete shapes, narrowed by `kind`.
// Each variant carries ONLY the fields relevant to its kind — no optional
// fields, no semantic ambiguity (e.g. `base64Data` that is actually plain text).

export interface ImageAttachment {
  kind: 'image'
  id: string
  fileName: string
  mediaType: ImageMediaType
  /** Base64-encoded image data (no data-URI prefix). */
  base64Data: string
  sizeBytes: number
  /** Data URI for <img> preview (`data:image/png;base64,...`). Always present. */
  dataUrl: string
}

export interface DocumentAttachment {
  kind: 'document'
  id: string
  fileName: string
  mediaType: DocumentMediaType
  /** PDF: base64-encoded · text/plain: raw UTF-8 content. See `encoding`. */
  data: string
  /** Disambiguates the encoding of `data` — avoids the "base64Data that isn't base64" trap. */
  encoding: 'base64' | 'utf8'
  sizeBytes: number
}

export type ProcessedAttachment = ImageAttachment | DocumentAttachment

// ─── Error ───────────────────────────────────────────────────────────────────

export type AttachmentErrorCode = 'unsupported_type' | 'too_large' | 'read_failed'

export class AttachmentError extends Error {
  readonly code: AttachmentErrorCode
  readonly detail: unknown
  readonly limit: unknown

  constructor(code: AttachmentErrorCode, detail: unknown, limit?: unknown) {
    super(buildErrorMessage(code, detail, limit))
    this.name = 'AttachmentError'
    this.code = code
    this.detail = detail
    this.limit = limit
  }
}

function buildErrorMessage(code: AttachmentErrorCode, detail: unknown, limit?: unknown): string {
  switch (code) {
    case 'unsupported_type':
      return `Unsupported file type: ${detail}. Supported: PNG, JPEG, GIF, WebP, PDF, Plain Text`
    case 'too_large':
      return `File too large (${formatBytes(detail as number)}). Maximum is ${formatBytes(limit as number)}.`
    case 'read_failed':
      return 'Failed to read file'
  }
}

// ─── Validation ──────────────────────────────────────────────────────────────

const ALL_SUPPORTED_TYPES: readonly string[] = [
  ...ATTACHMENT_LIMITS.image.supportedTypes,
  ...ATTACHMENT_LIMITS.document.supportedTypes,
]

/** Extension-to-MIME fallback for files with empty `file.type` (common in drag-drop). */
const EXTENSION_MIME_MAP: Record<string, AttachmentMediaType> = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/plain',
  log: 'text/plain',
  csv: 'text/plain',
  json: 'text/plain',
  xml: 'text/plain',
  yaml: 'text/plain',
  yml: 'text/plain',
}

/** Type guard for supported attachment MIME types. */
export function isValidAttachmentType(type: string): type is AttachmentMediaType {
  return ALL_SUPPORTED_TYPES.includes(type)
}

/** Determine attachment kind from a validated MIME type. */
export function getAttachmentKind(type: AttachmentMediaType): 'image' | 'document' {
  return (ATTACHMENT_LIMITS.image.supportedTypes as readonly string[]).includes(type)
    ? 'image'
    : 'document'
}

/**
 * Resolve the MIME type for a file.
 * Falls back to extension-based detection when `file.type` is empty or unknown.
 */
export function resolveMediaType(file: File): AttachmentMediaType | null {
  if (file.type && isValidAttachmentType(file.type)) {
    return file.type as AttachmentMediaType
  }
  const ext = file.name.split('.').pop()?.toLowerCase()
  return ext ? (EXTENSION_MIME_MAP[ext] ?? null) : null
}

// ─── accept attribute (Single Source of Truth) ───────────────────────────────
//
// Derived from ATTACHMENT_LIMITS + EXTENSION_MIME_MAP.
// Every <input type="file" accept="..."> MUST use this constant.

const FILE_EXTENSIONS = Object.keys(EXTENSION_MIME_MAP).map((ext) => `.${ext}`)

/** The `accept` attribute value for file inputs — derived from ATTACHMENT_LIMITS. */
export const FILE_INPUT_ACCEPT = [
  ...ATTACHMENT_LIMITS.image.supportedTypes,
  ...ATTACHMENT_LIMITS.document.supportedTypes,
  ...FILE_EXTENSIONS,
].join(',')

// ─── Icon mapping ────────────────────────────────────────────────────────────

export type AttachmentIconName = 'file-text' | 'file-code'

/** Return the lucide icon name for a document media type (centralized mapping). */
export function getDocumentIconName(mediaType: DocumentMediaType): AttachmentIconName {
  return mediaType === 'application/pdf' ? 'file-text' : 'file-code'
}

// ─── Processing ──────────────────────────────────────────────────────────────

/** Validate, read, and encode a file into a `ProcessedAttachment`. */
export async function processAttachmentFile(file: File): Promise<ProcessedAttachment> {
  const mediaType = resolveMediaType(file)
  if (!mediaType) {
    throw new AttachmentError('unsupported_type', file.type || file.name)
  }

  const kind = getAttachmentKind(mediaType)
  const maxSize = kind === 'image'
    ? ATTACHMENT_LIMITS.image.maxSizeBytes
    : ATTACHMENT_LIMITS.document.maxSizeBytes
  if (file.size > maxSize) {
    throw new AttachmentError('too_large', file.size, maxSize)
  }

  try {
    if (kind === 'image') {
      return await processImageAttachment(file, mediaType as ImageMediaType)
    }
    if (mediaType === 'text/plain') {
      return await processTextAttachment(file, mediaType)
    }
    // PDF — binary document
    return await processBinaryAttachment(file, mediaType as DocumentMediaType)
  } catch (err) {
    if (err instanceof AttachmentError) throw err
    throw new AttachmentError('read_failed', err)
  }
}

async function processImageAttachment(
  file: File,
  mediaType: ImageMediaType,
): Promise<ImageAttachment> {
  const dataUrl = await readFileAsDataUrl(file)
  const base64Data = dataUrl.split(',')[1] // strip "data:image/png;base64,"

  return {
    kind: 'image',
    id: crypto.randomUUID(),
    fileName: file.name,
    mediaType,
    base64Data,
    sizeBytes: file.size,
    dataUrl,
  }
}

async function processTextAttachment(
  file: File,
  mediaType: DocumentMediaType,
): Promise<DocumentAttachment> {
  const text = await file.text()
  return {
    kind: 'document',
    id: crypto.randomUUID(),
    fileName: file.name,
    mediaType,
    data: text,
    encoding: 'utf8',
    sizeBytes: file.size,
  }
}

async function processBinaryAttachment(
  file: File,
  mediaType: DocumentMediaType,
): Promise<DocumentAttachment> {
  const buffer = await file.arrayBuffer()
  return {
    kind: 'document',
    id: crypto.randomUUID(),
    fileName: file.name,
    mediaType,
    data: arrayBufferToBase64(buffer),
    encoding: 'base64',
    sizeBytes: file.size,
  }
}

// ─── Convenience: image-only processing ──────────────────────────────────────
//
// For Issue consumers that only accept images. Wraps `processAttachmentFile`
// with a type-narrowing guard — no separate code path, just a narrower type.

/** Process a file expected to be an image. Throws if not an image type. */
export async function processImageFile(file: File): Promise<ImageAttachment> {
  const att = await processAttachmentFile(file)
  if (att.kind !== 'image') {
    throw new AttachmentError('unsupported_type', file.type || file.name)
  }
  return att
}

// ─── IssueImage ↔ ProcessedAttachment ────────────────────────────────────────

/** Convert persisted IssueImage[] to ImageAttachment[] for UI state. */
export function issueImagesToAttachments(images: IssueImage[]): ImageAttachment[] {
  return images.map((img) => ({
    kind: 'image' as const,
    id: img.id,
    fileName: '',
    mediaType: img.mediaType as ImageMediaType,
    base64Data: img.data,
    sizeBytes: img.sizeBytes,
    dataUrl: `data:${img.mediaType};base64,${img.data}`,
  }))
}

/** Convert ImageAttachment[] back to IssueImage[] for persistence. */
export function attachmentsToIssueImages(attachments: ProcessedAttachment[]): IssueImage[] {
  return attachments
    .filter((a): a is ImageAttachment => a.kind === 'image')
    .map((a) => ({
      id: a.id,
      mediaType: a.mediaType,
      data: a.base64Data,
      sizeBytes: a.sizeBytes,
    }))
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (): void => resolve(reader.result as string)
    reader.onerror = (): void => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

/** Format bytes into a human-readable string (e.g. "1.2 MB"). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
