// SPDX-License-Identifier: Apache-2.0

/**
 * Discovery Engine — builds enriched CapabilitySnapshot from CapabilityStore + StateRepository.
 *
 * v3.1 fixes:
 *   #4  — dual scope (global + project) discovery
 *   #5  — parallel discovery across 6 categories
 *   #16 — discriminated union types (kind: 'document' | 'config')
 *   #17 — concurrency-limited file I/O in CapabilityStore.list()
 *
 * Refactoring (quality review):
 *   - Merged discoverDocumentCategory/discoverConfigCategory → generic discoverCategory()
 *   - Uses batchGetImports() — eliminates N+1 import lookups
 *   - Both document and config entries now wrapped in try-catch (was asymmetric)
 */

import type {
  ManagedCapabilityCategory,
  DocumentCapabilityEntry,
  ConfigCapabilityEntry,
  CapabilitySnapshot,
  CapabilityDiagnostic,
  CapabilityEligibility,
  CapabilityMountInfo,
} from '@shared/types'
import type { CapabilityStore, StoreEntry, DocumentStoreEntry, ConfigStoreEntry } from './capabilityStore'
import type { StateRepository, CapabilityToggle, ImportRecord, DistributionRecord } from './stateRepository'
import type { EligibilityEngine } from './eligibilityEngine'

// ─── Constants ──────────────────────────────────────────────────────────

const MAX_CAPABILITY_FILE_BYTES = 512 * 1024

// ─── Internal Types ─────────────────────────────────────────────────────

interface ScopeSpec {
  scope: 'global' | 'project'
  projectPath?: string
  projectId?: string
}

/** Shared context passed to entry mappers. */
interface EntryContext {
  category: ManagedCapabilityCategory
  scope: 'global' | 'project'
  projectPath?: string
  projectId?: string
  toggle: CapabilityToggle | null
  importInfo: ImportRecord | null
  distributionInfo: DistributionRecord | null
  distributionTargets: string[]
  eligibility: CapabilityEligibility
  diagnostics: CapabilityDiagnostic[]
}

// ─── DiscoveryEngine ────────────────────────────────────────────────────

export class DiscoveryEngine {
  constructor(
    private readonly store: CapabilityStore,
    private readonly stateRepo: StateRepository,
    private readonly eligibility: EligibilityEngine,
  ) {}

  /**
   * Build a full snapshot of all managed capabilities.
   * Merges global + project scopes when `projectPath` is provided.
   */
  async buildSnapshot(params?: { projectPath?: string; projectId?: string }): Promise<CapabilitySnapshot> {
    const diagnostics: CapabilityDiagnostic[] = []
    const scopes: ScopeSpec[] = [{ scope: 'global' }]
    if (params?.projectPath) {
      scopes.push({ scope: 'project', projectPath: params.projectPath, projectId: params.projectId })
    }

    const [skills, agents, commands, rules, hooks, mcpServers] = await Promise.all([
      this.discoverCategory<DocumentCapabilityEntry>('skill', scopes, diagnostics, this.mapDocument),
      this.discoverCategory<DocumentCapabilityEntry>('agent', scopes, diagnostics, this.mapDocument),
      this.discoverCategory<DocumentCapabilityEntry>('command', scopes, diagnostics, this.mapDocument),
      this.discoverCategory<DocumentCapabilityEntry>('rule', scopes, diagnostics, this.mapDocument),
      this.discoverCategory<ConfigCapabilityEntry>('hook', scopes, diagnostics, this.mapConfig),
      this.discoverCategory<ConfigCapabilityEntry>('mcp-server', scopes, diagnostics, this.mapConfig),
    ])

    return {
      skills, agents, commands, rules, hooks, mcpServers,
      diagnostics,
      version: Date.now(),
      timestamp: Date.now(),
    }
  }

  // ── Generic category discovery ────────────────────────────────────

