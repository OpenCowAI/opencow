// SPDX-License-Identifier: Apache-2.0

import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { EditorContent } from '@tiptap/react'
import { Pencil, X, Check, Loader2, GripVertical } from 'lucide-react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragOverlay,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { QueuedMessage, QueueDispatchContext } from '../../../hooks/useMessageQueue'
import type { UserMessageContent } from '@shared/types'
import { getSlashDisplayLabel } from '@shared/slashDisplay'
import { truncate } from '@shared/unicode'
import {
  extractContextFilesFromContent,
  type ParsedContextFile,
} from '@/lib/contextFilesParsing'
import { ContextFileChips } from '@/components/ui/ContextFileChips'
import { usePlainTextEditor } from '@/hooks/usePlainTextEditor'
import {
  contentToEditorDoc,
  editorDocToContent,
} from '@/lib/editorContentBridge'
import { cn } from '@/lib/utils'

/**
 * Drag handle props derived from useSortable return type.
 * Avoids importing internal @dnd-kit types (e.g. SyntheticListenerMap from
 * dist/hooks/utilities) that break on package updates.
 */
type SortableHandleProps = Pick<ReturnType<typeof useSortable>, 'attributes' | 'listeners'>

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Parsed preview of a queued message's content */
interface QueuedMessagePreview {
  /** Slash command display labels (e.g. ['review-pr', 'deploy']) — rendered as styled badges */
  slashCommands: string[]
  /** Parsed context file references */
  contextFiles: ParsedContextFile[]
  /** Text preview with context-files block and slash commands stripped */
  text: string
  /** Number of image attachments */
  imageCount: number
}

/**
 * Extract a rich preview from UserMessageContent.
 *
 * Separates slash commands, context files, text, and image counts so that
 * each can be rendered with its own visual treatment in the correct order:
 * slash command badges → context file chips → text → image count badge.
 */
function getMessagePreview(content: UserMessageContent, maxLen = 120): QueuedMessagePreview {
  const { files, cleanedTextParts } = extractContextFilesFromContent(content)

  const slashCommands: string[] = []
  if (typeof content !== 'string') {
    for (const b of content) {
      if (b.type === 'slash_command') slashCommands.push(getSlashDisplayLabel(b))
    }
  }

  const text = truncate(cleanedTextParts.join(' ').trim(), { max: maxLen })
  const imageCount = typeof content === 'string'
    ? 0
    : content.filter((b) => b.type === 'image').length

  return { slashCommands, contextFiles: files, text, imageCount }
}

/* ------------------------------------------------------------------ */
/*  QueueItemEditor — TipTap-based inline editor for queue items       */
/* ------------------------------------------------------------------ */

interface QueueItemEditorProps {
  content: UserMessageContent
  onConfirm: (newContent: UserMessageContent) => void
  onCancel: () => void
}

/**
 * Inline rich-text editor for editing a queued message.
 *
 * Uses the same TipTap editor as the main input bar so that slash commands
 * and file mentions appear as inline atomic nodes — identical to the
 * original input experience.
 *
 * Rendered as a separate component so the TipTap editor instance is
 * created on mount (when edit mode starts) and destroyed on unmount
 * (when edit mode ends).
 */
