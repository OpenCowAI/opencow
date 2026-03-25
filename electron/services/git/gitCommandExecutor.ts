// SPDX-License-Identifier: Apache-2.0

/**
 * GitCommandExecutor — pure Git CLI wrapper with zero state.
 *
 * Responsibility: execute git sub-processes, parse output into structured data.
 *
 * Design:
 *   - Stateless: every method receives `cwd` — one instance serves all projects.
 *   - Safe: GIT_TERMINAL_PROMPT=0 prevents credential pop-ups in background ops.
 *   - Bounded: 10s timeout + 10MB buffer cap protects against large-repo hangs.
 *   - Testable: mock `execFile` to unit-test all parsing logic.
 *
 * @module gitCommandExecutor
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createLogger } from '../../platform/logger'
import type { GitLineDiff } from '@shared/gitTypes'

const execFileAsync = promisify(execFile)
const log = createLogger('GitCLI')

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface GitExecConfig {
  /** Command timeout (ms). Default: 10_000 */
  readonly timeoutMs?: number
  /** Path to git binary. Default: 'git' */
  readonly gitBinary?: string
}

/** Parsed `git status --porcelain=v1 -z --branch` output. */
export interface GitStatusRaw {
  readonly branch: string | null
  readonly isDetached: boolean
  readonly upstream: string | null
  readonly entries: ReadonlyArray<GitStatusEntry>
}

export interface GitStatusEntry {
  readonly indexChar: string
  readonly workTreeChar: string
  readonly path: string
  /** Present for renames: the original path before rename. */
  readonly origPath?: string
}

/* ------------------------------------------------------------------ */
/*  Implementation                                                     */
/* ------------------------------------------------------------------ */

export class GitCommandExecutor {
  private readonly timeout: number
  private readonly git: string

  constructor(config?: GitExecConfig) {
    this.timeout = config?.timeoutMs ?? 10_000
    this.git = config?.gitBinary ?? 'git'
  }

  // ── Queries ─────────────────────────────────────────────

  /** Check whether a directory is inside a git work tree. */
  async isGitRepo(cwd: string): Promise<boolean> {
    try {
      const { stdout } = await this.exec(['rev-parse', '--is-inside-work-tree'], cwd)
      return stdout.trim() === 'true'
    } catch {
      return false
    }
  }

  /** Get the top-level directory of the git repository. */
  async getRepoRoot(cwd: string): Promise<string | null> {
    try {
      const { stdout } = await this.exec(['rev-parse', '--show-toplevel'], cwd)
      return stdout.trim() || null
    } catch {
      return null
    }
  }

  /**
   * Run `git status` and parse into structured data.
   *
   * Uses porcelain v1 + NUL delimiter for unambiguous parsing
   * of filenames containing spaces, unicode, or special characters.
   */
  async getStatus(cwd: string): Promise<GitStatusRaw> {
    const { stdout } = await this.exec(
      ['status', '--porcelain=v1', '-z', '-uall', '--branch'],
      cwd,
    )
    return this.parseStatusOutput(stdout)
  }

  /** Get ahead/behind counts relative to upstream. */
  async getAheadBehind(cwd: string): Promise<{ ahead: number; behind: number }> {
    try {
      const { stdout } = await this.exec(
        ['rev-list', '--left-right', '--count', '@{u}...HEAD'],
        cwd,
      )
      const parts = stdout.trim().split('\t')
      return {
        behind: Number(parts[0]) || 0,
        ahead: Number(parts[1]) || 0,
      }
    } catch {
      // No upstream configured — graceful fallback
      return { ahead: 0, behind: 0 }
    }
  }

  /** Detect active merge (MERGE_HEAD exists). */
  async isMerging(cwd: string): Promise<boolean> {
    try {
      const gitDir = await this.getGitDir(cwd)
      if (!gitDir) return false
      await access(join(gitDir, 'MERGE_HEAD'))
      return true
    } catch {
      return false
    }
  }

  /** Detect active rebase (rebase-merge/ or rebase-apply/ exists). */
  async isRebasing(cwd: string): Promise<boolean> {
    try {
      const gitDir = await this.getGitDir(cwd)
      if (!gitDir) return false
      const [mergeExists, applyExists] = await Promise.all([
        access(join(gitDir, 'rebase-merge')).then(() => true, () => false),
        access(join(gitDir, 'rebase-apply')).then(() => true, () => false),
      ])
      return mergeExists || applyExists
    } catch {
      return false
    }
  }

  /**
   * Get line-level diff hunks for a single file (for editor gutter indicators).
   *
   * Parses `@@ -a,b +c,d @@` headers from `git diff --unified=0`.
   */
  async getFileDiff(cwd: string, filePath: string): Promise<GitLineDiff[]> {
    try {
      const { stdout } = await this.exec(
        ['diff', '--unified=0', '--no-color', '--', filePath],
        cwd,
      )
      return this.parseDiffHunks(stdout)
    } catch {
      return []
    }
  }

  // ── Private: git execution ──────────────────────────────

