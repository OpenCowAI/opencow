// SPDX-License-Identifier: Apache-2.0

/**
 * FileChangeDiffView — Renders the diff for a single file's changes.
 *
 * Handles three scenarios:
 *   - Write (new file): full content with syntax highlighting
 *   - Single Edit: Monaco DiffEditor side-by-side
 *   - Multiple Edits: stacked inline diffs with sequence numbers
 *   - Write + Edit: combined view
 */
import { memo, useMemo } from 'react'
import { FilePlus2, Pencil } from 'lucide-react'
import { DiffEditor as MonacoDiffEditor } from '@monaco-editor/react'
import { useMonacoTheme } from '@/hooks/useMonacoTheme'
import { detectLanguage } from '@shared/fileUtils'
import { CodeViewer } from '../../ui/code-viewer'
import type { FileChange, FileOperation, DiffLine } from './extractFileChanges'
import { computeInlineDiff } from './extractFileChanges'

// ─── Diff line styles (shared with ToolUseBlockView) ────────────────────────

const DIFF_LINE_CLASSES: Record<DiffLine['type'], string> = {
  removed: 'bg-red-500/15 text-red-400',
  added: 'bg-green-500/15 text-green-400',
  context: 'text-[hsl(var(--muted-foreground))]',
}

const DIFF_PREFIX: Record<DiffLine['type'], string> = {
  removed: '\u2212',
  added: '+',
  context: ' ',
}

// ─── Sub-components ─────────────────────────────────────────────────────────

/** Inline diff block for a single Edit operation (compact, stacked layout). */
function InlineEditDiff({
  op,
  index,
  total,
}: {
  op: FileOperation
  index: number
  total: number
}): React.JSX.Element {
  const oldStr = op.oldString ?? ''
  const newStr = op.newString ?? ''
  const lines = useMemo(() => computeInlineDiff(oldStr, newStr), [oldStr, newStr])
  const removedCount = lines.filter((l) => l.type === 'removed').length
  const addedCount = lines.filter((l) => l.type === 'added').length

  return (
    <div className="mb-3">
      {/* Edit header */}
      <div className="flex items-center gap-2 text-xs mb-1.5 px-1">
        <Pencil className="w-3 h-3 text-[hsl(var(--muted-foreground)/0.5)]" aria-hidden="true" />
        <span className="text-[hsl(var(--muted-foreground))]">
          {total > 1 ? `Edit #${index + 1}` : 'Edit'}
        </span>
        <span className="flex items-center gap-1.5 text-[hsl(var(--muted-foreground)/0.5)]">
          {removedCount > 0 && <span className="text-red-400">&minus;{removedCount}</span>}
          {addedCount > 0 && <span className="text-green-400">+{addedCount}</span>}
          {op.replaceAll && (
            <span className="text-amber-400 text-[10px] font-medium uppercase tracking-wide">all</span>
          )}
        </span>
      </div>
      {/* Diff lines */}
      <pre
        className="font-mono text-xs leading-normal rounded-lg bg-[hsl(var(--background))] border border-[hsl(var(--border)/0.5)] overflow-x-auto max-h-[400px] overflow-y-auto"
        role="img"
        aria-label={`Code diff for edit ${index + 1}`}
      >
        {lines.map((line, i) => (
          <div key={i} className={`flex ${DIFF_LINE_CLASSES[line.type]}`}>
            <span className="w-5 shrink-0 text-right select-none opacity-40 pr-1 text-[10px]">
              {i + 1}
            </span>
            <span className="select-none opacity-60 inline-block w-3 text-center shrink-0">
              {DIFF_PREFIX[line.type]}
            </span>
            <span className="pl-0.5">{line.content || '\u00A0'}</span>
          </div>
        ))}
        {lines.length === 0 && (
          <div className="px-2 py-1 text-[hsl(var(--muted-foreground)/0.5)] italic">(no changes)</div>
        )}
      </pre>
    </div>
  )
}

/** Single Edit shown in full Monaco DiffEditor. */
function MonacoDiffView({
  oldString,
  newString,
  language,
}: {
  oldString: string
  newString: string
  language: string
}): React.JSX.Element {
  const monacoTheme = useMonacoTheme()

  return (
    <div className="h-full">
      <MonacoDiffEditor
        original={oldString}
        modified={newString}
        language={language}
        theme={monacoTheme}
        options={{
          fontSize: 13,
          lineHeight: 20,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          readOnly: true,
          domReadOnly: true,
          renderSideBySide: true,
          automaticLayout: true,
          contextmenu: false,
          scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
          padding: { top: 8 },
        }}
      />
    </div>
  )
}

/** Full-content view for Write operations (new file). */
function WriteContentView({
  content,
  language,
}: {
  content: string
  language: string
}): React.JSX.Element {
  return (
    <div className="h-full">
      <CodeViewer content={content} language={language} />
    </div>
  )
}

// ─── Main component ─────────────────────────────────────────────────────────

interface FileChangeDiffViewProps {
  fileChange: FileChange
}

