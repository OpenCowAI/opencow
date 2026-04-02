// SPDX-License-Identifier: Apache-2.0

import { basename, dirname, join } from 'path'
import type { Stats } from 'fs'
import { mkdir, rename, stat } from 'fs/promises'
import { ProjectStore, type StoredProject } from './projectStore'
import type { IssueStore } from './issueStore'
import type { ArtifactStore } from './artifactStore'
import type { ScheduleStore } from './scheduleStore'
import type { PipelineStore } from './pipelineStore'
import type { InboxStore } from './inboxStore'
import type { PackageService } from './capabilityCenter/packageService'
import {
  discoverProjects,
  parseSessionMetadata,
} from '../parsers/sessionParser'
import type { DiscoveredProjectCandidate, ProjectPreferencesPatch } from '@shared/types'

export interface DiscoveredProject {
  folderName: string
  resolvedPath: string
  name: string
}

interface CreateManualInput {
  path: string
  name?: string
}

interface CreateNewProjectInput {
  parentPath: string
  name: string
}

export interface RenameProjectInput {
  id: string
  newName: string
}

export interface RenameProjectResult {
  /** The updated project record. */
  project: StoredProject
  /**
   * The canonical path before rename.
   * When `previousPath !== project.canonicalPath`, the directory was actually moved on disk
   * and dependent subsystems should migrate their path references.
   */
  previousPath: string
}

export interface ProjectServiceDeps {
  store: ProjectStore
  issueStore: IssueStore
  artifactStore: ArtifactStore
  scheduleStore: ScheduleStore
  pipelineStore: PipelineStore
  inboxStore: InboxStore
  packageService?: PackageService
}

export class ProjectService {
  private readonly store: ProjectStore
  private readonly issueStore: IssueStore
  private readonly artifactStore: ArtifactStore
  private readonly scheduleStore: ScheduleStore
  private readonly pipelineStore: PipelineStore
  private readonly inboxStore: InboxStore
  private readonly packageService?: PackageService

  constructor(deps: ProjectServiceDeps) {
    this.store = deps.store
    this.issueStore = deps.issueStore
    this.artifactStore = deps.artifactStore
    this.scheduleStore = deps.scheduleStore
    this.pipelineStore = deps.pipelineStore
    this.inboxStore = deps.inboxStore
    this.packageService = deps.packageService
  }

  // ── Discovery & Sync ──

  /**
   * Try to match a discovered folder to an existing project.
   * Returns the StoredProject if matched (auto-adds folder mapping), or null.
   */
  private async resolveProject(disc: DiscoveredProject): Promise<StoredProject | null> {
    // 1. Known claude folder → reuse directly
    const byFolder = await this.store.findByClaudeFolderId(disc.folderName)
    if (byFolder) return byFolder

    // 2. Unknown folder but matching canonical path → add mapping
    const byPath = await this.store.findByCanonicalPath(disc.resolvedPath)
    if (byPath) {
      await this.store.addClaudeMapping(disc.folderName, byPath.id)
      return byPath
    }

    return null
  }

  /**
   * Sync discovered folders with DB — only matches known projects.
   * Returns Map<folderName, StoredProject> containing only successfully matched entries.
   * Unknown projects are silently skipped (no auto-creation).
   */
  async syncDiscovered(discovered: DiscoveredProject[]): Promise<Map<string, StoredProject>> {
    const result = new Map<string, StoredProject>()
    for (const disc of discovered) {
      const project = await this.resolveProject(disc)
      if (project) {
        result.set(disc.folderName, project)
      }
    }
    return result
  }

  /**
   * Batch-import user-selected discovered projects.
   * Reuses existing projects via resolveProject(); creates new ones only for truly unknown folders.
   */
  async importProjects(projects: DiscoveredProject[]): Promise<StoredProject[]> {
    const results: StoredProject[] = []
    for (const disc of projects) {
      const existing = await this.resolveProject(disc)
      if (existing) { results.push(existing); continue }

      // Create new project + folder mapping
      const created = await this.store.create({
        name: disc.name,
        canonicalPath: disc.resolvedPath,
      })
      await this.store.addClaudeMapping(disc.folderName, created.id)
      results.push(created)
    }
    return results
  }

