// SPDX-License-Identifier: Apache-2.0

import { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import type { Editor } from '@tiptap/core'
import type { Range } from '@tiptap/core'
import {
  processAttachmentFile,
  resolveMediaType,
  AttachmentError,
  type ProcessedAttachment,
} from '../lib/attachmentUtils'
import { toast } from '@/lib/toast'
import { usePlainTextEditor } from './usePlainTextEditor'
import { useSlashSuggestion } from './useSlashSuggestion'
import { useFileSearch } from './useFileSearch'
import { createFileMentionRenderer } from '../extensions/fileMentionSuggestion'
import type { SlashItem } from '@shared/slashItems'
import type { UserMessageContent, FileEntry } from '@shared/types'
import { ATTACHMENT_LIMITS } from '@shared/types'
import { extractEditorSegments } from '../lib/extractEditorSegments'
import type { EditorSegment } from '@shared/editorSegments'
import { resolveSlashSegments, type ResolvedBlock } from '@shared/slashExpander'
import { useProjectScope } from '../contexts/ProjectScopeContext'
import { createLogger } from '@/lib/logger'
import { getAppAPI } from '@/windowAPI'
import { serializeContextFiles } from '@/lib/contextFilesParsing'
import { useSettingsStore } from '@/stores/settingsStore'
import { buildSlashMentionInsertContent } from '../lib/slashMentionContent'

const log = createLogger('MessageComposer')

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface UseMessageComposerOptions {
  /** Placeholder text shown when the editor is empty */
  placeholder?: string
  /** Whether the editor is interactive (defaults to true) */
  editable?: boolean
  /** ARIA label for accessibility */
  ariaLabel?: string
  /**
   * Initial text to pre-fill the editor.
   * Only applied once on mount (when editor becomes available).
   */
  initialText?: string
  /**
   * Initial attachments to pre-populate.
   * Only applied once on mount.
   */
  initialAttachments?: ProcessedAttachment[]
  /**
   * Called on submit (Enter key or programmatic).
   * Return `true` (or void/undefined) to indicate success — the editor and
   * images will be cleared automatically. Return `false` to keep the content.
   */
  onSubmit: (content: UserMessageContent) => Promise<boolean | void>
  /**
   * Optional cache key for persisting draft content across remounts.
   * When provided, the editor text and pending images are saved to an
   * in-memory cache on unmount and restored on the next mount with the
   * same key (e.g. issueId).
   */
  cacheKey?: string
}

export interface MessageComposerDragHandlers {
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
}

export interface MessageComposerState {
  /** TipTap editor instance (nullable during init) */
  editor: Editor | null
  /** Currently attached files (images + documents) */
  pendingAttachments: ProcessedAttachment[]
  /** Whether a submit is in progress */
  isSending: boolean
  /** Whether the editor has any text or attachments */
  hasContent: boolean
  /** Whether the composer is effectively disabled (editable=false or submitting) */
  isDisabled: boolean
  /** Whether a file is being dragged over the drop zone */
  isDragOver: boolean

  /* -- Slash commands -- */

  /** All slash items (unfiltered, for popover with its own search) */
  slashItems: SlashItem[]
  /** Whether slash commands are loading */
  slashLoading: boolean
  /** Insert a slash command at the start of the editor */
  insertSlashCommand: (item: SlashItem) => void

  /* -- Actions -- */

  /** Trigger submit programmatically */
  submit: () => Promise<void>
  /** Add files (validates and processes images + documents) */
  addAttachments: (files: File[]) => Promise<void>
  /** Remove an attachment by id */
  removeAttachment: (id: string) => void
  /** Drag-drop event handlers to spread on the drop zone element */
  dragHandlers: MessageComposerDragHandlers
  /** Hidden file input ref — attach to an <input type="file"> */
  fileInputRef: React.RefObject<HTMLInputElement | null>
  /** Change handler for the hidden file input */
  handleFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void
}

/* ------------------------------------------------------------------ */
/*  Build UserMessageContent from editor text + images                 */
/* ------------------------------------------------------------------ */

// buildStructuredContent is now in @shared/contentBuilder — imported below
import { buildStructuredContent } from '@shared/contentBuilder'

/**
 * Module-level draft cache — persists input drafts across component
 * remounts within the same app session.  Keyed by caller-supplied cacheKey
 * (e.g. issueId) so each context remembers its own draft independently.
 *
 * Stores the editor's native HTML representation (via `editor.getHTML()`) to
 * ensure a lossless round-trip.  Plain-text serialisation (`editor.getText()`)
 * is lossy — it flattens paragraph boundaries and hard-breaks into the same
 * `\n` character, so each save→restore cycle inflates the document structure.
 */
const draftCache = new Map<string, { html: string; attachments: ProcessedAttachment[] }>()

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useMessageComposer(options: UseMessageComposerOptions): MessageComposerState {
  const {
    placeholder = '',
    editable = true,
    ariaLabel = '',
    initialText,
    initialAttachments,
    onSubmit,
    cacheKey,
  } = options

  /* -- Project scope (for slash command expansion) -- */
  const { projectPath } = useProjectScope()
  const projectPathRef = useRef(projectPath)
  projectPathRef.current = projectPath

  /* -- State -- */
  const [pendingAttachments, setPendingAttachments] = useState<ProcessedAttachment[]>([])
  const [isSending, setIsSending] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Whether the TipTap editor has non-empty text.
  //
  // This MUST be a React state driven by editor 'update' events — NOT a
  // render-time derivation like `editor?.getText().trim().length > 0`.
  //
  // Why: TipTap v3's `useEditor` defaults to NOT re-rendering the parent
  // component on transactions (`shouldRerenderOnTransaction` defaults to
  // `undefined`, which is treated as `false`). A derived variable would
  // remain stale after every keystroke, causing the send button's active
  // state to never update.
  //
  // React's useState bails out on identical boolean values, so setting
  // `true` repeatedly during continuous typing is effectively free.
  const [hasTextContent, setHasTextContent] = useState(false)

  // Monotonically increasing counter — forces a React re-render after
  // programmatic content mutations (setContent / clearContent) so that
  // components reading editor state (e.g. EditorContent) stay in sync
  // in all environments (including JSDOM for tests).
  const [, setContentVersion] = useState(0)
  const bumpContentVersion = useCallback(() => setContentVersion((v) => v + 1), [])

  const isDisabled = !editable || isSending

  /* -- Draft cache refs -- */
  const pendingAttachmentsRef = useRef<ProcessedAttachment[]>(pendingAttachments)
  pendingAttachmentsRef.current = pendingAttachments
  const latestTextRef = useRef('')
  const latestHtmlRef = useRef('')

  // Tracks whether a submit is in-flight.  Read by the draft-save cleanup
  // to avoid persisting already-submitted content as a stale draft when
  // the component unmounts during an async onSubmit (e.g. SessionInputBar
  // hides when session transitions to 'creating').
  const isSubmittingRef = useRef(false)

  /* -- Attachment actions -- */

  const addAttachments = useCallback(async (files: File[]) => {
    for (const file of files) {
      try {
        const processed = await processAttachmentFile(file)
        setPendingAttachments((prev) => {
          if (prev.length >= ATTACHMENT_LIMITS.maxPerMessage) return prev
          return [...prev, processed]
        })
      } catch (err) {
        if (err instanceof AttachmentError) {
          toast(err.message)
        }
        log.error('Attachment processing error', err)
      }
    }
  }, [])

  const removeAttachment = useCallback((id: string) => {
    setPendingAttachments((prev) => prev.filter((a) => a.id !== id))
  }, [])

  /* -- Drag-drop handlers -- */

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragOver(true)
    }
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragOver(false)
      const files = Array.from(e.dataTransfer.files).filter((f) => resolveMediaType(f) !== null)
      if (files.length > 0) addAttachments(files)
    },
    [addAttachments]
  )

  const dragHandlers: MessageComposerDragHandlers = useMemo(
    () => ({ onDragOver: handleDragOver, onDragLeave: handleDragLeave, onDrop: handleDrop }),
    [handleDragOver, handleDragLeave, handleDrop]
  )

  /* -- File picker -- */

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? [])
      if (files.length > 0) addAttachments(files)
      // Reset so same file can be selected again
      if (fileInputRef.current) fileInputRef.current.value = ''
    },
    [addAttachments]
  )

  /* -- Submit ref (break circular dep: submit needs editor, editor needs onEnter → submit) -- */
  const submitRef = useRef<() => void>(() => {})

  /* -- Slash commands (shared hook) -- */

  const slash = useSlashSuggestion()
  const slashSuggestion = slash.suggestion

  /* -- File mention (@) -- delegated to useFileSearch hook */

  const fileSearch = useFileSearch()
  const fileMentionRendererRef = useRef(createFileMentionRenderer(() => fileSearch.loadFileItems()))

  const fileSuggestion = useMemo(
    () =>
      projectPath
        ? {
            char: '@',
            allowSpaces: false,
            startOfLine: false,
            items: ({ query }: { query: string }) => fileSearch.filterFileItems(query),
            render: fileMentionRendererRef.current,
            command: ({ editor, range, props: entry }: { editor: Editor; range: Range; props: FileEntry }) => {
              editor
                .chain()
                .focus()
                .deleteRange(range)
                .insertContent([
                  {
                    type: 'fileMention',
                    attrs: {
                      path: entry.path,
                      name: entry.name,
                      isDirectory: entry.isDirectory,
                    },
                  },
                  { type: 'text', text: ' ' },
                ])
                .run()
            },
          }
        : undefined,
    [projectPath, fileSearch.filterFileItems],
  )

  /* -- TipTap editor -- */

  const editor = usePlainTextEditor({
    placeholder,
    editable: !isDisabled,
    ariaLabel,
    onEnter: () => submitRef.current(),
    onPasteFiles: (files) => addAttachments(files),
    slashSuggestion,
    fileSuggestion,
  })

  /* -- Draft cache & initial content injection -- */

  const hasInitializedText = useRef(false)
  const hasInitializedAttachments = useRef(false)

  // Keep latestTextRef and hasTextContent in sync via editor update events.
  // TipTap v3's useEditor does NOT re-render the parent on transactions,
  // so we explicitly track text presence as React state to drive UI updates
  // (e.g. send button active state).
  useEffect(() => {
    if (!editor) return
    const sync = (): void => {
      const text = editor.getText().trim()
      latestTextRef.current = text
      // getHTML() is intentionally NOT called here — it serialises the entire
      // ProseMirror document on every keystroke, which is wasteful for a ref
      // that is only consumed during draft-save (unmount / cacheKey switch).
      // Instead, we lazily snapshot the HTML only when it's actually needed.
      setHasTextContent(text.length > 0)
    }
    sync()
    editor.on('update', sync)
    return () => { editor.off('update', sync) }
  }, [editor])

  // Restore draft from cache on mount or when cacheKey changes (e.g. issue switch).
  // Uses lastRestoredKeyRef instead of a boolean flag so that switching between
  // different issues correctly saves the old draft and restores the new one.
  const lastRestoredKeyRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!editor || !cacheKey) return
    if (lastRestoredKeyRef.current === cacheKey) return // already restored for this key
    const isSwitch = lastRestoredKeyRef.current !== undefined
    lastRestoredKeyRef.current = cacheKey

    // On switch: clear previous issue's content and reset init flags so that
    // initialText / initialAttachments can apply if there is no cached draft.
    if (isSwitch) {
      editor.commands.clearContent()
      setPendingAttachments([])
      pendingAttachmentsRef.current = []
      latestTextRef.current = ''
      latestHtmlRef.current = ''
      hasInitializedText.current = false
      hasInitializedAttachments.current = false
    }

    const cached = draftCache.get(cacheKey)
    if (!cached) {
      if (isSwitch) bumpContentVersion()
      return
    }
    if (cached.html) {
      hasInitializedText.current = true // prevent initialText from overwriting
      editor.commands.setContent(cached.html)
      editor.commands.focus('end')
      bumpContentVersion()
    }
    if (cached.attachments.length > 0) {
      hasInitializedAttachments.current = true
      setPendingAttachments(cached.attachments)
    }
  }, [editor, cacheKey, bumpContentVersion])

  // Keep a stable ref to the editor instance for use in cleanup closures.
  const editorRefForDraft = useRef(editor)
  editorRefForDraft.current = editor

  // Save draft to cache when cacheKey changes or on unmount.
  // Calls editor.getHTML() lazily here (instead of on every keystroke) to
  // avoid serialising the full ProseMirror document ~10×/sec during typing.
  //
  // Submit-aware: when a submit is in-flight (`isSubmittingRef.current`)
  // the content has already been captured and passed to onSubmit — persisting
  // it here would create a stale draft that reappears on remount.
  useEffect(() => {
    if (!cacheKey) return
    return () => {
      if (isSubmittingRef.current) return

      const text = latestTextRef.current
      const attachments = pendingAttachmentsRef.current
      if (text || attachments.length > 0) {
        const html = editorRefForDraft.current?.getHTML() ?? latestHtmlRef.current
        draftCache.set(cacheKey, { html, attachments })
      } else {
        draftCache.delete(cacheKey)
      }
    }
  }, [cacheKey])

  /* -- Initial content injection (once) -- */

  useEffect(() => {
    if (editor && initialText && !hasInitializedText.current) {
      hasInitializedText.current = true
      // Convert text to TipTap document structure:
      //   \n\n  → paragraph boundary (<p> break)
      //   \n    → hard break (<br>) within the same paragraph
      // This preserves the visual hierarchy: blank lines separate sections,
      // single newlines are line breaks inside a section.
      const html = initialText
        .split('\n\n')
        .map((p) => `<p>${p ? p.replace(/\n/g, '<br>') : '<br>'}</p>`)
        .join('')
      editor.commands.setContent(html)
      editor.commands.focus('end')
      bumpContentVersion()
    }
  }, [editor, initialText, bumpContentVersion])

  useEffect(() => {
    if (initialAttachments && initialAttachments.length > 0 && !hasInitializedAttachments.current) {
      hasInitializedAttachments.current = true
      setPendingAttachments(initialAttachments)
    }
  }, [initialAttachments])

  /* -- Submit -- */

  const submit = useCallback(async () => {
    if (!editor || isSending) return

    // Extract structured segments from the editor document
    const segments = extractEditorSegments(editor)
    const hasAttachments = pendingAttachments.length > 0
    const hasSlashMentions = segments.some((s) => s.type === 'slashMention')
    const fileMentions = segments.filter((s): s is EditorSegment & { type: 'fileMention' } => s.type === 'fileMention')
    const builtinSlashNames = Array.from(
      new Set(
        segments
          .filter((s): s is EditorSegment & { type: 'slashMention' } => s.type === 'slashMention')
          .filter((s) => s.category === 'builtin')
          .map((s) => s.name),
      ),
    )

    // Quick empty-check for the non-expansion path
    if (!hasSlashMentions && !editor.getText().trim() && !hasAttachments && fileMentions.length === 0) return

    // Lock before any async work to prevent double-submit.
    // `isSubmittingRef` is the ref-based counterpart so the draft-save
    // cleanup (which only sees refs) can skip persisting stale content
    // when the component unmounts during the async onSubmit call.
    setIsSending(true)
    isSubmittingRef.current = true

    try {
      // Filter out fileMention segments before passing to slash resolver
      const nonFileSegments = segments.filter((s) => s.type !== 'fileMention')
      // Resolve segments into structured blocks (preserving slash_command identity)
      const curProjectPath = projectPathRef.current
      const { blocks: resolvedBlocks } = await resolveSlashSegments(nonFileSegments, async (sourcePath) => {
        const result = await getAppAPI()['read-capability-source'](sourcePath, curProjectPath)
        return result.content
      })

      // Prepend context-files block if there are file mentions
      if (fileMentions.length > 0) {
        const contextPrefix = serializeContextFiles(fileMentions)
        // Prepend to the first text block, or insert a new one
        if (resolvedBlocks.length > 0 && resolvedBlocks[0].type === 'text') {
          resolvedBlocks[0].text = contextPrefix + resolvedBlocks[0].text
        } else {
          resolvedBlocks.unshift({ type: 'text', text: contextPrefix })
        }
      }

      // Extract plain text for empty-check
      const finalText = resolvedBlocks
        .map((b) => (b.type === 'text' ? b.text : b.expandedText))
        .join('')
        .trim()

      if (!finalText && !hasAttachments) return

      const content = buildStructuredContent(resolvedBlocks, pendingAttachments)

      const result = await onSubmit(content)
      if (builtinSlashNames.length > 0) {
        log.info('builtin slash pass-through dispatched', {
          commands: builtinSlashNames,
          accepted: result !== false,
        })
      }

      // Clear editor only on success.  If onSubmit explicitly returned
      // `false` the caller wants to keep the content (e.g. send failed).
      // On thrown errors the catch block runs — content is naturally
      // preserved because we never cleared it.
      if (result !== false) {
        if (!editor.isDestroyed) {
          editor.commands.clearContent()
        }
        setPendingAttachments([])
        pendingAttachmentsRef.current = []
        latestTextRef.current = ''
        latestHtmlRef.current = ''
        if (cacheKey) draftCache.delete(cacheKey)
      }
    } catch (err) {
      // Content is naturally preserved — no rollback needed because
      // we never cleared the editor before awaiting onSubmit.
      //
      // NOTE: We intentionally do NOT re-throw here.  `submit()` is a
      // fire-and-forget entry point — called from onClick handlers and
      // keyboard events that never await or catch the returned promise.
      // Re-throwing would produce unhandled promise rejections across
      // all 5 call sites (ComposeView, SessionInputBar, ChatHeroInput,
      // ReviewChatPanel, usePlainTextEditor Enter key).  Instead, we
      // log the error and let the content remain in the editor so the
      // user can retry.  Callers that need to signal controlled failure
      // should use `return false` from onSubmit, not exceptions.
      log.error('Submit failed', err)
      if (builtinSlashNames.length > 0) {
        log.warn('builtin slash pass-through failed to dispatch', {
          commands: builtinSlashNames,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    } finally {
      isSubmittingRef.current = false
      setIsSending(false)
      if (!editor.isDestroyed) {
        editor.commands.focus()
      }
    }
  }, [editor, pendingAttachments, isSending, onSubmit, cacheKey])

  // Keep the ref in sync on every render
  submitRef.current = submit

  /* -- Insert slash command at start of editor -- */

  const insertSlashCommand = useCallback(
    (item: SlashItem) => {
      if (!editor) return

      // Insert slashMention node + trailing space at the very beginning of the editor.
      // `focus('start')` places cursor at pos 1 (start of first paragraph content),
      // then `insertContent` inserts at the cursor and advances it past the new content.
      editor
        .chain()
        .focus('start')
        .insertContent(buildSlashMentionInsertContent(item))
        .focus()
        .run()
    },
    [editor],
  )

  /* -- Derived state -- */

  // hasTextContent is event-driven state (updated via editor 'update' events).
  // pendingAttachments is React state. Both are reactive → hasContent is always fresh.
  const hasContent = hasTextContent || pendingAttachments.length > 0

  return {
    editor,
    pendingAttachments,
    isSending,
    hasContent,
    isDisabled,
    isDragOver,
    slashItems: slash.allItems,
    slashLoading: slash.loading,
    insertSlashCommand,
    submit,
    addAttachments,
    removeAttachment,
    dragHandlers,
    fileInputRef,
    handleFileSelect,
  }
}
