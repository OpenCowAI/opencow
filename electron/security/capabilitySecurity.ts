// SPDX-License-Identifier: Apache-2.0

/**
 * Capability Security — content and path validation for capability operations.
 *
 * v3.1 fix #28: validate content before saving to prevent:
 *   - Oversized files (DoS / disk abuse)
 *   - Malicious frontmatter injection
 *   - Invalid file names (path traversal)
 *   - Script injection in config-type capabilities
 *
 * M6: async path validation resolves symlinks before whitelist check.
 */

import { realpath } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { APP_FS_NAME } from '@shared/appIdentity'

// Maximum file size: 512 KB
const MAX_CONTENT_BYTES = 512 * 1024

// Name constraints
const NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/
const MAX_NAME_LENGTH = 128

// Dangerous patterns in config JSON (no /g flag — test() doesn't need global state)
const DANGEROUS_PATTERNS = [
  /\$\{.*?\}/, // template literal injection
  /\beval\s*\(/, // eval calls
  /\brequire\s*\(/, // require calls
  /\bimport\s*\(/, // dynamic import
  /\b__proto__\b/, // prototype pollution
  /\bconstructor\b.*\bprototype\b/, // prototype chain
]

export class CapabilitySecurityError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message)
    this.name = 'CapabilitySecurityError'
  }
}

/**
 * Validate capability content before saving.
 * Throws CapabilitySecurityError if content is invalid.
 */
export function validateCapabilityContent(content: string, name: string): void {
  // ── Name validation ──
  if (!name || name.length === 0) {
    throw new CapabilitySecurityError('Capability name is required', 'EMPTY_NAME')
  }

  if (name.length > MAX_NAME_LENGTH) {
    throw new CapabilitySecurityError(
      `Name exceeds ${MAX_NAME_LENGTH} characters`,
      'NAME_TOO_LONG',
    )
  }

  if (!NAME_PATTERN.test(name)) {
    throw new CapabilitySecurityError(
      'Name must start with alphanumeric and contain only alphanumeric, dots, hyphens, underscores',
      'INVALID_NAME',
    )
  }

  // Path traversal guard
  if (name.includes('..') || name.includes('/') || name.includes('\\')) {
    throw new CapabilitySecurityError(
      'Name contains path traversal characters',
      'PATH_TRAVERSAL',
    )
  }

  // ── Content size validation ──
  const byteLength = Buffer.byteLength(content, 'utf8')
  if (byteLength > MAX_CONTENT_BYTES) {
    throw new CapabilitySecurityError(
      `Content exceeds ${MAX_CONTENT_BYTES} bytes (${byteLength} bytes)`,
      'CONTENT_TOO_LARGE',
    )
  }

  if (content.length === 0) {
    throw new CapabilitySecurityError('Content is empty', 'EMPTY_CONTENT')
  }
}

/**
 * Validate JSON config content for suspicious patterns.
 * Used for hook and mcp-server config files.
 */
export function validateConfigContent(content: string, name: string): void {
  validateCapabilityContent(content, name)

  // Check for dangerous patterns in config JSON
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(content)) {
      throw new CapabilitySecurityError(
        `Config contains suspicious pattern: ${pattern.source}`,
        'SUSPICIOUS_PATTERN',
      )
    }
  }

  // Validate JSON structure
  try {
    JSON.parse(content)
  } catch {
    throw new CapabilitySecurityError(
      'Config content is not valid JSON',
      'INVALID_JSON',
    )
  }
}

/**
 * Sanitize a capability name — strips unsafe characters but keeps it readable.
 */
export function sanitizeCapabilityName(raw: string): string {
  return raw
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, MAX_NAME_LENGTH)
}

// ─── Async Path Validation (M6) ─────────────────────────────────────────

/**
 * Async path safety validation for capability file operations.
 * Resolves symlinks before checking against the whitelist.
 * This prevents symlink-based escape attacks.
 *
 * @param context.globalRoot — If provided, used as the primary whitelist root.
 *   This allows dev-mode paths (e.g. ~/.opencow-dev/) to be whitelisted correctly
 *   without hardcoding the suffix in the security module.
 */
