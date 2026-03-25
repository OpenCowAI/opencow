// SPDX-License-Identifier: Apache-2.0

import { memo, useState, useCallback, useRef, useEffect } from 'react'
import { EditorContent } from '@tiptap/react'
import { Trash2, Send, Check, X, ImagePlus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { processImageFile, issueImagesToAttachments, attachmentsToIssueImages, type ImageAttachment } from '@/lib/attachmentUtils'
import { useNoteEditor } from '@/hooks/useNoteEditor'
import { ImageThumbnail } from '../../ImageThumbnail'
import { ImageLightbox } from '../../ImageLightbox'
import { NOTE_IMAGE_MAX_COUNT, type SessionNote, type NoteContent } from '@shared/types'

// ─── Props ──────────────────────────────────────────────────────────────────

interface NoteItemProps {
  note: SessionNote
  /** Whether the item is selected (batch mode) */
  isSelected: boolean
  /** Whether batch-select mode is active */
  isBatchMode: boolean
  onUpdate: (id: string, content: NoteContent) => void
  onDelete: (id: string) => void
  onSendToChat: (id: string) => void
  onToggleSelect: (id: string) => void
  /** Enter batch mode (triggered by Ctrl/Cmd+Click) */
  onEnterBatchMode: () => void
  /** Compact mode (for popover) */
  compact?: boolean
}

// ─── Sub-component: Edit mode (uses TipTap editor) ─────────────────────────

interface NoteEditModeProps {
  note: SessionNote
  compact: boolean
  onConfirm: (content: NoteContent) => void
  onCancel: () => void
  onDelete: () => void
}

const NoteEditMode = memo(function NoteEditMode({
  note,
  compact,
  onConfirm,
  onCancel,
  onDelete,
}: NoteEditModeProps): React.JSX.Element {
  const noteImages = note.content.images ?? []
  const [editImages, setEditImages] = useState<ImageAttachment[]>(
    () => issueImagesToAttachments(noteImages)
  )
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Submit ref (break circular dep) ──
  const confirmRef = useRef<() => void>(() => {})
  const handleSubmit = useCallback(() => confirmRef.current(), [])

  // ── TipTap editor — restore from richContent (lossless) or text (plain text) ──
  const noteEditor = useNoteEditor({
    placeholder: 'Edit note\u2026',
    initialContent: note.content.richContent ?? note.content.text,
    onSubmit: handleSubmit,
    onPasteFiles: (files) => addEditImages(files),
  })

  // Wire up confirm logic
  useEffect(() => {
    confirmRef.current = () => {
      const text = noteEditor.getText()
      const images = attachmentsToIssueImages(editImages)
      if (!text && images.length === 0) {
        onDelete()
        return
      }
      const richContent = noteEditor.getJson() || undefined
      onConfirm({
        text,
        richContent,
        images: images.length > 0 ? images : undefined,
      })
    }
  }, [noteEditor.getText, noteEditor.getJson, editImages, onConfirm, onDelete])

  // Focus editor on mount — cursor at end for editing existing content
  useEffect(() => {
    requestAnimationFrame(() => noteEditor.focus('end'))
  }, [noteEditor.focus])

  // ── Escape key ──
  useEffect(() => {
    const { editor } = noteEditor
    if (!editor) return
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    }
    const dom = editor.view.dom
    dom.addEventListener('keydown', handleKeyDown)
    return () => dom.removeEventListener('keydown', handleKeyDown)
  }, [noteEditor.editor, onCancel])

  // ── Image helpers ──

  const addEditImages = useCallback(async (files: File[]) => {
    for (const file of files) {
      try {
        const processed = await processImageFile(file)
        setEditImages((prev) => {
          if (prev.length >= NOTE_IMAGE_MAX_COUNT) return prev
          return [...prev, processed]
        })
      } catch {
        // silently skip
      }
    }
  }, [])

  const removeEditImage = useCallback((id: string) => {
    setEditImages((prev) => prev.filter((img) => img.id !== id))
  }, [])

  const handleEditFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? [])
      if (files.length > 0) addEditImages(files)
      e.target.value = ''
    },
    [addEditImages],
  )

  return (
    <>
      {/* TipTap editor (replaces textarea) */}
      <div
        className={cn(
          'w-full [&_.plain-text-editor]:outline-none [&_.plain-text-editor]:min-h-[1.5em]',
          'text-[hsl(var(--foreground))] leading-relaxed',
          compact ? 'text-xs' : 'text-sm',
        )}
        onBlur={(e) => {
          // Only handle blur if focus left the entire edit container
          if (e.currentTarget.contains(e.relatedTarget as Node)) return
          confirmRef.current()
        }}
      >
        <EditorContent editor={noteEditor.editor} />
      </div>

      {/* Edit-mode image previews */}
      {editImages.length > 0 && (
        <div className="flex gap-1.5 mt-1.5 pt-2 overflow-x-auto">
          {editImages.map((img) => (
            <div key={img.id} className="relative group/img shrink-0">
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
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => removeEditImage(img.id)}
                className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))] flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-opacity"
                aria-label="Remove image"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-1 mt-1.5">
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => confirmRef.current()}
          className="p-0.5 rounded text-green-500 hover:bg-[hsl(var(--foreground)/0.04)] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]"
          aria-label="Confirm edit"
        >
          <Check className="w-3 h-3" />
        </button>
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={onCancel}
          className="p-0.5 rounded text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]"
          aria-label="Cancel edit"
        >
          <X className="w-3 h-3" />
        </button>
        {editImages.length < NOTE_IMAGE_MAX_COUNT && (
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => fileInputRef.current?.click()}
            className="p-0.5 rounded text-[hsl(var(--muted-foreground)/0.6)] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]"
            aria-label="Attach image"
          >
            <ImagePlus className="w-3 h-3" />
          </button>
        )}
        <span className="text-[10px] text-[hsl(var(--muted-foreground)/0.5)] ml-auto">
          Enter to save &middot; Esc cancel
        </span>
      </div>

      {/* Hidden file input for edit mode */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        className="hidden"
        onChange={handleEditFileSelect}
      />
    </>
  )
})

