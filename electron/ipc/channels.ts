// SPDX-License-Identifier: Apache-2.0

import { ipcMain, BrowserWindow, app, clipboard } from 'electron'
import { fetchEvoseApps } from '../services/evoseService'
import type { DataBus } from '../core/dataBus'
import type { OnboardingStore } from '../services/onboardingStore'
import type { InboxService } from '../services/inboxService'
import type { IssueService } from '../services/issueService'
import type { IssueViewService } from '../services/issueViewService'
import type { SessionOrchestrator } from '../command/sessionOrchestrator'
import type { SettingsService } from '../services/settingsService'
import type { WebhookService } from '../services/webhooks/webhookService'
import type { IMBridgeManager } from '../services/messaging'
import type { WeixinBotManager } from '../services/weixinBot/weixinBotManager'
import type { ProjectService } from '../services/projectService'
import type { ArtifactService } from '../services/artifactService'
import type { NoteStore } from '../services/noteStore'
import type { ProviderService } from '../services/provider/providerService'
import type { GitService } from '../services/git/gitService'
import type { IssueContextRefStore } from '../services/issueContextRefStore'
import type { StoredProject } from '../services/projectStore'
import type { BrowserService } from '../browser/browserService'
import type { ScheduleService } from '../services/schedule/scheduleService'
import type { TerminalService } from '../terminal/terminalService'
import type { TrayManager } from '../tray'
import type {
  IPCChannels,
  IPCEventChannels,
  TaskFull,
  FileEntry,
  DataBusEvent,
  Project,
  AppSettings,
} from '@shared/types'
import { searchFiles, shouldSkipEntry } from '@shared/fileSearch'
import type { IPCHandler } from '@shared/ipc'
import { writeLogEntry, createLogger } from '../platform/logger'
import { validateCapabilityPath } from '../security/pathValidator'
import { IPC_EVENT_CHANNEL } from '@shared/appIdentity'
import { resolveLocale } from '@shared/i18n'
import { setupApplicationMenu } from '../menu'

const log = createLogger('IPC')
import { ContextRefResolver } from '../services/contextRefResolver'
// Legacy save/delete capability imports removed — now handled by Capability Center
import { installHooks, uninstallHooks, isHooksInstalled } from '../services/hooksInstaller'
import { checkPrerequisites } from '../services/prerequisiteChecker'
import type { DataPaths } from '../platform/dataPaths'
import type { CapabilityCenter } from '../services/capabilityCenter'
import type { PackageService } from '../services/capabilityCenter/packageService'
import type { DistributionTarget } from '../services/capabilityCenter/distributionPipeline'
import type { MarketplaceService } from '../services/marketplace'
import type { RepoSourceRegistry } from '../services/marketplace/repoSourceRegistry'
import { listClaudeCapabilities } from '../services/capabilities'
import { projectStartSessionInput } from '../command/sessionStartInputProjector'
import { FileContentAccessService } from '../services/fileAccess'
import { isPathWithinBase } from '../security/pathBounds'

const QUIET_CHANNELS = new Set<string>(['log:write'])
const IPC_VERBOSE_LOG_ENABLED =
  process.env.OPENCOW_IPC_VERBOSE === '1' ||
  process.env.OPENCOW_IPC_VERBOSE === 'true'

function registerHandler<K extends keyof IPCChannels>(channel: K, handler: IPCHandler<K>): void {
  ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
    const startedAt = Date.now()
    try {
      const result = await (handler as (...a: unknown[]) => unknown)(...args)
      const durationMs = Date.now() - startedAt
      if (IPC_VERBOSE_LOG_ENABLED && !QUIET_CHANNELS.has(String(channel))) {
        log.debug(`IPC ${String(channel)} completed`, { durationMs, argsCount: args.length })
      }
      if (durationMs >= 1_000) {
        log.warn(`Slow IPC handler: ${String(channel)}`, { durationMs, argsCount: args.length })
      }
      return result
    } catch (err) {
      log.error(`Error in ${String(channel)}`, { durationMs: Date.now() - startedAt, argsCount: args.length }, err)
      throw err
    }
  })
}

function broadcast<K extends keyof IPCEventChannels>(channel: K, data: IPCEventChannels[K]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, data)
    }
  }
}


function serializeEvent(event: DataBusEvent): DataBusEvent {
  return event
}

function isEvoseSettingsChanged(previous: AppSettings, next: AppSettings): boolean {
  return JSON.stringify(previous.evose) !== JSON.stringify(next.evose)
}

function isUpdateSettingsChanged(previous: AppSettings, next: AppSettings): boolean {
  return (
    previous.updates.autoCheckUpdates !== next.updates.autoCheckUpdates ||
    previous.updates.updateCheckInterval !== next.updates.updateCheckInterval
  )
}

export interface IPCDeps {
  bus: DataBus
  onboarding: OnboardingStore
  dataPaths: DataPaths
  hookEnv: 'production' | 'development'
  inbox?: InboxService
  issueService?: IssueService
  issueViewService?: IssueViewService
  orchestrator?: SessionOrchestrator
  settingsService?: SettingsService
  webhookService?: WebhookService
  imBridgeManager?: IMBridgeManager
  weixinBotManager?: WeixinBotManager
  projectService?: ProjectService | null
  artifactService?: ArtifactService | null
  noteStore?: NoteStore | null
  providerService?: ProviderService
  gitService?: GitService
  browserService?: BrowserService | null
  scheduleService?: ScheduleService
  contextRefStore?: IssueContextRefStore
  terminalService?: TerminalService
  trayManager?: TrayManager
  capabilityCenter?: CapabilityCenter
  packageService?: PackageService
  marketplaceService?: MarketplaceService
  repoSourceRegistry?: RepoSourceRegistry
  /**
   * Returns a proxy-aware fetch function for external API calls (Evose, etc.).
   * Called lazily per-request so proxy settings changes take effect immediately.
   */
  getProxyFetch?: () => typeof globalThis.fetch
  /** Custom quit handler for double-press confirmation. */
  onQuit?: () => void
  /** UpdateChecker for manual "Check for Updates" IPC. */
  updateChecker?: import('../services/update').UpdateCheckerService
}

/* ------------------------------------------------------------------ */
/*  File Index Cache (in-memory, per project path)                     */
/* ------------------------------------------------------------------ */

interface FileIndexCacheEntry {
  entries: FileEntry[]
  timestamp: number
}

/** Cached file indexes keyed by projectPath. TTL-based invalidation. */
const fileIndexCache = new Map<string, FileIndexCacheEntry>()
const FILE_INDEX_TTL_MS = 30_000 // 30 seconds
const FILE_INDEX_MAX_DEPTH = 8