export async function validateCapabilityPath(
  targetPath: string,
  context?: { projectPath?: string; globalRoot?: string },
): Promise<void> {
  // Resolve the path to its real location (follows symlinks).
  // SECURITY: Never fall back to path.resolve() — it does NOT resolve
  // symlinks, which would allow symlink-based escape attacks.
  let resolved: string
  try {
    resolved = await realpath(targetPath)
  } catch {
    // File/directory doesn't exist yet — walk UP the ancestor chain until
    // we find an existing directory, then reconstruct the resolved path.
    // This handles skill bundles where multiple levels may not exist yet
    // (e.g. `skills/my-skill/SKILL.md` — neither `my-skill/` nor potentially
    // `skills/` exist).
    let ancestor = targetPath
    const missingSegments: string[] = []
    let realAncestor: string | null = null

    // Walk up at most 5 levels (prevents runaway on broken paths)
    for (let i = 0; i < 5; i++) {
      const segment = path.basename(ancestor)
      ancestor = path.dirname(ancestor)
      if (ancestor === path.dirname(ancestor)) break // reached filesystem root
      missingSegments.unshift(segment)
      try {
        realAncestor = await realpath(ancestor)
        break
      } catch {
        // ancestor doesn't exist either, keep walking up
      }
    }

    if (!realAncestor) {
      throw new CapabilitySecurityError(
        `Cannot verify path safety — no accessible ancestor directory for: ${targetPath}`,
        'PATH_UNRESOLVABLE',
      )
    }

    resolved = path.join(realAncestor, ...missingSegments)
  }

  if (!isAllowedCapabilityPath(resolved, context?.projectPath, context?.globalRoot)) {
    throw new CapabilitySecurityError(
      `Path outside allowed capability directories: ${targetPath}`,
      'PATH_DENIED',
    )
  }
}

/**
 * Whitelist check for capability paths.
 * Allows:
 *   - ~/.opencow/** (global Capability Center)
 *   - ~/.claude/** (legacy Claude Code)
 *   - ~/.claude.json (global MCP config)
 *   - {project}/.opencow/** (project Capability Center)
 *   - {project}/.claude/** (project Claude Code)
 *   - {project}/.mcp.json (project MCP config)
 */
function isAllowedCapabilityPath(resolved: string, projectPath?: string, globalRoot?: string): boolean {
  const home = os.homedir()

  // Explicitly configured global root (handles dev-mode suffix correctly)
  if (globalRoot) {
    const resolvedRoot = path.resolve(globalRoot)
    if (resolved.startsWith(resolvedRoot + path.sep) || resolved === resolvedRoot) return true
  }

  // Global Capability Center store: ~/.opencow/ (fallback for unconfigured callers)
  const opencowDir = path.resolve(home, `.${APP_FS_NAME}`)
  if (resolved.startsWith(opencowDir + path.sep) || resolved === opencowDir) return true

  // Dev-mode store: ~/.opencow-dev/
  const opencowDevDir = path.resolve(home, `.${APP_FS_NAME}-dev`)
  if (resolved.startsWith(opencowDevDir + path.sep) || resolved === opencowDevDir) return true

  // Legacy Claude Code global paths
  const claudeDir = path.resolve(home, '.claude')
  if (resolved.startsWith(claudeDir + path.sep) || resolved === claudeDir) return true

  const claudeJsonPath = path.resolve(home, '.claude.json')
  if (resolved === claudeJsonPath) return true

  if (projectPath) {
    const projectResolved = path.resolve(projectPath)

    // Project-level Capability Center store (both prod and dev)
    const projectOpencowDir = path.resolve(projectResolved, `.${APP_FS_NAME}`)
    if (resolved.startsWith(projectOpencowDir + path.sep)) return true
    const projectOpencowDevDir = path.resolve(projectResolved, `.${APP_FS_NAME}-dev`)
    if (resolved.startsWith(projectOpencowDevDir + path.sep)) return true

    // Legacy project Claude Code paths
    const projectClaudeDir = path.resolve(projectResolved, '.claude')
    if (resolved.startsWith(projectClaudeDir + path.sep)) return true

    if (resolved === path.resolve(projectResolved, '.mcp.json')) return true
    if (resolved === path.resolve(projectResolved, '.claude.json')) return true
  }

  return false
}
