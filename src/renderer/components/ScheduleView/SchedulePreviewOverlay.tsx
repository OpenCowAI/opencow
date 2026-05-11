// SPDX-License-Identifier: Apache-2.0

import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { DetailPreviewOverlay } from '@/components/ui/DetailPreviewOverlay'
import { ScheduleDetailView } from '../DetailPanel/ScheduleDetailView'

// ─── SchedulePreviewOverlay ─────────────────────────────────────────────────

interface SchedulePreviewOverlayProps {
  /** The schedule to display.  Updates swap the panel without remount. */
  scheduleId: string
  /** Called when the panel should close. */
  onClose: () => void
  /**
   * Modal toggle (see `DetailPreviewOverlay`).  Defaults to non-modal so
   * the underlying schedule list stays clickable for instant swap.
   */
  modal?: boolean
}

/**
 * Schedule-detail flavor of the shared `DetailPreviewOverlay`.  Thin
 * wrapper — there's no analogue to the issue panel's in-place sub-issue
 * navigation, so this just forwards `scheduleId` straight to
 * `ScheduleDetailView`.
 */
export const SchedulePreviewOverlay = memo(function SchedulePreviewOverlay({
  scheduleId,
  onClose,
  modal = false,
}: SchedulePreviewOverlayProps): React.JSX.Element {
  const { t } = useTranslation('schedule')

  return (
    <DetailPreviewOverlay
      onClose={onClose}
      modal={modal}
      ariaLabel={t('detail.previewAria', { defaultValue: 'Schedule preview' })}
      swapTargetSelector="[data-schedule-row]"
    >
      {(requestClose) => (
        <ScheduleDetailView scheduleId={scheduleId} onClose={requestClose} />
      )}
    </DetailPreviewOverlay>
  )
})
