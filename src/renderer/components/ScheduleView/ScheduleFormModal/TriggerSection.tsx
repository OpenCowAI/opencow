// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DateTimePicker } from '@/components/ui/DateTimePicker'
import { TimePicker } from '@/components/ui/TimePicker'
import {
  FREQ_PRESETS,
  WEEKDAY_LABEL_KEYS,
} from './constants'
import {
  computeNextRunPreview,
  intervalHint,
} from './useScheduleForm'
import type { FormAction, TimeFreqState } from './useScheduleForm'

// ---------------------------------------------------------------------------
// TriggerSection
// ---------------------------------------------------------------------------

interface TriggerSectionProps {
  timeTrigger: TimeFreqState
  dispatch: React.Dispatch<FormAction>
}

export function TriggerSection({
  timeTrigger,
  dispatch,
}: TriggerSectionProps): React.JSX.Element {
  const { t } = useTranslation('schedule')
  return (
    <div className="space-y-3">
      <label className="block text-xs font-medium text-[hsl(var(--muted-foreground))]">
        {t('trigger.label')}
      </label>

      <TimeTriggerConfig timeTrigger={timeTrigger} dispatch={dispatch} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// TimeTriggerConfig
// ---------------------------------------------------------------------------

function TimeTriggerConfig({
  timeTrigger,
  dispatch,
}: {
  timeTrigger: TimeFreqState
  dispatch: React.Dispatch<FormAction>
}): React.JSX.Element {
  const { t } = useTranslation('schedule')
  const [showCron, setShowCron] = useState(timeTrigger.freqType === 'cron')
  useEffect(() => {
    if (timeTrigger.freqType !== 'cron') {
      setShowCron(false)
    }
  }, [timeTrigger.freqType])

  const nextRun = computeNextRunPreview(timeTrigger, t)

  return (
    <div className="space-y-3 rounded-xl border border-[hsl(var(--border)/0.6)] bg-[hsl(var(--muted)/0.12)] p-3">

      {/* Preset chips */}
      <div className="flex flex-wrap gap-1.5">
        {FREQ_PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => dispatch({ type: 'APPLY_FREQ_PRESET', payload: preset })}
            className={cn(
              'px-2.5 py-1 text-xs rounded-md border transition-colors',
              timeTrigger.selectedPresetLabel === preset.label
                ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.08)] text-[hsl(var(--foreground))] font-medium'
                : 'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:border-[hsl(var(--border)/0.8)]'
            )}
          >
            {t(preset.labelKey)}
          </button>
        ))}

        {/* Cron toggle */}
        <button
          type="button"
          onClick={() => {
            setShowCron((v) => !v)
            if (!showCron) dispatch({ type: 'SET_FREQ_TYPE', payload: 'cron' })
          }}
          className={cn(
            'px-2.5 py-1 text-xs rounded-md border transition-colors',
            timeTrigger.freqType === 'cron'
              ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.08)] text-[hsl(var(--foreground))] font-medium'
              : 'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'
          )}
        >
          Cron
        </button>
      </div>

      {/* ── Once: calendar + time picker ── */}
      {timeTrigger.freqType === 'once' && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-[hsl(var(--muted-foreground))] shrink-0">{t('trigger.executeAt')}</span>
          <DateTimePicker
            value={timeTrigger.executeAt}
            onChange={(v) => dispatch({ type: 'SET_EXECUTE_AT', payload: v })}
            minDate={new Date(Date.now() + 60_000)}
            placeholder={t('trigger.pickDateTime')}
          />
        </div>
      )}

      {/* Interval detail */}
      {timeTrigger.freqType === 'interval' && (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-xs text-[hsl(var(--muted-foreground))]">{t('trigger.every')}</span>
            <input
              type="number"
              min={1}
              max={10080}
              value={timeTrigger.intervalMinutes}
              onChange={(e) =>
                dispatch({ type: 'SET_INTERVAL_MINUTES', payload: Math.max(1, Number(e.target.value)) })
              }
              className="w-20 px-2 py-1 text-xs rounded-md border border-[hsl(var(--border))] bg-transparent focus:outline-none focus:ring-1 focus:ring-[hsl(var(--ring))]"
            />
            <span className="text-xs text-[hsl(var(--muted-foreground))]">{t('trigger.minutes')}</span>
          </div>
          {/* Semantic hint (P2) */}
          <p className="text-[11px] text-[hsl(var(--muted-foreground)/0.7)] pl-[52px]">
            {intervalHint(timeTrigger.intervalMinutes, t)}
          </p>
        </div>
      )}

      {/* Time-of-day picker (daily / weekly / monthly) */}
      {(timeTrigger.freqType === 'daily' ||
        timeTrigger.freqType === 'weekly' ||
        timeTrigger.freqType === 'monthly') && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-[hsl(var(--muted-foreground))]">{t('trigger.at')}</span>
          <TimePicker
            value={timeTrigger.timeOfDay}
            onChange={(v) => dispatch({ type: 'SET_TIME_OF_DAY', payload: v })}
            ariaLabel={t('trigger.at')}
          />
        </div>
      )}

      {/* Weekday picker */}
      {timeTrigger.freqType === 'weekly' && (
        <div className="flex gap-1">
          {WEEKDAY_LABEL_KEYS.map((labelKey, day) => (
            <button
              key={day}
              type="button"
              onClick={() => dispatch({ type: 'TOGGLE_DAY', payload: day })}
              className={cn(
                'w-9 h-8 text-xs rounded-md border transition-colors font-medium',
                timeTrigger.daysOfWeek.includes(day)
                  ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.1)] text-[hsl(var(--foreground))]'
                  : 'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'
              )}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>
      )}

      {/* Cron expression (P1: no native select) */}
      {(timeTrigger.freqType === 'cron' || showCron) && (
        <div className="space-y-1">
          {timeTrigger.freqType !== 'cron' && (
            <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
              {t('trigger.cronAdvancedHint')}
            </p>
          )}
          <input
            type="text"
            value={timeTrigger.cronExpression}
            onChange={(e) => dispatch({ type: 'SET_CRON', payload: e.target.value })}
            placeholder="0 9 * * 1-5"
            className="w-full px-2 py-1.5 text-xs font-mono rounded-md border border-[hsl(var(--border))] bg-transparent focus:outline-none focus:ring-1 focus:ring-[hsl(var(--ring))]"
          />
          <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
            {t('trigger.cronHelp')}
          </p>
        </div>
      )}

      {/* Next run preview */}
      {nextRun && (
        <p className={cn(
          'text-[11px] flex items-center gap-1',
          nextRun.startsWith('⚠')
            ? 'text-amber-500'
            : 'text-[hsl(var(--muted-foreground))]'
        )}>
          {!nextRun.startsWith('⚠') && <Clock className="h-3 w-3 shrink-0" />}
          {nextRun.startsWith('⚠') ? nextRun : `${t('trigger.nextExecution')} ${nextRun}`}
        </p>
      )}
    </div>
  )
}

