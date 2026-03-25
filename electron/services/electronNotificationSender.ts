// SPDX-License-Identifier: Apache-2.0

import { Notification } from 'electron'
import type { NotificationSender, NotificationPayload } from './notificationService'
import { focusMainWindow } from '../window/windowManager'

export function createElectronNotificationSender(): NotificationSender {
  return {
    showNotification(payload: NotificationPayload): void {
      if (!Notification.isSupported()) return

      const notification = new Notification({
        title: payload.title,
        body: payload.body,
        silent: false
      })

      notification.on('click', () => {
        focusMainWindow()
      })

      notification.show()
    }
  }
}
