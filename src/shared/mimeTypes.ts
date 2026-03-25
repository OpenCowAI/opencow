// SPDX-License-Identifier: Apache-2.0

import type { ArtifactKind, ArtifactRenderer } from './types'

// ─── MIME Type Resolution ───────────────────────────────────────────────────

const EXTENSION_MIME_MAP: Record<string, string> = {
  // Markdown
  '.md': 'text/markdown',
  '.mdx': 'text/markdown',
  // TypeScript / JavaScript
  '.ts': 'text/typescript',
  '.tsx': 'text/typescript',
  '.js': 'text/javascript',
  '.jsx': 'text/javascript',
  '.mjs': 'text/javascript',
  '.cjs': 'text/javascript',
  // Data formats
  '.json': 'application/json',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.toml': 'text/toml',
  '.xml': 'application/xml',
  '.csv': 'text/csv',
  // Web
  '.html': 'text/html',
  '.css': 'text/css',
  '.scss': 'text/x-scss',
  '.less': 'text/x-less',
  '.svg': 'image/svg+xml',
  // Languages
  '.py': 'text/x-python',
  '.rs': 'text/x-rust',
  '.go': 'text/x-go',
  '.java': 'text/x-java',
  '.rb': 'text/x-ruby',
  '.php': 'text/x-php',
  '.c': 'text/x-c',
  '.cpp': 'text/x-cpp',
  '.h': 'text/x-c',
  '.sh': 'text/x-shellscript',
  '.bash': 'text/x-shellscript',
  '.zsh': 'text/x-shellscript',
  '.sql': 'text/x-sql',
  '.graphql': 'text/x-graphql',
  // Diagrams
  '.mermaid': 'text/x-mermaid',
  '.mmd': 'text/x-mermaid',
  // Config
  '.env': 'text/plain',
  '.gitignore': 'text/plain',
  '.dockerignore': 'text/plain',
  '.editorconfig': 'text/plain',
  // Images
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

/**
 * Derive MIME type from a file extension (with leading dot).
 * Returns 'text/plain' for unknown extensions.
 */
export function mimeTypeFromExtension(ext: string): string {
  return EXTENSION_MIME_MAP[ext.toLowerCase()] ?? 'text/plain'
}

// ─── Renderer Resolution ────────────────────────────────────────────────────

/**
 * Pure function: derive the frontend renderer from artifact kind + MIME type.
 *
 * This is NOT stored in the DB — it's derived at read time so the rendering
 * strategy can evolve without migrations.
 */
export function resolveRenderer(kind: ArtifactKind, mimeType: string): ArtifactRenderer {
  switch (kind) {
    case 'diagram':
      return 'mermaid'
    // Phase 2 kinds — uncomment when ArtifactKind union is extended:
    // case 'image':  return 'image'
    // case 'snippet': return 'code'
    // case 'card':    return 'raw'
    case 'file': {
      if (mimeType === 'text/markdown') return 'markdown'
      if (mimeType === 'text/html') return 'html'
      if (mimeType === 'text/x-mermaid') return 'mermaid'
      if (mimeType.startsWith('image/')) return 'image'
      return 'code'
    }
    default:
      return 'raw'
  }
}

// ─── File Extension Utilities ───────────────────────────────────────────────

/**
 * Extract file extension (with leading dot) from a file path.
 * Returns empty string if no extension found.
 */
export function extractExtension(filePath: string): string {
  const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  const basename = filePath.substring(lastSlash + 1)
  const dotIdx = basename.lastIndexOf('.')
  if (dotIdx <= 0) return '' // no dot, or dot is first char (hidden file)
  return basename.substring(dotIdx).toLowerCase()
}
