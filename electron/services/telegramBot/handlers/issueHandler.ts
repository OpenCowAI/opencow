// SPDX-License-Identifier: Apache-2.0

/**
 * IssueHandler — Telegram interaction layer for Issue management.
 *
 * Handles the 3 menu items under the Issues group:
 *   cmd:issues         → handleList()   — show status filter InlineKeyboard
 *   cmd:issues:new     → handleNew()    — enter issue_creation mode, send ForceReply
 *   cmd:issues:filter:<status> → handleFilter() — fetch and display issues by status
 *
 * Also provides handleCreationMessage() called by TelegramBotService.onCommand()
 * when mode === 'issue_creation'.
 */

import type { Context, CallbackQueryContext } from 'grammy'
import type { IssueService } from '../../issueService'
import type { ChatContextManager } from '../state/chatContextManager'
import type { FormattedMessage, InlineKeyboardButton } from '../messageFormatter'
import type { IssuePriority, IssueStatus } from '../../../../src/shared/types'

// ─── Priority / Status Display ────────────────────────────────────────────────

const PRIORITY_ICON: Record<IssuePriority, string> = {
  urgent: '🔴',
  high:   '🟡',
  medium: '🟢',
  low:    '⚪',
}

const STATUS_LABEL: Record<IssueStatus, string> = {
  backlog:     'Backlog',
  todo:        'Todo',
  in_progress: 'In Progress',
  done:        'Done',
  cancelled:   'Cancelled',
}

const ALL_STATUSES: IssueStatus[] = ['backlog', 'todo', 'in_progress', 'done', 'cancelled']

// ─── Deps ─────────────────────────────────────────────────────────────────────

export interface IssueHandlerDeps {
  issueService: IssueService
  chatContext: ChatContextManager
  botId: string
  sendToChat: (chatId: string, msg: FormattedMessage) => Promise<void>
  /** Dispatch user text into the current chat session (or start a new one). */
  dispatchUserMessage: (chatId: string, userId: number, text: string) => Promise<void>
}

// ─── IssueHandler ─────────────────────────────────────────────────────────────

export class IssueHandler {
  constructor(private readonly deps: IssueHandlerDeps) {}

  // ── Public: shared keyboard factory (reused by handleCommand case 'issues') ──