  /**
   * Discover projects under ~/.claude/projects/ that are not yet imported.
   * Encapsulates: discovery → metadata resolution → batch dedup filtering.
   * Used by the onboarding import step.
   */
  async discoverImportable(): Promise<DiscoveredProjectCandidate[]> {
    const discovered = await discoverProjects()

    // Batch-load known identifiers to avoid N+1 queries
    const knownFolders = await this.store.listAllClaudeFolderIds()
    const knownPaths = await this.store.listAllCanonicalPaths()

    const candidates: DiscoveredProjectCandidate[] = []

    for (const disc of discovered) {
      // Fast skip: folder already mapped to a project
      if (knownFolders.has(disc.folderName)) continue

      // Resolve path from session metadata (parse only until we get cwd)
      for (const sf of disc.sessionFiles) {
        if (disc.resolvedPath) break
        const metadata = await parseSessionMetadata(sf.jsonlPath)
        if (metadata.cwd) {
          disc.resolvedPath = metadata.cwd
          disc.name = basename(metadata.cwd) || disc.folderName
        }
      }
      if (!disc.resolvedPath) disc.resolvedPath = disc.folderName

      // Fast skip: path already belongs to an existing project
      if (knownPaths.has(disc.resolvedPath)) continue

      candidates.push({
        folderName: disc.folderName,
        resolvedPath: disc.resolvedPath,
        name: disc.name,
        sessionCount: disc.sessionFiles.length,
      })
    }

    return candidates
  }

  // ── Manual Project ──

  async createManualProject(input: CreateManualInput): Promise<StoredProject> {
    const existing = await this.store.findByCanonicalPath(input.path)
    if (existing) return existing
    return this.store.create({
      name: input.name || basename(input.path),
      canonicalPath: input.path,
    })
  }

  /**
   * Create a new project by creating a fresh directory on disk.
   *
   * Validates the project name, ensures the parent directory exists and
   * the target path is available, then atomically creates the directory
   * and project record.  If the DB insert fails, the created directory
   * is left on disk (harmless empty folder) rather than risking data loss
   * by attempting a rollback delete.
   */
  async createNewProject(input: CreateNewProjectInput): Promise<StoredProject> {
    const name = input.name.trim()
    if (!name) throw new Error('Project name cannot be empty')
    if (/[/\\]/.test(name)) throw new Error('Project name cannot contain path separators')
    if (name.length > 255) throw new Error('Project name is too long (max 255 characters)')

    const projectPath = join(input.parentPath, name)

    // Verify parent directory exists
    const parentStat = await statOrNull(input.parentPath)
    if (!parentStat) throw new Error('Parent directory does not exist')
    if (!parentStat.isDirectory()) throw new Error('Parent path is not a directory')

    // Ensure target path doesn't already exist on disk
    const targetStat = await statOrNull(projectPath)
    if (targetStat) throw new Error('A file or directory already exists at the target path')

    // Ensure target path is not already registered as a project
    const existing = await this.store.findByCanonicalPath(projectPath)
    if (existing) throw new Error('A project with this path already exists')

    // Create directory then project record
    await mkdir(projectPath, { recursive: true })
    return this.store.create({ name, canonicalPath: projectPath })
  }

  async resolveProjectId(claudeFolderId: string): Promise<string | null> {
    const project = await this.store.findByClaudeFolderId(claudeFolderId)
    return project?.id ?? null
  }

  // ── Pin / Archive ──

  async pinProject(id: string): Promise<StoredProject | null> {
    const project = await this.store.getById(id)
    if (!project) return null
    const order = await this.store.nextPinOrder()
    return this.store.update(id, { pinOrder: order, archivedAt: null })
  }

  async pinProjectAtOrder(id: string, order: number): Promise<StoredProject | null> {
    return this.store.update(id, { pinOrder: order, archivedAt: null })
  }

  async unpinProject(id: string): Promise<StoredProject | null> {
    const order = await this.store.nextDisplayOrder()
    return this.store.update(id, { pinOrder: null, displayOrder: order })
  }

  async archiveProject(id: string): Promise<StoredProject | null> {
    return this.store.update(id, { archivedAt: Date.now(), pinOrder: null })
  }

  async unarchiveProject(id: string): Promise<StoredProject | null> {
    const order = await this.store.nextDisplayOrder()
    return this.store.update(id, { archivedAt: null, displayOrder: order })
  }

  // ── Reorder ──

  /** Reorder projects within the "projects" (non-pinned, non-archived) group. */
  async reorderProjects(orderedIds: string[]): Promise<void> {
    await this.store.reorderProjects(orderedIds)
  }

  /** Reorder projects within the "pinned" group. */
  async reorderPinnedProjects(orderedIds: string[]): Promise<void> {
    await this.store.reorderPinnedProjects(orderedIds)
  }

  // ── Rename ──

