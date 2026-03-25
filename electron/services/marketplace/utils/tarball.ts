// SPDX-License-Identifier: Apache-2.0

/**
 * GitHub tarball download + extraction utility.
 *
 * Shared by any adapter that downloads skills from GitHub repos:
 *  - skills.sh (skill bundle lives in a GitHub repo sub-path)
 *  - GitHub adapter (entire repo as a skill bundle)
 *
 * Architecture — four separated concerns:
 *
 *  1. Download  — deterministic: fetch tarball → write to temp file.
 *  2. Extract   — deterministic: extract file with strip:1.
 *  3. Locate    — heuristic: scan local filesystem to find the skill directory.
 *  4. Copy      — deterministic: copy bundle files to targetDir.
 *
 * The download-to-file approach eliminates stream compatibility issues between
 * Electron's Web API fetch and Node.js tar — the previous `Readable.fromWeb()`
 * piping was unreliable in Electron's main process and could silently produce
 * empty extraction directories.
 *
 * Why tree-scan instead of candidate-guessing?
 *   skills.sh `skillId` is a platform registration identifier — it may NOT
 *   match the actual directory name in the GitHub repo. The only reliable
 *   approach is to scan the extracted filesystem for SKILL.md files.
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as tar from 'tar'

import { fetchWithTimeout } from './http'
import { copySkillBundle } from './bundle'

// ─── Types ──────────────────────────────────────────────────

interface TarballDownloadParams {
  /** GitHub repo owner */
  owner: string
  /** GitHub repo name */
  repo: string
  /** GitHub API request headers (including optional auth token) */
  headers: Record<string, string>
  /** Final directory to write the skill bundle into */
  targetDir: string
  /**
   * Hint for the skill's sub-path within the repo (e.g. "fan-operations").
   * Used as a scoring signal when multiple SKILL.md files are found.
   * NOT used as a deterministic path — the actual directory is resolved by
   * scanning the extracted filesystem.
   */
  skillPath?: string
  /** Download timeout in ms (default 60 000) */
  timeoutMs?: number
}

// ─── Public API ─────────────────────────────────────────────

/**
 * Download a GitHub repo tarball and extract the FULL directory tree.
 *
 * Unlike `downloadGithubTarball()` which locates a single skill and copies
 * its bundle, this function preserves the complete repo structure for
 * multi-capability discovery.
 *
 * @returns Absolute path to the extracted repo root directory.
 *          Caller is responsible for cleanup (the parent `targetDir`).
 */
export async function downloadAndExtractRepo(params: {
  owner: string
  repo: string
  headers: Record<string, string>
  targetDir: string
  timeoutMs?: number
}): Promise<string> {
  const { owner, repo, headers, targetDir, timeoutMs = 60_000 } = params
  const tarballPath = path.join(targetDir, '__download__.tar.gz')
  const extractDir = path.join(targetDir, '__repo__')

  try {
    await downloadToFile({ owner, repo, headers, timeoutMs, destPath: tarballPath })
    await fs.mkdir(extractDir, { recursive: true })
    await tar.x({ cwd: extractDir, strip: 1, gzip: true, file: tarballPath })

    // Verify extraction produced files
    const entries = await fs.readdir(extractDir)
    if (entries.length === 0) {
      throw new Error(
        `Tarball extraction produced an empty directory for ${owner}/${repo}. ` +
        `The archive may be corrupt or empty.`,
      )
    }

    return extractDir
  } finally {
    // Clean up tarball but NOT extractDir — caller needs to read files from it
    await fs.rm(tarballPath, { force: true }).catch(() => {})
  }
}

/**
 * Download a GitHub tarball, extract it, locate the skill directory,
 * and copy the standard skill bundle files to `targetDir`.
 *
 * Download strategy:
 *   1. GitHub API endpoint (follows 302 → codeload CDN, honours auth tokens)
 *   2. If rate-limited (403/429), try codeload.github.com directly
 *
 * Skill location strategy:
 *   1. Fast path — check common conventions (`skills/{hint}/`, `{hint}/`, root)
 *   2. Tree scan — walk the extracted tree (depth ≤ 3) to find ALL SKILL.md
 *   3. Best match — if multiple found, score against the skillPath hint
 *   4. Directory name match — if no SKILL.md anywhere, match by directory name
 */