  /**
   * Build the status-filter InlineKeyboard message.
   * Extracted as a pure factory so both the cmd:issues callback and the
   * /issues text command can share the same formatting without duplication.
   */
  buildFilterKeyboard(): FormattedMessage {
    const buttons: InlineKeyboardButton[][] = ALL_STATUSES.map((status) => [{
      text: STATUS_LABEL[status],
      callback_data: `cmd:issues:filter:${status}`,
    }])
    return {
      text: '📋 <b>View Issues</b>\n\nSelect a status to filter by:',
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: buttons },
    }
  }

  // ── Callback handlers ─────────────────────────────────────────────────────

  /** cmd:issues — show status filter keyboard */
  async handleList(ctx: CallbackQueryContext<Context>): Promise<void> {
    try {
      await ctx.answerCallbackQuery()
      const chatId = String(ctx.callbackQuery.message?.chat?.id ?? 0)
      await this.deps.sendToChat(chatId, this.buildFilterKeyboard())
    } catch (err) {
      await this.safeAnswerError(ctx, 'Failed to load, please retry')
    }
  }

  /** cmd:issues:filter:<status> — fetch and display issues filtered by status */
  async handleFilter(ctx: CallbackQueryContext<Context>): Promise<void> {
    try {
      await ctx.answerCallbackQuery()
      const chatId = String(ctx.callbackQuery.message?.chat?.id ?? 0)

      const statusRaw = ctx.match?.[1] as string | undefined
      if (!statusRaw || !ALL_STATUSES.includes(statusRaw as IssueStatus)) {
        await this.deps.sendToChat(chatId, this.errorMessage('Invalid status filter'))
        return
      }
      const status = statusRaw as IssueStatus

      const chatCtx = this.deps.chatContext.get(this.deps.botId, chatId)
      const issues = await this.deps.issueService.listIssues({
        status,
        ...(chatCtx.activeProjectId ? { projectId: chatCtx.activeProjectId } : {}),
      })

      await this.deps.sendToChat(chatId, this.formatIssueList(issues, status, chatCtx.activeProjectName))
    } catch (err) {
      await this.safeAnswerError(ctx, 'Failed to load, please retry')
    }
  }

  /** cmd:issues:new — enter issue_creation mode, send ForceReply */
  async handleNew(ctx: CallbackQueryContext<Context>): Promise<void> {
    try {
      await ctx.answerCallbackQuery()
      const chatId = String(ctx.callbackQuery.message?.chat?.id ?? 0)

      this.deps.chatContext.patch(this.deps.botId, chatId, { mode: 'issue_creation' })

      await this.deps.sendToChat(chatId, {
        text: '📝 <b>New Issue</b>\n\nDescribe the Issue you want to create (title, priority, etc.), and Claude will organize and create it.\n\nSend "cancel" or /menu to exit.',
        parse_mode: 'HTML',
        reply_markup: {
          force_reply: true,
          input_field_placeholder: 'Describe the issue, e.g.: Login button not responding, high priority',
          selective: true,
        },
      })
    } catch (err) {
      await this.safeAnswerError(ctx, 'Operation failed, please retry')
    }
  }

  // ── Message interceptor (called from onCommand when mode === 'issue_creation') ─

  /**
   * Handle the user's issue description message.
   *
   * Called by TelegramBotService.onCommand() when chatContext.mode === 'issue_creation'.
   * Constructs a natural-language prompt and dispatches it to the current session
   * so Claude can call the create_issue MCP tool via IssueNativeCapability.
   *
   * Known Limitation: if the user sends a photo while in issue_creation mode, it
   * bypasses this interceptor and goes through the normal photo handler. The mode
   * is NOT reset. In private chat scenarios this is acceptable; group chat support
   * would require adding a similar check in onPhotoMessage.
   */
  async handleCreationMessage(ctx: Context, text: string): Promise<void> {
    const chatId = String(ctx.message?.chat?.id ?? ctx.chat?.id ?? 0)
    const userId = (ctx.from?.id ?? 0) as number

    // Match cancellation commands in any supported language
    if (/^cancel$/i.test(text.trim()) || text.startsWith('/')) {
      this.deps.chatContext.reset(this.deps.botId, chatId)
      await this.deps.sendToChat(chatId, this.plainMessage('✅ Issue creation cancelled. Send a message to continue chatting.'))
      return
    }

    // Reset mode immediately — prevents the next message from being intercepted
    this.deps.chatContext.patch(this.deps.botId, chatId, { mode: 'normal' })

    // Dispatch to current session as a natural-language prompt.
    // Claude will use the create_issue MCP tool (via IssueNativeCapability) to create the issue.
    const prompt = `Please help me create an Issue with the following description: ${text}`
    await this.deps.dispatchUserMessage(chatId, userId, prompt)
  }

  // ── Private formatting helpers ─────────────────────────────────────────────

  private formatIssueList(
    issues: Awaited<ReturnType<IssueService['listIssues']>>,
    status: IssueStatus,
    activeProjectName?: string,
  ): FormattedMessage {
    const MAX_ITEMS = 20
    const shown = issues.slice(0, MAX_ITEMS)
    const truncated = issues.length > MAX_ITEMS

    const header = [
      `🐛 <b>Issues — ${STATUS_LABEL[status]} (${issues.length} items)</b>`,
      activeProjectName ? `📁 ${escapeHtml(activeProjectName)}` : null,
    ].filter(Boolean).join('\n')

    if (shown.length === 0) {
      return {
        text: `${header}\n\nNo issues with ${STATUS_LABEL[status]} status.`,
        parse_mode: 'HTML',
      }
    }

    const lines = shown.map((issue) => {
      const icon = PRIORITY_ICON[issue.priority]
      const shortId = issue.id.slice(0, 6)
      return `• ${escapeHtml(issue.title)}   ${icon} ${issue.priority}   <code>#${shortId}</code>`
    })

    const footer = truncated ? `\n<i>...showing first ${MAX_ITEMS} of ${issues.length} items</i>` : ''

    return {
      text: `${header}\n\n${lines.join('\n')}${footer}`,
      parse_mode: 'HTML',
    }
  }

  private errorMessage(msg: string): FormattedMessage {
    return { text: `❌ ${msg}`, parse_mode: 'HTML' }
  }

  private plainMessage(msg: string): FormattedMessage {
    return { text: msg, parse_mode: 'HTML' }
  }

  private async safeAnswerError(ctx: CallbackQueryContext<Context>, text: string): Promise<void> {
    try { await ctx.answerCallbackQuery({ text, show_alert: true }) } catch { /* ignore */ }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