export const FileChangeDiffView = memo(function FileChangeDiffView({
  fileChange,
}: FileChangeDiffViewProps): React.JSX.Element {
  const language = detectLanguage(fileChange.filePath)
  const writeOps = fileChange.operations.filter((op) => op.type === 'write')
  const editOps = fileChange.operations.filter((op) => op.type === 'edit' || op.type === 'notebook_edit')

  // Statistics
  const totalEdits = editOps.length
  const lastWrite = writeOps.length > 0 ? writeOps[writeOps.length - 1] : null

  return (
    <div className="h-full flex flex-col">
      {/* File header */}
      <div className="shrink-0 px-4 py-2.5 border-b border-[hsl(var(--border)/0.5)]">
        <div className="flex items-center gap-1.5 min-w-0">
          {fileChange.changeType === 'created' || fileChange.changeType === 'created_and_modified' ? (
            <FilePlus2 className="w-3.5 h-3.5 shrink-0 text-green-400" aria-hidden="true" />
          ) : (
            <Pencil className="w-3.5 h-3.5 shrink-0 text-yellow-400" aria-hidden="true" />
          )}
          <span className="text-sm font-semibold text-[hsl(var(--foreground))] truncate">
            {fileChange.fileName}
          </span>
          <span className="text-[10px] font-mono text-[hsl(var(--muted-foreground)/0.5)] shrink-0">
            {language}
          </span>
        </div>
        <p className="text-xs text-[hsl(var(--muted-foreground))] truncate mt-0.5 font-mono">
          {fileChange.filePath}
          {writeOps.length > 0 && (
            <>
              <span className="mx-1.5">&middot;</span>
              <span className="text-green-400">new file</span>
            </>
          )}
          {totalEdits > 0 && (
            <>
              <span className="mx-1.5">&middot;</span>
              <span className="text-yellow-400">
                {totalEdits} edit{totalEdits > 1 ? 's' : ''}
              </span>
            </>
          )}
        </p>
      </div>

      {/* Content area */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {/* Case 1: Only Write (new file) — show full content */}
        {writeOps.length > 0 && editOps.length === 0 && lastWrite?.content != null && (
          <WriteContentView content={lastWrite.content} language={language} />
        )}

        {/* Case 2: Only Edits */}
        {writeOps.length === 0 && editOps.length === 1 && editOps[0].oldString != null && editOps[0].newString != null && (
          /* Single edit — full Monaco DiffEditor */
          <MonacoDiffView
            oldString={editOps[0].oldString}
            newString={editOps[0].newString}
            language={language}
          />
        )}

        {writeOps.length === 0 && editOps.length > 1 && (
          /* Multiple edits — stacked inline diffs */
          <div className="h-full overflow-y-auto p-3">
            {editOps.map((op, i) => (
              <InlineEditDiff
                key={op.toolUseId}
                op={op}
                index={i}
                total={totalEdits}
              />
            ))}
          </div>
        )}

        {/* Case 3: Write + Edits — combined view */}
        {writeOps.length > 0 && editOps.length > 0 && (
          <div className="h-full overflow-y-auto p-3">
            {/* Show Write info */}
            {lastWrite?.content != null && (
              <div className="mb-3">
                <div className="flex items-center gap-2 text-xs mb-1.5 px-1">
                  <FilePlus2 className="w-3 h-3 text-green-400" aria-hidden="true" />
                  <span className="text-[hsl(var(--muted-foreground))]">
                    File created
                  </span>
                  <span className="text-[hsl(var(--muted-foreground)/0.5)]">
                    {lastWrite.content.split('\n').length} lines
                  </span>
                </div>
                <pre className="font-mono text-xs leading-normal rounded-lg bg-[hsl(var(--background))] border border-[hsl(var(--border)/0.5)] overflow-x-auto max-h-[200px] overflow-y-auto">
                  {lastWrite.content.split('\n').slice(0, 20).map((line, i) => (
                    <div key={i} className="flex bg-green-500/10 text-green-400">
                      <span className="w-5 shrink-0 text-right select-none opacity-40 pr-1 text-[10px]">
                        {i + 1}
                      </span>
                      <span className="select-none opacity-60 inline-block w-3 text-center shrink-0">+</span>
                      <span className="pl-0.5">{line || '\u00A0'}</span>
                    </div>
                  ))}
                  {lastWrite.content.split('\n').length > 20 && (
                    <div className="px-2 py-0.5 text-[hsl(var(--muted-foreground)/0.4)] italic text-center">
                      &hellip; {lastWrite.content.split('\n').length - 20} more lines
                    </div>
                  )}
                </pre>
              </div>
            )}
            {/* Subsequent edits */}
            {editOps.map((op, i) => (
              <InlineEditDiff
                key={op.toolUseId}
                op={op}
                index={i}
                total={totalEdits}
              />
            ))}
          </div>
        )}

        {/* Edge case: single Edit without old/new string data */}
        {writeOps.length === 0 && editOps.length === 1 && (editOps[0].oldString == null || editOps[0].newString == null) && (
          <div className="h-full overflow-y-auto p-3">
            <InlineEditDiff op={editOps[0]} index={0} total={1} />
          </div>
        )}

        {/* Edge case: no operations (shouldn't happen) */}
        {writeOps.length === 0 && editOps.length === 0 && (
          <div className="h-full flex items-center justify-center text-xs text-[hsl(var(--muted-foreground)/0.5)]">
            No change data available
          </div>
        )}
      </div>
    </div>
  )
})
