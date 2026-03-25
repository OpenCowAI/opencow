// SPDX-License-Identifier: Apache-2.0

/**
 * useGutterDiff — apply git line-level diff decorations to Monaco editor gutter.
 *
 * Responsibility:
 *   - Fetch per-file diff hunks via IPC (`git:file-diff`)
 *   - Map `GitLineDiff[]` → Monaco `IModelDeltaDecoration[]`
 *   - Manage decoration lifecycle (create / update / cleanup)
 *
 * Refresh triggers:
 *   1. Editor mount (file switch causes re-mount via `key={path}`)
 *   2. Git snapshot timestamp change (file save, stage, external edit)
 *
 * Design:
 *   - Uses `createDecorationsCollection()` (modern Monaco API, 0.36+)
 *   - `cancelled` flag prevents stale IPC results on rapid file switches
 *   - DOM connectivity guard handles the transient stale-editor render
 *     that occurs between key-change unmount and `setEditorInstance`
 *   - Silent degradation: non-git projects, binary files, errors → no decorations
 *
 * @module useGutterDiff
 */

import { useEffect } from 'react'
import type { editor as monacoEditor } from 'monaco-editor'
import { useGitStore } from '@/stores/gitStore'
import { getAppAPI } from '@/windowAPI'
import { createLogger } from '@/lib/logger'
import type { GitLineDiff } from '@shared/gitTypes'

const log = createLogger('GutterDiff')

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

/**
 * Apply git line-level diff decorations to a Monaco editor gutter.
 *
 * Lifecycle:
 *   1. On mount (editor ready): fetch diff via IPC, apply decorations.
 *   2. On `gitTimestamp` change (same file): re-fetch + atomic replace.
 *   3. On unmount (file switch / view close): clear decorations.
 *
 * Since EditorPane uses `key={activeFile.path}`, this hook re-mounts
 * on file switch — no separate file-change detection needed.
 */
export function useGutterDiff(
  editorInstance: monacoEditor.IStandaloneCodeEditor | null,
  projectPath: string,
  filePath: string | undefined,
): void {
  // Subscribe to snapshot timestamp — primitive number, no spurious re-renders.
  const gitTimestamp = useGitStore(
    (s) => s.gitSnapshots[projectPath]?.timestamp ?? 0,
  )

  useEffect(() => {
    // Guard: need both editor and file path
    if (!editorInstance || !filePath) return

    // Guard: skip stale editor instance during key-change transition.
    // Between Editor unmount (key change) and setMountedEditor(newEditor),
    // React may fire this effect with the destroyed old editor + new filePath.
    // Checking DOM connectivity catches this transient state cleanly.
    if (!editorInstance.getDomNode()?.isConnected) return

    // Create a fresh decoration collection for this editor instance.
    // Captured in closure — cleanup clears exactly this collection.
    const collection = editorInstance.createDecorationsCollection()

    let cancelled = false

    async function fetchAndApply(): Promise<void> {
      try {
        const diffs = await getAppAPI()['git:file-diff'](projectPath, filePath!)
        if (cancelled) return
        collection.set(mapDiffsToDecorations(diffs))
      } catch (err) {
        if (!cancelled) {
          log.warn('Failed to fetch file diff', { filePath, err })
          collection.set([]) // Clear stale decorations on error
        }
      }
    }

    fetchAndApply()

    return () => {
      cancelled = true
      collection.clear()
    }
  }, [editorInstance, projectPath, filePath, gitTimestamp])
}

/* ------------------------------------------------------------------ */
/*  Decoration Mapping (pure functions)                                */
/* ------------------------------------------------------------------ */

/** CSS class name for gutter bar indicator. */
const GUTTER_CLASS: Record<GitLineDiff['type'], string> = {
  added:    'git-gutter-added',
  modified: 'git-gutter-modified',
  deleted:  'git-gutter-deleted',
}

/** CSS class name for subtle line background highlight. */
const LINE_CLASS: Record<GitLineDiff['type'], string | undefined> = {
  added:    'git-line-added',
  modified: 'git-line-modified',
  deleted:  undefined, // Deleted is a point indicator, no line background
}

/**
 * Map backend GitLineDiff[] → Monaco IModelDeltaDecoration[].
 *
 * Uses `linesDecorationsClassName` (thin vertical bar between line
 * numbers and code) rather than `glyphMarginClassName` (avoids
 * enabling the wider glyph margin column).
 *
 * Mapping:
 *   - added    → green bar spanning startLine..startLine+lineCount-1
 *   - modified → amber bar spanning startLine..startLine+lineCount-1
 *   - deleted  → red triangle at startLine (lineCount is always 1)
 */
function mapDiffsToDecorations(
  diffs: readonly GitLineDiff[],
): monacoEditor.IModelDeltaDecoration[] {
  return diffs.map((diff): monacoEditor.IModelDeltaDecoration => {
    const endLine = diff.startLine + diff.lineCount - 1

    return {
      range: {
        startLineNumber: diff.startLine,
        startColumn: 1,
        endLineNumber: endLine,
        endColumn: 1,
      },
      options: {
        isWholeLine: true,
        linesDecorationsClassName: GUTTER_CLASS[diff.type],
        className: LINE_CLASS[diff.type],
      },
    }
  })
}
