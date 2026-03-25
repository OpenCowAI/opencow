// SPDX-License-Identifier: Apache-2.0

/**
 * Encrypted credential storage using Electron's safeStorage API.
 *
 * Sensitive credentials (OAuth tokens, API keys) are encrypted with the
 * OS-level keychain (macOS Keychain / Windows DPAPI / Linux libsecret)
 * and persisted to a binary file.
 *
 * Non-sensitive auth config (active mode, region) lives in SettingsService.
 *
 * Generic over `T` — the shape of the credential object:
 *   - Provider adapters use `CredentialStore` (defaults to `StoredCredentials`)
 *   - Repo source registry uses `CredentialStore<Record<string, string>>` for
 *     dynamic keys like `repo:<sourceId>`.
 *
 * Thread-safety: all public methods are serialized via an async mutex to
 * prevent concurrent read-modify-write races (e.g. two adapters updating
 * different credential keys simultaneously).
 */

import { readFile, writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { dirname } from 'path'
import { safeStorage } from 'electron'
import type { StoredCredentials } from './types'
import { createLogger } from '../../platform/logger'

const log = createLogger('CredentialStore')

export class CredentialStore<T extends Record<string, unknown> = StoredCredentials> {
  private readonly filePath: string
  private cache: T | null = null

  /**
   * Async mutex — serializes all public methods to prevent concurrent
   * read-modify-write races.  Only one operation can be in-flight at a time.
   */
  private pending: Promise<void> = Promise.resolve()

  constructor(filePath: string) {
    this.filePath = filePath
  }

  /** Update a specific credential field and persist. */
  async update<K extends string & keyof T>(
    key: K,
    value: T[K]
  ): Promise<void> {
    return this.serialize(async () => {
      const current = await this.loadInternal()
      const next = { ...current, [key]: value }
      await this.persistToDisk(next)
    })
  }

  /** Remove a specific credential field and persist. */
  async remove(key: string & keyof T): Promise<void> {
    return this.serialize(async () => {
      const current = await this.loadInternal()
      const next = { ...current }
      delete next[key]
      await this.persistToDisk(next)
    })
  }

  /** Get a specific credential field (loads from disk on first access). */
  async get<K extends string & keyof T>(key: K): Promise<T[K] | undefined> {
    return this.serialize(async () => {
      const current = await this.loadInternal()
      const value = current[key]
      // Return a deep copy to prevent callers from mutating the cache
      return value !== undefined ? structuredClone(value) : undefined
    })
  }

  /** Clear all stored credentials. */
  async clear(): Promise<void> {
    return this.serialize(async () => {
      await this.persistToDisk({} as T)
    })
  }

  // ── Private: Serialization ────────────────────────────────────────

  /**
   * Serialize an async operation through the mutex.
   *
   * Each operation waits for all previously queued operations to complete
   * before executing.  Errors in one operation do not block subsequent ones.
   */
  private serialize<R>(fn: () => Promise<R>): Promise<R> {
    const next = this.pending.then(fn, fn)
    // Update the chain — swallow the value so `pending` is always Promise<void>
    this.pending = next.then(() => {}, () => {})
    return next
  }

  // ── Private: Disk I/O ─────────────────────────────────────────────

  /**
   * Load credentials from disk (decrypting if safeStorage is available).
   * Uses an in-memory cache after first load.
   */
  private async loadInternal(): Promise<T> {
    if (this.cache) return this.cache

    if (!existsSync(this.filePath)) {
      this.cache = {} as T
      return this.cache
    }

    try {
      const encrypted = await readFile(this.filePath)
      let json: string
      if (safeStorage.isEncryptionAvailable()) {
        try {
          json = safeStorage.decryptString(encrypted)
        } catch (decryptErr) {
          // Compatibility migration: older/dev builds may have written plaintext JSON.
          // If parsing succeeds, immediately re-encrypt via persistToDisk().
          const fallbackJson = encrypted.toString('utf-8')
          const parsedFallback = parseCredentialObject<T>(fallbackJson)
          if (parsedFallback) {
            this.cache = parsedFallback
            await this.persistToDisk(this.cache)
            log.info(`Migrated plaintext credential file to encrypted storage (${this.filePath})`)
            return this.cache
          }
          throw decryptErr
        }
      } else {
        json = encrypted.toString('utf-8')
      }

      const parsed = parseCredentialObject<T>(json)
      if (!parsed) throw new Error('Credential file is not a JSON object')
      this.cache = parsed
    } catch (err) {
      log.warn(`Failed to load credentials (${this.filePath}), starting fresh`, err)
      this.cache = {} as T
    }

    return this.cache
  }

  /**
   * Persist credentials to disk, then update the in-memory cache.
   *
   * IMPORTANT: The cache is updated AFTER the disk write succeeds.
   * If the write fails, the in-memory cache retains the previous state,
   * ensuring cache and disk stay consistent.
   */
  private async persistToDisk(credentials: T): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })

    const json = JSON.stringify(credentials, null, 2)
    const data = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(json)
      : Buffer.from(json, 'utf-8')

    await writeFile(this.filePath, data)
    // Only update cache after successful write
    this.cache = credentials
    log.debug('Credentials persisted')
  }
}

function parseCredentialObject<T extends Record<string, unknown>>(json: string): T | null {
  try {
    const parsed = JSON.parse(json) as unknown
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') return null
    return parsed as T
  } catch {
    return null
  }
}