export async function downloadGithubTarball(params: TarballDownloadParams): Promise<void> {
  const {
    owner,
    repo,
    headers,
    targetDir,
    skillPath = '',
    timeoutMs = 60_000,
  } = params

  // ── Step 1: Download tarball to a temp file ─────────────────
  const tarballPath = path.join(targetDir, '__download__.tar.gz')
  try {
    await downloadToFile({ owner, repo, headers, timeoutMs, destPath: tarballPath })

    // ── Step 2: Extract from file ─────────────────────────────
    const extractDir = path.join(targetDir, '__extract__')
    await fs.mkdir(extractDir, { recursive: true })

    try {
      await tar.x({ cwd: extractDir, strip: 1, gzip: true, file: tarballPath })

      // Verify extraction produced files
      const entries = await fs.readdir(extractDir)
      if (entries.length === 0) {
        throw new Error(
          `Tarball extraction produced an empty directory for ${owner}/${repo}. ` +
          `The archive may be corrupt or empty.`,
        )
      }

      // ── Step 3: Locate the skill directory ───────────────────
      const sourceDir = await locateSkillDir(extractDir, skillPath)

      // ── Step 4: Copy bundle files ────────────────────────────
      await copySkillBundle(sourceDir, targetDir)
    } finally {
      await fs.rm(extractDir, { recursive: true, force: true }).catch(() => {})
    }
  } finally {
    await fs.rm(tarballPath, { force: true }).catch(() => {})
  }
}

// ─── Download ───────────────────────────────────────────────

interface DownloadFileParams {
  owner: string
  repo: string
  headers: Record<string, string>
  timeoutMs: number
  destPath: string
}

/**
 * Download a GitHub repo tarball to a local file.
 *
 * Tries the API endpoint first (respects auth tokens, follows 302 to CDN).
 * Falls back to codeload.github.com on 403/429 (rate limit).
 * Validates Content-Type before writing to prevent saving HTML/JSON error pages.
 */
async function downloadToFile(params: DownloadFileParams): Promise<void> {
  const { owner, repo, headers, timeoutMs, destPath } = params

  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/tarball`
  const codeloadUrl = `https://codeload.github.com/${owner}/${repo}/tar.gz/HEAD`

  let resp = await fetchWithTimeout(apiUrl, { headers, redirect: 'follow' }, timeoutMs)

  // API rate-limited → try codeload (doesn't count against API quota)
  if (resp.status === 403 || resp.status === 429) {
    resp = await fetchWithTimeout(
      codeloadUrl,
      { headers: { Accept: 'application/gzip' }, redirect: 'follow' },
      timeoutMs,
    ).catch(() => resp) // if codeload also fails, keep original resp for error
  }

  if (!resp.ok) {
    const hint = resp.status === 403 || resp.status === 429
      ? ' (GitHub API rate limit — consider setting a GitHub token in settings)'
      : ''
    throw new Error(`Tarball download failed: HTTP ${resp.status}${hint}`)
  }

  // Validate the response is actually a gzip archive, not an error page
  const contentType = resp.headers.get('content-type') ?? ''
  if (contentType.includes('json') || contentType.includes('html') || contentType.includes('text/plain')) {
    throw new Error(
      `Download returned ${contentType} instead of gzip for ${owner}/${repo}. ` +
      `Likely a GitHub rate-limit or error page. Consider setting a GitHub token.`,
    )
  }

  // Write response body to file (in-memory buffer — tarballs are typically < 50MB)
  const buffer = Buffer.from(await resp.arrayBuffer())
  if (buffer.length === 0) {
    throw new Error(`Downloaded tarball for ${owner}/${repo} is empty (0 bytes)`)
  }
  await fs.writeFile(destPath, buffer)
}

// ─── Skill Location ─────────────────────────────────────────

/** Maximum directory depth for tree scanning. */
const MAX_SCAN_DEPTH = 3

