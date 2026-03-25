// SPDX-License-Identifier: Apache-2.0

/**
 * ReviewChatPanel — Floating chat widget inside DiffChangesDialog.
 *
 * Pure UI component. All session lifecycle logic lives in useReviewSession.
 *
 * Visual states:
 *   - Collapsed: a single input bar (placeholder: "Chat to review")
 *   - Expanded:  input bar + scrollable message list, expanding upward
 *
 * Input features (via useMessageComposer):
 *   - TipTap rich editor with inline `/` slash commands & `@` file mentions
 *   - Image upload (button, paste, drag-drop)
 *   - Slash command popover (click-triggered)
 *   - Context mention popover (click-triggered, when project is associated)
 */
import { useState, useCallback, useRef, useEffect } from 'react'
import { EditorContent } from '@tiptap/react'
import { useTranslation } from 'react-i18next'
import {
  MessageSquare,
  ChevronDown,
  CornerDownLeft,
  Loader2,
  AlignLeft,
  AtSign,
  Paperclip,
} from 'lucide-react'
import { StopButtonPopover } from '../../ui/StopButtonPopover'
import { SessionMessageList } from './SessionMessageList'
import type { SessionMessageListHandle } from './SessionMessageList'
import { StreamingFooter } from './StreamingFooter'
import { SlashCommandPopover } from './SlashCommandPopover'
import { ContextMentionPopover } from './ContextMentionPopover'
import { AttachmentPreviewList } from '../../ui/AttachmentPreviewList'
import { useReviewSession } from '@/hooks/useReviewSession'
import { useMessageComposer } from '@/hooks/useMessageComposer'
import { useProjectScope } from '@/contexts/ProjectScopeContext'
import { FILE_INPUT_ACCEPT } from '@/lib/attachmentUtils'
import { cn } from '@/lib/utils'
import type { ReviewContext } from './reviewTypes'
import type { FileChangesResult } from './extractFileChanges'
import type { UserMessageContent } from '@shared/types'
import { ATTACHMENT_LIMITS } from '@shared/types'
import type { SlashItem } from '@shared/slashItems'

// ─── Props ──────────────────────────────────────────────────────────────────

interface ReviewChatPanelProps {
  /** Structured review context (issueId + sessionId + scope) */
  context: ReviewContext
  /** Extracted file changes — used to build AI context */
  fileChanges: FileChangesResult
}

// ─── Component ──────────────────────────────────────────────────────────────

