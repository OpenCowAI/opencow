// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from 'react-i18next'
import type { DiscordConnection } from '@shared/types'
import { TextField, SecretField } from './fields'
import { GenericConfigPanel } from './GenericConfigPanel'

interface DiscordConfigPanelProps {
  connection: DiscordConnection
  onUpdate: (updated: DiscordConnection) => void
}

export function DiscordConfigPanel({ connection, onUpdate }: DiscordConfigPanelProps): React.JSX.Element {
  const { t } = useTranslation('settings')

  return (
    <GenericConfigPanel connection={connection} onUpdate={onUpdate}>
      {(patch) => (
        <>
          <SecretField
            label={t('messaging.discord.botToken')}
            value={connection.botToken}
            placeholder={t('messaging.discord.botTokenPlaceholder')}
            onChange={(v) => patch({ botToken: v })}
          />
          <TextField
            label={t('messaging.discord.guildId')}
            value={connection.guildId ?? ''}
            placeholder={t('messaging.discord.guildIdPlaceholder')}
            onChange={(v) => patch({ guildId: v || undefined })}
          />
        </>
      )}
    </GenericConfigPanel>
  )
}
