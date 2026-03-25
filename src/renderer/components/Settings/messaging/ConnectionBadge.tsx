// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from 'react-i18next'
import type { IMConnectionStatus, IMConnectionStatusType } from '@shared/types'

const STATUS_MAP: Record<IMConnectionStatusType, { dot: string; labelKey: string }> = {
  connected:    { dot: 'bg-emerald-500',             labelKey: 'messaging.connectionStatus.connected'    },
  connecting:   { dot: 'bg-amber-500 animate-pulse', labelKey: 'messaging.connectionStatus.connecting'   },
  disconnected: { dot: 'bg-zinc-400',                labelKey: 'messaging.connectionStatus.disconnected' },
  error:        { dot: 'bg-red-500',                 labelKey: 'messaging.connectionStatus.error'        },
}

interface ConnectionBadgeProps {
  status: IMConnectionStatus | null
  /** When true, shows only the dot + label (no username, no error detail). */
  compact?: boolean
}

export function ConnectionBadge({ status, compact }: ConnectionBadgeProps): React.JSX.Element | null {
  const { t } = useTranslation('settings')

  if (!status) {
    return null
  }

  const info = STATUS_MAP[status.connectionStatus] ?? STATUS_MAP.disconnected

  return (
    <div className="flex items-center gap-1.5">
      <span className={`inline-block h-1.5 w-1.5 rounded-full flex-none ${info.dot}`} />
      <span className="text-[11px] text-[hsl(var(--muted-foreground))]">{t(info.labelKey)}</span>
      {!compact && status.metadata?.botUsername && (
        <span className="text-[11px] text-[hsl(var(--muted-foreground))]">@{status.metadata.botUsername}</span>
      )}
      {!compact && status.lastError && status.connectionStatus === 'error' && (
        <span
          className="text-[11px] text-red-500 truncate max-w-[180px]"
          title={status.lastError}
        >
          {status.lastError}
        </span>
      )}
    </div>
  )
}
