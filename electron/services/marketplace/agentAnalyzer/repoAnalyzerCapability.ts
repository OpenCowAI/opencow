// SPDX-License-Identifier: Apache-2.0

/**
 * RepoAnalyzerCapability — sandboxed NativeCapability for the repo analysis Agent.
 *
 * Provides three tools that the analysis Agent uses to inspect a downloaded
 * repository and submit a structured manifest of discovered capabilities:
 *
 *   list_directory   — recursively list directory contents (capped depth)
 *   read_file        — read a single file as UTF-8 (truncated at 100 KB)
 *   read_files       — batch-read up to 10 files in a single call
 *   submit_manifest  — submit the final AgentManifest with path validation
 *
 * All filesystem access is sandboxed to `repoDir`. Path traversal attempts
 * (e.g. `../../etc/passwd`) are rejected before any I/O occurs.
 *
 * After the Agent session completes, the orchestrator retrieves the submitted
 * manifest via `getSubmittedManifest()`.
 */

import { z } from 'zod/v4'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import type { NativeCapabilityMeta, NativeCapabilityToolContext } from '../../../nativeCapabilities/types'
import { BaseNativeCapability, type ToolConfig } from '../../../nativeCapabilities/baseNativeCapability'
import type { AgentManifest } from './types'

// ─── Constants ──────────────────────────────────────────────────────────────

/** Maximum recursion depth for list_directory. */
const MAX_DEPTH = 4

/** Default recursion depth for list_directory. */
const DEFAULT_DEPTH = 2

/** Maximum file size (in bytes) that read_file will return before truncating. */
const MAX_FILE_SIZE = 100 * 1024 // 100 KB

/** Number of leading bytes checked for binary detection (null bytes). */
const BINARY_CHECK_LENGTH = 1024

/** Maximum number of files per read_files batch call. */
const MAX_BATCH_FILES = 10

// ─── RepoAnalyzerCapability ─────────────────────────────────────────────────

export class RepoAnalyzerCapability extends BaseNativeCapability {
  readonly meta: NativeCapabilityMeta = {
    category: 'repo-analyzer',
    name: 'Repo Analyzer',
    description: 'Sandboxed filesystem tools for the repo analysis Agent',
    version: '1.0.0',
  }

  /** Absolute path to the repository root — all paths are resolved relative to this. */
  private readonly repoDir: string

  /** Manifest submitted by the Agent via submit_manifest, or null if not yet submitted. */
  private submittedManifest: AgentManifest | null = null

  constructor(repoDir: string) {
    super()
    this.repoDir = path.resolve(repoDir)
  }

  /**
   * Retrieve the manifest submitted by the Agent.
   *
   * Returns null if the Agent session completed without calling submit_manifest
   * (e.g. it determined the repo has no installable capabilities).
   */
  getSubmittedManifest(): AgentManifest | null {
    return this.submittedManifest
  }

  // ── Declarative tool definitions ────────────────────────────────────────────

  protected toolConfigs(_context: NativeCapabilityToolContext): ToolConfig[] {
    return [
      this.listDirectoryConfig(),
      this.readFileConfig(),
      this.readFilesConfig(),
      this.submitManifestConfig(),
    ]
  }

  // ── list_directory ──────────────────────────────────────────────────────────

  private listDirectoryConfig(): ToolConfig {
    return {
      name: 'list_directory',
      description:
        'Recursively list directory contents within the repository. '
        + 'Returns entries with name, type (file/dir), and size. '
        + `Default depth is ${DEFAULT_DEPTH}; maximum depth is ${MAX_DEPTH}. `
        + 'All paths are relative to the repository root.',
      schema: {
        path: z
          .string()
          .describe('Relative path within the repository to list (use "." for root)'),
        depth: z
          .number()
          .int()
          .min(1)
          .max(MAX_DEPTH)
          .optional()
          .describe(`Recursion depth (1–${MAX_DEPTH}, default ${DEFAULT_DEPTH})`),
      },
      execute: async (args) => {
        const relPath = args.path as string
        const depth = (args.depth as number | undefined) ?? DEFAULT_DEPTH

        const resolved = this.resolveSandboxed(relPath)
        const output = await this.listRecursive(resolved, depth, 0)
        return this.textResult(output)
      },
    }
  }

