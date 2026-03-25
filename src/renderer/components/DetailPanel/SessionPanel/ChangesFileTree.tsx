// SPDX-License-Identifier: Apache-2.0

/**
 * ChangesFileTree — Static file tree for the diff changes dialog.
 *
 * Key design decisions:
 *   1. Strips the longest common directory prefix from all paths, showing only
 *      the meaningful relative portion (like `git diff` does).
 *   2. Git-style directory compaction: single-child directory chains are merged
 *      into one line (e.g. "src/components" instead of two nested levels).
 *   3. All directories are rendered fully expanded — no collapse toggle needed
 *      for a diff viewer where the file count is typically small.
 */
import { memo, useMemo, useEffect, useRef } from 'react'
import { FileCode2, FolderOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { FileChange } from './extractFileChanges'

// ─── Types ──────────────────────────────────────────────────────────────────

interface TreeNode {
  /** Display name (may be a compacted path segment like "src/components") */
  name: string
  /** Original full path of the file (used for selection identity) */
  filePath: string
  isDirectory: boolean
  changeType?: FileChange['changeType']
  children: TreeNode[]
  operationCount?: number
}

interface ChangesFileTreeProps {
  files: FileChange[]
  selectedFilePath: string | null
  onSelectFile: (filePath: string) => void
}

// ─── Pure helpers ───────────────────────────────────────────────────────────

/**
 * Compute the longest common directory prefix across all file paths.
 *
 * Given ["/a/b/c/x.ts", "/a/b/d/y.ts"], returns "/a/b/".
 * Always returns a string ending with "/" (or empty string if no common prefix).
 */
function longestCommonDirPrefix(paths: string[]): string {
  if (paths.length === 0) return ''
  if (paths.length === 1) {
    const idx = paths[0].lastIndexOf('/')
    return idx > 0 ? paths[0].slice(0, idx + 1) : ''
  }

  const dirParts = paths.map((p) => {
    const idx = p.lastIndexOf('/')
    return idx > 0 ? p.slice(0, idx).split('/') : []
  })

  const common: string[] = []
  const minLen = Math.min(...dirParts.map((d) => d.length))
  for (let i = 0; i < minLen; i++) {
    const seg = dirParts[0][i]
    if (dirParts.every((d) => d[i] === seg)) {
      common.push(seg)
    } else {
      break
    }
  }

  return common.length > 0 ? common.join('/') + '/' : ''
}

/**
 * Build a directory tree from FileChange[], stripping the common prefix first,
 * then compact single-child directories.
 */
function buildTree(files: FileChange[]): { nodes: TreeNode[]; prefix: string } {
  const prefix = longestCommonDirPrefix(files.map((f) => f.filePath))
  const root: TreeNode = { name: '', filePath: '', isDirectory: true, children: [] }

  for (const file of files) {
    // Strip common prefix to get the relative path
    const relPath = file.filePath.startsWith(prefix)
      ? file.filePath.slice(prefix.length)
      : file.filePath
    const parts = relPath.split('/').filter(Boolean)

    let current = root
    // Build intermediate directory nodes
    for (let i = 0; i < parts.length - 1; i++) {
      const segment = parts[i]
      let child = current.children.find((c) => c.isDirectory && c.name === segment)
      if (!child) {
        child = {
          name: segment,
          filePath: '',
          isDirectory: true,
          children: [],
        }
        current.children.push(child)
      }
      current = child
    }

    // Leaf file node — filePath keeps the original absolute path for selection
    const fileName = parts[parts.length - 1] ?? file.fileName
    current.children.push({
      name: fileName,
      filePath: file.filePath,
      isDirectory: false,
      changeType: file.changeType,
      children: [],
      operationCount: file.operations.length,
    })
  }

  compactTree(root)
  sortTree(root)

  return { nodes: root.children, prefix }
}

/** Compact single-child directory chains into "dir1/dir2" style names. */
function compactTree(node: TreeNode): void {
  for (const child of node.children) compactTree(child)

  if (node.isDirectory && node.children.length === 1 && node.children[0].isDirectory) {
    const child = node.children[0]
    node.name = node.name ? `${node.name}/${child.name}` : child.name
    node.children = child.children
    compactTree(node) // recurse — merged result might compact further
  }
}

/** Sort: directories first (alpha), then files (alpha). */
function sortTree(node: TreeNode): void {
  node.children.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  for (const child of node.children) {
    if (child.isDirectory) sortTree(child)
  }
}

/**
 * Return file paths in the same visual order as the rendered tree (DFS).
 *
 * Exported so DiffChangesDialog can use this for keyboard navigation —
 * ArrowUp / ArrowDown should follow the tree's visual order, not the
 * extraction order of `changesResult.files`.
 */
export function getVisualFileOrder(files: FileChange[]): string[] {
  if (files.length === 0) return []
  const { nodes } = buildTree(files)
  const result: string[] = []
  function collect(children: TreeNode[]): void {
    for (const node of children) {
      if (node.isDirectory) {
        collect(node.children)
      } else {
        result.push(node.filePath)
      }
    }
  }
  collect(nodes)
  return result
}

// ─── Badge config ───────────────────────────────────────────────────────────

const CHANGE_BADGE: Record<FileChange['changeType'], { label: string; className: string }> = {
  created: { label: 'A', className: 'text-green-400' },
  modified: { label: 'M', className: 'text-yellow-400' },
  created_and_modified: { label: 'A', className: 'text-green-400' },
}

// ─── Recursive tree renderer ────────────────────────────────────────────────

function TreeNodeRow({
  node,
  depth,
  selectedFilePath,
  onSelectFile,
}: {
  node: TreeNode
  depth: number
  selectedFilePath: string | null
  onSelectFile: (path: string) => void
}): React.JSX.Element {
  if (node.isDirectory) {
    return (
      <>
        <div
          className="flex items-center gap-1.5 py-0.5 text-xs text-[hsl(var(--muted-foreground))]"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          <FolderOpen className="w-3.5 h-3.5 shrink-0 opacity-50" aria-hidden="true" />
          <span className="font-mono truncate opacity-60">{node.name}/</span>
        </div>
        {node.children.map((child) => (
          <TreeNodeRow
            key={child.isDirectory ? `d:${child.name}` : child.filePath}
            node={child}
            depth={depth + 1}
            selectedFilePath={selectedFilePath}
            onSelectFile={onSelectFile}
          />
        ))}
      </>
    )
  }

  const isActive = selectedFilePath === node.filePath
  const badge = node.changeType ? CHANGE_BADGE[node.changeType] : null

  return (
    <button
      onClick={() => onSelectFile(node.filePath)}
      className={cn(
        'w-full flex items-center gap-1.5 py-[3px] text-xs text-left transition-colors rounded-sm',
        'hover:bg-[hsl(var(--foreground)/0.04)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]',
        isActive && 'bg-[hsl(var(--primary)/0.08)] text-[hsl(var(--foreground))]',
        !isActive && 'text-[hsl(var(--muted-foreground))]',
      )}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
      aria-current={isActive ? 'true' : undefined}
      data-file-path={node.filePath}
      title={node.filePath}
    >
      <FileCode2 className="w-3.5 h-3.5 shrink-0 opacity-50" aria-hidden="true" />
      <span className="font-mono truncate min-w-0 flex-1">{node.name}</span>
      {node.operationCount != null && node.operationCount > 1 && (
        <span className="shrink-0 text-[10px] text-[hsl(var(--muted-foreground)/0.5)] font-mono">
          &times;{node.operationCount}
        </span>
      )}
      {badge && (
        <span className={cn('shrink-0 text-[10px] font-semibold font-mono mr-1', badge.className)}>
          {badge.label}
        </span>
      )}
    </button>
  )
}

// ─── Main component ─────────────────────────────────────────────────────────

export const ChangesFileTree = memo(function ChangesFileTree({
  files,
  selectedFilePath,
  onSelectFile,
}: ChangesFileTreeProps): React.JSX.Element {
  const { nodes, prefix } = useMemo(() => buildTree(files), [files])
  const containerRef = useRef<HTMLDivElement>(null)

  // Auto-scroll the selected file into view when it changes (keyboard navigation)
  useEffect(() => {
    if (!selectedFilePath) return
    requestAnimationFrame(() => {
      const el = containerRef.current?.querySelector(
        `[data-file-path="${CSS.escape(selectedFilePath)}"]`,
      )
      el?.scrollIntoView({ block: 'nearest' })
    })
  }, [selectedFilePath])

  return (
    <div ref={containerRef} className="h-full overflow-y-auto py-1.5" role="tree" aria-label="Changed files">
      {/* Common prefix hint — shown small at the top so user knows the base path */}
      {prefix && (
        <div
          className="px-2 pb-1.5 mb-1 border-b border-[hsl(var(--border)/0.3)] text-[10px] font-mono text-[hsl(var(--muted-foreground)/0.4)] truncate"
          title={prefix}
        >
          {prefix}
        </div>
      )}
      {nodes.map((node) => (
        <TreeNodeRow
          key={node.isDirectory ? `d:${node.name}` : node.filePath}
          node={node}
          depth={0}
          selectedFilePath={selectedFilePath}
          onSelectFile={onSelectFile}
        />
      ))}
    </div>
  )
})