  /**
   * Rename a project: updates the display name and renames the physical
   * directory on disk.
   *
   * Execution order:
   * 1. Validate new name (same rules as createNewProject)
   * 2. Verify current directory exists on disk
   * 3. Ensure target path is available (no conflict on disk or in DB)
   * 4. Rename directory on disk
   * 5. Update DB record (name + canonicalPath)
   * 6. If DB update fails, attempt to roll back the disk rename
   *
   * @throws Error if validation fails, directory doesn't exist, target
   *   path conflicts, or the rename operation fails.
   */
  async renameProject(input: RenameProjectInput): Promise<RenameProjectResult> {
    const { id, newName } = input
    const name = newName.trim()

    // ── Validate name ──
    if (!name) throw new Error('Project name cannot be empty')
    if (/[/\\]/.test(name)) throw new Error('Project name cannot contain path separators')
    if (name.length > 255) throw new Error('Project name is too long (max 255 characters)')

    // ── Load current project ──
    const project = await this.store.getById(id)
    if (!project) throw new Error(`Project not found: ${id}`)

    const previousPath = project.canonicalPath

    // No-op if name hasn't changed
    if (project.name === name) return { project, previousPath }

    const parentDir = dirname(previousPath)
    const newPath = join(parentDir, name)

    // ── Verify current directory exists ──
    const oldStat = await statOrNull(previousPath)
    if (!oldStat || !oldStat.isDirectory()) {
      // Directory doesn't exist — update name only (soft rename)
      const updated = await this.store.update(id, { name }) as StoredProject
      return { project: updated, previousPath }
    }

    // ── Ensure target path is available ──
    if (previousPath !== newPath) {
      const targetStat = await statOrNull(newPath)
      if (targetStat) throw new Error('A file or directory already exists at the target path')

      const existingProject = await this.store.findByCanonicalPath(newPath)
      if (existingProject) throw new Error('A project with this path already exists')
    }

    // ── Rename on disk ──
    if (previousPath !== newPath) {
      await rename(previousPath, newPath)
    }

    // ── Update DB ──
    try {
      const updated = await this.store.update(id, { name, canonicalPath: newPath })
      if (!updated) {
        // Rollback disk rename on DB failure
        if (previousPath !== newPath) await rename(newPath, previousPath).catch(() => {})
        throw new Error('Failed to update project record')
      }
      return { project: updated, previousPath }
    } catch (err) {
      // Rollback disk rename on any DB error
      if (previousPath !== newPath) await rename(newPath, previousPath).catch(() => {})
      throw err
    }
  }

  // ── CRUD delegations ──

  async getById(id: string): Promise<StoredProject | null> { return this.store.getById(id) }
  /**
   * Canonical project listing order shared by all consumers:
   * 1) pinned (pinOrder asc)
   * 2) active non-pinned (displayOrder asc)
   * 3) archived (name asc)
   */
  async listAll(): Promise<StoredProject[]> {
    const projects = await this.store.listAll()
    return sortProjectsForPresentation(projects)
  }
  async findByCanonicalPath(path: string): Promise<StoredProject | null> { return this.store.findByCanonicalPath(path) }
  async update(
    id: string,
    input: { name?: string; preferences?: ProjectPreferencesPatch },
  ): Promise<StoredProject | null> {
    return this.store.update(id, input)
  }

  /**
   * Delete a project and all its associated data.
   *
   * Cascade order (explicit service-layer cleanup since DB uses soft-reference pattern):
   * 1. Issues — deleted (cascades session_notes + issue_context_refs via DB FK CASCADE)
   * 2. Project-file artifacts — deleted
   * 3. Schedules and pipelines — deleted
   * 4. Inbox messages — project_id set to null (messages preserved, value is independent)
   * 5. Installed packages — DB records + filesystem cleanup
   * 6. Project itself — deleted (cascades project_claude_mappings via DB FK CASCADE)
   */
  async delete(id: string): Promise<boolean> {
    // Resolve project path BEFORE deletion (needed for package filesystem cleanup)
    const project = await this.store.getById(id)
    const projectPath = project?.canonicalPath

    await this.issueStore.deleteByProjectId(id)
    await this.artifactStore.deleteByProjectId(id)
    await this.scheduleStore.deleteByProjectId(id)
    await this.pipelineStore.deleteByProjectId(id)
    await this.inboxStore.detachFromProject(id)
    // Package cascade: removes DB records + project packages directory
    if (this.packageService) {
      await this.packageService.onProjectDeleted(id, projectPath)
    }
    return this.store.delete(id)
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function sortProjectsForPresentation(projects: StoredProject[]): StoredProject[] {
  const rank = (p: StoredProject): 0 | 1 | 2 => {
    if (p.pinOrder !== null) return 0
    if (p.archivedAt === null) return 1
    return 2
  }

  return [...projects].sort((a, b) => {
    const aRank = rank(a)
    const bRank = rank(b)
    if (aRank !== bRank) return aRank - bRank

    if (aRank === 0) {
      return (a.pinOrder ?? Number.MAX_SAFE_INTEGER) - (b.pinOrder ?? Number.MAX_SAFE_INTEGER)
    }
    if (aRank === 1) {
      return a.displayOrder - b.displayOrder
    }

    const byName = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    if (byName !== 0) return byName
    return a.id.localeCompare(b.id)
  })
}

/** Return fs.Stats if the path exists, or `null` for ENOENT. Rethrows other errors. */
async function statOrNull(path: string): Promise<Stats | null> {
  try {
    return await stat(path)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}