  // ── read_file ───────────────────────────────────────────────────────────────

  private readFileConfig(): ToolConfig {
    return {
      name: 'read_file',
      description:
        'Read a single file from the repository as UTF-8 text. '
        + `Files larger than ${MAX_FILE_SIZE / 1024} KB are truncated with a [truncated] marker. `
        + 'Binary files (detected by null bytes in the first 1024 chars) are rejected. '
        + 'Path is relative to the repository root.',
      schema: {
        path: z
          .string()
          .describe('Relative path to the file within the repository'),
      },
      execute: async (args) => {
        const relPath = args.path as string
        const resolved = this.resolveSandboxed(relPath)

        const content = await fs.readFile(resolved, 'utf-8')

        // Binary detection: check for null bytes in the leading portion
        const checkSlice = content.slice(0, BINARY_CHECK_LENGTH)
        if (checkSlice.includes('\0')) {
          return this.errorResult(
            new Error(`File appears to be binary (null bytes detected): ${relPath}`),
          )
        }

        // Truncate if too large
        if (Buffer.byteLength(content, 'utf-8') > MAX_FILE_SIZE) {
          const truncated = Buffer.from(content, 'utf-8').subarray(0, MAX_FILE_SIZE).toString('utf-8')
          return this.textResult(truncated + '\n[truncated]')
        }

        return this.textResult(content)
      },
    }
  }

  // ── read_files (batch) ──────────────────────────────────────────────────────