/**
 * Build or retrieve a cached flat file index for the given project.
 * Uses shared `shouldSkipEntry` for consistent filtering.
 */
async function getFileIndex(projectPath: string): Promise<FileEntry[]> {
  const cached = fileIndexCache.get(projectPath)
  if (cached && Date.now() - cached.timestamp < FILE_INDEX_TTL_MS) {
    return cached.entries
  }

  const fs = await import('node:fs/promises')
  const path = await import('node:path')
  const resolvedBase = path.resolve(projectPath)
  const entries: FileEntry[] = []

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > FILE_INDEX_MAX_DEPTH) return
    try {
      const dirEntries = await fs.readdir(dir, { withFileTypes: true })
      for (const entry of dirEntries) {
        if (shouldSkipEntry(entry.name)) continue
        const fullPath = path.join(dir, entry.name)
        const relativePath = path.relative(projectPath, fullPath)
        try {
          const stat = await fs.stat(fullPath)
          entries.push({
            name: entry.name,
            path: relativePath,
            isDirectory: entry.isDirectory(),
            size: stat.size,
            modifiedAt: stat.mtimeMs,
          })
        } catch { /* skip unreadable */ }
        if (entry.isDirectory()) {
          await walk(fullPath, depth + 1)
        }
      }
    } catch { /* skip unreadable dirs */ }
  }

  await walk(resolvedBase, 0)

  fileIndexCache.set(projectPath, { entries, timestamp: Date.now() })
  return entries
}

