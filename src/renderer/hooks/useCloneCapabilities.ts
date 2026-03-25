// SPDX-License-Identifier: Apache-2.0

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type {
  ClonableCapability,
  CloneConflictResolution,
  CloneResult,
  ManagedCapabilityCategory,
} from '@shared/types'
import { getAppAPI } from '@/windowAPI'

// ── Types ────────────────────────────────────────────────────────────────────

type Phase = 'idle' | 'discovering' | 'ready' | 'cloning' | 'done'

interface UseCloneCapabilitiesParams {
  sourceProjectId: string | null
  targetProjectId: string
}

interface UseCloneCapabilitiesReturn {
  // Discovery
  phase: Phase
  capabilities: ClonableCapability[]
  discoverError: string | null

  // Selection
  selectedKeys: ReadonlySet<string>
  toggleItem: (key: string) => void
  toggleAll: () => void
  allSelected: boolean
  someSelected: boolean
  selectedCount: number

  // Conflicts
  hasConflicts: boolean
  conflictCount: number

  // Search
  searchQuery: string
  setSearchQuery: (q: string) => void
  filteredCapabilities: ClonableCapability[]

  // Grouped view (filtered capabilities grouped by category)
  groupedCapabilities: Map<ManagedCapabilityCategory, ClonableCapability[]>

  // Clone execution
  executeClone: (defaultResolution: CloneConflictResolution) => Promise<CloneResult | null>
  cloneResult: CloneResult | null
  cloneError: string | null
}

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Manages the full clone workflow: discover → select → execute.
 *
 * Provides reactive state for all UI needs: search, selection, conflict
 * detection, and execution with result feedback.
 */
export function useCloneCapabilities({
  sourceProjectId,
  targetProjectId,
}: UseCloneCapabilitiesParams): UseCloneCapabilitiesReturn {
  const [phase, setPhase] = useState<Phase>('idle')
  const [capabilities, setCapabilities] = useState<ClonableCapability[]>([])
  const [discoverError, setDiscoverError] = useState<string | null>(null)
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [cloneResult, setCloneResult] = useState<CloneResult | null>(null)
  const [cloneError, setCloneError] = useState<string | null>(null)
  const mountedRef = useRef(true)
  const requestVersionRef = useRef(0)

  // ── Discovery ──────────────────────────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    // Bump version so any in-flight request from a previous sourceProjectId
    // will see a stale version and bail out.
    const requestVersion = ++requestVersionRef.current

    if (!sourceProjectId) {
      setCapabilities([])
      setSelectedKeys(new Set())
      setPhase('idle')
      setDiscoverError(null)
      return
    }

    setPhase('discovering')
    setDiscoverError(null)
    setCapabilities([])
    setSelectedKeys(new Set())
    setCloneResult(null)
    setCloneError(null)

    const discoverFn = getAppAPI()['capability:clone:discover']
    if (typeof discoverFn !== 'function') {
      setDiscoverError('Clone IPC channel not available')
      setPhase('ready')
      return
    }

    discoverFn({
      sourceProjectId,
      targetProjectId,
    })
      .then((items) => {
        if (!mountedRef.current || requestVersion !== requestVersionRef.current) return
        setCapabilities(items)
        // Auto-select all non-conflicting items
        const keys = new Set(
          items
            .filter(c => c.conflict === null)
            .map(c => capKey(c.category, c.name)),
        )
        setSelectedKeys(keys)
        setPhase('ready')
      })
      .catch((err) => {
        if (!mountedRef.current || requestVersion !== requestVersionRef.current) return
        setDiscoverError(err instanceof Error ? err.message : String(err))
        setPhase('ready')
      })
  }, [sourceProjectId, targetProjectId])

  // ── Selection ──────────────────────────────────────────────────────────

  const toggleItem = useCallback((key: string) => {
    setSelectedKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const filteredCapabilities = useMemo(() => {
    if (!searchQuery.trim()) return capabilities
    const q = searchQuery.toLowerCase()
    return capabilities.filter(
      c => c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q),
    )
  }, [capabilities, searchQuery])

  const toggleAll = useCallback(() => {
    const filtered = filteredCapabilities
    const allKeys = new Set(filtered.map(c => capKey(c.category, c.name)))
    const allCurrentlySelected = filtered.every(c => selectedKeys.has(capKey(c.category, c.name)))

    if (allCurrentlySelected) {
      // Deselect all filtered items
      setSelectedKeys(prev => {
        const next = new Set(prev)
        for (const key of allKeys) next.delete(key)
        return next
      })
    } else {
      // Select all filtered items
      setSelectedKeys(prev => new Set([...prev, ...allKeys]))
    }
  }, [filteredCapabilities, selectedKeys])

  const allSelected = filteredCapabilities.length > 0 &&
    filteredCapabilities.every(c => selectedKeys.has(capKey(c.category, c.name)))
  const someSelected = filteredCapabilities.some(c => selectedKeys.has(capKey(c.category, c.name))) && !allSelected

  // ── Conflicts ──────────────────────────────────────────────────────────

  const selectedConflicts = useMemo(
    () => capabilities.filter(c =>
      c.conflict !== null && selectedKeys.has(capKey(c.category, c.name)),
    ),
    [capabilities, selectedKeys],
  )
  const hasConflicts = selectedConflicts.length > 0
  const conflictCount = selectedConflicts.length

  // ── Grouped view ───────────────────────────────────────────────────────

  const groupedCapabilities = useMemo(() => {
    const map = new Map<ManagedCapabilityCategory, ClonableCapability[]>()
    for (const cap of filteredCapabilities) {
      const group = map.get(cap.category) ?? []
      group.push(cap)
      map.set(cap.category, group)
    }
    return map
  }, [filteredCapabilities])

  // ── Clone execution ────────────────────────────────────────────────────

  const executeClone = useCallback(async (
    defaultResolution: CloneConflictResolution,
  ): Promise<CloneResult | null> => {
    if (!sourceProjectId || selectedKeys.size === 0) return null

    setPhase('cloning')
    setCloneError(null)

    const items = capabilities
      .filter(c => selectedKeys.has(capKey(c.category, c.name)))
      .map(c => ({
        name: c.name,
        category: c.category,
        ...(c.conflict ? { conflictResolution: defaultResolution } : {}),
      }))

    try {
      const executeFn = getAppAPI()['capability:clone:execute']
      if (typeof executeFn !== 'function') {
        throw new Error('Clone execute IPC channel not available')
      }
      const result = await executeFn({
        sourceProjectId,
        targetProjectId,
        items,
      })
      if (!mountedRef.current) return null
      setCloneResult(result)
      setPhase('done')
      return result
    } catch (err) {
      if (!mountedRef.current) return null
      const message = err instanceof Error ? err.message : 'Clone failed'
      setCloneError(message)
      setPhase('ready')
      return null
    }
  }, [sourceProjectId, targetProjectId, capabilities, selectedKeys])

  return {
    phase,
    capabilities,
    discoverError,
    selectedKeys,
    toggleItem,
    toggleAll,
    allSelected,
    someSelected,
    selectedCount: selectedKeys.size,
    hasConflicts,
    conflictCount,
    searchQuery,
    setSearchQuery,
    filteredCapabilities,
    groupedCapabilities,
    executeClone,
    cloneResult,
    cloneError,
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Composite key for a capability (category + name). */
function capKey(category: ManagedCapabilityCategory, name: string): string {
  return `${category}:${name}`
}

export { capKey }
