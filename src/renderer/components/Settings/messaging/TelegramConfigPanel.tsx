// SPDX-License-Identifier: Apache-2.0

import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import type { TelegramConnection, IMConnectionStatus } from '@shared/types'
import { getAppAPI } from '@/windowAPI'
import { SecretField } from './fields'
import { GenericConfigPanel } from './GenericConfigPanel'
import { SetupGuideTooltip } from './SetupGuideTooltip'

// ── Telegram config panel ────────────────────────────────────────────────────

interface TelegramConfigPanelProps {
  connection: TelegramConnection
  status: IMConnectionStatus | null
  onUpdate: (updated: TelegramConnection) => void
}

export function TelegramConfigPanel({
  connection,
  status,
  onUpdate,
}: TelegramConfigPanelProps): React.JSX.Element {
  const { t } = useTranslation('settings')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null)

  const handleTest = useCallback(async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await getAppAPI()['messaging:test'](connection.id)
      setTestResult(result)
    } catch (err) {
      setTestResult({ success: false, error: String(err) })
    } finally {
      setTesting(false)
    }
  }, [connection.id])

  const isConnected = status?.connectionStatus === 'connected'

  return (
    <GenericConfigPanel
      connection={connection}
      onUpdate={onUpdate}
      afterCredentials={
        <>
          {/* Test connection */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleTest}
              disabled={testing || !connection.botToken}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[hsl(var(--border))] text-sm hover:bg-[hsl(var(--accent))] transition-colors disabled:opacity-50"
            >
              {testing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t('messaging.testConnection')}
            </button>
            <SetupGuideTooltip />
            {testResult && (
              <span className={`text-xs ${testResult.success ? 'text-emerald-600' : 'text-red-500'}`}>
                {testResult.success ? t('messaging.testConnected') : t('messaging.testFailed', { error: testResult.error ?? 'Failed' })}
              </span>
            )}
          </div>

          {/* Runtime stats (when connected) */}
          {isConnected && status?.metadata && (
            <div className="flex gap-4 text-xs text-[hsl(var(--muted-foreground))]">
              <span>{t('messaging.telegram.statsReceived', { count: status.metadata.messagesReceived ?? 0 })}</span>
              <span>{t('messaging.telegram.statsSent', { count: status.metadata.messagesSent ?? 0 })}</span>
              {status.connectedAt && (
                <span>{t('messaging.telegram.since', { time: new Date(status.connectedAt).toLocaleTimeString() })}</span>
              )}
            </div>
          )}
        </>
      }
    >
      {(patch) => (
        <SecretField
          label={t('messaging.telegram.botToken')}
          value={connection.botToken}
          placeholder={t('messaging.telegram.botTokenPlaceholder')}
          onChange={(v) => patch({ botToken: v })}
        />
      )}
    </GenericConfigPanel>
  )
}
