#!/usr/bin/env node

import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawnSync } from 'child_process'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'

const SUPPORTED_ARCHES = new Set(['arm64', 'x64'])
const ZIP_INFO_PLIST_ENTRY = 'Electron.app/Contents/Info.plist'
const ZIP_MACOS_PREFIX = 'Electron.app/Contents/MacOS/'
const require = createRequire(import.meta.url)

function createLogger(prefix) {
  return {
    info(message) {
      console.log(`[${prefix}] ${message}`)
    },
    error(message) {
      console.error(`[${prefix}] ERROR: ${message}`)
    },
  }
}

export function inferHostArch() {
  switch (os.arch()) {
    case 'arm64':
      return 'arm64'
    case 'x64':
      return 'x64'
    default:
      return ''
  }
}

function dedupe(values) {
  return [...new Set(values)]
}

function normalizeArch(input) {
  if (!input) {
    return ''
  }

  if (input === 'aarch64') {
    return 'arm64'
  }

  if (input === 'amd64') {
    return 'x64'
  }

  return input
}

function ensureSupportedArch(arch) {
  if (!SUPPORTED_ARCHES.has(arch)) {
    throw new Error(`Unsupported architecture: ${arch}`)
  }
}

export function resolveMacTargetArchesFromBuilderArgs(builderArgs) {
  const arches = []

  for (const arg of builderArgs) {
    if (arg === '--universal') {
      arches.push('arm64', 'x64')
      continue
    }

    if (arg === '--arm64') {
      arches.push('arm64')
      continue
    }

    if (arg === '--x64') {
      arches.push('x64')
      continue
    }
  }

  return dedupe(arches)
}

function collectArchesFromTargetEntry(targetEntry) {
  if (!targetEntry || typeof targetEntry === 'string') {
    return []
  }

  const arch = targetEntry.arch
  if (!arch) {
    return []
  }

  if (Array.isArray(arch)) {
    return arch.map(normalizeArch).filter(Boolean)
  }

  return [normalizeArch(arch)].filter(Boolean)
}

export function resolveMacTargetArchesFromBuildConfig(buildConfig) {
  const macConfig = buildConfig?.mac
  if (!macConfig) {
    return []
  }

  const target = macConfig.target
  if (!target) {
    return []
  }

  const targetEntries = Array.isArray(target) ? target : [target]
  const arches = []

  for (const targetEntry of targetEntries) {
    arches.push(...collectArchesFromTargetEntry(targetEntry))
  }

  const resolved = dedupe(arches)
  for (const arch of resolved) {
    ensureSupportedArch(arch)
  }

  return resolved
}

function commandExists(command) {
  const lookup = spawnSync('which', [command], { stdio: 'ignore' })
  return lookup.status === 0
}

function runCapture(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' })

  if (result.error) {
    throw result.error
  }

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function resolveElectronVersion(projectDir) {
  const electronPackagePath = path.join(projectDir, 'node_modules', 'electron', 'package.json')
  if (fs.existsSync(electronPackagePath)) {
    const electronPackage = JSON.parse(fs.readFileSync(electronPackagePath, 'utf8'))
    if (typeof electronPackage.version === 'string' && electronPackage.version.length > 0) {
      return electronPackage.version
    }
  }

  try {
    const electronPackage = require('electron/package.json')
    if (typeof electronPackage.version === 'string' && electronPackage.version.length > 0) {
      return electronPackage.version
    }
  } catch {
    // Ignore and fall back to package.json parsing.
  }

  const projectPackagePath = path.join(projectDir, 'package.json')
  if (!fs.existsSync(projectPackagePath)) {
    return ''
  }

  const projectPackage = JSON.parse(fs.readFileSync(projectPackagePath, 'utf8'))
  const rawVersion = projectPackage?.devDependencies?.electron
  if (typeof rawVersion !== 'string') {
    return ''
  }

  const match = rawVersion.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/)
  return match?.[0] ?? ''
}

function validateZipArchive(zipPath) {
  const integrity = runCapture('unzip', ['-tq', zipPath])
  if (integrity.status !== 0) {
    return {
      ok: false,
      reason: integrity.stderr.trim() || integrity.stdout.trim() || 'integrity check failed',
    }
  }

  const listing = runCapture('unzip', ['-Z1', zipPath])
  if (listing.status !== 0) {
    return {
      ok: false,
      reason: listing.stderr.trim() || listing.stdout.trim() || 'unable to list zip entries',
    }
  }

  const entries = listing.stdout.split('\n').map(line => line.trim()).filter(Boolean)
  const hasInfoPlist = entries.includes(ZIP_INFO_PLIST_ENTRY)
  const hasMacOSBinary = entries.some(entry => entry.startsWith(ZIP_MACOS_PREFIX) && !entry.endsWith('/'))

  if (!hasInfoPlist) {
    return {
      ok: false,
      reason: `missing required entry: ${ZIP_INFO_PLIST_ENTRY}`,
    }
  }

  if (!hasMacOSBinary) {
    return {
      ok: false,
      reason: `missing executable payload under ${ZIP_MACOS_PREFIX}`,
    }
  }

  return { ok: true, reason: '' }
}

