// SPDX-License-Identifier: Apache-2.0

/**
 * XTermContainer — xterm.js rendering container.
 *
 * Responsibilities:
 * - xterm.js Terminal instance lifecycle (create / destroy)
 * - PTY connection (dual-mode: Create / Connect)
 * - Responsive sizing (FitAddon + ResizeObserver)
 * - Ring Buffer replay (restore output history after tab switch)
 *
 * Dual-mode connection:
 * - Create mode (terminalId = null): first open, calls ensure -> auto-registers the first tab
 * - Connect mode (terminalId is set): existing tab, directly replay + subscribe
 *
 * Full rebuild on tab switch via key={activeTerminalId ?? scopeKey}.
 */

import { useRef, useEffect, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { useTerminalOverlayStore } from '@/stores/terminalOverlayStore'
import { getAppAPI } from '@/windowAPI'
import type { TerminalScope } from '@shared/types'
import '@xterm/xterm/css/xterm.css'

interface XTermContainerProps {
  scope: TerminalScope
  terminalId: string | null
}

/** xterm.js theme — follows CSS custom properties (adapts to light/dark) */
function getTheme(): Record<string, string> {
  const style = getComputedStyle(document.documentElement)
  const hsl = (v: string): string => `hsl(${style.getPropertyValue(v).trim()})`

  return {
    background: hsl('--background'),
    foreground: hsl('--foreground'),
    cursor: hsl('--foreground'),
    cursorAccent: hsl('--background'),
    selectionBackground: hsl('--ring'),
    selectionForeground: hsl('--background'),
  }
}

export function XTermContainer({ scope, terminalId }: XTermContainerProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)

  const ensureTerminalTab = useTerminalOverlayStore((s) => s.ensureTerminalTab)

  // Scope key for Tab group registration
  const scopeKey = scope.type === 'global' ? 'global' : `project:${scope.projectId}`

  const connectTerminal = useCallback(async (term: Terminal, fitAddon: FitAddon) => {
    const api = getAppAPI()
    let termId: string

    if (terminalId) {
      // ── Connect mode: existing tab, connect directly ──
      termId = terminalId
    } else {
      // ── Create mode: first open, ensure + register the first tab ──
      const info = await api['terminal:ensure']({
        scope,
        cols: term.cols,
        rows: term.rows,
      })
      termId = info.id
      const shellName = info.shell.split('/').pop() ?? 'terminal'
      ensureTerminalTab(scopeKey, termId, shellName)
    }

    // Replay buffered output
    const replay = await api['terminal:replay'](termId)
    if (replay) {
      term.write(replay)
    }

    // Subscribe to PTY output
    const unsubOutput = api['terminal:onOutput'](termId, (data: string) => {
      term.write(data)
    })

    // Forward user input to PTY
    const inputDisposable = term.onData((data: string) => {
      api['terminal:write'](termId, data)
    })

    // Forward resize events
    const resizeDisposable = term.onResize(({ cols, rows }) => {
      api['terminal:resize'](termId, cols, rows)
    })

    // Initial fit
    fitAddon.fit()

    return () => {
      unsubOutput()
      inputDisposable.dispose()
      resizeDisposable.dispose()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalId, scopeKey])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // Create xterm.js instance
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      lineHeight: 1.2,
      theme: getTheme(),
      allowProposedApi: true,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(new WebLinksAddon((_event, uri) => {
      // Electron's setWindowOpenHandler intercepts window.open and calls shell.openExternal
      window.open(uri)
    }))

    term.open(container)

    // Try WebGL, fallback to canvas
    try {
      term.loadAddon(new WebglAddon())
    } catch {
      // WebGL not available — canvas renderer is fine
    }

    termRef.current = term
    fitAddonRef.current = fitAddon

    // Connect to PTY
    let ptyCleanup: (() => void) | null = null
    connectTerminal(term, fitAddon)
      .then((cleanup) => {
        ptyCleanup = cleanup
        // Auto-focus after connection is ready so the terminal accepts input immediately
        term.focus()
      })
      .catch((err) => {
        term.write(`\r\n\x1b[31mFailed to connect terminal: ${err}\x1b[0m\r\n`)
      })

    // ResizeObserver for auto-fit
    const observer = new ResizeObserver(() => {
      fitAddon.fit()
    })
    observer.observe(container)

    // Theme change listener
    const themeObserver = new MutationObserver(() => {
      term.options.theme = getTheme()
    })
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style'],
    })

    cleanupRef.current = () => {
      ptyCleanup?.()
      themeObserver.disconnect()
      observer.disconnect()
      term.dispose()
    }

    return () => {
      cleanupRef.current?.()
      cleanupRef.current = null
      termRef.current = null
      fitAddonRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalId, scopeKey])

  return (
    <div
      ref={containerRef}
      className="h-full w-full px-2 py-1"
    />
  )
}
