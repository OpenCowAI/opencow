// SPDX-License-Identifier: Apache-2.0

import { Group, Panel, Separator } from 'react-resizable-panels'
import { useAppStore, selectProjectId } from '@/stores/appStore'
import { useAgentSession, type AgentSessionHandle } from '@/hooks/useAgentSession'
import { AgentChatView } from './AgentChatView'
import { AgentSidebar } from './AgentSidebar'
import { ChatPanel } from './ChatPanel'
import { ViewModeToggle } from './ViewModeToggle'
import { FilesViewForSelectedProject } from '@/components/FilesView/FilesView'

// ════════════════════════════════════════════════════════════════════
// ChatView — Agent page with view mode switching.
//
// Single-owner rule: `useAgentSession()` is called ONCE here and the
// resulting handle is threaded down to child layouts. This guarantees
// a single `useMessageQueue` instance per session, preventing the
// duplicate auto-dispatch bug that caused queued messages to be sent
// twice.
//
// Two modes:
//   • default: AgentChatView (left ~75%) + AgentSidebar (right ~25%)
//   • files:   ChatPanel (left ~40%)    + FilesView (right ~60%)
//
// The ViewModeToggle is rendered once in a stable toolbar row at the
// top — it never changes position between modes, ensuring zero jitter
// during transitions.
// ════════════════════════════════════════════════════════════════════

function FilesResizeHandle(): React.JSX.Element {
  return (
    <Separator
      className="w-px bg-[hsl(var(--border)/0.5)] relative data-[state=drag]:bg-[hsl(var(--ring)/0.7)] hover:bg-[hsl(var(--ring)/0.3)] transition-colors"
    >
      <div className="absolute inset-y-0 -left-1 -right-1" />
    </Separator>
  )
}

export function ChatView(): React.JSX.Element {
  const chatViewMode = useAppStore((s) => s.chatViewMode)
  const hasProject = useAppStore(selectProjectId) !== null

  // Single owner of the agent session — threaded to all child layouts.
  const agent = useAgentSession()

  return (
    <div className="relative flex-1 flex flex-col min-h-0">
      {/* Always at the same absolute position — stable across mode switches, no jitter */}
      {hasProject && (
        <div className="absolute top-1.5 left-3 z-10">
          <ViewModeToggle className="rounded-md bg-[hsl(var(--muted)/0.3)]" />
        </div>
      )}

      {/* Content area — switches layout based on mode, fade on switch */}
      <div key={chatViewMode} className="flex-1 flex flex-col min-h-0 view-switch-enter">
        {chatViewMode === 'default' ? (
          <DefaultChatLayout agent={agent} />
        ) : (
          <FilesChatLayout agent={agent} />
        )}
      </div>
    </div>
  )
}

// ── Default Layout: AgentChatView + AgentSidebar ────────────────────

function DefaultChatLayout({
  agent,
}: {
  agent: AgentSessionHandle
}): React.JSX.Element {
  return (
    <div className="flex-1 flex min-h-0">
      {/* Left — Chat */}
      <div className="flex-1 flex flex-col min-w-0">
        <AgentChatView agent={agent} />
      </div>

      {/* Right — Sidebar */}
      <AgentSidebar
        sessions={agent.sessions}
        activeSessionId={agent.session?.id ?? null}
        onSelectSession={agent.selectSession}
      />
    </div>
  )
}

// ── Files Layout: FilesView + ChatPanel ─────────────────────────────

function FilesChatLayout({
  agent,
}: {
  agent: AgentSessionHandle
}): React.JSX.Element {
  return (
    <Group
      id="claude-files-layout"
      orientation="horizontal"
      className="flex-1 min-h-0"
    >
      {/* Left — Chat */}
      <Panel
        id="claude-chat-pane"
        defaultSize="40%"
        minSize="25%"
        maxSize="60%"
      >
        <ChatPanel agent={agent} />
      </Panel>

      <FilesResizeHandle />

      {/* Right — Files */}
      <Panel
        id="claude-files-pane"
        defaultSize="60%"
        minSize="35%"
      >
        <FilesViewForSelectedProject layout={{ searchFabBottomOffsetPx: 36 }} />
      </Panel>
    </Group>
  )
}
