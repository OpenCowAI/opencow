// SPDX-License-Identifier: Apache-2.0

import * as pty from 'node-pty'
import { BrowserWindow } from 'electron'
import { nanoid } from 'nanoid'
import type {
  TerminalScope,
  TerminalSpawnParams,
  TerminalInfo,
  TerminalExitPayload,
} from '@shared/types'
import type { ManagedTerminal, TerminalServiceDeps } from './types'
import { createRingBuffer } from './ringBuffer'
import { resolveShell } from './shellResolver'
import { generateWelcomeBanner } from './welcomeBanner'
import { createLogger } from '../platform/logger'

const log = createLogger('TerminalService')

/**
 * TerminalService — PTY lifecycle management.
 *
 * Responsibilities:
 * - PTY creation / reuse / destruction
 * - Output data routing (targeted IPC push + Ring Buffer caching)
 * - Exit event dispatching (DataBus)
 *
 * Design decisions:
 * - Each scope (project / global) can have multiple active PTY instances (multiple tabs)
 * - ensure() has idempotent semantics: returns the first existing instance for the scope, or creates one
 * - spawn() always creates a new instance (used for new tabs)
 * - Mutex protects concurrent ensure() calls (prevents double creation)
 * - Ring Buffer supports output replay after tab switching
 */
export class TerminalService {
  /** Primary index: terminalId → managed terminal */
  private readonly terminalsById = new Map<string, ManagedTerminal>()

  /** Secondary index: scopeKey → Set<terminalId> (one-to-many) */
  private readonly terminalsByScope = new Map<string, Set<string>>()

  /** Mutex: scope key → in-flight ensure() Promise */
  private readonly pendingEnsures = new Map<string, Promise<TerminalInfo>>()

  private readonly deps: TerminalServiceDeps

  constructor(deps: TerminalServiceDeps) {
    this.deps = deps
  }

  // ── Public API ──────────────────────────────────────────────────────

  /**
   * Create or reuse a Terminal for the given scope (idempotent semantics).
   *
   * - Scope already has an instance → return the first one
   * - No instance but an in-flight ensure exists → await the existing Promise
   * - No instance and no in-flight → create a new instance
   */
  async ensure(params: TerminalSpawnParams): Promise<TerminalInfo> {
    const key = this.scopeKey(params.scope)

    // Fast path: scope already has an instance → return the first one
    const scopeIds = this.terminalsByScope.get(key)
    if (scopeIds && scopeIds.size > 0) {
      const firstId = scopeIds.values().next().value as string
      return this.toInfo(this.terminalsById.get(firstId)!)
    }

    // Mutex: prevent concurrent ensure calls from creating multiple instances
    const pending = this.pendingEnsures.get(key)
    if (pending) {
      return pending
    }

    const promise = this.doCreate(params)
    this.pendingEnsures.set(key, promise)

    try {
      return await promise
    } finally {
      this.pendingEnsures.delete(key)
    }
  }

  /**
   * Always create a new Terminal instance (used for new tabs).
   * Not protected by the mutex — each call creates an independent PTY.
   */
  async spawn(params: TerminalSpawnParams): Promise<TerminalInfo> {
    return this.doCreate(params)
  }

  write(id: string, data: string): void {
    const managed = this.findById(id)
    if (!managed) {
      log.warn(`write: terminal not found (id=${id})`)
      return
    }
    managed.pty.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    const managed = this.findById(id)
    if (!managed) return
    managed.pty.resize(cols, rows)
  }

  kill(id: string): void {
    const managed = this.terminalsById.get(id)
    if (!managed) return
    const key = this.scopeKey(managed.scope)
    log.info(`Killing terminal: key="${key}", id="${id}"`)
    managed.pty.kill()
    this.terminalsById.delete(id)
    this.terminalsByScope.get(key)?.delete(id)
  }

  killAll(): void {
    for (const [id, managed] of this.terminalsById) {
      log.info(`Killing terminal: id="${id}"`)
      managed.pty.kill()
    }
    this.terminalsById.clear()
    this.terminalsByScope.clear()
  }

  getInfo(scope: TerminalScope): TerminalInfo | null {
    const key = this.scopeKey(scope)
    const scopeIds = this.terminalsByScope.get(key)
    if (!scopeIds || scopeIds.size === 0) return null
    const firstId = scopeIds.values().next().value as string
    return this.toInfo(this.terminalsById.get(firstId)!)
  }

  list(): TerminalInfo[] {
    return Array.from(this.terminalsById.values()).map((m) => this.toInfo(m))
  }

  replay(id: string): string {
    const managed = this.findById(id)
    if (!managed) return ''
    return managed.outputBuffer.drain()
  }

  // ── Private ─────────────────────────────────────────────────────────

  private async doCreate(params: TerminalSpawnParams): Promise<TerminalInfo> {
    const { scope, cols, rows } = params
    const key = this.scopeKey(scope)
    const id = nanoid()
    const shell = resolveShell()
    const cwd = this.deps.resolveCwd(scope)

    log.info(`Creating terminal: key="${key}", id="${id}", shell="${shell}", cwd="${cwd}"`)

    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: {
        ...process.env,
        // Ensure UTF-8 locale for CJK support when launched from Finder (macOS)
        LANG: process.env.LANG || 'en_US.UTF-8',
      } as Record<string, string>,
    })

    const managed: ManagedTerminal = {
      id,
      scope,
      pty: ptyProcess,
      shell,
      outputBuffer: createRingBuffer(),
      createdAt: Date.now(),
    }

    // Write to both indexes
    this.terminalsById.set(id, managed)
    if (!this.terminalsByScope.has(key)) {
      this.terminalsByScope.set(key, new Set())
    }
    this.terminalsByScope.get(key)!.add(id)

    // Welcome banner: push into Ring Buffer (naturally included on replay)
    managed.outputBuffer.push(generateWelcomeBanner(scope, cwd))

    // Output routing: Ring Buffer + targeted IPC
    ptyProcess.onData((data: string) => {
      managed.outputBuffer.push(data)
      this.sendToRenderer(`terminal:output:${id}`, data)
    })

    // Exit handling
    ptyProcess.onExit(({ exitCode, signal }) => {
      log.info(`Terminal exited: id="${id}", code=${exitCode}, signal=${signal}`)
      this.terminalsById.delete(id)
      this.terminalsByScope.get(key)?.delete(id)

      const payload: TerminalExitPayload = { id, exitCode, signal }
      this.deps.dispatch({ type: 'terminal:exited', payload })
    })

    return this.toInfo(managed)
  }

  private findById(id: string): ManagedTerminal | undefined {
    return this.terminalsById.get(id)
  }

  private toInfo(managed: ManagedTerminal): TerminalInfo {
    return {
      id: managed.id,
      scope: managed.scope,
      pid: managed.pty.pid,
      cwd: this.deps.resolveCwd(managed.scope),
      shell: managed.shell,
      createdAt: managed.createdAt,
    }
  }

  private scopeKey(scope: TerminalScope): string {
    return scope.type === 'global' ? 'global' : `project:${scope.projectId}`
  }

  private sendToRenderer(channel: string, data: string): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, data)
      }
    }
  }
}
