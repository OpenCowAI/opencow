// SPDX-License-Identifier: Apache-2.0

import { useState, useCallback, useRef, useEffect, useImperativeHandle, forwardRef, memo } from 'react'
import { useTranslation } from 'react-i18next'
import { EditorContent } from '@tiptap/react'
import { AlignLeft, AtSign, CornerDownLeft, Paperclip, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useMessageComposer } from '../../../hooks/useMessageComposer'
import { SlashCommandPopover } from './SlashCommandPopover'
import { ContextMentionPopover } from './ContextMentionPopover'
import { AttachmentPreviewList } from '../../ui/AttachmentPreviewList'
import { StopButtonPopover } from '../../ui/StopButtonPopover'
import type { SessionControlProps } from '../../ui/StopButtonPopover'
import { registerSessionInputFocus, unregisterSessionInputFocus } from '../../../hooks/useSlashFocusShortcut'
import { useProjectScope } from '@/contexts/ProjectScopeContext'
import { useContextFilesEditorSync } from '@/hooks/useContextFilesEditorSync'
import { FILE_INPUT_ACCEPT } from '@/lib/attachmentUtils'
import type { UserMessageContent } from '@shared/types'
import { ATTACHMENT_LIMITS } from '@shared/types'
import type { SlashItem } from '@shared/slashItems'

interface SessionInputBarProps {
  onSend: (message: UserMessageContent) => Promise<boolean>
  disabled: boolean
  placeholder?: string
  /** Cache key for persisting draft content across issue switches (e.g. issueId) */
  cacheKey?: string
  /** When provided, the send button transforms to a stop action during active processing */
  sessionControl?: SessionControlProps
}

/** Imperative handle exposed to parent components via ref. */
export interface SessionInputBarHandle {
  /** Process and attach files (images, PDFs, text) to the pending message. */
  addAttachments: (files: File[]) => Promise<void>
}

/**
 * Session message input bar — wrapped in memo to prevent re-renders during
 * streaming.  SessionPanel re-renders on every streamed message chunk, but
 * SessionInputBar's props (onSend, disabled, placeholder, etc.) only change
 * at state transitions (idle → streaming, streaming → idle), NOT on every chunk.
 */
