// SPDX-License-Identifier: Apache-2.0

/**
 * welcomeBanner — Branded welcome message shown when a Terminal is first created.
 *
 * Design: ASCII Art OpenCow logo (ANSI gradient colors) + project context line.
 * Injection timing: pushed into the Ring Buffer after PTY creation; included naturally on replay.
 * Only shown on initial PTY creation; panel toggle does not repeat it (PTY is still alive).
 */

import { execFileSync } from 'child_process'
import { basename } from 'path'
import { homedir } from 'os'
import type { TerminalScope } from '@shared/types'

// ── ANSI escape helpers ─────────────────────────────────────────────

const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'
const fg = (n: number): string => `\x1b[38;5;${n}m`

// 256-color palette — grayscale gradient from dark to bright
const GRAY_1 = fg(238)   // ░░░ darkest
const GRAY_2 = fg(241)   // ░░
const GRAY_3 = fg(245)   // ░
const GRAY_4 = fg(249)   // ▓
const GRAY_5 = fg(253)   // ▓▓▓ brightest

const BLUE = fg(75)       // project name
const GREEN = fg(114)     // Git branch
const VIOLET = fg(141)    // Global Terminal
const MUTED = fg(245)     // path
const DIM = fg(240)       // punctuation / separator

// ── Git branch resolver ─────────────────────────────────────────────

function getGitBranch(cwd: string): string | null {
  try {
    return execFileSync(
      'git', ['rev-parse', '--abbrev-ref', 'HEAD'],
      { cwd, encoding: 'utf-8', timeout: 2000, stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim()
  } catch {
    return null
  }
}

// ── Path shortener ──────────────────────────────────────────────────

function shortenPath(fullPath: string): string {
  const home = homedir()
  return fullPath.startsWith(home) ? '~' + fullPath.slice(home.length) : fullPath
}

// ── Banner generator ────────────────────────────────────────────────

/**
 * Generate an ANSI-colored welcome banner.
 *
 * Example output (pseudo-rendered):
 * ```
 *      ___                    ___
 *     / _ \ _ __   ___ _ __  / __\___  _      __
 *    | | | | '_ \ / _ \ '_ \/ /  / _ \| | /| / /
 *    | |_| | |_) |  __/ | | / /__| (_) | |/ |/ /
 *     \___/| .__/ \___|_| |_\____/\___/|__/|__/
 *         |_|
 *
 *    ▸ my-project  ·  ~/workspace/.../my-project  ·  main
 * ```
 */
export function generateWelcomeBanner(scope: TerminalScope, cwd: string): string {
  const NL = '\r\n'

  // ── ASCII Art (gradient: dark at top → bright at bottom) ──
  const art = [
    `${GRAY_1}     ___                    ___`,
    `${GRAY_2}    / _ \\ _ __   ___ _ __  / __\\___  _      __`,
    `${GRAY_3}   | | | | '_ \\ / _ \\ '_ \\/ /  / _ \\| | /| / /`,
    `${GRAY_4}   | |_| | |_) |  __/ | | / /__| (_) | |/ |/ /`,
    `${GRAY_5}    \\___/| .__/ \\___|_| |_\\____/\\___/|__/|__/`,
    `${GRAY_5}        |_|`,
  ].map((line) => `${line}${RESET}`).join(NL)

  // ── Context line ──
  const shortPath = shortenPath(cwd)
  const branch = getGitBranch(cwd)

  let contextLine: string
  if (scope.type === 'project') {
    const projectName = basename(cwd)
    contextLine = `${DIM}   ▸${RESET} ${BLUE}${BOLD}${projectName}${RESET}  ${DIM}·${RESET}  ${MUTED}${shortPath}${RESET}`
    if (branch) {
      contextLine += `  ${DIM}·${RESET}  ${GREEN}${branch}${RESET}`
    }
  } else {
    contextLine = `${DIM}   ▸${RESET} ${VIOLET}${BOLD}Global Terminal${RESET}  ${DIM}·${RESET}  ${MUTED}${shortPath}${RESET}`
    if (branch) {
      contextLine += `  ${DIM}·${RESET}  ${GREEN}${branch}${RESET}`
    }
  }

  return `${NL}${art}${NL}${NL}${contextLine}${NL}${NL}`
}
