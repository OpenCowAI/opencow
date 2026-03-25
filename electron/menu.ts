// SPDX-License-Identifier: Apache-2.0

import { Menu, shell } from 'electron'
import type { SupportedLocale } from '@shared/i18n'
import { getMenuLabels } from './i18n'

export interface MenuOptions {
  /** Custom quit handler (e.g. double-press confirmation). Falls back to app.quit(). */
  onQuit?: () => void
  /** Custom About handler — opens the renderer-side About dialog instead of the native panel. */
  onAbout?: () => void
}

export function setupApplicationMenu(locale: SupportedLocale, options?: MenuOptions): void {
  const isMac = process.platform === 'darwin'
  const m = getMenuLabels(locale)
  const quitHandler = options?.onQuit
  const aboutHandler = options?.onAbout

  // Build the Quit menu item: use custom handler when provided, role otherwise.
  const quitItem: Electron.MenuItemConstructorOptions = quitHandler
    ? { label: m.quit, accelerator: 'CmdOrCtrl+Q', click: () => quitHandler() }
    : { role: 'quit' as const, label: m.quit }

  // Build the About menu item: use custom handler to open the renderer-side
  // AboutDialog when provided; fall back to native Electron About panel.
  const aboutItem: Electron.MenuItemConstructorOptions = aboutHandler
    ? { label: m.about, click: () => aboutHandler() }
    : { role: 'about' as const, label: m.about }

  const template: Electron.MenuItemConstructorOptions[] = [
    // macOS app menu
    ...(isMac
      ? [
          {
            label: m.appMenu,
            submenu: [
              aboutItem,
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const, label: m.hide },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              quitItem
            ]
          }
        ]
      : []),

    // File menu
    {
      label: m.file,
      submenu: [isMac ? { role: 'close' as const } : quitItem]
    },

    // Edit menu
    {
      label: m.edit,
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        ...(isMac
          ? [
              { role: 'pasteAndMatchStyle' as const },
              { role: 'delete' as const },
              { role: 'selectAll' as const },
              { type: 'separator' as const },
              {
                label: m.speech,
                submenu: [
                  { role: 'startSpeaking' as const },
                  { role: 'stopSpeaking' as const }
                ]
              }
            ]
          : [
              { role: 'delete' as const },
              { type: 'separator' as const },
              { role: 'selectAll' as const }
            ])
      ]
    },

    // View menu
    {
      label: m.view,
      submenu: [
        { role: 'reload' as const },
        { role: 'forceReload' as const },
        { role: 'toggleDevTools' as const },
        { type: 'separator' as const },
        { role: 'resetZoom' as const },
        { role: 'zoomIn' as const },
        { role: 'zoomOut' as const },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const }
      ]
    },

    // Window menu
    {
      label: m.window,
      submenu: [
        { role: 'minimize' as const },
        { role: 'zoom' as const },
        ...(isMac
          ? [
              { type: 'separator' as const },
              { role: 'front' as const },
              { type: 'separator' as const },
              { role: 'window' as const }
            ]
          : [{ role: 'close' as const }])
      ]
    },

    // Help menu
    {
      role: 'help' as const,
      submenu: [
        {
          label: m.githubLink,
          click: async () => {
            await shell.openExternal('https://github.com')
          }
        }
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}
