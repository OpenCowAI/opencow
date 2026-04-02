// SPDX-License-Identifier: Apache-2.0

import { useState, useCallback, useEffect } from 'react'
import { EditorContent } from '@tiptap/react'
import { useTranslation } from 'react-i18next'
import { ArrowUp, AtSign, Paperclip, Loader2 } from 'lucide-react'
import { useMessageComposer } from '@/hooks/useMessageComposer'
import { useProjectScope } from '@/contexts/ProjectScopeContext'
import { useContextFilesEditorSync } from '@/hooks/useContextFilesEditorSync'
import { ContextMentionPopover } from '@/components/DetailPanel/SessionPanel/ContextMentionPopover'
import { AttachmentPreviewList } from '@/components/ui/AttachmentPreviewList'
import { StopButtonPopover } from '@/components/ui/StopButtonPopover'
import type { SessionControlProps } from '@/components/ui/StopButtonPopover'
import { FILE_INPUT_ACCEPT } from '@/lib/attachmentUtils'
import { registerChatInputFocus, unregisterChatInputFocus } from '@/lib/chatInputRegistry'
import { cn } from '@/lib/utils'
import type { AIEngineKind, UserMessageContent } from '@shared/types'
import { ATTACHMENT_LIMITS } from '@shared/types'

interface ChatHeroInputProps {
  onSend: (message: UserMessageContent) => Promise<boolean>
  disabled?: boolean
  placeholder?: string
  engineKind?: AIEngineKind
  /** When provided, the send button transforms to a stop action during active processing */
  sessionControl?: SessionControlProps
  /** Registers this instance as the Chat tab's active focus target. */
  registerAsChatTabInput?: boolean
}

/**
 * ChatHeroInput — A page-level hero input for the Agent Chat landing page.
 *
 * Design rationale: `SessionInputBar` is a compact, panel-bottom-docked control
 * (border-top, `>` prompt, text-xs). This component serves a fundamentally
 * different purpose — it's the visual centrepiece of an empty chat page,
 * designed to feel spacious, inviting, and prominent.
 *
 * Both share `useMessageComposer` for input logic (single source of truth),
 * but their visual presentation is entirely independent (separation of concerns).
 */
export function ChatHeroInput({
  onSend,
  disabled = false,
  placeholder,
  engineKind,
  sessionControl,
  registerAsChatTabInput = false,
}: ChatHeroInputProps): React.JSX.Element {
  const { t } = useTranslation('sessions')
  const { t: tCommon } = useTranslation('common')
  const { projectPath } = useProjectScope()
  const [isContextOpen, setIsContextOpen] = useState(false)
  const handleCloseContext = useCallback(() => setIsContextOpen(false), [])
  const {
    editor,
    pendingAttachments,
    isSending,
    hasContent,
    isDisabled,
    isDragOver,
    submit,
    removeAttachment,
    dragHandlers,
    fileInputRef,
    handleFileSelect,
  } = useMessageComposer({
    placeholder: placeholder ?? t('chatHero.defaultPlaceholder'),
    editable: !disabled,
    ariaLabel: t('chatHero.inputAria'),
    onSubmit: onSend,
    engineKind,
  })

  useEffect(() => {
    if (!registerAsChatTabInput || !editor) return

    const focus = (): void => {
      editor.commands.focus()
    }

    registerChatInputFocus(focus)
    return () => unregisterChatInputFocus(focus)
  }, [editor, registerAsChatTabInput])

  useContextFilesEditorSync(editor)

  return (
    <div
      className={cn(
        'chat-hero-editor flex flex-col rounded-xl border transition-all',
        'bg-[hsl(var(--card))] shadow-sm',
        isDragOver
          ? 'border-[hsl(var(--ring))] bg-[hsl(var(--accent)/0.15)] shadow-[0_0_0_2px_hsl(var(--ring)/0.15)]'
          : 'border-[hsl(var(--border))] hover:border-[hsl(var(--border)/0.8)] focus-within:border-[hsl(var(--ring))] focus-within:shadow-[0_0_0_2px_hsl(var(--ring)/0.1)]'
      )}
      onClick={(e) => {
        // Click on empty area (not buttons/inputs) → focus the editor
        if (!(e.target as HTMLElement).closest('button, input, [contenteditable]')) {
          editor?.commands.focus()
        }
      }}
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

      {/* Editor area */}
      <div className="flex items-end gap-2 px-4 py-3">
        {/* TipTap editor — flexible multi-line area */}
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

      {/* Action row — sits below the editor for visual breathing room */}
      <div className="flex items-center justify-between px-3 pb-2.5">
        {/* Left: attach image + @ context */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isDisabled || pendingAttachments.length >= ATTACHMENT_LIMITS.maxPerMessage}
            aria-label={tCommon('attachFile')}
            className={cn(
              'p-1.5 rounded-lg transition-colors',
              'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
              'disabled:opacity-30 disabled:cursor-not-allowed'
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

          {/* @ Context mention trigger — only when project is associated */}
          {projectPath && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsContextOpen((prev) => !prev)}
                className={cn(
                  'p-1.5 rounded-lg transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
                  isContextOpen
                    ? 'text-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.08)]'
                    : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)]',
                )}
                aria-label={t('contextMention.triggerAria', { defaultValue: 'Add file context' })}
                aria-haspopup="dialog"
                aria-expanded={isContextOpen}
              >
                <AtSign className="w-4 h-4" aria-hidden="true" />
              </button>
              {isContextOpen && (
                <div className="absolute bottom-full left-0 mb-1.5 z-50">
                <ContextMentionPopover
                  onClose={handleCloseContext}
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
        </div>

        {/* Right: send / stop button — dual-mode based on session processing state */}
        {sessionControl?.isProcessing ? (
          <StopButtonPopover onStop={sessionControl.onStop} size="md" />
        ) : (
          <button
            onClick={submit}
            disabled={isDisabled || !hasContent}
            aria-label={t('chatHero.sendAria')}
            className={cn(
              'p-1.5 rounded-lg transition-all',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
              hasContent && !isDisabled
                ? 'bg-[hsl(var(--foreground))] text-[hsl(var(--background))] hover:opacity-90 shadow-sm'
                : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] cursor-not-allowed opacity-50'
            )}
          >
            {isSending ? (
              <Loader2 className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" />
            ) : (
              <ArrowUp className="w-4 h-4" aria-hidden="true" />
            )}
          </button>
        )}
      </div>
    </div>
  )
}