export function registerIPCHandlers(deps: IPCDeps): void {
  const { bus, onboarding, inbox, issueService, orchestrator, settingsService, projectService, gitService } = deps
  const fileContentAccess = new FileContentAccessService()

  function toProject(stored: StoredProject, runtime?: Project | null): Project {
    return {
      id: stored.id, path: stored.canonicalPath, name: stored.name,
      sessionCount: runtime?.sessionCount ?? 0,
      pinOrder: stored.pinOrder, archivedAt: stored.archivedAt,
      displayOrder: stored.displayOrder,
      updatedAt: stored.updatedAt,
    }
  }

  async function syncRuntimeProjectsFromStore(): Promise<void> {
    if (!projectService) return
    const stored = await projectService.listAll()
    const state = bus.getState()
    const runtimeProjectMap = new Map(state.projects.map((p) => [p.id, p]))
    const projects = stored
      .map((sp) => toProject(sp, runtimeProjectMap.get(sp.id)))
      .sort((a, b) => a.displayOrder - b.displayOrder)

    bus.dispatch({
      type: 'sessions:updated',
      payload: {
        projects,
        sessions: state.sessions,
      },
    })
  }

  // Keep DataBus project snapshot aligned with DB even without SessionSource.
  void syncRuntimeProjectsFromStore().catch((err) => {
    log.error('Failed to initialize runtime project snapshot', err)
  })

  registerHandler('get-initial-state', async () => {
    // ── Projects: DB direct read + runtime metadata merge ──
    // Runtime project snapshot is maintained from DB sync (no ~/.claude scan dependency).
    const stored = projectService ? await projectService.listAll() : []
    const runtime = bus.getState()
    const runtimeProjectMap = new Map(runtime.projects.map(p => [p.id, p]))
    const projects = stored.map(sp => toProject(sp, runtimeProjectMap.get(sp.id)))

    // ── Runtime state from DataBus (may be partially populated at startup) ──
    const tasks: Record<string, TaskFull[]> = {}
    for (const [k, v] of runtime.tasks) {
      tasks[k] = v
    }

    return {
      projects,
      sessions: runtime.sessions,
      tasks,
      stats: runtime.stats,
      onboarding: runtime.onboarding,
      inboxMessages: runtime.inboxMessages,
      inboxUnreadCount: runtime.inboxUnreadCount,
      settings: runtime.settings,
      providerStatus: runtime.providerStatus,
      systemLocale: app.getLocale(),
      runtimeVersions: {
        electron: process.versions.electron ?? '',
        chrome: process.versions.chrome ?? '',
        node: process.versions.node ?? '',
      },
    }
  })

  registerHandler('install-hooks', async () => {
    const result = await installHooks(deps.dataPaths, deps.hookEnv)
    if (result) {
      const onboardingState = await onboarding.setHooksInstalled(true)
      bus.dispatch({ type: 'onboarding:status', payload: onboardingState })
    }
    return result
  })

  registerHandler('uninstall-hooks', async () => {
    const result = await uninstallHooks(deps.hookEnv)
    if (result) {
      const onboardingState = await onboarding.setHooksInstalled(false)
      bus.dispatch({ type: 'onboarding:status', payload: onboardingState })
    }
    return result
  })

  registerHandler('get-hooks-status', () => isHooksInstalled(deps.hookEnv))

  registerHandler('pin-project', async (projectId) => {
    if (!projectService) throw new Error('Not ready')
    const stored = await projectService.pinProject(projectId)
    if (!stored) throw new Error(`Project not found: ${projectId}`)
    await syncRuntimeProjectsFromStore()
    const runtime = bus.getState().projects.find((p) => p.id === projectId)
    return toProject(stored, runtime)
  })

  registerHandler('unpin-project', async (projectId) => {
    if (!projectService) throw new Error('Not ready')
    const stored = await projectService.unpinProject(projectId)
    if (!stored) throw new Error(`Project not found: ${projectId}`)
    await syncRuntimeProjectsFromStore()
    const runtime = bus.getState().projects.find((p) => p.id === projectId)
    return toProject(stored, runtime)
  })

  registerHandler('archive-project', async (projectId) => {
    if (!projectService) throw new Error('Not ready')
    const stored = await projectService.archiveProject(projectId)
    if (!stored) throw new Error(`Project not found: ${projectId}`)
    await syncRuntimeProjectsFromStore()
    const runtime = bus.getState().projects.find((p) => p.id === projectId)
    return toProject(stored, runtime)
  })

  registerHandler('unarchive-project', async (projectId) => {
    if (!projectService) throw new Error('Not ready')
    const stored = await projectService.unarchiveProject(projectId)
    if (!stored) throw new Error(`Project not found: ${projectId}`)
    await syncRuntimeProjectsFromStore()
    const runtime = bus.getState().projects.find((p) => p.id === projectId)
    return toProject(stored, runtime)
  })

  registerHandler('reorder-projects', async (orderedIds) => {
    if (!projectService) throw new Error('Not ready')
    await projectService.reorderProjects(orderedIds)
    await syncRuntimeProjectsFromStore()
  })

  registerHandler('reorder-pinned-projects', async (orderedIds) => {
    if (!projectService) throw new Error('Not ready')
    await projectService.reorderPinnedProjects(orderedIds)
    await syncRuntimeProjectsFromStore()
  })

  registerHandler('get-onboarding-state', () => onboarding.load())

  registerHandler('complete-onboarding', async () => {
    const state = await onboarding.complete()
    bus.dispatch({ type: 'onboarding:status', payload: state })
    return state
  })

  registerHandler('check-prerequisites', () => checkPrerequisites())

  // ── Project Discovery & Import (Onboarding) ────────────────────────

  registerHandler('discover-importable-projects', async () => {
    if (!projectService) throw new Error('Not ready')
    return projectService.discoverImportable()
  })

  registerHandler('import-discovered-projects', async (projects) => {
    if (!projectService) throw new Error('Not ready')
    const stored = await projectService.importProjects(
      projects.map((p) => ({ folderName: p.folderName, resolvedPath: p.resolvedPath, name: p.name }))
    )
    await syncRuntimeProjectsFromStore()
    // Keep import-completed signal for observers (schedule/event automation).
    bus.dispatch({ type: 'projects:import-completed', payload: {} })
    return stored.map((s) => toProject(s))
  })

  // ── Git integration ────────────────────────────────────────────────

  if (gitService) {
    const git = gitService
    registerHandler('git:get-status', async (projectPath) => git.activateProject(projectPath))
    registerHandler('git:is-repo', async (projectPath) => git.isGitRepo(projectPath))
    registerHandler('git:force-refresh', async (projectPath) => git.forceRefresh(projectPath))
    registerHandler('git:file-diff', async (projectPath, filePath) => git.getFileDiff(projectPath, filePath))
  }

  // ── File operations ───────────────────────────────────────────────

  registerHandler('list-project-files', async (projectPath, subPath) => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')

    const targetDir = subPath ? path.join(projectPath, subPath) : projectPath

    // Security: ensure targetDir is within projectPath
    const resolved = path.resolve(targetDir)
    const resolvedBase = path.resolve(projectPath)
    if (!isPathWithinBase(resolved, resolvedBase)) {
      throw new Error('Access denied: path outside project directory')
    }

    try {
      const entries = await fs.readdir(resolved, { withFileTypes: true })
      const results: FileEntry[] = []

      for (const entry of entries) {
        // Skip hidden files and common noise (shared skip logic)
        if (shouldSkipEntry(entry.name)) continue

        const fullPath = path.join(resolved, entry.name)
        try {
          const stat = await fs.stat(fullPath)
          results.push({
            name: entry.name,
            path: path.relative(projectPath, fullPath),
            isDirectory: entry.isDirectory(),
            size: stat.size,
            modifiedAt: stat.mtimeMs
          })
        } catch {
          // Skip files we can't stat (permission issues, broken symlinks)
        }
      }

      // Sort: directories first, then alphabetical
      results.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
        return a.name.localeCompare(b.name)
      })

      return results
    } catch {
      return []
    }
  })

  registerHandler('search-project-files', async (projectPath, query) => {
    // Build or retrieve cached file index, then apply fuzzy search
    const allEntries = await getFileIndex(projectPath)
    const matches = searchFiles(allEntries, query, { maxResults: 50 })
    // Return FileEntry[] for backward compatibility (Phase 3 will switch to FileSearchMatch[])
    return matches.map((m) => m.entry)
  })

  registerHandler('read-file-content', async (projectPath, filePath) => {
    return fileContentAccess.readProjectFile(projectPath, filePath)
  })

  registerHandler('view-tool-file-content', async (input) => {
    return fileContentAccess.readSessionToolFile({
      input,
      getSession: deps.orchestrator
        ? (sessionId) => deps.orchestrator!.getSession(sessionId)
        : undefined,
    })
  })

  registerHandler('save-file-content', async (projectPath, filePath, content) => {
    return fileContentAccess.saveProjectFile(projectPath, filePath, content)
  })

  registerHandler('download-file', async (defaultFileName, content) => {
    const { dialog } = await import('electron')
    const fs = await import('node:fs/promises')
    const path = await import('node:path')

    // Derive dialog filters from the file extension
    const ext = path.extname(defaultFileName).replace('.', '').toLowerCase()
    const FILTER_NAMES: Record<string, string> = {
      md: 'Markdown', svg: 'SVG Image', mmd: 'Mermaid Diagram',
      json: 'JSON', yaml: 'YAML', yml: 'YAML', html: 'HTML',
      ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript',
      py: 'Python', rs: 'Rust', go: 'Go', css: 'CSS',
    }
    const filterName = FILTER_NAMES[ext] ?? ext.toUpperCase()
    const filters = ext
      ? [{ name: filterName, extensions: [ext] }, { name: 'All Files', extensions: ['*'] }]
      : [{ name: 'All Files', extensions: ['*'] }]

    const { canceled, filePath: savePath } = await dialog.showSaveDialog({
      defaultPath: defaultFileName,
      filters,
    })
    if (canceled || !savePath) return { success: false }

    await fs.writeFile(savePath, content, 'utf-8')
    return { success: true, savedPath: savePath }
  })

  registerHandler('list-claude-capabilities', (projectPath) => listClaudeCapabilities(projectPath))

  // --- Inbox handlers (guarded until inbox is wired in Task 14) ---
  if (inbox) {
    registerHandler('list-inbox-messages', (filter) => inbox.listMessages(filter))
    registerHandler('update-inbox-message', (params) => inbox.updateMessage(params))
    registerHandler('get-inbox-stats', () => inbox.getStats())
    registerHandler('dismiss-inbox-message', (id) => inbox.dismissMessage(id))
    registerHandler('mark-all-inbox-read', () => inbox.markAllRead())
  }

  // --- Issue handlers ---
  if (issueService) {
    registerHandler('list-issues', (filter) => {
      // Return lightweight summaries — excludes description, images, sessionHistory.
      // contextRefs are NOT loaded here (eliminates N+1 queries).
      // Full issue data is loaded on-demand via get-issue when detail view opens.
      return issueService.listIssueSummaries(filter)
    })
    registerHandler('count-issues', (filter) => issueService.countIssues(filter))
    registerHandler('get-issue', async (id) => {
      const issue = await issueService.getIssue(id)
      if (issue && deps.contextRefStore) {
        issue.contextRefs = await deps.contextRefStore.listByIssueId(issue.id)
      }
      return issue
    })
    registerHandler('create-issue', async (input) => {
      const issue = await issueService.createIssue(input)
      if (deps.contextRefStore && input.contextRefs?.length) {
        await deps.contextRefStore.replaceAll(issue.id, input.contextRefs)
      }
      return issue
    })
    registerHandler('update-issue', async (id, patch) => {
      // contextRefs live in the junction table, not the issues table — strip before DB update
      const { contextRefs, ...issuePatch } = patch as typeof patch & { contextRefs?: unknown }
      const issue = await issueService.updateIssue(id, issuePatch)
      if (deps.contextRefStore && Array.isArray(contextRefs)) {
        await deps.contextRefStore.replaceAll(id, contextRefs as import('../../src/shared/types').ContextRef[])
      }
      return issue
    })
    registerHandler('delete-issue', async (id) => {
      // Release any browser view created for this Issue (issue-standalone mode)
      // before deleting the record, to free WebContentsView resources immediately.
      await deps.browserService?.releaseIssueView(id)
      return issueService.deleteIssue(id)
    })
    registerHandler('mark-issue-read', (id) => issueService.markIssueRead(id))
    registerHandler('mark-issue-unread', (id) => issueService.markIssueUnread(id))
    registerHandler('list-child-issues', (parentId) => issueService.listChildIssueSummaries(parentId))
    registerHandler('list-custom-labels', () => issueService.getCustomLabels())
    registerHandler('create-custom-label', (label) => issueService.createCustomLabel(label))
    registerHandler('delete-custom-label', async (label) => {
      const labels = await issueService.deleteCustomLabel(label)
      // Cascade: purge the deleted label from all issue view filters
      // so no view silently retains a "phantom" reference.
      await deps.issueViewService?.purgeLabel(label)
      return labels
    })
    registerHandler('update-custom-label', async (oldLabel, newLabel) => {
      const labels = await issueService.updateCustomLabel(oldLabel, newLabel)
      // Cascade: rename the label in all issue view filters
      // so filter UIs and queries stay consistent.
      await deps.issueViewService?.renameLabel(oldLabel, newLabel)
      return labels
    })

    // Context candidates for ContextRefsPicker — only needs id + title.
    // Accepts an optional filter to scope results (e.g. by project).
    registerHandler('get-context-candidates', async (filter) => {
      const issueQuery: { hasSession: boolean; projectId?: string } = { hasSession: true }
      if (filter?.projectId) issueQuery.projectId = filter.projectId
      const issues = await issueService.listIssueSummaries(issueQuery)
      const artifacts = deps.artifactService ? await deps.artifactService.listStarred() : []
      return { issues, artifacts }
    })
  }

  // --- Issue View handlers ---
  if (deps.issueViewService) {
    const issueViewService = deps.issueViewService
    registerHandler('list-issue-views', () => issueViewService.listViews())
    registerHandler('create-issue-view', (input) => issueViewService.createView(input))
    registerHandler('update-issue-view', (id, patch) => issueViewService.updateView(id, patch))
    registerHandler('delete-issue-view', (id) => issueViewService.deleteView(id))
    registerHandler('reorder-issue-views', (orderedIds) => issueViewService.reorderViews(orderedIds))
  }

  // --- Schedule handlers ---
  if (deps.scheduleService) {
    const scheduleService = deps.scheduleService
    // Schedule CRUD
    registerHandler('schedule:list', (filter?) => scheduleService.list(filter))
    registerHandler('schedule:get', (id) => scheduleService.get(id))
    registerHandler('schedule:create', (input) => scheduleService.create(input))
    registerHandler('schedule:update', (id, patch) => scheduleService.update(id, patch))
    registerHandler('schedule:delete', (id) => scheduleService.delete(id))
    // Schedule Control
    registerHandler('schedule:pause', (id) => scheduleService.pause(id))
    registerHandler('schedule:resume', (id) => scheduleService.resume(id))
    registerHandler('schedule:trigger-now', (id) => scheduleService.triggerNow(id))
    // Executions
    registerHandler('schedule:list-executions', (scheduleId, limit?) => scheduleService.listExecutions(scheduleId, limit))
    // Preview
    registerHandler('schedule:preview-next-runs', (trigger, count) => scheduleService.previewNextRuns(trigger, count))
    // Pipeline CRUD
    registerHandler('pipeline:list', () => scheduleService.listPipelines())
    registerHandler('pipeline:get', (id) => scheduleService.getPipeline(id))
    registerHandler('pipeline:create', (input) => scheduleService.createPipeline(input))
    registerHandler('pipeline:update', (id, patch) => scheduleService.updatePipeline(id, patch))
    registerHandler('pipeline:delete', (id) => scheduleService.deletePipeline(id))
  }

  registerHandler('read-capability-source', async (sourcePath, projectPath) => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const { detectLanguage } = await import('@shared/fileUtils')

    const virtual = deps.capabilityCenter?.readVirtualCapabilitySource(sourcePath)
    if (virtual) return virtual

    const resolved = path.resolve(sourcePath)

    validateCapabilityPath(resolved, projectPath)

    const stat = await fs.stat(resolved)

    if (stat.isDirectory()) {
      const configFiles = [
        path.join(resolved, '.claude-plugin', 'plugin.json'),
        path.join(resolved, '.mcp.json'),
        path.join(resolved, 'package.json')
      ]
      const aggregated: Record<string, unknown> = {}
      for (const cfgPath of configFiles) {
        try {
          const content = await fs.readFile(cfgPath, 'utf-8')
          const filename = path.basename(cfgPath)
          aggregated[filename] = JSON.parse(content)
        } catch {
          // skip missing/unreadable files
        }
      }
      return {
        content: JSON.stringify(aggregated, null, 2),
        language: 'json'
      }
    }

    const content = await fs.readFile(resolved, 'utf-8')
    return {
      content,
      language: detectLanguage(resolved)
    }
  })

  // --- Capability Center handlers (v3.1 M4) ---

  /** Parse IPC target string into typed DistributionTarget (resolves projectId → path) */
  async function resolveDistTarget(params: { target: string; projectId?: string }): Promise<DistributionTarget> {
    const validTargets = new Set([
      'claude-code-global',
      'claude-code-project',
      'codex-global',
      'codex-project',
    ])
    if (!validTargets.has(params.target)) {
      throw new Error(`Unsupported capability target: ${params.target}`)
    }

    const isProjectTarget = params.target.endsWith('-project')
    if (isProjectTarget) {
      if (!params.projectId) throw new Error('projectId is required for project target')
      const cc = deps.capabilityCenter!
      const projectPath = await cc.resolveProjectPathFromId(params.projectId)
      if (!projectPath) throw new Error(`Project not found: ${params.projectId}`)
      return { type: params.target as 'claude-code-project' | 'codex-project', projectPath }
    }
    return { type: params.target as 'claude-code-global' | 'codex-global' }
  }

  if (deps.capabilityCenter) {
    const cc = deps.capabilityCenter

    registerHandler('capability:snapshot', async (projectId) => {
      return cc.getSnapshot(projectId ?? undefined)
    })

    registerHandler('capability:import:discover', async (params) => {
      const projectId = 'projectId' in params ? params.projectId : undefined
      const filePaths = params.sourceType === 'file' ? params.filePaths : undefined
      return cc.discoverImportable(params.sourceType, projectId, filePaths)
    })

    registerHandler('capability:import:execute', async (params) => {
      const scope = params.projectId ? 'project' : 'global'
      log.info(`[import:execute] scope=${scope}, projectId=${params.projectId ?? '(none)'}, items=${params.items.length}`)
      return cc.importItems(params.items, { scope, projectId: params.projectId })
    })

    // ── Clone (Cross-Project Copy) ──

    registerHandler('capability:clone:discover', async (params) => {
      return cc.discoverClonable(params)
    })

    registerHandler('capability:clone:execute', async (params) => {
      log.info(`[clone:execute] source=${params.sourceProjectId}, target=${params.targetProjectId}, items=${params.items.length}`)
      return cc.cloneCapabilities(params)
    })

    registerHandler('capability:save', async (params) => {
      return cc.save(params)
    })

    registerHandler('capability:delete', async (params) => {
      await cc.remove(params)
    })

    registerHandler('capability:toggle', async (params) => {
      await cc.toggle(params)
    })

    registerHandler('capability:publish', async (params) => {
      await cc.publish({ category: params.category, name: params.name, target: await resolveDistTarget(params) })
    })

    registerHandler('capability:unpublish', async (params) => {
      await cc.unpublish({ category: params.category, name: params.name, target: await resolveDistTarget(params) })
    })

    registerHandler('capability:sync', async (params) => {
      return cc.syncAll(params)
    })

    registerHandler('capability:detect-drift', async (params) => {
      return cc.detectDrift(params)
    })

    // M5: structured form save (backend handles serialization)
    registerHandler('capability:save-form', async (params) => {
      return cc.saveForm(params)
    })

    // M5: tags management
    registerHandler('capability:set-tags', async (params) => {
      await cc.setTags(params)
    })

    // M5: MCP Server connection test
    registerHandler('capability:test-mcp', async (params) => {
      return cc.testMcpServer(params)
    })

    // M6: diagnostics + version history
    registerHandler('capability:diagnostics', () => {
      return cc.flushDiagnostics()
    })

    registerHandler('capability:versions', async (params) => {
      return cc.getVersionHistory(params)
    })

    registerHandler('capability:version-detail', async (params) => {
      return cc.getVersionSnapshot(params.id)
    })

    // Bundle file listing — lists sibling files in a skill bundle directory
    registerHandler('capability:bundle-files', async (filePath, projectId) => {
      const { SKILL_BUNDLE_FILENAME } = await import(
        '../services/capabilityCenter/capabilityStore'
      )
      return fileContentAccess.listCapabilityBundleFiles({
        skillFilePath: filePath,
        projectId,
        bundleFileName: SKILL_BUNDLE_FILENAME,
        resolveProjectPathFromId: async (id) => (await cc.resolveProjectPathFromId(id)) ?? undefined,
      })
    })

    registerHandler('capability:view-bundle-file-content', async (input) => {
      const { SKILL_BUNDLE_FILENAME } = await import('../services/capabilityCenter/capabilityStore')
      return fileContentAccess.readCapabilityBundleFile({
        input,
        bundleFileName: SKILL_BUNDLE_FILENAME,
        resolveProjectPathFromId: async (id) => (await cc.resolveProjectPathFromId(id)) ?? undefined,
      })
    })
  }

  // --- Skills Marketplace handlers ---
  const marketplace = deps.marketplaceService
  if (marketplace) {
    registerHandler('market:providers', async () => {
      return marketplace.getProviders()
    })

    registerHandler('market:search', async (params) => {
      return marketplace.search(params)
    })

    registerHandler('market:browse', async (params) => {
      return marketplace.browse(params)
    })

    registerHandler('market:detail', async (slug, marketplaceId) => {
      return marketplace.getDetail(slug, marketplaceId)
    })

    registerHandler('market:install', async (params) => {
      return marketplace.install(params)
    })

    registerHandler('market:analyze', async (slug, marketplaceId) => {
      return marketplace.analyze(slug, marketplaceId)
    })

    registerHandler('market:start-analysis-session', async (slug, marketplaceId) => {
      return marketplace.startAnalysisSession(slug, marketplaceId)
    })

    registerHandler('market:cancel-analyze', async (slug, marketplaceId) => {
      marketplace.cancelAnalysis(slug, marketplaceId)
    })

    registerHandler('market:resolve-install-path', async (params) => {
      if (!deps.packageService) throw new Error('PackageService not available')
      return deps.packageService.resolveInstallPath(params)
    })

    registerHandler('market:check-updates', async () => {
      return marketplace.checkUpdates()
    })
  }

  // --- Package lifecycle handlers ---
  if (deps.packageService) {
    const pkgSvc = deps.packageService
    registerHandler('package:list', async (query) => {
      const records = await pkgSvc.list(query ?? {})
      // Map internal records → renderer DTO (omit id, contentHash)
      return records.map(({ id: _id, contentHash: _hash, ...rest }) => rest)
    })
    registerHandler('package:uninstall', async (params) => {
      return pkgSvc.uninstall({
        prefix: params.prefix,
        scope: params.scope ?? 'global',
        projectId: params.projectId,
      })
    })
    registerHandler('package:verify', async (params) => {
      return pkgSvc.verify(params.prefix, {
        scope: params.scope,
        projectId: params.projectId,
      })
    })
  }

  // --- Repo Source handlers ---
  const repoSources = deps.repoSourceRegistry
  if (repoSources) {
    registerHandler('repo-source:list', async () => repoSources.list())
    registerHandler('repo-source:create', async (input) => repoSources.create(input))
    registerHandler('repo-source:update', async (id, input) => repoSources.update(id, input))
    registerHandler('repo-source:delete', async (id) => repoSources.remove(id))
    registerHandler('repo-source:test-connection', async (id) => repoSources.testConnection(id))
    registerHandler('repo-source:sync', async (id) => repoSources.sync(id))
    registerHandler('repo-source:browse', async (id) => repoSources.browse(id))
  }

  // --- Settings handlers ---
  if (settingsService) {
    registerHandler('get-settings', () => settingsService.getSettings())
    registerHandler('update-settings', async (settings) => {
      const oldSettings = settingsService.getSettings()
      const updated = await settingsService.update(settings)
      const evoseSettingsChanged = isEvoseSettingsChanged(oldSettings, updated)

      // Detect language change → rebuild menu + update tray locale
      if (oldSettings.language !== updated.language) {
        const locale = resolveLocale(updated.language, app.getLocale())
        setupApplicationMenu(locale, { onQuit: deps.onQuit })
        deps.trayManager?.updateLocale(locale)
      }

      // Detect update settings change → reschedule periodic check timer
      if (deps.updateChecker && isUpdateSettingsChanged(oldSettings, updated)) {
        deps.updateChecker.reschedule()
      }

      bus.dispatch({ type: 'settings:updated', payload: updated })
      if (evoseSettingsChanged) {
        // Evose apps are projected as runtime skills in CapabilityCenter snapshot.
        // Invalidate caches and refresh renderer snapshot subscribers.
        bus.dispatch({ type: 'capabilities:changed', payload: {} })
      }
      return updated
    })
  }

  // --- Update checker handler ---
  // The renderer's primary update flow uses DataBus events (dispatched by
  // UpdateCheckerService.performCheck()). The IPC return value is intentionally
  // null — the renderer ignores it and relies on the `update:check-result`
  // DataBus event handled in useAppBootstrap → updateStore.onCheckResult().
  if (deps.updateChecker) {
    const updateChecker = deps.updateChecker
    registerHandler('check-for-updates', async () => {
      await updateChecker.checkNow()
      return null
    })
  }

  // --- Provider handlers ---
  if (deps.providerService) {
    const providerService = deps.providerService
    registerHandler('provider:get-status', (engineKind) => providerService.getStatus(engineKind ?? 'claude'))
    registerHandler('provider:login', (engineKind, mode, params) =>
      providerService.login(engineKind, mode, params))
    registerHandler('provider:cancel-login', async (engineKind, mode) => {
      await providerService.cancelLogin(engineKind, mode)
      return true
    })
    registerHandler('provider:logout', async (engineKind, mode) => {
      await providerService.logout(engineKind, mode)
      return true
    })
    registerHandler('provider:get-credential', (engineKind, mode) =>
      providerService.getCredential(engineKind, mode))
  }

  // --- Command handlers ---
  if (orchestrator) {
    // Lazily resolve Issue contextRefs → contextSystemPrompt for issue-originated sessions.
    // Created once per app lifecycle; null when backing services are unavailable.
    const contextRefResolver = (deps.contextRefStore && deps.issueService)
      ? new ContextRefResolver({
          contextRefStore: deps.contextRefStore,
          issueService: deps.issueService,
          artifactService: deps.artifactService ?? null,
        })
      : null

    registerHandler('command:start-session', async (input) => {
      // IPC arguments are runtime-unknown. Re-project onto the shared contract
      // so backend-only fields cannot be injected from renderer callers.
      const sessionInput = projectStartSessionInput(input)

      // Defensive projectId resolution for non-frontend callers (e.g. Telegram, Schedule).
      // Frontend already passes projectId directly — this is a fallback, not the primary path.
      if (projectService && sessionInput.projectPath && !sessionInput.projectId) {
        try {
          const project = await projectService.findByCanonicalPath(sessionInput.projectPath)
          if (project) sessionInput.projectId = project.id
        } catch (err) {
          log.warn('Failed to resolve projectId from projectPath — starting session without project context', err)
        }
      }

      // Auto-resolve contextRefs for issue-originated sessions
      if (contextRefResolver && !sessionInput.contextSystemPrompt && sessionInput.origin?.source === 'issue') {
        try {
          const resolved = await contextRefResolver.resolveForIssue(sessionInput.origin.issueId)
          if (resolved) {
            sessionInput.contextSystemPrompt = resolved
            log.info(`Resolved contextRefs for issue ${sessionInput.origin.issueId} (${resolved.length} chars)`)
          }
        } catch (err) {
          log.warn('Failed to resolve contextRefs — starting session without context', err)
        }
      }
      return orchestrator.startSession(sessionInput)
    })
    registerHandler('command:send-message', (sessionId, content) =>
      orchestrator.sendMessage(sessionId, content)
    )
    registerHandler('command:answer-question', (sessionId, requestId, answer) => {
      const registry = orchestrator.getPendingQuestionRegistry()
      if (!registry) return false
      return registry.resolve(requestId, answer)
    })
    registerHandler('command:stop-session', (sessionId) => orchestrator.stopSession(sessionId))
    registerHandler('command:resume-session', (sessionId, content) =>
      orchestrator.resumeSession(sessionId, content ?? '')
    )
    registerHandler('command:list-managed-sessions', () => orchestrator.listSessions())
    registerHandler('command:get-managed-session', (sessionId) =>
      orchestrator.getSession(sessionId)
    )
    registerHandler('command:get-session-messages', async (sessionId) => {
      const full = await orchestrator.getFullSession(sessionId)
      return full?.messages ?? []
    })
    registerHandler('command:delete-session', (sessionId) =>
      orchestrator.deleteSession(sessionId)
    )
  }

  // --- Webhook handlers ---
  if (deps.webhookService) {
    registerHandler('webhook:test', (endpoint) => deps.webhookService!.testEndpoint(endpoint))
  }

  // --- Messaging handlers (unified multi-platform IM API) ---
  if (deps.imBridgeManager) {
    const im = deps.imBridgeManager
    registerHandler('messaging:get-all-statuses', () => im.getAllStatuses())
    registerHandler('messaging:start', async (connectionId) => {
      return im.startConnection(connectionId)
    })
    registerHandler('messaging:stop', async (connectionId) => {
      return im.stopConnection(connectionId)
    })
    registerHandler('messaging:test', async (connectionId) => {
      try {
        return await im.testConnection(connectionId)
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    })
  }

  // --- WeChat QR code login (platform-specific) ---
  if (deps.weixinBotManager) {
    const wxm = deps.weixinBotManager
    registerHandler('messaging:weixin-start-qr-login', async (connectionId) => {
      try {
        await wxm.startQRLogin(connectionId)
        return { success: true }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    })
    registerHandler('messaging:weixin-cancel-qr-login', (connectionId) => {
      wxm.cancelQRLogin(connectionId)
    })
  }

  // ── Evose ──────────────────────────────────────────────────────────────────

  registerHandler('evose:fetch-apps', async (apiKey, baseUrl, workspaceIds) => {
    // Stateless validation call — fetchEvoseApps does not mutate service state.
    // EvoseApiError is serialized by the outer try/catch and delivered to
    // the renderer as a rejected Promise with the human-readable error.message.
    //
    // getProxyFetch() is called at request time so proxy changes take effect
    // immediately — same lazy-getter pattern as WebhookService.
    const proxyFetch = deps.getProxyFetch?.() ?? globalThis.fetch
    return fetchEvoseApps({ apiKey, baseUrl, workspaceIds, fetch: proxyFetch })
  })

  // --- App lifecycle ---
  registerHandler('app:relaunch', () => {
    app.relaunch()
    app.quit()
  })

  // --- Clipboard ---
  registerHandler('clipboard:write-text', (text) => {
    clipboard.writeText(text)
  })

  // ── Project Management ────────────────────────────────────────────

  registerHandler('create-project', async (input) => {
    if (!projectService) throw new Error('Not ready')
    const stored = await projectService.createManualProject(input)
    await syncRuntimeProjectsFromStore()
    return toProject(stored)
  })

  registerHandler('create-new-project', async (input) => {
    if (!projectService) throw new Error('Not ready')
    const stored = await projectService.createNewProject(input)
    await syncRuntimeProjectsFromStore()
    return toProject(stored)
  })

  registerHandler('list-all-projects', async () => {
    if (!projectService) throw new Error('Not ready')
    const state = bus.getState()
    const projectMap = new Map(state.projects.map((p) => [p.id, p]))
    const stored = await projectService.listAll()
    return stored.map((p) => toProject(p, projectMap.get(p.id)))
  })

  registerHandler('update-project', async (id, patch) => {
    if (!projectService) throw new Error('Not ready')
    const stored = await projectService.update(id, patch)
    if (!stored) return null
    await syncRuntimeProjectsFromStore()
    const state = bus.getState()
    const runtime = state.projects.find((p) => p.id === id)
    return toProject(stored, runtime)
  })

  registerHandler('rename-project', async (input) => {
    if (!projectService) throw new Error('Not ready')

    // Execute rename (disk + projects table)
    const { project: stored, previousPath } = await projectService.renameProject(input)

    // Propagate path change to dependent subsystems
    if (stored.canonicalPath !== previousPath) {
      const pathChange = {
        projectId: input.id,
        oldPath: previousPath,
        newPath: stored.canonicalPath,
      }

      // Migrate capability distribution target_path records
      if (deps.capabilityCenter) {
        await deps.capabilityCenter.onProjectPathChanged(pathChange).catch((err) => {
          log.error('Failed to migrate capability paths after rename', err)
        })
      }

      // Migrate managed session project_path records
      if (deps.orchestrator) {
        await deps.orchestrator.getStore().migrateProjectPath({
          projectId: input.id,
          newPath: stored.canonicalPath,
        }).catch((err) => {
          log.error('Failed to migrate managed session paths after rename', err)
        })
      }

      // Broadcast path change event for renderer and other runtime listeners
      bus.dispatch({
        type: 'project:path-changed',
        payload: pathChange,
      })
    }

    await syncRuntimeProjectsFromStore()
    const runtime = bus.getState().projects.find((p) => p.id === input.id)
    return toProject(stored, runtime)
  })

  registerHandler('delete-project', async (id) => {
    if (!projectService) throw new Error('Not ready')
    const deleted = await projectService.delete(id)
    await syncRuntimeProjectsFromStore()
    return deleted
  })

  // ── Directory / File Picker ─────────────────────────────────────

  registerHandler('select-directory', async () => {
    const { dialog } = await import('electron')
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select Project Directory'
    })
    if (canceled || filePaths.length === 0) return null
    return filePaths[0]
  })

  registerHandler('capability:import:pick-files', async () => {
    const { dialog } = await import('electron')
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile', 'openDirectory', 'multiSelections'],
      filters: [
        { name: 'Capability Files', extensions: ['md', 'json'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      title: 'Select capability files to import',
    })
    if (canceled || filePaths.length === 0) return null
    return filePaths
  })

  // ── Artifacts ──────────────────────────────────────────────────────

  if (deps.artifactService) {
    const artifactSvc = deps.artifactService
    registerHandler('list-artifacts', (filter) => artifactSvc.list(filter))
    registerHandler('get-artifact-content', (id) => artifactSvc.getContent(id))
    registerHandler('update-artifact-meta', (id, patch) => artifactSvc.updateMeta(id, patch))
    registerHandler('list-starred-artifacts', (projectId) => artifactSvc.listStarred(projectId))
    registerHandler('star-session-artifact', (input) =>
      artifactSvc.persistAndStar({
        extracted: {
          kind: input.kind,
          title: input.title,
          mimeType: input.mimeType,
          filePath: input.filePath,
          fileExtension: input.fileExtension,
          content: input.content,
          contentHash: input.contentHash,
          lastModifiedAt: Date.now(),
          stats: input.stats,
        },
        sessionId: input.sessionId,
        issueId: input.issueId,
        projectId: input.projectId,
        starred: input.starred,
      }),
    )
    registerHandler('star-project-file', (input) => artifactSvc.starProjectFile(input))
  }

  // ── Session Notes ──────────────────────────────────────────────────

  if (deps.noteStore) {
    const noteStore = deps.noteStore
    registerHandler('list-session-notes', (issueId) => noteStore.listByIssue(issueId))
    registerHandler('count-session-notes-by-issue', () => noteStore.countByIssue())
    registerHandler('create-session-note', (input) => noteStore.create(input))
    registerHandler('update-session-note', (id, content) => noteStore.update(id, content))
    registerHandler('delete-session-note', (id) => noteStore.delete(id))
  }

  // ── Logging (renderer → main file transport) ──────────────────────

  registerHandler('log:write', (entry) => {
    writeLogEntry({
      ...entry,
      scope: `renderer:${entry.scope}`,
    })
  })

  // ── Browser ────────────────────────────────────────────────────────

  // browser:show — new semantics: no longer opens a standalone window; instead broadcasts
  // a browser:open-overlay event via DataBus, letting the renderer's useDataBus trigger
  // openBrowserOverlay(). Source type is mapped from BrowserShowContext (implicit combo)
  // to BrowserSource (explicit discriminated union).
  registerHandler('browser:show', (context) => {
    const linkedSessionId = context?.linkedSessionId ?? null
    const sourceIssueId   = context?.sourceIssueId   ?? null

    let source: import('@shared/types').BrowserSource

    if (linkedSessionId && sourceIssueId) {
      source = { type: 'issue-session', issueId: sourceIssueId, sessionId: linkedSessionId }
    } else if (linkedSessionId) {
      source = { type: 'chat-session', sessionId: linkedSessionId }
    } else if (sourceIssueId) {
      source = { type: 'issue-standalone', issueId: sourceIssueId }
    } else {
      source = { type: 'standalone' }
    }

    const options: import('@shared/types').BrowserOpenOptions = {}
    if (context?.initialUrl) options.initialUrl = context.initialUrl
    if (context?.profileId) options.profileId = context.profileId

    // Broadcast to renderer — useDataBus handles browser:open-overlay -> openBrowserOverlay()
    bus.dispatch({
      type: 'browser:open-overlay',
      payload: { source, options: Object.keys(options).length > 0 ? options : undefined },
    })
  })

  // browser:hide — notify renderer to close the overlay
  registerHandler('browser:hide', () => {
    bus.dispatch({ type: 'browser:close-overlay', payload: {} })
  })

  if (deps.browserService) {
    const browserSvc = deps.browserService

    registerHandler('browser:create-profile', async (input) => {
      const profile = await browserSvc.createProfile(input)
      return profile
    })

    registerHandler('browser:list-profiles', () => browserSvc.listProfiles())

    registerHandler('browser:delete-profile', (profileId) => browserSvc.deleteProfile(profileId))

    registerHandler('browser:open-view', async (profileId) => {
      const { BrowserWindow: BW } = await import('electron')
      const win = BW.getAllWindows().find((w) => !w.isDestroyed())
      if (!win) throw new Error('No main window available for browser view attachment')
      return browserSvc.openView(profileId, win)
    })

    registerHandler('browser:close-view', (viewId) => browserSvc.closeView(viewId))

    registerHandler('browser:sync-bounds', (params) => {
      browserSvc.syncBounds(params.viewId, params.bounds)
    })

    registerHandler('browser:execute', (command) => browserSvc.executeCommand(command))

    registerHandler('browser:get-page-info', (viewId) => browserSvc.getPageInfo(viewId))

    registerHandler('browser:get-active-view', () => {
      const result = browserSvc.getActiveView()
      log.debug(`browser:get-active-view → ${result ? JSON.stringify(result) : 'null'}`)
      return result
    })

    registerHandler('browser:get-session-view', (sessionId) => {
      const result = browserSvc.getSessionViewInfo(sessionId)
      log.debug(`browser:get-session-view(${sessionId}) → ${result ? JSON.stringify(result) : 'null'}`)
      return result
    })

    registerHandler('browser:get-issue-view', (issueId) => {
      const result = browserSvc.getIssueViewInfo(issueId)
      log.debug(`browser:get-issue-view(${issueId}) → ${result ? JSON.stringify(result) : 'null'}`)
      return result
    })

    registerHandler('browser:get-focused-context', () => {
      const result = browserSvc.getFocusedContext()
      log.debug(`browser:get-focused-context → ${result ? JSON.stringify(result) : 'null'}`)
      return result
    })

    // ── Browser Overlay lifecycle (new IPC channels) ────────────────

    registerHandler('browser:ensure-source-view', async (params) => {
      const { source } = params

      // Get the main window for attaching WebContentsView
      const { BrowserWindow: BW } = await import('electron')
      const mainWindow = BW.getAllWindows().find(w => !w.isDestroyed())
      if (!mainWindow) throw new Error('No main window available')

      const getWindow = async () => mainWindow

      switch (source.type) {
        case 'issue-session':
        case 'chat-session': {
          browserSvc.setFocusedSession(source.sessionId)
          const viewId = await browserSvc.getOrCreateSessionView(source.sessionId, getWindow)
          // Ensure the view is attached (idempotent — addChildView on an
          // already-attached view just adjusts z-order). This handles the
          // reopen-from-PiP case where the view was previously detached.
          browserSvc.reattachView(viewId, mainWindow)
          browserSvc.displaySessionView(source.sessionId)
          return viewId
        }
        case 'issue-standalone': {
          browserSvc.setFocusedIssue(source.issueId)
          const viewId = await browserSvc.getOrCreateIssueView(source.issueId, getWindow)
          browserSvc.reattachView(viewId, mainWindow)
          browserSvc.displayIssueView(source.issueId)
          return viewId
        }
        case 'standalone': {
          browserSvc.setFocusedSession(null)
          return browserSvc.ensureActiveView(getWindow)
        }
      }
    })

    registerHandler('browser:display-source', (params) => {
      const { source } = params
      switch (source.type) {
        case 'issue-session':
        case 'chat-session':
          browserSvc.setFocusedSession(source.sessionId)
          browserSvc.displaySessionView(source.sessionId)
          break
        case 'issue-standalone':
          browserSvc.setFocusedIssue(source.issueId)
          browserSvc.displayIssueView(source.issueId)
          break
        case 'standalone':
          browserSvc.setFocusedSession(null)
          break
      }
    })

    registerHandler('browser:detach-view', (viewId) => {
      browserSvc.detachView(viewId)
    })

    registerHandler('browser:reattach-view', async (viewId) => {
      const { BrowserWindow: BW } = await import('electron')
      const mainWindow = BW.getAllWindows().find(w => !w.isDestroyed())
      if (!mainWindow) throw new Error('No main window available')
      browserSvc.reattachView(viewId, mainWindow)
    })

    registerHandler('browser:set-view-visible', (params) => {
      browserSvc.setViewVisible(params.viewId, params.visible)
    })
  }

  // ── Terminal ──────────────────────────────────────────────────────────
  const termSvc = deps.terminalService
  if (termSvc) {
    registerHandler('terminal:ensure', (params) => termSvc.ensure(params))
    registerHandler('terminal:spawn', (params) => termSvc.spawn(params))
    registerHandler('terminal:write', (id, data) => termSvc.write(id, data))
    registerHandler('terminal:resize', (id, cols, rows) => termSvc.resize(id, cols, rows))
    registerHandler('terminal:kill', (id) => termSvc.kill(id))
    registerHandler('terminal:kill-all', () => termSvc.killAll())
    registerHandler('terminal:get-info', (scope) => termSvc.getInfo(scope))
    registerHandler('terminal:list', () => termSvc.list())
    registerHandler('terminal:replay', (id) => termSvc.replay(id))
  }

  // ── Tray Popover ────────────────────────────────────────────────────
  // Channels used exclusively by the tray popover renderer.
  const tray = deps.trayManager
  if (tray) {
    registerHandler('tray-popover:open-main', () => {
      tray.focusMainWindow()
    })
    registerHandler('tray-popover:navigate-issue', (issueId, projectId) => {
      tray.navigateToIssue(issueId, projectId)
    })
    registerHandler('tray-popover:get-issues', () => {
      return tray.getTrayItems()
    })
    registerHandler('tray-popover:quit', () => {
      if (deps.onQuit) {
        deps.onQuit()
      } else {
        app.quit()
      }
    })
    registerHandler('tray-popover:resize', (height) => {
      tray.popoverWindow?.resize(height)
    })
  }
}

export function connectBusToIPC(bus: DataBus): () => void {
  return bus.onBroadcast((event) => {
    // Log browser-related events for debugging view lifecycle
    if (event.type.startsWith('browser:')) {
      const windowCount = BrowserWindow.getAllWindows().filter(w => !w.isDestroyed()).length
      log.debug(`DataBus→IPC: broadcasting "${event.type}" to ${windowCount} window(s)`)
    }
    broadcast(IPC_EVENT_CHANNEL, serializeEvent(event))
  })
}