  private readFilesConfig(): ToolConfig {
    return {
      name: 'read_files',
      description:
        `Batch-read up to ${MAX_BATCH_FILES} files from the repository in a single call. `
        + 'Each file is returned with a header separator. '
        + 'Same truncation and binary detection rules as read_file. '
        + 'Paths are relative to the repository root. '
        + 'Use this instead of read_file when reading multiple files for efficiency.',
      schema: {
        paths: z
          .array(z.string())
          .min(1)
          .max(MAX_BATCH_FILES)
          .describe(`Array of relative file paths (1–${MAX_BATCH_FILES})`),
      },
      execute: async (args) => {
        const paths = args.paths as string[]
        const sections: string[] = []

        for (const relPath of paths) {
          try {
            const resolved = this.resolveSandboxed(relPath)
            const content = await fs.readFile(resolved, 'utf-8')

            // Binary detection
            const checkSlice = content.slice(0, BINARY_CHECK_LENGTH)
            if (checkSlice.includes('\0')) {
              sections.push(`=== ${relPath} ===\n[binary file — skipped]`)
              continue
            }

            // Truncate if too large
            if (Buffer.byteLength(content, 'utf-8') > MAX_FILE_SIZE) {
              const truncated = Buffer.from(content, 'utf-8')
                .subarray(0, MAX_FILE_SIZE)
                .toString('utf-8')
              sections.push(`=== ${relPath} ===\n${truncated}\n[truncated]`)
            } else {
              sections.push(`=== ${relPath} ===\n${content}`)
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            sections.push(`=== ${relPath} ===\n[error: ${msg}]`)
          }
        }

        return this.textResult(sections.join('\n\n'))
      },
    }
  }

  // ── submit_manifest ─────────────────────────────────────────────────────────

  private submitManifestConfig(): ToolConfig {
    return {
      name: 'submit_manifest',
      description:
        'Submit the final analysis manifest describing the capabilities discovered in the repository. '
        + 'Every sourcePath must point to an existing file within the repository. '
        + 'Call this tool exactly once when analysis is complete.',
      schema: {
        packageName: z
          .string()
          .describe('Suggested namespace prefix for the package (e.g. "my-toolkit")'),
        capabilities: z
          .array(
            z.object({
              name: z
                .string()
                .describe('Capability name in kebab-case (e.g. "spec-driven-development")'),
              category: z
                .enum(['skill', 'agent', 'command', 'rule', 'hook', 'mcp-server'])
                .describe('Capability category'),
              sourcePath: z
                .string()
                .describe('Relative path to the source file within the repository'),
              description: z
                .string()
                .describe('One-line description of what this capability does'),
              confidence: z
                .enum(['high', 'medium', 'low'])
                .describe('Confidence in this classification'),
            }),
          )
          .describe('Array of discovered capabilities'),
        reasoning: z
          .string()
          .describe('Explanation of the analysis decisions and methodology'),
      },
      execute: async (args) => {
        const packageName = args.packageName as string
        const capabilities = args.capabilities as Array<{
          name: string
          category: 'skill' | 'agent' | 'command' | 'rule' | 'hook' | 'mcp-server'
          sourcePath: string
          description: string
          confidence: 'high' | 'medium' | 'low'
        }>
        const reasoning = args.reasoning as string

        // Validate that every sourcePath exists within the repo
        const missingPaths: string[] = []
        for (const cap of capabilities) {
          const resolved = this.resolveSandboxed(cap.sourcePath)
          try {
            await fs.access(resolved)
          } catch {
            missingPaths.push(cap.sourcePath)
          }
        }

        if (missingPaths.length > 0) {
          return this.errorResult(
            new Error(
              `Source path validation failed. The following paths do not exist:\n`
              + missingPaths.map((p) => `  - ${p}`).join('\n')
              + '\n\nPlease verify the paths and resubmit.',
            ),
          )
        }

        // Store the validated manifest
        const manifest: AgentManifest = {
          packageName,
          capabilities,
          reasoning,
        }
        this.submittedManifest = manifest

        return this.textResult(
          `Manifest submitted successfully. `
          + `Package: "${packageName}", `
          + `${capabilities.length} capability(ies) registered.`,
        )
      },
    }
  }

  // ── Sandbox helpers ─────────────────────────────────────────────────────────

  /**
   * Resolve a relative path within the sandbox (repoDir).
   *
   * Throws if the resolved path escapes the repository root (path traversal).
   */
  private resolveSandboxed(relPath: string): string {
    const resolved = path.resolve(this.repoDir, relPath)
    if (!resolved.startsWith(this.repoDir + path.sep) && resolved !== this.repoDir) {
      throw new Error(
        `Path traversal detected: "${relPath}" resolves outside the repository root.`,
      )
    }
    return resolved
  }

  // ── Directory listing helpers ───────────────────────────────────────────────

  /**
   * Recursively list directory entries with indentation.
   *
   * Each entry is formatted as:
   *   {indent}{name}  ({type}, {size} bytes)
   */
  private async listRecursive(dirPath: string, maxDepth: number, currentDepth: number): Promise<string> {
    const indent = '  '.repeat(currentDepth)
    const entries = await fs.readdir(dirPath, { withFileTypes: true })

    const lines: string[] = []
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name)

      if (entry.isDirectory()) {
        lines.push(`${indent}${entry.name}/  (dir)`)
        if (currentDepth < maxDepth - 1) {
          const subListing = await this.listRecursive(fullPath, maxDepth, currentDepth + 1)
          if (subListing) {
            lines.push(subListing)
          }
        }
      } else if (entry.isFile()) {
        try {
          const stat = await fs.stat(fullPath)
          lines.push(`${indent}${entry.name}  (file, ${stat.size} bytes)`)
        } catch {
          lines.push(`${indent}${entry.name}  (file, unknown size)`)
        }
      }
    }

    return lines.join('\n')
  }
}
