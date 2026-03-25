// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from 'react-i18next'
import { FolderPlus } from 'lucide-react'

/**
 * Full-panel overlay shown when the user drags a file or directory
 * from the sidebar file tree onto the Issue detail panel.
 *
 * Visual cue: "Release to add to conversation context".
 */
export function DropOverlay(): React.JSX.Element {
  const { t } = useTranslation('sessions')

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-[hsl(var(--background)/0.75)] backdrop-blur-[2px] pointer-events-none">
      <div className="flex flex-col items-center gap-3 p-6 rounded-xl border-2 border-dashed border-[hsl(var(--primary)/0.5)] bg-[hsl(var(--primary)/0.04)]">
        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-[hsl(var(--primary)/0.1)]">
          <FolderPlus className="w-6 h-6 text-[hsl(var(--primary))]" aria-hidden="true" />
        </div>
        <p className="text-sm font-medium text-[hsl(var(--foreground))]">
          {t('contextMention.dropHint', { defaultValue: 'Release to add context' })}
        </p>
        <p className="text-xs text-[hsl(var(--muted-foreground))]">
          {t('contextMention.dropHintSub', {
            defaultValue: 'Files and directories will be added as conversation context',
          })}
        </p>
      </div>
    </div>
  )
}