export const SessionInputBar = memo(forwardRef<SessionInputBarHandle, SessionInputBarProps>(function SessionInputBar({ onSend, disabled, placeholder, cacheKey, sessionControl }: SessionInputBarProps, ref): React.JSX.Element {
  const { t } = useTranslation('sessions')
  const { t: tCommon } = useTranslation('common')
  const { projectPath } = useProjectScope()

  const {
    editor,
    pendingAttachments,
    isSending,
    hasContent,
    isDisabled,
    isDragOver,
    slashItems,
    slashLoading,
    insertSlashCommand,
    submit,
    addAttachments,
    removeAttachment,
    dragHandlers,
    fileInputRef,
    handleFileSelect,
  } = useMessageComposer({
    placeholder: placeholder ?? t('sessionInput.placeholder'),
    editable: !disabled,
    ariaLabel: t('sessionInput.inputAria'),
    onSubmit: onSend,
    cacheKey,
  })

  /* -- Expose addAttachments to parent (for console-wide file drop zone) -- */
  useImperativeHandle(ref, () => ({
    addAttachments,
  }), [addAttachments])

  /* -- Stop mode: send button transforms to stop action during processing -- */
  const isStopMode = sessionControl?.isProcessing === true

  /* -- Sync drag-drop ContextFiles into editor as fileMention nodes -- */
  useContextFilesEditorSync(editor)

  /* -- Slash command popover state (click-triggered) -- */
  const [isPopoverOpen, setIsPopoverOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  /* -- Context mention popover state -- */
  const [isContextPopoverOpen, setIsContextPopoverOpen] = useState(false)

  const handleToggleSlashPopover = useCallback(() => {
    setIsPopoverOpen((prev) => !prev)
  }, [])

  const handleClosePopover = useCallback(() => {
    setIsPopoverOpen(false)
  }, [])

  const handleSelectCommand = useCallback(
    (item: SlashItem) => {
      insertSlashCommand(item)
      setIsPopoverOpen(false)
    },
    [insertSlashCommand],
  )

  const handleToggleContextPopover = useCallback(() => {
    setIsContextPopoverOpen((prev) => !prev)
  }, [])

  const handleCloseContextPopover = useCallback(() => {
    setIsContextPopoverOpen(false)
  }, [])

  /* -- Register editor focus for the global `/` / `、` shortcut -- */
  useEffect(() => {
    if (!editor) return

    registerSessionInputFocus(
      // focus — just move cursor into the editor
      () => editor.commands.focus(),
      // focusWithSlash — focus and insert `/` to trigger slash command suggestion
      () => {
        editor.chain().focus().insertContent('/').run()
      },
    )

    return () => unregisterSessionInputFocus()
  }, [editor])

  return (
    // Card-style chrome shared with `ChatHeroInput` — same rounded-xl
    // outer surface, focus-within shadow ring, drag-over highlight.
    // The session-specific surface area (slash command + ref-driven
    // attachment ingestion) is preserved; only the chrome and action
    // row composition change.  `mx-3 mb-3 mt-1` lifts the card off the
    // panel edges so it visually floats over the message list, the
    // way ChatHeroInput floats inside its parent's `pb-3 pt-1 px-3`
    // wrapper.
    <div
      data-session-input
      onClick={(e) => {
        // Click on empty area (not buttons / inputs / contenteditable) → focus the editor.
        if (!(e.target as HTMLElement).closest('button, input, [contenteditable]')) {
          editor?.commands.focus()
        }
      }}
      className={cn(
        'chat-hero-editor mx-3 mb-3 mt-1 flex flex-col rounded-xl border bg-[hsl(var(--card))] shadow-sm transition-all',
        isDragOver
          ? 'border-[hsl(var(--ring))] bg-[hsl(var(--accent)/0.15)] shadow-[0_0_0_2px_hsl(var(--ring)/0.15)]'
          : 'border-[hsl(var(--border))] hover:border-[hsl(var(--border)/0.8)] focus-within:border-[hsl(var(--ring))] focus-within:shadow-[0_0_0_2px_hsl(var(--ring)/0.1)]'
      )}
      {...dragHandlers}
    >
      <AttachmentPreviewList
        attachments={pendingAttachments}
        onRemove={removeAttachment}
        size="lg"
        image={{ previewMode: 'lightbox' }}
        className="px-4 pt-3"
        ariaLabel={tCommon('attachedFiles')}
        labels={{
          previewImage: tCommon('previewImage'),
          removeFile: tCommon('removeFile'),
          attachedImageFallbackAlt: tCommon('attachedImageAlt'),
          fallbackFileName: tCommon('file'),
        }}
      />

      {/* Editor area — its own row, spacious vertical breathing room
          so multi-line drafts have visible runway. */}
      <div className="flex items-end gap-2 px-4 py-3">
        <div
          className={cn(
            'flex-1 min-w-0',
            isDisabled && 'opacity-50 cursor-not-allowed pointer-events-none'
          )}
          aria-haspopup="listbox"
        >
          <EditorContent editor={editor} />
        </div>
      </div>

      {/* Action row — sits below the editor.  Left cluster: insertion
          shortcuts (slash command, file mention, file attach); right:
          send / stop.  Mirrors the visual hierarchy of ChatHeroInput
          while keeping the slash-command affordance that only sessions
          need. */}
      <div className="flex items-center justify-between px-3 pb-2.5">
        <div className="flex items-center gap-0.5">
          {/* Slash command trigger (Session-only) */}
          <div className="relative">
            <button
              ref={triggerRef}
              type="button"
              onClick={handleToggleSlashPopover}
              className={cn(
                'p-1.5 rounded-lg transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
                isPopoverOpen
                  ? 'text-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.08)]'
                  : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)]',
              )}
              aria-label={t('sessionInput.slashCommandAria')}
              aria-haspopup="listbox"
              aria-expanded={isPopoverOpen}
            >
              <AlignLeft className="w-4 h-4" aria-hidden="true" />
            </button>
            {/* Popover anchors to bottom-full so it opens UPward into
                the editor space — same convention used by Chat's @
                context popover. */}
            {isPopoverOpen && (
              <div className="absolute bottom-full left-0 mb-1.5 z-50">
                <SlashCommandPopover
                  items={slashItems}
                  loading={slashLoading}
                  onSelect={handleSelectCommand}
                  onClose={handleClosePopover}
                />
              </div>
            )}
          </div>

          {/* @ Context mention trigger — only when project is associated */}
          {projectPath && (
            <div className="relative">
              <button
                type="button"
                onClick={handleToggleContextPopover}
                className={cn(
                  'p-1.5 rounded-lg transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
                  isContextPopoverOpen
                    ? 'text-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.08)]'
                    : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)]',
                )}
                aria-label={t('contextMention.triggerAria', { defaultValue: 'Add file context' })}
                aria-haspopup="dialog"
                aria-expanded={isContextPopoverOpen}
              >
                <AtSign className="w-4 h-4" aria-hidden="true" />
              </button>
              {isContextPopoverOpen && (
                <div className="absolute bottom-full left-0 mb-1.5 z-50">
                  <ContextMentionPopover
                    onClose={handleCloseContextPopover}
                    onSelectFile={(entry) => {
                      editor
                        ?.chain()
                        .focus('end')
                        .insertContent([
                          {
                            type: 'fileMention',
                            attrs: { path: entry.path, name: entry.name, isDirectory: entry.isDirectory },
                          },
                          { type: 'text', text: ' ' },
                        ])
                        .run()
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Paperclip — attach file from disk */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isDisabled || pendingAttachments.length >= ATTACHMENT_LIMITS.maxPerMessage}
            aria-label={tCommon('attachFile')}
            className={cn(
              'p-1.5 rounded-lg transition-colors',
              'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
              'disabled:opacity-30 disabled:cursor-not-allowed',
            )}
          >
            <Paperclip className="w-4 h-4" aria-hidden="true" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept={FILE_INPUT_ACCEPT}
            multiple
            className="hidden"
            onChange={handleFileSelect}
            aria-hidden="true"
            tabIndex={-1}
          />
        </div>

        {/* Send / Stop button — dual-mode based on session processing state */}
        {isStopMode ? (
          <StopButtonPopover onStop={sessionControl!.onStop} size="md" />
        ) : (
          <button
            onClick={submit}
            disabled={isDisabled || !hasContent}
            aria-label={t('sessionInput.sendAria')}
            className={cn(
              'p-1.5 rounded-lg transition-all',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
              hasContent && !isDisabled
                ? 'bg-[hsl(var(--foreground))] text-[hsl(var(--background))] hover:opacity-90 shadow-sm'
                : 'text-[hsl(var(--muted-foreground))] opacity-30 cursor-not-allowed'
            )}
          >
            {isSending ? (
              <Loader2 className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" />
            ) : (
              <CornerDownLeft className="w-4 h-4" aria-hidden="true" />
            )}
          </button>
        )}
      </div>
    </div>
  )
}))
