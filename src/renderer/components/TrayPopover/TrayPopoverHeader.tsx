// SPDX-License-Identifier: Apache-2.0

import React from 'react'
import { APP_NAME } from '@shared/appIdentity'

interface TrayPopoverHeaderProps {
  appVersion: string
}

export function TrayPopoverHeader({ appVersion }: TrayPopoverHeaderProps): React.JSX.Element {
  return (
    <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-border/50">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-foreground">{APP_NAME}</span>
        <span className="text-[10px] text-muted-foreground font-medium tabular-nums">
          v{appVersion}
        </span>
      </div>
    </div>
  )
}
