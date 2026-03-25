// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { usePlainTextEditor } from './usePlainTextEditor'
import { useSlashSuggestion } from './useSlashSuggestion'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface UseNoteEditorOptions {
  /** Placeholder text shown when the editor is empty */
  placeholder?: string
  /**
   * Initial content to restore on mount.
   * If the value is valid TipTap JSON (stringified), it is parsed and restored
   * losslessly (preserving slash mention nodes). Otherwise treated as plain text.
   */
  initialContent?: string | null
  /** Called when the user presses Enter (without Shift) — typically "submit" */
  onSubmit?: () => void
  /** Called when files are pasted from the clipboard */
  onPasteFiles?: (files: File[]) => void
  /** Whether the editor is editable (defaults to true) */
  editable?: boolean
}

export interface NoteEditorState {
  /** TipTap editor instance (nullable during init) */
  editor: Editor | null
  /** Whether the editor has any non-whitespace content */
  hasContent: boolean
  /**
   * Monotonically increasing counter — increments on every editor update.
   *
   * Use as a cheap dependency signal in `useEffect` to react to content changes
   * without reading the actual content (which can be expensive for large documents).
   * Consumers that need the content itself should call `getText()` / `getJson()`
   * inside the effect body (deferred), not in the dependency array.
   */
  revision: number
  /** Get the plain-text representation of the editor content */
  getText: () => string
  /**
   * Get the TipTap JSON representation of the editor content
   * (stringified, for storage as `richContent`).
   */
  getJson: () => string
  /**
   * Replace the editor content from a string.
   *
   * Accepts either a stringified TipTap JSON document (lossless restore,
   * preserving slash mention nodes) or plain text (converted to paragraphs).
   * This is the **canonical way** for callers to set editor content after
   * mount — e.g. when async-fetched data arrives in edit mode.
   */
  setContent: (content: string) => void
  /** Clear the editor content */
  clear: () => void
  /**
   * Focus the editor.
   *
   * @param position  Where to place the cursor after focusing.
   *                  Accepts any TipTap `FocusPosition` value:
   *                  - `'start'` / `'end'` / `'all'` / `number` / `boolean` / `null`
   *                  - Omit to focus at the current (last known) cursor position.
   */
  focus: (position?: 'start' | 'end' | 'all' | number | boolean | null) => void
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Try to parse a string as TipTap JSON. Returns the parsed object on success,
 * or `null` if the string is not valid TipTap JSON (e.g. plain text).
 */
function tryParseTipTapJson(value: string): object | null {
  try {
    const parsed = JSON.parse(value)
    // TipTap JSON always has a `type` field at root (e.g. "doc")
    if (parsed && typeof parsed === 'object' && 'type' in parsed) {
      return parsed
    }
  } catch {
    // Not JSON — treat as plain text
  }
  return null
}

/**
 * Convert plain text to TipTap-compatible HTML.
 *
 * `\n\n` → paragraph boundary, `\n` → `<br>` within a paragraph.
 * Safe: TipTap's ProseMirror schema strips all unknown tags on parse,
 * so no XSS risk even if the input contains raw HTML.
 */
function plainTextToTipTapHtml(text: string): string {
  return text
    .split('\n\n')
    .map((p) => `<p>${p ? p.replace(/\n/g, '<br>') : '<br>'}</p>`)
    .join('')
}

/**
 * Apply a content string to a TipTap editor instance.
 *
 * Detects TipTap JSON (lossless) vs plain text and uses the appropriate
 * restore path. This is the single implementation shared by both
 * `initialContent` restoration and the `setContent` callback.
 */
function applyContentToEditor(editor: Editor, content: string): void {
  const tipTapJson = tryParseTipTapJson(content)
  if (tipTapJson) {
    editor.commands.setContent(tipTapJson)
  } else {
    editor.commands.setContent(plainTextToTipTapHtml(content))
  }
}

// ─── Hook ───────────────────────────────────────────────────────────────────

/**
 * A TipTap-based rich-text editor hook with slash command support.
 *
 * Provides:
 * - Slash command support (via `useSlashSuggestion`)
 * - Content extraction (plain text + TipTap JSON)
 * - Initial content restoration (from JSON or plain text)
 * - Configurable Enter behaviour (submit or natural paragraph)
 * - Image paste forwarding
 *
 * Enter key behaviour:
 * - With `onSubmit` → Enter triggers submit
 * - Without `onSubmit` → Enter creates a new paragraph (natural TipTap behaviour)
 * - Ctrl+J always inserts a newline (new paragraph) regardless of mode
 *
 * Differs from `useMessageComposer` in that it does NOT manage:
 * - File attachments (callers handle attachments separately)
 * - Draft caching (callers handle their own draft lifecycle)
 * - Submit/send pipeline (caller controls submit logic)
 */
export function useNoteEditor(options: UseNoteEditorOptions): NoteEditorState {
  const {
    placeholder = '',
    initialContent,
    onSubmit,
    onPasteFiles,
    editable = true,
  } = options

  // Stable ref to avoid stale closure in onEnter
  const onSubmitRef = useRef(onSubmit)
  useEffect(() => {
    onSubmitRef.current = onSubmit
  }, [onSubmit])

  // Slash command suggestion config (shared with Console)
  const { suggestion: slashSuggestion } = useSlashSuggestion()

  // TipTap editor — onEnter is only passed when onSubmit is provided,
  // so SubmitOnEnter extension is omitted when Enter should create paragraphs.
  const editor = usePlainTextEditor({
    placeholder,
    editable,
    ariaLabel: 'Rich text editor',
    onEnter: onSubmit ? () => onSubmitRef.current?.() : undefined,
    onPasteFiles,
    slashSuggestion,
  })

  // Track hasContent via editor update events (same pattern as useMessageComposer).
  // Uses editor.isEmpty (O(1) ProseMirror node check) instead of
  // editor.getText().trim().length (O(n) full DOM walk + string allocation).
  const [hasContent, setHasContent] = useState(false)
  // Revision counter increments on every editor update — consumers can use it
  // as a cheap signal that content changed without reading the actual content.
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (!editor) return
    const sync = (): void => {
      setHasContent(!editor.isEmpty)
      setRevision((r) => r + 1)
    }
    sync()
    editor.on('update', sync)
    return () => { editor.off('update', sync) }
  }, [editor])

  // Restore initial content once (on mount when editor becomes available).
  // Uses a ref so the effect only depends on `editor`, avoiding superfluous
  // effect cycles when `initialContent` identity changes after mount.
  //
  // NOTE: This effect intentionally does NOT call `editor.commands.focus()`.
  // Content initialisation and focus management are separate concerns — callers
  // decide when and where to focus (e.g. IssueFormModal focuses the title input,
  // NoteEditMode focuses the editor at the end of content).
  const initialContentRef = useRef(initialContent)
  const hasInitialized = useRef(false)
  useEffect(() => {
    if (!editor || hasInitialized.current || !initialContentRef.current) return
    hasInitialized.current = true
    applyContentToEditor(editor, initialContentRef.current)
  }, [editor])

  // Content extraction helpers
  const getText = useCallback((): string => {
    return editor?.getText().trim() ?? ''
  }, [editor])

  const getJson = useCallback((): string => {
    if (!editor) return ''
    return JSON.stringify(editor.getJSON())
  }, [editor])

  const setContent = useCallback((content: string): void => {
    if (!editor) return
    applyContentToEditor(editor, content)
  }, [editor])

  const clear = useCallback((): void => {
    editor?.commands.clearContent()
  }, [editor])

  const focus = useCallback((position?: 'start' | 'end' | 'all' | number | boolean | null): void => {
    editor?.commands.focus(position)
  }, [editor])

  // Stable API surface — identity changes only when the editor lifecycle
  // changes (typically once, from null to the created instance).
  //
  // `hasContent` is exposed via a getter backed by a ref, so:
  //   - The memo identity is NOT affected by hasContent transitions
  //   - Consumers that use `state.hasContent` as an effect dep still get
  //     correct trigger behaviour: React evaluates the getter at render
  //     time, capturing the boolean value for dependency comparison.
  //
  // This avoids the pitfall where `useMemo([..., hasContent])` makes the
  // entire object unstable on every empty↔non-empty transition — a subtle
  // trap that causes spurious effect re-executions in consumers.
  const hasContentRef = useRef(hasContent)
  hasContentRef.current = hasContent
  const revisionRef = useRef(revision)
  revisionRef.current = revision

  return useMemo((): NoteEditorState => ({
    editor,
    get hasContent() { return hasContentRef.current },
    get revision() { return revisionRef.current },
    getText,
    getJson,
    setContent,
    clear,
    focus,
  }), [editor, getText, getJson, setContent, clear, focus])
}
