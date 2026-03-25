// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from 'react-i18next'
import type { FeishuConnection } from '@shared/types'
import { TextField, SecretField } from './fields'
import { GenericConfigPanel } from './GenericConfigPanel'

interface FeishuConfigPanelProps {
  connection: FeishuConnection
  onUpdate: (updated: FeishuConnection) => void
}

export function FeishuConfigPanel({ connection, onUpdate }: FeishuConfigPanelProps): React.JSX.Element {
  const { t } = useTranslation('settings')
  const domain = connection.domain ?? 'feishu'

  return (
    <GenericConfigPanel connection={connection} onUpdate={onUpdate}>
      {(patch) => (
        <>
          {/* Environment selector */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[hsl(var(--foreground))]">
              {t('messaging.feishu.environment')}
            </label>
            <div className="flex gap-2">
              {(['feishu', 'lark'] as const).map((env) => (
                <button
                  key={env}
                  type="button"
                  onClick={() => patch({ domain: env })}
                  className={[
                    'flex-1 px-3 py-2 rounded-lg border text-sm font-medium transition-all text-left',
                    domain === env
                      ? 'border-[hsl(var(--ring))] bg-[hsl(var(--primary)/0.06)] text-[hsl(var(--foreground))]'
                      : 'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--ring)/0.5)]',
                  ].join(' ')}
                >
                  <div>{t(`messaging.feishu.domain.${env}`)}</div>
                  <div className="text-[10px] font-normal mt-0.5 opacity-60">
                    {env === 'feishu' ? 'open.feishu.cn' : 'open.larksuite.com'}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <TextField
            label={t('messaging.feishu.appId')}
            value={connection.appId}
            placeholder={t('messaging.feishu.appIdPlaceholder')}
            onChange={(v) => patch({ appId: v })}
          />
          <SecretField
            label={t('messaging.feishu.appSecret')}
            value={connection.appSecret}
            placeholder={t('messaging.feishu.appSecretPlaceholder')}
            onChange={(v) => patch({ appSecret: v })}
          />
        </>
      )}
    </GenericConfigPanel>
  )
}