function QueueItemEditor({ content, onConfirm, onCancel }: QueueItemEditorProps): React.JSX.Element {
  const { t } = useTranslation('sessions')

  // Convert queued content to TipTap document JSON + metadata
  const { doc, metadata } = useMemo(() => contentToEditorDoc(content), [content])

  // Ref to break circular dependency: editor creation needs onEnter → confirm,
  // but confirm needs editor. Matches useMessageComposer's submitRef pattern.
  const confirmRef = useRef<() => void>(() => {})

  // Create a lightweight TipTap editor (no suggestion popups — editing only)
  const editor = usePlainTextEditor({
    initialContent: doc,
    editable: true,
    placeholder: t('queuedMessages.editPlaceholder', { defaultValue: 'Edit message...' }),
    onEnter: () => confirmRef.current(),
  })

  const handleConfirm = useCallback(() => {
    if (!editor) return

    const isEmpty = !editor.getText().trim()
    if (isEmpty && metadata.mediaBlocks.length === 0) {
      // Everything cleared → treat as cancel/remove
      onConfirm('')
      return
    }

    const newContent = editorDocToContent(editor, metadata)
    onConfirm(newContent)
  }, [editor, metadata, onConfirm])

  // Keep ref in sync every render
  confirmRef.current = handleConfirm

  // Auto-focus with cursor at end when editor is ready
  useEffect(() => {
    if (editor) {
      editor.commands.focus('end')
    }
  }, [editor])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    },
    [onCancel],
  )

  return (
    <div className="flex flex-col gap-1">
      {/* TipTap editor — same inline node rendering as the main input */}
      <div
        className="queue-item-editor"
        role="textbox"
        aria-label={t('queuedMessages.editMessageAria', { defaultValue: 'Edit queued message' })}
        onKeyDown={handleKeyDown}
      >
        <EditorContent editor={editor} />
      </div>

      {/* Media block indicator (images/documents can't be edited in TipTap) */}
      {metadata.mediaBlocks.length > 0 && (
        <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
          {t('queuedMessages.mediaPreserved', {
            count: metadata.mediaBlocks.length,
            defaultValue: '{{count}} attachment(s) preserved',
          })}
        </span>
      )}

      {/* Confirm / Cancel buttons */}
      <div className="flex items-center gap-1 justify-end">
        <button
          onClick={handleConfirm}
          className="p-0.5 rounded text-green-500 hover:bg-[hsl(var(--foreground)/0.04)] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]"
          aria-label={t('queuedMessages.confirmEdit')}
        >
          <Check className="w-3 h-3" />
        </button>
        <button
          onClick={onCancel}
          className="p-0.5 rounded text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]"
          aria-label={t('queuedMessages.cancelEdit')}
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  QueuedMessageItem — inner content (used by both DnD and non-DnD)   */
/* ------------------------------------------------------------------ */

interface QueuedMessageItemProps {
  message: QueuedMessage
  index: number
  onEdit: (id: string, content: UserMessageContent) => void
  onCancel: (id: string) => void
  disabled: boolean
  /**
   * Drag handle props from useSortable.
   * Presence controls handle visibility — no separate boolean needed.
   */
  dragHandleProps?: SortableHandleProps
  /** Whether this specific item is actively being dispatched (sequential mode). */
  isActivelyDispatching?: boolean
}

function QueuedMessageItem({
  message,
  index,
  onEdit,
  onCancel,
  disabled,
  dragHandleProps,
  isActivelyDispatching,
}: QueuedMessageItemProps): React.JSX.Element {
  const { t } = useTranslation('sessions')
  const [isEditing, setIsEditing] = useState(false)

  const handleConfirm = useCallback(
    (newContent: UserMessageContent) => {
      if (newContent === '' || (typeof newContent === 'string' && !newContent.trim())) {
        // Empty content → remove the message
        onCancel(message.id)
      } else {
        onEdit(message.id, newContent)
      }
      setIsEditing(false)
    },
    [message.id, onEdit, onCancel],
  )

  const handleCancelEdit = useCallback(() => {
    setIsEditing(false)
  }, [])

  const preview = useMemo(() => getMessagePreview(message.content), [message.content])

  return (
    <div
      className={cn(
        'group flex items-start gap-2 px-2.5 py-1.5 rounded-lg border',
        isActivelyDispatching
          ? 'bg-orange-500/[0.03] border-orange-400/30'
          : 'bg-[hsl(var(--background)/0.5)] border-[hsl(var(--border)/0.5)]'
      )}
      role="listitem"
      aria-label={t('queuedMessages.messageAria', { index: index + 1 })}
    >
      {/* Drag handle — visible when dragHandleProps is provided (sortable context) */}
      {dragHandleProps && (
        <button
          className={cn(
            'shrink-0 mt-px p-0.5 rounded cursor-grab text-[hsl(var(--muted-foreground))]',
            'hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]',
            disabled && 'opacity-30 cursor-not-allowed'
          )}
          aria-label={t('queuedMessages.reorderAria')}
          {...dragHandleProps.attributes}
          {...dragHandleProps.listeners}
        >
          <GripVertical className="w-3 h-3" />
        </button>
      )}

      {/* Index badge — replaced by spinner when this item is actively dispatching */}
      {isActivelyDispatching ? (
        <Loader2
          className="shrink-0 mt-px w-4 h-4 text-orange-400 motion-safe:animate-spin"
          aria-hidden="true"
        />
      ) : (
        <span
          className="shrink-0 mt-px flex items-center justify-center w-4 h-4 rounded-full bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] text-[10px] font-medium"
          aria-hidden="true"
        >
          {index + 1}
        </span>
      )}

      {/* Content area */}
      <div className="flex-1 min-w-0">
        {isEditing ? (
          <QueueItemEditor
            content={message.content}
            onConfirm={handleConfirm}
            onCancel={handleCancelEdit}
          />
        ) : (
          <div className="flex items-center gap-1 flex-wrap">
            {/* Slash command badges — first position, matching editor inline styling */}
            {preview.slashCommands.map((name) => (
              <span
                key={`slash-${name}`}
                className="shrink-0 inline-flex items-center px-1 py-px text-[10px] font-medium bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))] border border-[hsl(var(--border))] rounded"
              >
                /{name}
              </span>
            ))}
            {/* Context file chips — rendered inline like in the session message list */}
            {preview.contextFiles.length > 0 && (
              <ContextFileChips files={preview.contextFiles} variant="compact" />
            )}
            {preview.text && (
              <span className="text-xs text-[hsl(var(--foreground)/0.9)] truncate">
                {preview.text}
              </span>
            )}
            {!preview.text && preview.slashCommands.length === 0 && preview.contextFiles.length === 0 && (
              <span className="text-xs text-[hsl(var(--foreground)/0.9)] truncate">
                {t('queuedMessages.empty')}
              </span>
            )}
            {preview.imageCount > 0 && (
              <span className="shrink-0 text-[10px] text-[hsl(var(--muted-foreground))] bg-[hsl(var(--muted))] px-1 py-px rounded">
                {t('queuedMessages.imageCount', { count: preview.imageCount })}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Action buttons — hidden during edit or dispatching */}
      {!isEditing && (
        <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <button
            onClick={() => setIsEditing(true)}
            disabled={disabled}
            className="p-0.5 rounded text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))] disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label={t('queuedMessages.editMessage')}
          >
            <Pencil className="w-3 h-3" />
          </button>
          <button
            onClick={() => onCancel(message.id)}
            disabled={disabled}
            className="p-0.5 rounded text-[hsl(var(--muted-foreground))] hover:text-red-500 hover:bg-[hsl(var(--foreground)/0.04)] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))] disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label={t('queuedMessages.cancelMessage')}
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  SortableQueueItem — drag-and-drop wrapper for QueuedMessageItem    */
/* ------------------------------------------------------------------ */

interface SortableQueueItemProps {
  message: QueuedMessage
  index: number
  onEdit: (id: string, content: UserMessageContent) => void
  onCancel: (id: string) => void
  disabled: boolean
  isActivelyDispatching?: boolean
}

function SortableQueueItem({ message, index, onEdit, onCancel, disabled, isActivelyDispatching }: SortableQueueItemProps): React.JSX.Element {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: message.id, disabled })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  return (
    <div ref={setNodeRef} style={style}>
      <QueuedMessageItem
        message={message}
        index={index}
        onEdit={onEdit}
        onCancel={onCancel}
        disabled={disabled}
        dragHandleProps={{ attributes, listeners }}
        isActivelyDispatching={isActivelyDispatching}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  DragOverlay — floating preview shown while dragging                */
/* ------------------------------------------------------------------ */

function QueueDragOverlay({ message }: { message: QueuedMessage }): React.JSX.Element {
  const preview = useMemo(() => getMessagePreview(message.content, 60), [message.content])
  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[hsl(var(--card))] shadow-md border border-[hsl(var(--border))] text-[hsl(var(--foreground))]">
      <GripVertical className="w-3 h-3 text-[hsl(var(--muted-foreground))] shrink-0" />
      <span className="text-xs truncate max-w-[200px]">
        {preview.text || preview.slashCommands.map((n) => `/${n}`).join(' ') || '(message)'}
      </span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Mode Toggle — segmented button for Batch / Sequential              */
/* ------------------------------------------------------------------ */

interface ModeToggleProps {
  mode: QueueDispatchContext['mode']
  onChange: QueueDispatchContext['onModeChange']
  disabled: boolean
}

function ModeToggle({ mode, onChange, disabled }: ModeToggleProps): React.JSX.Element {
  const { t } = useTranslation('sessions')
  return (
    <div
      className="flex items-center h-5 rounded-md bg-[hsl(var(--muted)/0.5)] p-0.5"
      role="radiogroup"
      aria-label={t('queuedMessages.dispatchModeAria')}
    >
      <button
        role="radio"
        aria-checked={mode === 'batch'}
        disabled={disabled}
        onClick={() => onChange('batch')}
        className={cn(
          'px-1.5 h-4 text-[10px] font-medium rounded transition-colors',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]',
          mode === 'batch'
            ? 'bg-[hsl(var(--background))] text-[hsl(var(--foreground))] shadow-sm'
            : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground)/0.8)]',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
      >
        {t('queuedMessages.modeBatch')}
      </button>
      <button
        role="radio"
        aria-checked={mode === 'sequential'}
        disabled={disabled}
        onClick={() => onChange('sequential')}
        className={cn(
          'px-1.5 h-4 text-[10px] font-medium rounded transition-colors',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]',
          mode === 'sequential'
            ? 'bg-[hsl(var(--background))] text-[hsl(var(--foreground))] shadow-sm'
            : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground)/0.8)]',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
      >
        {t('queuedMessages.modeSequential')}
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  QueuedMessageList                                                  */
/* ------------------------------------------------------------------ */

interface QueuedMessageListProps {
  queue: QueuedMessage[]
  /** Dispatch state and mode control — zero-mapping passthrough from hook. */
  dispatch: QueueDispatchContext
  onEdit: (id: string, content: UserMessageContent) => void
  onCancel: (id: string) => void
  /** Reorder queue items via drag-and-drop IDs (sequential mode only). */
  onReorder: (activeId: string, overId: string) => void
}

export function QueuedMessageList({
  queue,
  dispatch,
  onEdit,
  onCancel,
  onReorder,
}: QueuedMessageListProps): React.JSX.Element {
  const { t } = useTranslation('sessions')
  const { mode, phase, onModeChange } = dispatch

  const isSequential = mode === 'sequential'
  // Only the 'sending' phase represents an in-flight IPC — during 'awaiting_agent'
  // the dispatched message has already been removed from the queue, so remaining
  // items should be fully interactive (edit, delete, reorder).
  const isSending = phase === 'sending'
  const showDnD = isSequential && queue.length > 1

  // ── DnD state ──
  const [dragActiveMessage, setDragActiveMessage] = useState<QueuedMessage | null>(null)
  const sortableIds = useMemo(() => queue.map((m) => m.id), [queue])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  )

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const msg = queue.find((m) => m.id === event.active.id)
      setDragActiveMessage(msg ?? null)
    },
    [queue],
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDragActiveMessage(null)
      const { active, over } = event
      if (!over || active.id === over.id) return
      onReorder(String(active.id), String(over.id))
    },
    [onReorder],
  )

  const handleDragCancel = useCallback(() => setDragActiveMessage(null), [])

  // ── Header status text ──
  const statusText = (() => {
    if (phase === 'idle' || phase === 'awaiting_agent') {
      return t('queuedMessages.queued', { count: queue.length })
    }
    // phase === 'sending'
    return isSequential
      ? t('queuedMessages.sendingItem', { index: 1 })
      : t('queuedMessages.sending')
  })()

  return (
    <div className="shrink-0 bg-[hsl(var(--card))]">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 py-1">
        {isSending ? (
          <Loader2
            className="w-3 h-3 text-orange-400 motion-safe:animate-spin"
            aria-hidden="true"
          />
        ) : (
          <span
            className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"
            aria-hidden="true"
          />
        )}
        <span className="text-[10px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider">
          {statusText}
        </span>

        <div className="flex-1" />

        {/* Mode toggle — only show when 2+ messages (meaningful choice) */}
        {queue.length >= 2 && (
          <ModeToggle
            mode={mode}
            onChange={onModeChange}
            disabled={isSending}
          />
        )}
      </div>

      {/* Message list — single container, conditionally wrapped with DnD context */}
      {(() => {
        const list = (
          <div
            className="flex flex-col gap-1 px-2.5 pb-1.5 max-h-32 overflow-y-auto"
            role="list"
            aria-label={t('queuedMessages.queueListAria')}
          >
            {queue.map((msg, i) => {
              // Per-item disabled:
              //   - Sequential 'sending': only msg[0] is in-flight, rest are editable
              //   - Batch 'sending': all messages are in the merged payload, all locked
              //   - 'awaiting_agent': dispatched msg already removed from queue, all unlocked
              //   - 'idle': all unlocked
              const isItemDispatching = isSending && (isSequential ? i === 0 : true)
              return showDnD ? (
                <SortableQueueItem
                  key={msg.id}
                  message={msg}
                  index={i}
                  onEdit={onEdit}
                  onCancel={onCancel}
                  disabled={isItemDispatching}
                  isActivelyDispatching={isItemDispatching}
                />
              ) : (
                <QueuedMessageItem
                  key={msg.id}
                  message={msg}
                  index={i}
                  onEdit={onEdit}
                  onCancel={onCancel}
                  disabled={isItemDispatching}
                  isActivelyDispatching={isItemDispatching}
                />
              )
            })}
          </div>
        )

        return showDnD ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
              {list}
            </SortableContext>
            <DragOverlay dropAnimation={{ duration: 200, easing: 'ease' }}>
              {dragActiveMessage ? <QueueDragOverlay message={dragActiveMessage} /> : null}
            </DragOverlay>
          </DndContext>
        ) : list
      })()}
    </div>
  )
}