/**
 * Locate the skill directory within the extracted tarball.
 *
 * Strategy (ordered by cost):
 *   1. **Fast path** — check common conventions that cover ~90% of repos.
 *   2. **Tree scan** — walk the filesystem to find all SKILL.md files.
 *   3. **Best match** — score multiple hits against the skillPath hint.
 *   4. **Dir name match** — if no SKILL.md anywhere, find directory by name.
 *
 * Returns the resolved absolute directory path.
 * Falls back to extractDir root if nothing else matches.
 */
async function locateSkillDir(extractDir: string, skillPath: string): Promise<string> {
  // No sub-path hint → repo root is the skill root
  if (!skillPath) return extractDir

  // ── Fast path: common conventions ───────────────────────────
  const conventions = [
    path.join(extractDir, 'skills', skillPath),  // monorepo: skills/{id}/
    path.join(extractDir, skillPath),             // direct: {id}/
  ]
  for (const candidate of conventions) {
    if (await hasSkillMd(candidate)) return candidate
  }

  // ── Tree scan: find ALL SKILL.md in the extracted tree ──────
  const skillDirs = await scanForSkillMd(extractDir, MAX_SCAN_DEPTH)

  if (skillDirs.length === 1) {
    return skillDirs[0]
  }

  if (skillDirs.length > 1) {
    return pickBestMatch(skillDirs, skillPath, extractDir)
  }

  // ── Repo root fallback ──────────────────────────────────────
  if (await hasSkillMd(extractDir)) return extractDir

  // ── No SKILL.md anywhere — directory name matching ──────────
  const dirMatch = await findDirByName(extractDir, skillPath, MAX_SCAN_DEPTH)
  if (dirMatch) return dirMatch

  // Last resort: use the extraction root
  return extractDir
}

// ─── Filesystem helpers ─────────────────────────────────────

async function scanForSkillMd(root: string, maxDepth: number): Promise<string[]> {
  const results: string[] = []
  await walk(root, 0, maxDepth, results)
  return results
}

async function walk(
  dir: string,
  depth: number,
  maxDepth: number,
  results: string[],
): Promise<void> {
  if (depth > maxDepth) return

  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }

  let hasSkill = false
  const subdirs: string[] = []

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    if (entry.isFile() && entry.name === 'SKILL.md') {
      hasSkill = true
    } else if (entry.isDirectory()) {
      subdirs.push(path.join(dir, entry.name))
    }
  }

  if (hasSkill) results.push(dir)

  for (const subdir of subdirs) {
    await walk(subdir, depth + 1, maxDepth, results)
  }
}

function pickBestMatch(dirs: string[], skillPath: string, extractDir: string): string {
  const hint = skillPath.toLowerCase()
  let bestDir = dirs[0]
  let bestScore = -Infinity

  for (const dir of dirs) {
    const dirName = path.basename(dir).toLowerCase()
    const relative = path.relative(extractDir, dir).toLowerCase()

    let score = 0
    if (dirName === hint) score += 100
    else if (dirName.includes(hint) || hint.includes(dirName)) score += 50
    else if (relative.includes(hint)) score += 25

    score -= relative.split(path.sep).length

    if (score > bestScore) {
      bestScore = score
      bestDir = dir
    }
  }

  return bestDir
}

async function findDirByName(
  root: string,
  hint: string,
  maxDepth: number,
): Promise<string | null> {
  const h = hint.toLowerCase()
  const candidates: Array<{ dir: string; score: number }> = []

  async function scan(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      const name = entry.name.toLowerCase()

      let score = 0
      if (name === h) score = 100
      else if (name.includes(h) || h.includes(name)) score = 50

      if (score > 0) {
        score -= depth
        candidates.push({ dir: full, score })
      }
      await scan(full, depth + 1)
    }
  }

  await scan(root, 0)
  if (candidates.length === 0) return null
  candidates.sort((a, b) => b.score - a.score)
  return candidates[0].dir
}

async function hasSkillMd(dir: string): Promise<boolean> {
  try {
    await fs.access(path.join(dir, 'SKILL.md'))
    return true
  } catch {
    return false
  }
}
