// SPDX-License-Identifier: Apache-2.0

import { memo, useState, useCallback, useRef, useEffect } from 'react'
import { EditorContent } from '@tiptap/react'
import { Plus, ImagePlus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { processImageFile, attachmentsToIssueImages, type ImageAttachment } from '@/lib/attachmentUtils'
import { useNoteEditor } from '@/hooks/useNoteEditor'
import { NOTE_IMAGE_MAX_COUNT, type NoteContent } from '@shared/types'

// ─── Props ──────────────────────────────────────────────────────────────────

interface NoteInputProps {
  /** Called when the user confirms a new note */
  onAdd: (content: NoteContent) => void
  /** Placeholder text for the input */
  placeholder?: string
  /** Auto-focus when component mounts (empty-state hint) */
  autoFocus?: boolean
  /** Compact mode for popover usage */
  compact?: boolean
  /** Initial draft text to restore (e.g. from popover cache) */
  initialValue?: string
  /** Called whenever draft text changes so parent can cache it */
  onDraftChange?: (text: string) => void
}

// ─── Component ──────────────────────────────────────────────────────────────

export const NoteInput = memo(function NoteInput({
  onAdd,
  placeholder = 'Add a note\u2026',
  autoFocus = false,
  compact = false,
  initialValue = '',
  onDraftChange,
}: NoteInputProps): React.JSX.Element {
  const [isActive, setIsActive] = useState(() => !!initialValue)
  const [pendingImages, setPendingImages] = useState<ImageAttachment[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  /** Guard: when true, blur should not submit (e.g. clicking the attach button) */
  const suppressBlurRef = useRef(false)

  // ── Image helpers (must be declared before handlePasteFiles) ──

  const addImages = useCallback(async (files: File[]) => {
    for (const file of files) {
      try {
        const processed = await processImageFile(file)
        setPendingImages((prev) => {
          if (prev.length >= NOTE_IMAGE_MAX_COUNT) return prev
          return [...prev, processed]
        })
      } catch {
        // silently skip invalid files
      }
    }
  }, [])

  const removeImage = useCallback((id: string) => {
    setPendingImages((prev) => prev.filter((img) => img.id !== id))
  }, [])

  // ── TipTap editor with slash command support ──

  const handleSubmit = useCallback(() => {
    submitRef.current?.()
  }, [])

  const handlePasteFiles = useCallback(
    (files: File[]) => addImages(files),
    [addImages],
  )

  const noteEditor = useNoteEditor({
    placeholder,
    initialContent: initialValue || undefined,
    onSubmit: handleSubmit,
    onPasteFiles: handlePasteFiles,
    editable: isActive,
  })

  // ── Submit ref (break circular dependency: submit uses noteEditor, noteEditor needs onSubmit) ──
  const submitRef = useRef<() => void>(() => {})

  /** Build NoteContent from current editor state + pending images. */
  const buildNoteContent = useCallback((): NoteContent | null => {
    const text = noteEditor.getText()
    if (!text && pendingImages.length === 0) return null
    const images = pendingImages.length > 0 ? attachmentsToIssueImages(pendingImages) : undefined
    const richContent = noteEditor.getJson() || undefined
    return { text, richContent, images }
  }, [noteEditor.getText, noteEditor.getJson, pendingImages])

  useEffect(() => {
    submitRef.current = () => {
      const content = buildNoteContent()
      if (!content) return
      onAdd(content)
      noteEditor.clear()
      setPendingImages([])
      onDraftChange?.('')
      // Keep active for continuous input
      requestAnimationFrame(() => noteEditor.focus())
    }
  }, [buildNoteContent, onAdd, noteEditor.clear, noteEditor.focus, onDraftChange])

  // ── Draft change tracking ──
  useEffect(() => {
    const { editor } = noteEditor
    if (!editor || !onDraftChange) return
    const sync = (): void => {
      onDraftChange(editor.getText().trim())
    }
    editor.on('update', sync)
    return () => { editor.off('update', sync) }
  }, [noteEditor.editor, onDraftChange])

  // Auto-focus after activation
  useEffect(() => {
    if (autoFocus && !isActive) {
      setIsActive(true)
    }
  }, [autoFocus, isActive])

  useEffect(() => {
    if (isActive) {
      requestAnimationFrame(() => noteEditor.focus())
    }
  }, [isActive, noteEditor.focus])

  const handleActivate = useCallback(() => {
    setIsActive(true)
  }, [])

  // ── Blur handling ──

  const handleBlur = useCallback(() => {
    if (suppressBlurRef.current) {
      suppressBlurRef.current = false
      return
    }
    const content = buildNoteContent()
    if (content) {
      onAdd(content)
      noteEditor.clear()
      setPendingImages([])
      onDraftChange?.('')
    }
    setIsActive(false)
  }, [buildNoteContent, onAdd, noteEditor.clear, onDraftChange])

  // ── Escape key handling ──

  useEffect(() => {
    const { editor } = noteEditor
    if (!editor || !isActive) return

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        noteEditor.clear()
        setPendingImages([])
        onDraftChange?.('')
        setIsActive(false)
      }
    }

    const dom = editor.view.dom
    dom.addEventListener('keydown', handleKeyDown)
    return () => dom.removeEventListener('keydown', handleKeyDown)
  }, [noteEditor.editor, isActive, onDraftChange, noteEditor.clear])

  // ── Drag & drop ──

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    if (e.dataTransfer.types.includes('Files')) setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragOver(false)
      const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'))
      if (files.length > 0) addImages(files)
    },
    [addImages],
  )

  // ── File picker ──

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? [])
      if (files.length > 0) addImages(files)
      e.target.value = '' // reset so same file can be selected again
    },
    [addImages],
  )

  // ── Inactive: dashed placeholder button ──
  if (!isActive) {
    return (
      <button
        onClick={handleActivate}
        className={cn(
          'w-full flex items-center gap-1.5 rounded-lg border-2 border-dashed',
          'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]',
          'hover:border-[hsl(var(--primary)/0.4)] hover:text-[hsl(var(--foreground))]',
          'transition-colors cursor-text',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
          compact ? 'px-2 py-1.5 text-[11px]' : 'px-3 py-2.5 text-xs',
        )}
        aria-label="Add a new note"
      >
        <Plus className={cn('shrink-0', compact ? 'w-3 h-3' : 'w-3.5 h-3.5')} aria-hidden="true" />
        <span>{placeholder}</span>
      </button>
    )
  }

  // ── Active: TipTap editor with image support ──
  return (
    <div
      className={cn(
        'rounded-lg border-2 bg-[hsl(var(--background))] transition-colors',
        isDragOver
          ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.04)]'
          : 'border-[hsl(var(--ring))]',
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* TipTap editor (replaces textarea) */}
      <div
        className={cn(
          'w-full [&_.plain-text-editor]:outline-none [&_.plain-text-editor]:min-h-[1.5em]',
          'text-[hsl(var(--foreground))]',
          compact ? 'px-2 py-1.5 text-[11px] leading-relaxed' : 'px-3 py-2 text-xs leading-relaxed',
        )}
        onBlur={(e) => {
          // Only handle blur if focus left the entire NoteInput container
          if (e.currentTarget.contains(e.relatedTarget as Node)) return
          handleBlur()
        }}
      >
        <EditorContent editor={noteEditor.editor} />
      </div>

      {/* Image previews */}
      {pendingImages.length > 0 && (
        <div className={cn('flex gap-1.5 pt-2 overflow-x-auto', compact ? 'px-2 pb-1' : 'px-3 pb-1.5')}>
          {pendingImages.map((img) => (
            <div key={img.id} className="relative group shrink-0">
              <img
                src={img.dataUrl}
                alt=""
                className={cn(
                  'rounded border border-[hsl(var(--border))] object-cover',
                  compact ? 'h-8 w-8' : 'h-10 w-10',
                )}
              />
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  suppressBlurRef.current = true
                }}
                onClick={() => removeImage(img.id)}
                className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label="Remove image"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Bottom hint bar with attach button */}
      <div
        className={cn(
          'flex items-center gap-1.5 border-t border-[hsl(var(--border)/0.5)]',
          compact ? 'px-2 py-1' : 'px-3 py-1.5',
        )}
      >
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault()
            suppressBlurRef.current = true
          }}
          onClick={() => {
            fileInputRef.current?.click()
            requestAnimationFrame(() => noteEditor.focus())
          }}
          disabled={pendingImages.length >= NOTE_IMAGE_MAX_COUNT}
          className={cn(
            'p-0.5 rounded transition-colors',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]',
            pendingImages.length >= NOTE_IMAGE_MAX_COUNT
              ? 'text-[hsl(var(--muted-foreground)/0.3)] cursor-not-allowed'
              : 'text-[hsl(var(--muted-foreground)/0.6)] hover:text-[hsl(var(--foreground))]',
          )}
          aria-label="Attach image"
        >
          <ImagePlus className={cn(compact ? 'w-3 h-3' : 'w-3.5 h-3.5')} />
        </button>
        <span className="text-[10px] text-[hsl(var(--muted-foreground)/0.5)]">
          Enter to save &middot; Shift+Enter newline &middot; Esc cancel
        </span>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        className="hidden"
        onChange={handleFileSelect}
      />
    </div>
  )
})
