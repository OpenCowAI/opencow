// SPDX-License-Identifier: Apache-2.0

import type { Issue, IssueProvider, UserMessageContent } from '@shared/types'
import { buildIssuePrompt, type IssueRemoteContext } from '@shared/issuePromptBuilder'
import { getAppAPI } from '@/windowAPI'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface IssueSessionPromptResult {
  prompt: UserMessageContent
  projectPath: string | undefined
}

export interface BuildIssueSessionPromptOptions {
  /** Available projects — used to resolve `issue.projectId` → file-system path. */
  projects: Array<{ id: string; path: string }>
  /** Locale-aware call-to-action appended at the end (e.g. t('pleaseWorkOnIssue')). */
  actionText?: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Resolve a projectId to its file-system path from the projects list.
 *
 * Extracted as a named function so every call site expresses the same intent
 * without inlining `projects.find(p => p.id === id)?.path` — a pattern that
 * appears 20+ times across the renderer and is easy to point at the wrong
 * store by mistake (the original bug: `useIssueStore` instead of `useAppStore`).
 */
export function resolveProjectPath(
  projectId: string | null | undefined,
  projects: ReadonlyArray<{ id: string; path: string }>,
): string | undefined {
  if (!projectId) return undefined
  return projects.find((p) => p.id === projectId)?.path
}

// ─── Core ───────────────────────────────────────────────────────────────────

/**
 * Build a session prompt from an Issue, resolving the project path and
 * expanding slash command source files.
 *
 * This is the **single canonical entry point** for preparing a prompt before
 * calling `startSession()`. All UI call sites (FormModal, DetailView,
 * ContextMenu) should use this instead of inlining the readSource + prompt
 * building logic.
 */
export async function buildIssueSessionPrompt(
  issue: Pick<Issue, 'title' | 'description' | 'richContent' | 'images' | 'projectId' | 'providerId' | 'remoteNumber' | 'remoteUrl' | 'remoteState' | 'syncStatus'>,
  options: BuildIssueSessionPromptOptions,
): Promise<IssueSessionPromptResult> {
  const projectPath = resolveProjectPath(issue.projectId, options.projects)

  const readSource = async (sourcePath: string): Promise<string> => {
    const result = await getAppAPI()['read-capability-source'](sourcePath, projectPath)
    return result.content
  }

  // Resolve remote context if the issue is linked to a provider
  let remoteContext: IssueRemoteContext | null = null
  if (issue.providerId) {
    try {
      const provider: IssueProvider | null = await getAppAPI()['issue-provider:get'](issue.providerId)
      if (provider) {
        remoteContext = {
          platform: provider.platform,
          repoOwner: provider.repoOwner,
          repoName: provider.repoName,
          remoteNumber: issue.remoteNumber ?? null,
          remoteUrl: issue.remoteUrl ?? null,
          remoteState: issue.remoteState ?? null,
          syncStatus: issue.syncStatus ?? null,
        }
      }
    } catch {
      // Best-effort — remote context failure should not block session start
    }
  }

  const prompt = await buildIssuePrompt(issue, {
    readSource,
    actionText: options.actionText,
    remoteContext,
  })

  return { prompt, projectPath }
}
