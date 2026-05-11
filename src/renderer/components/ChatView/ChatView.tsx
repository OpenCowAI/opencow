// SPDX-License-Identifier: Apache-2.0

import { useAgentSession, type AgentSessionHandle } from '@/hooks/useAgentSession'
import { AgentChatView } from './AgentChatView'
import { ChatHeader } from './ChatHeader'

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
// ════════════════════════════════════════════════════════════════════

export function ChatView(): React.JSX.Element {
  const agent = useAgentSession()
  return (
    <div className="relative flex-1 flex flex-col min-h-0">
      <DefaultChatLayout agent={agent} />
    </div>
  )
}

// ── Default Layout ──────────────────────────────────────────────────

function DefaultChatLayout({
  agent,
}: {
  agent: AgentSessionHandle
}): React.JSX.Element {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <ChatHeader
        sessions={agent.sessions}
        activeSessionId={agent.session?.id ?? null}
        onSelectSession={agent.selectSession}
      />
      <AgentChatView agent={agent} />
    </div>
  )
}
