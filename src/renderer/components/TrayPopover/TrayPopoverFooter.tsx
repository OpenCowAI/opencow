// SPDX-License-Identifier: Apache-2.0

import React from 'react'
import { useTranslation } from 'react-i18next'
import { APP_NAME } from '@shared/appIdentity'

interface TrayPopoverFooterProps {
  onOpenMain: () => void
  onQuit: () => void
}

export function TrayPopoverFooter({ onOpenMain, onQuit }: TrayPopoverFooterProps): React.JSX.Element {
  const { t } = useTranslation('navigation')

  return (
    <div className="flex items-center justify-between px-2 py-1.5 border-t border-border/50">
      <button
        onClick={onOpenMain}
        className="text-xs font-medium text-primary px-2 py-1 rounded-md
          hover:bg-primary/10 hover:text-primary/90 active:bg-primary/15 active:scale-[0.97]
          transition-all duration-150 cursor-pointer"
      >
        {t('tray.openApp', { appName: APP_NAME })}
      </button>
      <button
        onClick={onQuit}
        className="text-xs text-muted-foreground px-2 py-1 rounded-md
          hover:bg-accent/80 hover:text-foreground active:bg-accent active:scale-[0.97]
          transition-all duration-150 cursor-pointer"
      >
        {t('quit', { ns: 'common' })}
      </button>
    </div>
  )
}
