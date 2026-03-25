// SPDX-License-Identifier: Apache-2.0

/**
 * ChatPanelErrorBoundary — Isolates BrowserAgentChat render crashes.
 *
 * BrowserAgentChat reuses SessionMessageList / SessionInputBar from the main
 * window's DetailPanel. Those components have deep dependencies (ToolUseBlockView
 * → useAppStore, useMonacoTheme, ContentViewerDialog, etc.) that may not be
 * fully satisfied in the browser window context. A render error in any of these
 * children must NOT collapse the toolbar or viewport.
 *
 * This boundary catches the error, logs it for diagnostics, and renders a
 * compact inline fallback within the chat panel area.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RotateCw } from 'lucide-react'
import { createLogger } from '@/lib/logger'

const log = createLogger('ChatPanelErrorBoundary')

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class ChatPanelErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    log.error('BrowserAgentChat render error', error, info.componentStack)
  }

  private handleRetry = (): void => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center h-full px-4 py-8 gap-3 text-center">
          <div className="h-9 w-9 rounded-full bg-[hsl(var(--destructive)/0.1)] flex items-center justify-center">
            <AlertTriangle className="h-4 w-4 text-[hsl(var(--destructive))]" />
          </div>

          <div>
            <p className="text-xs font-medium text-[hsl(var(--foreground))]">
              Chat panel encountered an error
            </p>
            <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-1 leading-relaxed max-w-[200px]">
              {this.state.error.message}
            </p>
          </div>

          <button
            type="button"
            onClick={this.handleRetry}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--accent))] transition-colors"
          >
            <RotateCw className="h-3 w-3" />
            Retry
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
