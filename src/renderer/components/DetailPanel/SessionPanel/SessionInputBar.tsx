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
    <div
      data-session-input
      className={`flex flex-col border-t transition-colors ${
        isDragOver
          ? 'border-t-[hsl(var(--ring))] bg-[hsl(var(--accent)/0.3)]'
          : 'border-t-[hsl(var(--border))] bg-[hsl(var(--card))] focus-within:border-t-[hsl(var(--ring))]'
      }`}
      {...dragHandlers}
    >
      <AttachmentPreviewList
        attachments={pendingAttachments}
        onRemove={removeAttachment}
        size="sm"
        image={{ previewMode: 'lightbox' }}
        className="px-2.5 pt-1.5"
        ariaLabel={tCommon('attachedFiles')}
        labels={{
          previewImage: tCommon('previewImage'),
          removeFile: tCommon('removeFile'),
          attachedImageFallbackAlt: tCommon('attachedImageAlt'),
          fallbackFileName: tCommon('file'),
        }}
      />

      {/* Input row */}
      <div className="flex items-center gap-1.5 px-2.5 py-2">
        {/* Slash command trigger icon (click to toggle) */}
        <div className="relative shrink-0">
          <button
            ref={triggerRef}
            type="button"
            onClick={handleToggleSlashPopover}
            className={`p-1 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] ${
              isPopoverOpen
                ? 'text-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.08)]'
                : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)]'
            }`}
            aria-label={t('sessionInput.slashCommandAria')}
            aria-haspopup="listbox"
            aria-expanded={isPopoverOpen}
          >
            <AlignLeft className="w-3.5 h-3.5" aria-hidden="true" />
          </button>

          {/* Popover (above the trigger) */}
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

        {/* @ Context mention trigger — only visible when project is associated */}
        {projectPath && (
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={handleToggleContextPopover}
              className={`p-1 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] ${
                isContextPopoverOpen
                  ? 'text-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.08)]'
                  : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)]'
              }`}
              aria-label={t('contextMention.triggerAria', { defaultValue: 'Add file context' })}
              aria-haspopup="dialog"
              aria-expanded={isContextPopoverOpen}
            >
              <AtSign className="w-3.5 h-3.5" aria-hidden="true" />
            </button>

            {/* Context mention popover (above the trigger, aligned to left of panel) */}
            {isContextPopoverOpen && (
              <div className="absolute bottom-full left-0 mb-1.5 z-50">
                <ContextMentionPopover
                  onClose={handleCloseContextPopover}
                  onSelectFile={(entry) => {
                    // Insert fileMention node directly into the editor
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

        {/* TipTap plain-text editor with slash command support */}
        <div
          className={`flex-1 min-w-0 ${isDisabled ? 'opacity-50 cursor-not-allowed pointer-events-none' : ''}`}
          aria-haspopup="listbox"
        >
          <EditorContent editor={editor} />
        </div>

        {/* Attach file button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isDisabled || pendingAttachments.length >= ATTACHMENT_LIMITS.maxPerMessage}
          aria-label={tCommon('attachFile')}
          className="p-1 rounded text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
        >
          <Paperclip className="w-3.5 h-3.5" aria-hidden="true" />
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

        {/* Send / Stop button — dual-mode based on session processing state */}
        {isStopMode ? (
          <StopButtonPopover onStop={sessionControl!.onStop} size="sm" />
        ) : (
          <button
            onClick={submit}
            disabled={isDisabled || !hasContent}
            aria-label={t('sessionInput.sendAria')}
            className={cn(
              'p-1 rounded-md transition-all shrink-0',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
              hasContent && !isDisabled
                ? 'bg-[hsl(var(--foreground))] text-[hsl(var(--background))] hover:opacity-90 shadow-sm'
                : 'text-[hsl(var(--muted-foreground))] opacity-30 cursor-not-allowed'
            )}
          >
            {isSending ? (
              <Loader2 className="w-3.5 h-3.5 motion-safe:animate-spin" aria-hidden="true" />
            ) : (
              <CornerDownLeft className="w-3.5 h-3.5" aria-hidden="true" />
            )}
          </button>
        )}
      </div>
    </div>
  )
}))
