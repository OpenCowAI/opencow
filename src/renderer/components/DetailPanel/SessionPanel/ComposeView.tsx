// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from 'react-i18next'
import { EditorContent } from '@tiptap/react'
import { Play, Paperclip, Loader2, ArrowLeft } from 'lucide-react'
import { useMessageComposer } from '../../../hooks/useMessageComposer'
import { AttachmentPreviewList } from '../../ui/AttachmentPreviewList'
import { FILE_INPUT_ACCEPT, type ProcessedAttachment } from '../../../lib/attachmentUtils'
import type { UserMessageContent } from '@shared/types'
import { ATTACHMENT_LIMITS } from '@shared/types'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ComposeViewProps {
  /** Pre-filled prompt content derived from the Issue */
  initialPrompt: {
    text: string
    attachments: ProcessedAttachment[]
  }
  /**
   * Called when user submits the composed content to start a session.
   * Return `false` to signal failure — the editor content will be preserved.
   * Returning void/undefined or any truthy value clears the editor.
   */
  onSubmit: (content: UserMessageContent) => Promise<boolean | void>
  /** Called when user cancels compose mode */
  onCancel: () => void
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function ComposeView({ initialPrompt, onSubmit, onCancel }: ComposeViewProps): React.JSX.Element {
  const { t } = useTranslation('sessions')
  const { t: tCommon } = useTranslation('common')

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
    placeholder: t('compose.placeholder'),
    editable: true,
    ariaLabel: t('compose.inputAria'),
    initialText: initialPrompt.text,
    initialAttachments: initialPrompt.attachments,
    onSubmit,
  })

  return (
    <div className="h-full flex flex-col bg-[hsl(var(--card))]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]">
        <div className="flex items-center gap-2">
          <button
            onClick={onCancel}
            className="p-1 rounded-md text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
            aria-label={t('compose.cancelAria')}
          >
            <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <span className="text-xs font-medium text-[hsl(var(--foreground))]">
            {t('compose.title')}
          </span>
        </div>
        <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
          {t('compose.useSlash')} <kbd className="px-1 py-0.5 rounded bg-[hsl(var(--background))] border border-[hsl(var(--border))] font-mono text-[10px]">{t('compose.slashSymbol')}</kbd> {t('compose.forCommandsHint')}
        </span>
      </div>

      {pendingAttachments.length > 0 && (
        <div className="px-3 py-2 border-b border-[hsl(var(--border))]">
          <AttachmentPreviewList
            attachments={pendingAttachments}
            onRemove={removeAttachment}
            size="md"
            image={{ previewMode: 'lightbox' }}
            ariaLabel={tCommon('attachedFiles')}
            labels={{
              previewImage: tCommon('previewImage'),
              removeFile: tCommon('removeFile'),
              attachedImageFallbackAlt: tCommon('attachedImageAlt'),
              fallbackFileName: tCommon('file'),
            }}
          />
        </div>
      )}

      {/* Editor — full-height scrollable area.
          Click anywhere in the empty region to focus the editor. */}
      <div
        className={`flex-1 min-h-0 overflow-y-auto px-3 py-2 cursor-text ${
          isDragOver
            ? 'bg-[hsl(var(--accent)/0.3)] ring-1 ring-inset ring-[hsl(var(--ring))]'
            : ''
        }`}
        onClick={(e) => {
          // Only focus-to-end when clicking the empty padding area, not the editor itself
          if (e.target === e.currentTarget) {
            editor?.commands.focus('end')
          }
        }}
        {...dragHandlers}
      >
        <div className="compose-editor min-h-full" aria-haspopup="listbox">
          <EditorContent editor={editor} />
        </div>
      </div>

      {/* Footer action bar */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-[hsl(var(--border))] bg-[hsl(var(--muted))]">
        {/* Left: attach file */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isDisabled || pendingAttachments.length >= ATTACHMENT_LIMITS.maxPerMessage}
            aria-label={tCommon('attachFile')}
            className="flex items-center gap-1.5 px-2 py-1 text-xs rounded-md text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Paperclip className="w-3.5 h-3.5" aria-hidden="true" />
            Attach
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

        {/* Right: cancel + start */}
        <div className="flex items-center gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs rounded-md text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
          >
            {tCommon('cancel')}
          </button>
          <button
            onClick={submit}
            disabled={isDisabled || !hasContent}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Start session with composed prompt"
          >
            {isSending ? (
              <Loader2 className="w-3 h-3 motion-safe:animate-spin" aria-hidden="true" />
            ) : (
              <Play className="w-3 h-3" aria-hidden="true" />
            )}
            {t('sessionPanel.startSession')}
          </button>
        </div>
      </div>
    </div>
  )
}
