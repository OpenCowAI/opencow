// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo, useState } from 'react'
import { useAgentSession, type AgentSessionHandle } from '@/hooks/useAgentSession'
import { useAppStore } from '@/stores/appStore'
import { AgentChatView } from './AgentChatView'
import { ChatHeader } from './ChatHeader'
import type { SessionWorkspaceInput } from '@shared/types'

// ════════════════════════════════════════════════════════════════════
// ChatView — Agent page (default layout only).
//
// Single-owner rule: `useAgentSession()` is called ONCE here and the
// resulting handle is threaded down to child layouts. This guarantees
// a single `useMessageQueue` instance per session, preventing the
// duplicate auto-dispatch bug that caused queued messages to be sent
// twice.
//
// Layout: ChatHeader (top — title dropdown + new chat) + AgentChatView
// (flex-1). The legacy right-side AgentSidebar has been retired — its
// session list is now reachable via the title dropdown, and "new chat"
// lives in the header's top-right.
//
// Chat-folder override: in the sidebar Chat panel (chat home), the user
// can pick an arbitrary directory below the hero input.  That choice is
// stored locally here as `chatFolder` and forwarded to `useAgentSession`
// as a workspace override so the next NEW session is rooted at that
// folder.  Project-detail Chat tabs ignore this state entirely (the
// picker is only rendered when the agent's projectPath equals $HOME).
// ════════════════════════════════════════════════════════════════════

export function ChatView(): React.JSX.Element {
  const homeDir = useAppStore((s) => s.homeDir)
  const ensureHomeDir = useAppStore((s) => s.ensureHomeDir)

  // null = use default (home dir project via base.startWorkspace).
  // string = custom path the user picked from the folder picker.
  const [chatFolder, setChatFolder] = useState<string | null>(null)

  useEffect(() => {
    if (homeDir === null) void ensureHomeDir()
  }, [homeDir, ensureHomeDir])

  const workspaceOverride = useMemo<SessionWorkspaceInput | undefined>(
    () => (chatFolder ? { scope: 'custom-path', cwd: chatFolder } : undefined),
    [chatFolder],
  )

  const agent = useAgentSession({ workspaceOverride })

  return (
    <div className="relative flex-1 flex flex-col min-h-0">
      <DefaultChatLayout
        agent={agent}
        chatFolder={chatFolder}
        onSetChatFolder={setChatFolder}
        homeDir={homeDir}
      />
    </div>
  )
}

// ── Default Layout ──────────────────────────────────────────────────

function DefaultChatLayout({
  agent,
  chatFolder,
  onSetChatFolder,
  homeDir,
}: {
  agent: AgentSessionHandle
  chatFolder: string | null
  onSetChatFolder: (path: string | null) => void
  homeDir: string | null
}): React.JSX.Element {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <ChatHeader
        sessions={agent.sessions}
        activeSessionId={agent.session?.id ?? null}
        onSelectSession={agent.selectSession}
      />
      <AgentChatView
        agent={agent}
        chatFolder={chatFolder}
        onSetChatFolder={onSetChatFolder}
        homeDir={homeDir}
      />
    </div>
  )
}