// ─── Main Component ─────────────────────────────────────────────────────────

/**
 * A single note row following the IssueRow flat-row pattern.
 * Each row has rounded corners and a subtle hover highlight.
 * Click to inline-edit; Ctrl/Cmd+Click enters batch mode.
 *
 * Uses a **single wrapper div** for both display and edit states so that
 * ring / background / padding transitions are smooth (no DOM swap).
 */
export const NoteItem = memo(function NoteItem({
  note,
  isSelected,
  isBatchMode,
  onUpdate,
  onDelete,
  onSendToChat,
  onToggleSelect,
  onEnterBatchMode,
  compact = false,
}: NoteItemProps): React.JSX.Element {
  const [isEditing, setIsEditing] = useState(false)
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null)

  const noteImages = note.content.images ?? []

  // ── Edit lifecycle ──

  const startEdit = useCallback(() => {
    if (isBatchMode) return
    setIsEditing(true)
  }, [isBatchMode])

  const handleConfirmEdit = useCallback(
    (content: NoteContent) => {
      const textChanged = content.text !== note.content.text
      const imagesChanged = JSON.stringify(content.images ?? []) !== JSON.stringify(noteImages)
      const richContentChanged = (content.richContent ?? '') !== (note.content.richContent ?? '')
      if (textChanged || imagesChanged || richContentChanged) {
        onUpdate(note.id, content)
      }
      setIsEditing(false)
    },
    [note.id, note.content, noteImages, onUpdate],
  )

  const handleCancelEdit = useCallback(() => {
    setIsEditing(false)
  }, [])

  const handleDeleteFromEdit = useCallback(() => {
    onDelete(note.id)
  }, [note.id, onDelete])

  // ── Click handling ──

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      // Ctrl/Cmd+Click → batch mode
      if (e.ctrlKey || e.metaKey) {
        if (!isBatchMode) onEnterBatchMode()
        onToggleSelect(note.id)
        return
      }
      // In batch mode → toggle selection
      if (isBatchMode) {
        onToggleSelect(note.id)
        return
      }
      // Normal click → enter edit
      startEdit()
    },
    [isBatchMode, note.id, onEnterBatchMode, onToggleSelect, startEdit],
  )

  // Source file label
  const sourceLabel = note.sourceFilePath
    ? note.sourceFilePath.split('/').pop()
    : null

  // Build data URIs for display-mode thumbnails
  const displayImageUris = noteImages.map(
    (img) => `data:${img.mediaType};base64,${img.data}`,
  )

  // ── Single wrapper — ring/bg/padding animate smoothly between states ──
  return (
    <>
      <div
        onClick={isEditing ? undefined : handleClick}
        className={cn(
          'group w-full rounded-lg transition-all duration-150 ease-out',
          compact ? 'px-2.5 py-2' : 'px-3 py-2.5',
          isEditing
            ? 'ring-1 ring-[hsl(var(--ring))] bg-[hsl(var(--background))]'
            : isSelected
              ? 'bg-[hsl(var(--primary)/0.08)] cursor-pointer'
              : 'hover:bg-[hsl(var(--foreground)/0.04)] cursor-pointer',
        )}
        role="listitem"
        tabIndex={0}
        aria-label={`Note: ${note.content.text.slice(0, 50)}`}
        aria-selected={isBatchMode ? isSelected : undefined}
      >
        {isEditing ? (
          /* ── Edit mode (TipTap sub-component) ── */
          <NoteEditMode
            note={note}
            compact={compact}
            onConfirm={handleConfirmEdit}
            onCancel={handleCancelEdit}
            onDelete={handleDeleteFromEdit}
          />
        ) : (
          /* ── Display mode ── */
          <div className="flex items-start gap-2">
            {/* Batch checkbox */}
            {isBatchMode && (
              <button
                onClick={(e) => { e.stopPropagation(); onToggleSelect(note.id) }}
                className={cn(
                  'shrink-0 w-4 h-4 mt-0.5 rounded border-2 flex items-center justify-center transition-colors',
                  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]',
                  isSelected
                    ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]'
                    : 'border-[hsl(var(--muted-foreground)/0.4)]',
                )}
                aria-label={isSelected ? 'Deselect note' : 'Select note'}
                aria-checked={isSelected}
                role="checkbox"
              >
                {isSelected && <Check className="w-2.5 h-2.5" aria-hidden="true" />}
              </button>
            )}

            {/* Content + images + source label (vertical stack) */}
            <div className="flex-1 min-w-0 flex flex-col gap-1">
              {/* Content — truncated to 2 lines */}
              {note.content.text && (
                <span
                  className={cn(
                    'text-[hsl(var(--foreground))] line-clamp-2',
                    compact ? 'text-xs leading-relaxed' : 'text-sm leading-relaxed',
                  )}
                >
                  {note.content.text}
                </span>
              )}

              {/* Image thumbnails */}
              {noteImages.length > 0 && (
                <div className="flex gap-1 mt-0.5">
                  {noteImages.map((img, i) => (
                    <ImageThumbnail
                      key={img.id}
                      src={displayImageUris[i]}
                      alt={`Note image ${i + 1}`}
                      onClick={() => setLightboxIdx(i)}
                    />
                  ))}
                </div>
              )}

              {/* Source file badge — below content */}
              {sourceLabel && (
                <span className="self-start px-1.5 py-px rounded-full bg-[hsl(var(--muted))] text-[10px] text-[hsl(var(--muted-foreground))] truncate max-w-full">
                  {sourceLabel}
                </span>
              )}
            </div>

            {/* Hover actions (hidden in batch mode) */}
            {!isBatchMode && (
              <div className="shrink-0 mt-0.5 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                <button
                  onClick={(e) => { e.stopPropagation(); onSendToChat(note.id) }}
                  className="p-1 rounded text-[hsl(var(--primary))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]"
                  aria-label="Send this note to chat"
                >
                  <Send className={cn(compact ? 'w-3 h-3' : 'w-3.5 h-3.5')} aria-hidden="true" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(note.id) }}
                  className="p-1 rounded text-[hsl(var(--muted-foreground))] hover:text-red-500 hover:bg-[hsl(var(--foreground)/0.04)] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]"
                  aria-label="Delete note"
                >
                  <Trash2 className={cn(compact ? 'w-3 h-3' : 'w-3.5 h-3.5')} aria-hidden="true" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Lightbox overlay */}
      {lightboxIdx !== null && displayImageUris[lightboxIdx] && (
        <ImageLightbox
          src={displayImageUris[lightboxIdx]}
          alt={`Note image ${lightboxIdx + 1}`}
          onClose={() => setLightboxIdx(null)}
        />
      )}
    </>
  )
})
