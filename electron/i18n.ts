// SPDX-License-Identifier: Apache-2.0

// electron/i18n.ts — Main process only, contains Electron native UI labels.
// Not shared with the renderer layer, not bundled into renderer.

import type { SupportedLocale } from '@shared/i18n'
import { APP_NAME } from '@shared/appIdentity'

/** Only custom-label menu items need translation. Role items (copy/paste/undo, etc.) are auto-localized by macOS. */
export function getMenuLabels(locale: SupportedLocale): Record<string, string> {
  const labels: Record<SupportedLocale, Record<string, string>> = {
    'zh-CN': {
      appMenu:      APP_NAME,
      about:        `关于 ${APP_NAME}`,
      quit:         `退出 ${APP_NAME}`,
      hide:         `隐藏 ${APP_NAME}`,
      file:         '文件',
      edit:         '编辑',
      speech:       '语音',
      view:         '显示',
      window:       '窗口',
      help:         '帮助',
      githubLink:   `${APP_NAME} GitHub`,
      trayOpen:     `打开 ${APP_NAME}`,
      trayQuit:     '退出',
      trayTooltip:  '会话监控',
      quitConfirm: '再按一次 ⌘Q 退出',
      trayUpdateAvailable: '有新版本可用',
      trayCheckForUpdates: '检查更新…',
    },
    'en-US': {
      appMenu:      APP_NAME,
      about:        `About ${APP_NAME}`,
      quit:         `Quit ${APP_NAME}`,
      hide:         `Hide ${APP_NAME}`,
      file:         'File',
      edit:         'Edit',
      speech:       'Speech',
      view:         'View',
      window:       'Window',
      help:         'Help',
      githubLink:   `${APP_NAME} on GitHub`,
      trayOpen:     `Open ${APP_NAME}`,
      trayQuit:     'Quit',
      trayTooltip:  'Session Monitor',
      quitConfirm: 'Press ⌘Q again to quit',
      trayUpdateAvailable: 'Update Available',
      trayCheckForUpdates: 'Check for Updates…',
    },
  }
  return labels[locale]
}
