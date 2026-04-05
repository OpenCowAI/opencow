// SPDX-License-Identifier: Apache-2.0

import type { BrowserSource, BrowserStatePolicy } from './types'

export interface BrowserStatePolicyResolutionInput {
  source: BrowserSource
  requestedPolicy: BrowserStatePolicy
  projectId?: string | null
  issueId?: string | null
  sessionId?: string | null
}

export function defaultBrowserStatePolicyForSource(source: BrowserSource): BrowserStatePolicy {
  switch (source.type) {
    case 'standalone':
    case 'issue-session':
    case 'issue-standalone':
    case 'chat-session':
      return 'shared-global'
  }
}

export function normalizeBrowserStatePolicy(input: BrowserStatePolicyResolutionInput): BrowserStatePolicy {
  const { source, requestedPolicy } = input
  const projectId = input.projectId ?? null
  const issueId = input.issueId ?? inferIssueId(source)
  const sessionId = input.sessionId ?? inferSessionId(source)

  switch (requestedPolicy) {
    case 'shared-project':
      return projectId ? 'shared-project' : 'shared-global'
    case 'isolated-issue':
      if (issueId) return 'isolated-issue'
      return sessionId ? 'isolated-session' : 'shared-global'
    case 'isolated-session':
      return sessionId ? 'isolated-session' : 'shared-global'
    case 'shared-global':
    case 'custom-profile':
    default:
      return requestedPolicy
  }
}

function inferIssueId(source: BrowserSource): string | null {
  switch (source.type) {
    case 'issue-session':
    case 'issue-standalone':
      return source.issueId
    case 'chat-session':
    case 'standalone':
      return null
  }
}

function inferSessionId(source: BrowserSource): string | null {
  switch (source.type) {
    case 'issue-session':
    case 'chat-session':
      return source.sessionId
    case 'issue-standalone':
    case 'standalone':
      return null
  }
}