  private async discoverCategory<T extends DocumentCapabilityEntry | ConfigCapabilityEntry>(
    category: ManagedCapabilityCategory,
    scopes: ScopeSpec[],
    diagnostics: CapabilityDiagnostic[],
    mapper: (raw: StoreEntry, ctx: EntryContext) => T | null,
  ): Promise<T[]> {
    const results: T[] = []

    for (const { scope, projectPath, projectId } of scopes) {
      // Parallel fetch: toggles + file entries
      const [toggles, entries] = await Promise.all([
        this.stateRepo.batchGetToggles(scope, projectId, category),
        this.store.list(scope, category, projectPath),
      ])

      // Batch-fetch import + distribution records (eliminates N+1)
      const names = entries.map((e) => e.name)
      const [imports, distributions, distributionTargetsByName] = await Promise.all([
        this.stateRepo.batchGetImports(category, names),
        this.stateRepo.batchGetDistributions(category, names),
        this.stateRepo.batchGetDistributionTargetTypes(category, names),
      ])

      for (const raw of entries) {
        try {
          const toggle = toggles.get(raw.name) ?? null
          const isExternalMount = !!raw.mountInfo

          // External mount entries: synthetic import info (no DB record), never distributed
          // sourceOrigin flows from CapabilityMount → CapabilityMountInfo → here
          const importInfo: ImportRecord | null = isExternalMount
            ? { category, name: raw.name, sourcePath: raw.filePath, sourceOrigin: raw.mountInfo!.sourceOrigin, sourceHash: null, importedAt: 0 }
            : imports.get(raw.name) ?? null
          const distributionInfo = isExternalMount
            ? null
            : distributions.get(raw.name) ?? null
          const distributionTargets = isExternalMount
            ? []
            : distributionTargetsByName.get(raw.name) ?? []

          const eligibility = await this.eligibility.evaluate(
            raw.kind === 'document' ? raw.attributes : extractConfigMetadata(raw),
          )

          const mapped = mapper.call(this, raw, {
            category,
            scope,
            projectPath,
            projectId,
            toggle,
            importInfo,
            distributionInfo,
            distributionTargets,
            eligibility,
            diagnostics,
          })
          if (mapped) results.push(mapped)
        } catch (err) {
          diagnostics.push({
            level: 'error',
            category,
            name: raw.name,
            message: err instanceof Error ? err.message : String(err),
          })
        }
      }
    }

    return results
  }

  // ── Entry mappers ─────────────────────────────────────────────────

  private mapDocument(raw: StoreEntry, ctx: EntryContext): DocumentCapabilityEntry | null {
    if (raw.kind !== 'document') return null
    const doc = raw as DocumentStoreEntry

    if (Buffer.byteLength(doc.body) > MAX_CAPABILITY_FILE_BYTES) {
      ctx.diagnostics.push({
        level: 'warn',
        category: ctx.category,
        name: doc.name,
        message: `File too large (${Buffer.byteLength(doc.body)} bytes), skipped`,
      })
      return null
    }

    const metadata = (doc.attributes['metadata'] ?? {}) as Record<string, unknown>

    return {
      kind: 'document',
      name: doc.name,
      description: doc.description,
      body: doc.body,
      attributes: doc.attributes,
      filePath: doc.filePath,
      category: ctx.category,
      scope: ctx.scope,
      projectId: ctx.projectId,
      enabled: ctx.toggle?.enabled ?? true,
      tags: ctx.toggle?.tags ?? [],
      eligibility: ctx.eligibility,
      metadata,
      importInfo: ctx.importInfo,
      distributionInfo: mapDistribution(ctx.distributionInfo),
      distributionTargets: ctx.distributionTargets.length > 0 ? ctx.distributionTargets : undefined,
      mountInfo: doc.mountInfo ?? null,
    }
  }

  private mapConfig(raw: StoreEntry, ctx: EntryContext): ConfigCapabilityEntry | null {
    if (raw.kind !== 'config') return null
    const cfg = raw as ConfigStoreEntry
    const metadata = (cfg.config['metadata'] ?? {}) as Record<string, unknown>

    return {
      kind: 'config',
      name: cfg.name,
      description: cfg.description,
      config: cfg.config,
      filePath: cfg.filePath,
      category: ctx.category,
      scope: ctx.scope,
      projectId: ctx.projectId,
      enabled: ctx.toggle?.enabled ?? true,
      tags: ctx.toggle?.tags ?? [],
      eligibility: ctx.eligibility,
      metadata,
      importInfo: ctx.importInfo,
      distributionInfo: mapDistribution(ctx.distributionInfo),
      distributionTargets: ctx.distributionTargets.length > 0 ? ctx.distributionTargets : undefined,
      mountInfo: cfg.mountInfo ?? null,
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────

/** Map a DistributionRecord to the public CapabilityDistributionInfo shape. */
function mapDistribution(dist: DistributionRecord | null): import('@shared/types').CapabilityDistributionInfo | null {
  if (!dist) return null
  return {
    targetType: dist.targetType,
    targetPath: dist.targetPath,
    strategy: dist.strategy,
    contentHash: dist.contentHash,
    distributedAt: dist.distributedAt,
  }
}

/** Extract metadata from a config entry for eligibility evaluation. */
function extractConfigMetadata(raw: StoreEntry): Record<string, unknown> {
  if (raw.kind !== 'config') return {}
  const metadata = (raw.config['metadata'] ?? {}) as Record<string, unknown>
  return metadata['requires'] ? { metadata } : {}
}
