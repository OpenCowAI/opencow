// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from 'react-i18next'
import type { IMPlatformType } from '@shared/types'
import { PLATFORM_META } from './platformConfig'

export function PlatformBadge({ platform }: { platform: IMPlatformType }): React.JSX.Element {
  const { t } = useTranslation('settings')
  const meta = PLATFORM_META[platform]
  const Icon = meta.icon
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-medium ${meta.color}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {t(meta.labelKey)}
    </span>
  )
}
