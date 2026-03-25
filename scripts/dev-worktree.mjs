#!/usr/bin/env node

import { execSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// 1. resolveProjectRoot — git rev-parse --show-toplevel
// ---------------------------------------------------------------------------
function resolveProjectRoot() {
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim()
  } catch {
    console.error('  Error: not inside a git repository.')
    process.exit(1)
  }
}

// ---------------------------------------------------------------------------
// 2. parseWorktrees — git worktree list --porcelain → WorktreeEntry[]
// ---------------------------------------------------------------------------
function parseWorktrees(root) {
  const output = execSync('git worktree list --porcelain', {
    cwd: root,
    encoding: 'utf-8'
  })

  const entries = []
  let cur = {}

  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (cur.path) entries.push(cur)
      cur = { path: line.slice('worktree '.length) }
    } else if (line.startsWith('branch refs/heads/')) {
      cur.branch = line.slice('branch refs/heads/'.length)
    } else if (line === 'bare') {
      cur.bare = true
    } else if (line === 'detached') {
      cur.detached = true
    }
  }
  if (cur.path) entries.push(cur)

  return entries.filter((e) => !e.bare)
}

// ---------------------------------------------------------------------------
// 3. interactiveSelect — raw-mode TUI selector
// ---------------------------------------------------------------------------
function interactiveSelect(entries, root, initialFilter = '') {
  return new Promise((resolve) => {
    let filter = initialFilter
    let cursor = 0

    const getFiltered = () => {
      if (!filter) return entries
      const lf = filter.toLowerCase()
      return entries.filter((e) => {
        const branch = (e.branch || '').toLowerCase()
        const path = e.path.toLowerCase()
        return branch.includes(lf) || path.includes(lf)
      })
    }

    const rel = (p) => (p.startsWith(root + '/') ? p.slice(root.length + 1) : p)

    const render = () => {
      const filtered = getFiltered()
      // clear screen + cursor to top
      process.stdout.write('\x1b[2J\x1b[H')

      console.log('  Select a worktree to start dev server:\n')

      if (filter) {
        console.log(`  Filter: ${filter}\n`)
      }

      if (filtered.length === 0) {
        console.log('  (no matches)\n')
      } else {
        for (let i = 0; i < filtered.length; i++) {
          const e = filtered[i]
          const prefix = i === cursor ? '  \x1b[36m> ' : '    '
          const branch = e.branch || (e.detached ? '(detached)' : '(unknown)')
          const tag = e.path === root ? '[main]' : '[worktree]'
          const suffix = i === cursor ? '\x1b[0m' : ''
          console.log(`${prefix}${branch.padEnd(35)} ${tag.padEnd(12)} ${rel(e.path)}${suffix}`)
        }
      }

      console.log('\n  \x1b[2m↑↓ navigate  ⏎ select  esc quit\x1b[0m')
    }

    const cleanup = () => {
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdout.write('\x1b[2J\x1b[H')
    }

    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.setEncoding('utf-8')
    render()

    process.stdin.on('data', (key) => {
      const filtered = getFiltered()

      // Ctrl+C
      if (key === '\x03') {
        cleanup()
        process.exit(0)
      }

      // Escape (exactly \x1b, not part of arrow sequence)
      if (key === '\x1b') {
        cleanup()
        resolve(null)
        return
      }

      // Enter
      if (key === '\r' || key === '\n') {
        if (filtered.length > 0 && cursor < filtered.length) {
          cleanup()
          resolve(filtered[cursor])
        }
        return
      }

      // Arrow up
      if (key === '\x1b[A') {
        if (filtered.length > 0) {
          cursor = (cursor - 1 + filtered.length) % filtered.length
        }
        render()
        return
      }

      // Arrow down
      if (key === '\x1b[B') {
        if (filtered.length > 0) {
          cursor = (cursor + 1) % filtered.length
        }
        render()
        return
      }

      // Backspace
      if (key === '\x7f' || key === '\b') {
        if (filter.length > 0) {
          filter = filter.slice(0, -1)
          cursor = 0
        }
        render()
        return
      }

      // Printable ASCII
      if (key.length === 1 && key >= ' ' && key <= '~') {
        filter += key
        cursor = 0
        render()
      }
    })
  })
}

// ---------------------------------------------------------------------------
// 4. startDev — spawn electron-vite dev in the selected worktree
// ---------------------------------------------------------------------------
function startDev(entry) {
  const cwd = entry.path
  const branch = entry.branch || '(detached)'

  if (!existsSync(join(cwd, 'node_modules'))) {
    console.error(`\n  node_modules not found in: ${cwd}`)
    console.error(`  Please run first: cd "${cwd}" && pnpm install\n`)
    process.exit(1)
  }

  console.log(`  Starting dev server in: ${branch} (${cwd})\n`)

  const bin = join(cwd, 'node_modules', '.bin', 'electron-vite')
  const child = spawn(bin, ['dev'], {
    cwd,
    stdio: 'inherit'
  })

  const forward = (sig) => child.kill(sig)
  process.on('SIGINT', () => forward('SIGINT'))
  process.on('SIGTERM', () => forward('SIGTERM'))

  child.on('exit', (code) => process.exit(code ?? 0))
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  const root = resolveProjectRoot()
  const entries = parseWorktrees(root)

  // Quick-match via CLI argument: pnpm dev:wt -- sqlite
  const quickFilter = process.argv[2]

  if (quickFilter) {
    const lf = quickFilter.toLowerCase()
    const matches = entries.filter((e) => {
      const branch = (e.branch || '').toLowerCase()
      const path = e.path.toLowerCase()
      return branch.includes(lf) || path.includes(lf)
    })

    if (matches.length === 1) {
      startDev(matches[0])
      return
    }

    if (matches.length === 0) {
      console.error(`  No worktree matching "${quickFilter}"`)
      process.exit(1)
    }

    // Multiple matches — fall through to interactive with pre-populated filter
    if (!process.stdin.isTTY) {
      console.error(`  Multiple worktrees match "${quickFilter}". Use a more specific filter.`)
      matches.forEach((e) => console.error(`    - ${e.branch || e.path}`))
      process.exit(1)
    }

    const selected = await interactiveSelect(entries, root, quickFilter)
    if (!selected) {
      console.log('  Cancelled.')
      process.exit(0)
    }
    startDev(selected)
    return
  }

  // No worktrees — start dev in main repo directly
  if (entries.length <= 1) {
    if (entries.length === 1) {
      console.log('  No extra worktrees found. Starting dev in main repo.\n')
      startDev(entries[0])
    } else {
      console.error('  No git worktrees found.')
      process.exit(1)
    }
    return
  }

  // Non-TTY without quick filter
  if (!process.stdin.isTTY) {
    console.error('  Error: non-TTY environment. Use: pnpm dev:wt -- <filter>')
    process.exit(1)
  }

  const selected = await interactiveSelect(entries, root)
  if (!selected) {
    console.log('  Cancelled.')
    process.exit(0)
  }
  startDev(selected)
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
