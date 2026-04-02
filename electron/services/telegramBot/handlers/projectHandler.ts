// SPDX-License-Identifier: Apache-2.0

/**
 * ProjectHandler — Telegram interaction layer for Project management.
 *
 * Handles the 2 menu items under the Projects group:
 *   cmd:projects         → handleList()         — grouped project info display
 *   cmd:projects:switch  → handleSwitchPrompt() — switch InlineKeyboard
 *   cmd:projects:switch:<id> → handleSwitch()   — apply project switch
 */

import type { Context, CallbackQueryContext } from 'grammy'
import type { ProjectService } from '../../projectService'
import type { ChatContextManager } from '../state/chatContextManager'
import type { FormattedMessage, InlineKeyboardButton } from '../messageFormatter'

// ─── Deps ─────────────────────────────────────────────────────────────────────

export interface ProjectHandlerDeps {
  projectService: ProjectService
  chatContext: ChatContextManager
  botId: string
  sendToChat: (chatId: string, msg: FormattedMessage) => Promise<void>
}

// ─── ProjectHandler ───────────────────────────────────────────────────────────

export class ProjectHandler {
  constructor(private readonly deps: ProjectHandlerDeps) {}

  // ── Callback handlers ─────────────────────────────────────────────────────

  /**
   * cmd:projects — display all projects grouped by pin / active / inactive.
   * Pure informational view — no switch buttons shown here.
   */
  async handleList(ctx: CallbackQueryContext<Context>): Promise<void> {
    try {
      await ctx.answerCallbackQuery()
      const chatId = String(ctx.callbackQuery.message?.chat?.id ?? 0)

      const all = await this.deps.projectService.listAll()
      const pinned   = all.filter((p) => p.pinOrder !== null)
                          .sort((a, b) => (a.pinOrder ?? 0) - (b.pinOrder ?? 0))
      const regular  = all.filter((p) => p.pinOrder === null && !p.archivedAt)
      // Archived projects are excluded from the daily workflow view

      await this.deps.sendToChat(chatId, this.formatProjectList(pinned, regular))
    } catch (err) {
      await this.safeAnswerError(ctx, 'Failed to load, please retry')
    }
  }

  /**
   * cmd:projects:switch — show the project switch InlineKeyboard.
   * Each non-archived project gets one switch button.
   */
  async handleSwitchPrompt(ctx: CallbackQueryContext<Context>): Promise<void> {
    try {
      await ctx.answerCallbackQuery()
      const chatId = String(ctx.callbackQuery.message?.chat?.id ?? 0)

      const all = await this.deps.projectService.listAll()
      const switchable = all.filter((p) => !p.archivedAt)
                            .sort((a, b) => {
                              // Pinned first, then by name
                              if (a.pinOrder !== null && b.pinOrder !== null) return a.pinOrder - b.pinOrder
                              if (a.pinOrder !== null) return -1
                              if (b.pinOrder !== null) return 1
                              return a.name.localeCompare(b.name)
                            })

      if (switchable.length === 0) {
        await this.deps.sendToChat(chatId, {
          text: '⚙️ <b>Switch Project</b>\n\nNo projects available.',
          parse_mode: 'HTML',
        })
        return
      }

      const buttons: InlineKeyboardButton[][] = switchable.map((p) => [{
        text: `${p.pinOrder !== null ? '📌 ' : ''}${p.name}`,
        callback_data: `cmd:projects:switch:${p.id}`,
      }])

      await this.deps.sendToChat(chatId, {
        text: '⚙️ <b>Switch Project</b>\n\nSelect the project to switch to (temporary, resets to default on Bot restart):',
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: buttons },
      })
    } catch (err) {
      await this.safeAnswerError(ctx, 'Failed to load, please retry')
    }
  }

  /**
   * cmd:projects:switch:<id> — apply the project switch for this chat.
   * Updates in-memory ChatContext; does NOT persist to SQLite.
   */
  async handleSwitch(ctx: CallbackQueryContext<Context>): Promise<void> {
    const projectId = ctx.match?.[1] as string | undefined
    const chatId    = String(ctx.callbackQuery?.message?.chat?.id ?? 0)

    if (!projectId) {
      await this.safeAnswerError(ctx, 'Invalid project ID')
      return
    }

    try {
      const project = await this.deps.projectService.getById(projectId)
      if (!project) {
        await ctx.answerCallbackQuery({ text: '❌ Project not found, please select again', show_alert: true })
        return
      }

      this.deps.chatContext.patch(this.deps.botId, chatId, {
        activeProjectName: project.name,
        activeProjectId:   project.id,
      })

      await ctx.answerCallbackQuery({ text: `✅ Switched to ${project.name}` })
      await this.deps.sendToChat(chatId, {
        text: [
          `✅ <b>Switched to project: ${escapeHtml(project.name)}</b>`,
          `📁 <code>${escapeHtml(project.canonicalPath)}</code>`,
          '',
          'New conversations will run under this project.',
          '💡 Resets to default project after Bot restart.',
        ].join('\n'),
        parse_mode: 'HTML',
      })
    } catch (err) {
      await this.safeAnswerError(ctx, 'Switch failed, please retry')
    }
  }

  // ── Private formatting helpers ─────────────────────────────────────────────

  private formatProjectList(
    pinned: Awaited<ReturnType<ProjectService['listAll']>>,
    regular: Awaited<ReturnType<ProjectService['listAll']>>,
  ): FormattedMessage {
    if (pinned.length === 0 && regular.length === 0) {
      return {
        text: '📂 <b>Project List</b>\n\nNo projects.',
        parse_mode: 'HTML',
      }
    }

    const lines: string[] = ['📂 <b>Project List</b>']

    if (pinned.length > 0) {
      lines.push('')
      lines.push('📌 <b>Pinned Projects</b>')
      pinned.forEach((p) => lines.push(`• ${escapeHtml(p.name)}`))
    }

    if (regular.length > 0) {
      lines.push('')
      lines.push('📁 <b>Other Projects</b>')
      regular.forEach((p) => lines.push(`• ${escapeHtml(p.name)}`))
    }

    return { text: lines.join('\n'), parse_mode: 'HTML' }
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
