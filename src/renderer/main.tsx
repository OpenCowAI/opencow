// SPDX-License-Identifier: Apache-2.0

import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { initI18n } from './i18n'
import './globals.css'

// Register all translation resources synchronously (before React tree mounts)
initI18n()

// React Grab — dev-only element context selector for AI coding agents.
// Hover over any element and use the toolbar (or activation key) to copy
// component name + file path + HTML to clipboard, then paste into Claude Code.
if (import.meta.env.DEV) {
  import('react-grab').then(({ getGlobalApi }) => {
    const api = getGlobalApi()
    if (!api) return

    api.registerPlugin({
      name: 'opencow-dev',
      options: {
        // Use toggle mode — press once to activate, press again to deactivate.
        // This avoids conflicts with Electron's native ⌘C copy shortcut.
        activationMode: 'toggle'
      },
      hooks: {
        transformCopyContent(content: string) {
          // Rewrite Vite dev-server URLs to project-relative paths
          // e.g. "//localhost:5173/src/renderer/..." → "src/renderer/..."
          return content.replace(/\/\/localhost:\d+\/src\//g, 'src/')
        }
      }
    })
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
