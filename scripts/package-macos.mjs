#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import {
  inferHostArch,
  resolveMacTargetArchesFromBuilderArgs,
  resolveMacTargetArchesFromBuildConfig,
  runElectronCachePreflight,
} from './preflight-electron-cache.mjs'

const INFO_KEYS = ['CFBundleExecutable', 'CFBundleName', 'CFBundleDisplayName']

function log(message) {
  console.log(`[package-macos] ${message}`)
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    stdio: options.stdio ?? 'inherit',
    encoding: options.encoding,
  })

  if (result.error) {
    throw result.error
  }

  return result.status ?? 1
}

function runCommandCapture(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (result.error) {
    throw result.error
  }

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function readJsonFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8')
  return JSON.parse(content)
}

function dedupeArches(arches) {
  return [...new Set(arches)]
}

function resolvePreflightArches(builderArgs, buildConfig) {
  const cliArches = resolveMacTargetArchesFromBuilderArgs(builderArgs)
  const configArches = resolveMacTargetArchesFromBuildConfig(buildConfig)
  const mergedArches = dedupeArches([...cliArches, ...configArches])
  if (mergedArches.length > 0) {
    const sourceParts = []
    if (cliArches.length > 0) {
      sourceParts.push(`cli args (${cliArches.join(', ')})`)
    }
    if (configArches.length > 0) {
      sourceParts.push(`build.mac.target (${configArches.join(', ')})`)
    }

    return {
      arches: mergedArches,
      source: sourceParts.join(' + '),
    }
  }

  const hostArch = inferHostArch()
  if (hostArch) {
    return {
      arches: [hostArch],
      source: 'host arch fallback',
    }
  }

  return {
    arches: [],
    source: 'unresolved',
  }
}

function extractInfoField(plistContent, key) {
  const pattern = new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`)
  const match = plistContent.match(pattern)
  return match?.[1] ?? ''
}

function collectAppBundles(rootDir, maxDepth = 4) {
  if (!fs.existsSync(rootDir)) {
    return []
  }

  const found = []

  function walk(currentDir, depth) {
    if (depth > maxDepth) {
      return
    }

    const entries = fs.readdirSync(currentDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue
      }

      const absolute = path.join(currentDir, entry.name)
      if (entry.name.endsWith('.app')) {
        found.push(absolute)
        continue
      }

      walk(absolute, depth + 1)
    }
  }

  walk(rootDir, 0)
  return [...new Set(found)].sort()
}

function printFailureDiagnostics(projectDir) {
  log('electron-builder failed. Collecting diagnostics.')

  const distDir = path.join(projectDir, 'dist')
  const appBundles = collectAppBundles(distDir)
  if (appBundles.length === 0) {
    log('No .app bundle found under dist/.')
    return
  }

  for (const appBundle of appBundles) {
    const macosDir = path.join(appBundle, 'Contents', 'MacOS')
    const plistPath = path.join(appBundle, 'Contents', 'Info.plist')

    log(`Snapshot: ${macosDir}`)
    const ls = runCommandCapture('ls', ['-la', macosDir], projectDir)
    if (ls.stdout.trim()) {
      process.stdout.write(ls.stdout)
    }
    if (ls.stderr.trim()) {
      process.stderr.write(ls.stderr)
    }

    if (!fs.existsSync(plistPath)) {
      log(`Info.plist not found: ${plistPath}`)
      continue
    }

    const plist = fs.readFileSync(plistPath, 'utf8')
    const keyValues = INFO_KEYS
      .map(key => `${key}=${extractInfoField(plist, key) || '(missing)'}`)
      .join(', ')
    log(`Info.plist identity: ${keyValues}`)
  }
}

function run() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url))
  const projectDir = path.resolve(scriptDir, '..')
  const builderArgs = process.argv.slice(2)
  const packageJson = readJsonFile(path.join(projectDir, 'package.json'))

  const { arches, source } = resolvePreflightArches(builderArgs, packageJson.build)
  if (arches.length === 0) {
    throw new Error('Unable to resolve preflight architectures from CLI args, build config, or host arch')
  }

  log(`Resolved preflight arches (${source}): ${arches.join(', ')}`)
  runElectronCachePreflight({
    projectDir,
    arches,
  })

  log('Building electron-vite artifacts')
  const buildStatus = runCommand('pnpm', ['exec', 'electron-vite', 'build'], { cwd: projectDir })
  if (buildStatus !== 0) {
    process.exit(buildStatus)
  }

  log(`Running electron-builder --mac ${builderArgs.join(' ')}`.trim())
  const builderStatus = runCommand('pnpm', ['exec', 'electron-builder', '--mac', ...builderArgs], {
    cwd: projectDir,
  })

  if (builderStatus !== 0) {
    printFailureDiagnostics(projectDir)
    process.exit(builderStatus)
  }

  log('macOS packaging completed.')
}

try {
  run()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[package-macos] ERROR: ${message}`)
  process.exit(1)
}