  private async exec(
    args: string[],
    cwd: string,
  ): Promise<{ stdout: string; stderr: string }> {
    return execFileAsync(this.git, args, {
      cwd,
      timeout: this.timeout,
      maxBuffer: 10 * 1024 * 1024, // 10MB — safe for large monorepos
      env: {
        ...process.env,
        GIT_OPTIONAL_LOCKS: '0',    // Prevent .git/index stat cache updates (avoids watcher feedback loop)
        GIT_PAGER: '',              // Disable pager
        GIT_ASKPASS: '',            // Disable credential prompts
        GIT_TERMINAL_PROMPT: '0',   // Prevent interactive auth
      },
    })
  }

  private async getGitDir(cwd: string): Promise<string | null> {
    try {
      const { stdout } = await this.exec(['rev-parse', '--git-dir'], cwd)
      const dir = stdout.trim()
      return dir ? resolve(cwd, dir) : null
    } catch {
      return null
    }
  }

  // ── Private: status parsing ─────────────────────────────

  /**
   * Parse `git status --porcelain=v1 -z --branch` output.
   *
   * Format with --branch and -z:
   *   ## branch...upstream [ahead N, behind N]\0
   *   XY path\0              (normal entries)
   *   XY path\0origPath\0    (renames: destination\0source)
   *
   * The -z flag uses NUL as delimiter, so paths with spaces are unambiguous.
   */
  private parseStatusOutput(raw: string): GitStatusRaw {
    let branch: string | null = null
    let isDetached = false
    let upstream: string | null = null
    const entries: GitStatusEntry[] = []

    if (!raw) {
      return { branch, isDetached, upstream, entries }
    }

    // Split on NUL. Last element may be empty string.
    const parts = raw.split('\0')

    let i = 0

    // First part may be the branch header (starts with '## ')
    if (parts[i] && parts[i].startsWith('## ')) {
      const branchLine = parts[i].slice(3) // Remove '## '
      this.parseBranchHeader(branchLine, (b, d, u) => {
        branch = b
        isDetached = d
        upstream = u
      })
      i++
    }

    // Remaining parts are file entries
    while (i < parts.length) {
      const part = parts[i]
      if (!part || part.length < 3) {
        i++
        continue
      }

      const indexChar = part[0]
      const workTreeChar = part[1]
      // part[2] is always a space
      const path = part.slice(3)

      if (!path) {
        i++
        continue
      }

      // Renames (R or C in index column) have an extra NUL-separated origPath
      if (indexChar === 'R' || indexChar === 'C') {
        const origPath = parts[i + 1] || undefined
        entries.push({ indexChar, workTreeChar, path, origPath })
        i += 2 // Skip both the entry and the origPath
      } else {
        entries.push({ indexChar, workTreeChar, path })
        i++
      }
    }

    return { branch, isDetached, upstream, entries }
  }

  /**
   * Parse the branch header line from `git status --branch --porcelain=v1`.
   *
   * Examples:
   *   "main...origin/main [ahead 2, behind 1]"
   *   "main...origin/main"
   *   "main"
   *   "HEAD (no branch)"
   *   "No commits yet on main"
   */
  private parseBranchHeader(
    line: string,
    cb: (branch: string | null, isDetached: boolean, upstream: string | null) => void,
  ): void {
    // Detached HEAD
    if (line.startsWith('HEAD (no branch)') || line === 'HEAD') {
      cb(null, true, null)
      return
    }

    // "No commits yet on <branch>"
    const noCommitsMatch = line.match(/^No commits yet on (.+)$/)
    if (noCommitsMatch) {
      cb(noCommitsMatch[1], false, null)
      return
    }

    // "Initial commit on <branch>"
    const initialMatch = line.match(/^Initial commit on (.+)$/)
    if (initialMatch) {
      cb(initialMatch[1], false, null)
      return
    }

    // "branch...upstream [ahead N, behind M]"
    const dotDotDot = line.indexOf('...')
    if (dotDotDot >= 0) {
      const branchName = line.slice(0, dotDotDot)
      const rest = line.slice(dotDotDot + 3)
      // Upstream may have trailing " [ahead N, behind M]"
      const bracketIdx = rest.indexOf(' [')
      const upstreamName = bracketIdx >= 0 ? rest.slice(0, bracketIdx) : rest
      cb(branchName, false, upstreamName || null)
      return
    }

    // Just branch name, no upstream
    cb(line.trim(), false, null)
  }

  // ── Private: diff parsing ───────────────────────────────

  /**
   * Parse unified diff hunks from `git diff --unified=0`.
   *
   * Extracts `@@ -oldStart[,oldCount] +newStart[,newCount] @@` headers
   * and classifies each hunk as added, deleted, or modified.
   */
  private parseDiffHunks(raw: string): GitLineDiff[] {
    const results: GitLineDiff[] = []
    const hunkRegex = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm

    let match: RegExpExecArray | null
    while ((match = hunkRegex.exec(raw)) !== null) {
      const oldCount = match[2] !== undefined ? Number(match[2]) : 1
      const newStart = Number(match[3])
      const newCount = match[4] !== undefined ? Number(match[4]) : 1

      if (oldCount === 0 && newCount > 0) {
        // Pure addition
        results.push({ type: 'added', startLine: newStart, lineCount: newCount })
      } else if (newCount === 0 && oldCount > 0) {
        // Pure deletion — show indicator at the line after deletion point
        results.push({ type: 'deleted', startLine: newStart + 1, lineCount: 1 })
      } else {
        // Modification (lines changed)
        results.push({ type: 'modified', startLine: newStart, lineCount: newCount })
      }
    }

    return results
  }
}