export function ReviewChatPanel({
  context,
  fileChanges,
}: ReviewChatPanelProps): React.JSX.Element {
  const { t: tCommon } = useTranslation('common')
  // ── Session logic (hook) ──
  const review = useReviewSession(context, fileChanges)
  const { projectPath } = useProjectScope()

  // ── UI state ──
  const [panelExpansion, setPanelExpansion] = useState<'auto' | 'expanded' | 'collapsed'>('auto')

  const messageListRef = useRef<SessionMessageListHandle>(null)

  const hasMessages = review.messages.length > 0
  const hasHistoricalSession = !!review.session && hasMessages
  const reviewSessionId = review.session?.id
  const isInputDisabled = review.isProcessing || review.isCreating
  const isExpanded = panelExpansion === 'auto' ? hasHistoricalSession : panelExpansion === 'expanded'
  const expandPanel = useCallback(() => setPanelExpansion('expanded'), [])
  const collapsePanel = useCallback(() => setPanelExpansion('collapsed'), [])

  // ── Composer (TipTap + slash + @ mentions + images) ──
  const handleSubmit = useCallback(
    async (content: UserMessageContent): Promise<boolean> => {
      const ok = await review.send(content)
      if (ok) expandPanel()
      return ok
    },
    [review, expandPanel],
  )

  const {
    editor,
    pendingAttachments,
    isSending,
    hasContent,
    isDisabled,
    slashItems,
    slashLoading,
    insertSlashCommand,
    submit,
    removeAttachment,
    dragHandlers,
    fileInputRef,
    handleFileSelect,
  } = useMessageComposer({
    placeholder: 'Chat to review',
    editable: !isInputDisabled,
    ariaLabel: 'Review chat input',
    onSubmit: handleSubmit,
    engineKind: review.session?.engineKind,
  })

  // ── Slash command popover (click-triggered) ──
  const [isSlashOpen, setIsSlashOpen] = useState(false)
  const handleToggleSlash = useCallback(() => {
    setIsSlashOpen((prev) => !prev)
  }, [])

  const handleSelectCommand = useCallback(
    (item: SlashItem) => {
      insertSlashCommand(item)
      setIsSlashOpen(false)
    },
    [insertSlashCommand],
  )

  // ── Context mention popover (click-triggered) ──
  const [isContextOpen, setIsContextOpen] = useState(false)

  // ── Auto-scroll to bottom on new messages ──
  // Uses Virtuoso's native scrollToBottom API instead of scrollIntoView,
  // which doesn't work for virtualised lists.
  useEffect(() => {
    if (isExpanded && review.messages.length > 0) {
      messageListRef.current?.scrollToBottom()
    }
  }, [isExpanded, review.messages.length])

  // ── Keyboard: Escape to collapse ──
  const handlePanelKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape' && isExpanded) {
        e.stopPropagation()
        collapsePanel()
      }
    },
    [isExpanded, collapsePanel],
  )

  return (
    <div
      className={cn(
        'absolute bottom-4 right-4 z-10',
        'flex flex-col',
        'rounded-xl',
        // overflow-visible when a popover is open so it isn't clipped;
        // overflow-hidden otherwise for collapse animation & border-radius.
        isSlashOpen || isContextOpen ? 'overflow-visible' : 'overflow-hidden',
        'border border-[hsl(var(--border))]',
        'bg-[hsl(var(--card)/0.97)] backdrop-blur-md',
        'shadow-lg shadow-[hsl(var(--foreground)/0.06)]',
        'transition-all duration-250 ease-[cubic-bezier(0.22,1,0.36,1)]',
        isExpanded ? 'w-[420px]' : 'w-80',
      )}
      style={{
        // When expanded with messages: explicit height gives flex children
        // a definite reference so Virtuoso can compute its viewport.
        // maxHeight alone is NOT a definite size — flex-1 resolves to 0.
        maxHeight: 'calc(100% - 80px)',
        height: isExpanded && hasMessages ? 'calc(100% - 80px)' : 'auto',
        transition:
          'max-height 250ms cubic-bezier(0.22, 1, 0.36, 1), height 250ms cubic-bezier(0.22, 1, 0.36, 1), width 250ms cubic-bezier(0.22, 1, 0.36, 1)',
      }}
      onKeyDown={handlePanelKeyDown}
      {...dragHandlers}
    >
      {/* ── Header (expanded only) ── */}
      {isExpanded && (
        <div
          onClick={collapsePanel}
          className="flex items-center justify-between px-3 py-2 border-b border-[hsl(var(--border)/0.5)] shrink-0 cursor-pointer hover:bg-[hsl(var(--foreground)/0.03)] transition-colors"
          role="button"
          aria-label="Collapse review chat"
        >
          <div className="flex items-center gap-1.5">
            <MessageSquare
              className="w-3.5 h-3.5 text-[hsl(var(--muted-foreground))]"
              aria-hidden="true"
            />
            <span className="text-xs font-medium text-[hsl(var(--foreground)/0.7)]">
              Review Chat
            </span>
            {review.isProcessing && (
              <Loader2
                className="w-3 h-3 text-[hsl(var(--primary))] motion-safe:animate-spin"
                aria-hidden="true"
              />
            )}
          </div>
          <ChevronDown className="w-3.5 h-3.5 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
        </div>
      )}

      {/* ── Messages (expanded + has messages) ── */}
      {isExpanded && hasMessages && reviewSessionId && (
        <div className="flex-1 min-h-0 flex flex-col">
          <SessionMessageList
            ref={messageListRef}
            messages={review.messages}
            sessionId={reviewSessionId}
            sessionState={review.sessionState}
            variant="chat"
          />
        </div>
      )}

      {/* ── Creating indicator ── */}
      {isExpanded && review.isCreating && !hasMessages && (
        <div className="flex items-center justify-center gap-2 py-6 text-[hsl(var(--muted-foreground))]">
          <Loader2 className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" />
          <span className="text-xs">Starting review session…</span>
        </div>
      )}

      {/* ── Streaming status bar — shown while agent is processing ── */}
      {review.isProcessing && review.session && (
        <StreamingFooter
          activeDurationMs={review.session.activeDurationMs}
          activeStartedAt={review.session.activeStartedAt ?? null}
          inputTokens={review.session.inputTokens}
          outputTokens={review.session.outputTokens}
          activity={review.session.activity}
          todos={null}
        />
      )}

      {/* ── Pending attachment previews ── */}
      {pendingAttachments.length > 0 && (
        <AttachmentPreviewList
          attachments={pendingAttachments}
          onRemove={removeAttachment}
          size="sm"
          image={{ previewMode: 'lightbox' }}
          className={cn('px-3 pt-1.5', isExpanded && 'border-t border-[hsl(var(--border)/0.5)]')}
          ariaLabel={tCommon('attachedFiles')}
          labels={{
            previewImage: tCommon('previewImage'),
            removeFile: tCommon('removeFile'),
            attachedImageFallbackAlt: tCommon('attachedImageAlt'),
            fallbackFileName: tCommon('file'),
          }}
        />
      )}

      {/* ── Input area ── */}
      <div
        className={cn(
          'flex items-center gap-1 px-2.5 py-2 shrink-0',
          isExpanded && pendingAttachments.length === 0 && 'border-t border-[hsl(var(--border)/0.5)]',
        )}
      >
        {/* Expand trigger (collapsed + has previous messages) */}
        {!isExpanded && hasMessages && (
          <button
            onClick={expandPanel}
            className="p-1 rounded text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/0.08)] transition-colors shrink-0"
            aria-label="Expand review chat"
          >
            <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        )}

        {/* Slash command trigger */}
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={handleToggleSlash}
            className={cn(
              'p-1 rounded transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]',
              isSlashOpen
                ? 'text-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.08)]'
                : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)]',
            )}
            aria-label="Slash commands"
            aria-haspopup="listbox"
            aria-expanded={isSlashOpen}
          >
            <AlignLeft className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          {isSlashOpen && (
            <div className="absolute bottom-full left-0 mb-1.5 z-50">
              <SlashCommandPopover
                items={slashItems}
                loading={slashLoading}
                onSelect={handleSelectCommand}
                onClose={() => setIsSlashOpen(false)}
              />
            </div>
          )}
        </div>

        {/* @ Context mention trigger — only when project is associated */}
        {projectPath && (
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setIsContextOpen((prev) => !prev)}
              className={cn(
                'p-1 rounded transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]',
                isContextOpen
                  ? 'text-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.08)]'
                  : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)]',
              )}
              aria-label="Add file context"
              aria-haspopup="dialog"
              aria-expanded={isContextOpen}
            >
              <AtSign className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
            {isContextOpen && (
              <div className="absolute bottom-full left-0 mb-1.5 z-50">
                <ContextMentionPopover
                  onClose={() => setIsContextOpen(false)}
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

        {/* TipTap editor */}
        <div
          className={cn(
            'flex-1 min-w-0',
            '[&_.tiptap]:text-[13px] [&_.tiptap]:leading-5 [&_.tiptap]:text-[hsl(var(--foreground))]',
            '[&_.tiptap]:outline-none [&_.tiptap]:max-h-24 [&_.tiptap]:overflow-y-auto',
            '[&_.tiptap_p.is-editor-empty:first-child::before]:text-[hsl(var(--muted-foreground)/0.5)]',
            '[&_.tiptap_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]',
            '[&_.tiptap_p.is-editor-empty:first-child::before]:float-left',
            '[&_.tiptap_p.is-editor-empty:first-child::before]:h-0',
            '[&_.tiptap_p.is-editor-empty:first-child::before]:pointer-events-none',
            isDisabled && 'opacity-40 cursor-not-allowed pointer-events-none',
          )}
          onFocus={() => {
            if (hasMessages && !isExpanded) expandPanel()
          }}
        >
          <EditorContent editor={editor} />
        </div>

        {/* File upload */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isDisabled || pendingAttachments.length >= ATTACHMENT_LIMITS.maxPerMessage}
          className="p-1 rounded text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))] disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
          aria-label="Attach file"
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

        {/* Send / Stop button — dual-mode based on review processing state */}
        {review.isProcessing ? (
          <StopButtonPopover onStop={review.stop} size="sm" />
        ) : (
          <button
            onClick={submit}
            disabled={isDisabled || !hasContent}
            className={cn(
              'p-1 rounded transition-colors shrink-0',
              'text-[hsl(var(--muted-foreground))]',
              'hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)]',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]',
              'disabled:opacity-30 disabled:cursor-not-allowed',
            )}
            aria-label="Send review message"
          >
            {isSending || review.isCreating ? (
              <Loader2 className="w-3.5 h-3.5 motion-safe:animate-spin" aria-hidden="true" />
            ) : (
              <CornerDownLeft className="w-3.5 h-3.5" aria-hidden="true" />
            )}
          </button>
        )}
      </div>
    </div>
  )
}