function removeCorruptedArchive(zipPath) {
  fs.rmSync(zipPath, { force: true })
}

function normalizeRequestedArches(arches) {
  const normalized = dedupe(arches.map(normalizeArch).filter(Boolean))
  for (const arch of normalized) {
    ensureSupportedArch(arch)
  }

  return normalized
}

export function runElectronCachePreflight(options) {
  const { projectDir, arches, logPrefix = 'preflight-electron-cache' } = options
  const logger = createLogger(logPrefix)

  if (process.platform !== 'darwin') {
    logger.info('Non-macOS host detected; skipping cache preflight.')
    return {
      checked: [],
      removed: [],
      missing: [],
    }
  }

  if (!commandExists('unzip')) {
    throw new Error('`unzip` is required for Electron cache validation on macOS hosts')
  }

  const normalizedArches = normalizeRequestedArches(arches)
  if (normalizedArches.length === 0) {
    throw new Error('No target architectures were provided for cache preflight')
  }

  const electronVersion = resolveElectronVersion(projectDir)
  if (!electronVersion) {
    throw new Error('Failed to resolve Electron version')
  }

  const cacheDir = path.join(os.homedir(), 'Library', 'Caches', 'electron')
  if (!fs.existsSync(cacheDir)) {
    logger.info('Electron cache directory not found; skipping.')
    return {
      checked: [],
      removed: [],
      missing: normalizedArches,
    }
  }

  logger.info(`Checking Electron cache for v${electronVersion} (arches: ${normalizedArches.join(', ')})`)

  const summary = {
    checked: [],
    removed: [],
    missing: [],
  }

  for (const arch of normalizedArches) {
    const zipName = `electron-v${electronVersion}-darwin-${arch}.zip`
    const zipPath = path.join(cacheDir, zipName)

    if (!fs.existsSync(zipPath)) {
      logger.info(`No cached archive for ${arch} (${zipName}); fresh download may occur.`)
      summary.missing.push(arch)
      continue
    }

    const validation = validateZipArchive(zipPath)
    if (validation.ok) {
      logger.info(`Cache OK: ${zipPath}`)
      summary.checked.push(arch)
      continue
    }

    logger.info(`Corrupted archive detected for ${arch}: ${validation.reason}`)
    logger.info(`Removing cache entry: ${zipPath}`)
    removeCorruptedArchive(zipPath)
    summary.removed.push(arch)
  }

  logger.info('Preflight completed.')
  return summary
}

function printUsage() {
  console.log(`Usage:\n  node scripts/preflight-electron-cache.mjs [--arch arm64] [--arch x64]\n\nIf no --arch is provided, host arch is inferred.`)
}

function parseCliArgs(args) {
  const arches = []

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]

    if (arg === '-h' || arg === '--help') {
      return {
        mode: 'help',
        arches,
      }
    }

    if (arg === '--arch') {
      const value = args[index + 1]
      if (!value) {
        throw new Error('Missing value for --arch')
      }

      arches.push(value)
      index += 1
      continue
    }

    if (arg.startsWith('--arch=')) {
      arches.push(arg.slice('--arch='.length))
      continue
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  return {
    mode: 'run',
    arches,
  }
}

function runAsCli() {
  const { mode, arches } = parseCliArgs(process.argv.slice(2))
  if (mode === 'help') {
    printUsage()
    return
  }

  const scriptDir = path.dirname(fileURLToPath(import.meta.url))
  const projectDir = path.resolve(scriptDir, '..')

  const requestedArches = arches.length > 0 ? arches : [inferHostArch()]
  if (!requestedArches[0]) {
    throw new Error('Unable to infer host architecture. Please pass --arch explicitly.')
  }

  runElectronCachePreflight({
    projectDir,
    arches: requestedArches,
  })
}

const isCliEntry = path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)
if (isCliEntry) {
  try {
    runAsCli()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[preflight-electron-cache] ERROR: ${message}`)
    process.exit(1)
  }
}
