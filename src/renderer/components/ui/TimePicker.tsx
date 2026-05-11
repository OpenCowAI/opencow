// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Clock, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TimePickerProps {
  /** "HH:MM" 24-hour string, e.g. "09:30". Falls back to "09:00" when empty/invalid. */
  value: string
  onChange: (value: string) => void
  /** Aria-label for the trigger button. */
  ariaLabel?: string
  className?: string
  /** Stride for the minute column. 1 (default) = every minute, 5 = 5-min steps, etc. */
  minuteStep?: number
}

interface AnchorPos { left: number; bottom: number }

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIME = '09:00'
const POPOVER_W = 168
const POPOVER_ANIM_MS = 100
const COL_HEIGHT_PX = 200
const ITEM_HEIGHT_PX = 28

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseTime(value: string): { hour: number; minute: number } {
  const match = /^(\d{1,2}):(\d{1,2})$/.exec(value.trim())
  if (!match) return { hour: 9, minute: 0 }
  const hour = Math.min(23, Math.max(0, parseInt(match[1] ?? '9', 10)))
  const minute = Math.min(59, Math.max(0, parseInt(match[2] ?? '0', 10)))
  return { hour, minute }
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

// ---------------------------------------------------------------------------
// TimePicker
// ---------------------------------------------------------------------------

/**
 * Custom time picker — pill trigger + popover with two scrolling columns.
 *
 * Built to match `DateTimePicker`'s visual language and avoid the OS-native
 * `<input type="time">` chrome that doesn't match the rest of the app.
 */
export function TimePicker({
  value,
  onChange,
  ariaLabel,
  className,
  minuteStep = 1,
}: TimePickerProps): React.JSX.Element {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const [isClosing, setIsClosing] = useState(false)
  const [anchor, setAnchor] = useState<AnchorPos | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hourColRef = useRef<HTMLDivElement>(null)
  const minuteColRef = useRef<HTMLDivElement>(null)

  const { hour, minute } = useMemo(
    () => parseTime(value || DEFAULT_TIME),
    [value]
  )
  const display = `${pad(hour)}:${pad(minute)}`

  const hours = useMemo(() => Array.from({ length: 24 }, (_, i) => i), [])
  const minutes = useMemo(() => {
    const step = Math.max(1, Math.min(30, Math.floor(minuteStep)))
    const out: number[] = []
    for (let m = 0; m < 60; m += step) out.push(m)
    // Always include the current minute so a non-aligned value stays visible.
    if (!out.includes(minute)) {
      out.push(minute)
      out.sort((a, b) => a - b)
    }
    return out
  }, [minuteStep, minute])

  const closePopover = useCallback((): void => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    setIsClosing(true)
    closeTimer.current = setTimeout(() => {
      setOpen(false)
      setIsClosing(false)
      setAnchor(null)
    }, POPOVER_ANIM_MS)
  }, [])

  const handleToggle = (): void => {
    if (open || isClosing) {
      closePopover()
      return
    }
    if (triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect()
      const clampedLeft = Math.min(r.left, window.innerWidth - POPOVER_W - 8)
      setAnchor({ left: clampedLeft, bottom: window.innerHeight - r.top + 6 })
    }
    setOpen(true)
  }

  // Auto-scroll each column to its selected value on open.
  useEffect(() => {
    if (!open || isClosing) return
    const scrollTo = (
      col: HTMLDivElement | null,
      list: number[],
      target: number,
    ): void => {
      if (!col) return
      const idx = list.indexOf(target)
      if (idx < 0) return
      // Center the selected row in the visible viewport.
      const target_offset = idx * ITEM_HEIGHT_PX - col.clientHeight / 2 + ITEM_HEIGHT_PX / 2
      col.scrollTop = Math.max(0, target_offset)
    }
    // Defer until popover is laid out so clientHeight is non-zero.
    const id = requestAnimationFrame(() => {
      scrollTo(hourColRef.current, hours, hour)
      scrollTo(minuteColRef.current, minutes, minute)
    })
    return () => cancelAnimationFrame(id)
  }, [open, isClosing, hours, minutes, hour, minute])

  const setHour = (h: number): void => onChange(`${pad(h)}:${pad(minute)}`)
  const setMinute = (m: number): void => onChange(`${pad(hour)}:${pad(m)}`)

  const isOpen = open && !isClosing

  return (
    <div className={cn('inline-block', className)}>
      {/* ── Trigger ── */}
      <button
        ref={triggerRef}
        type="button"
        onClick={handleToggle}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={ariaLabel ?? t('timePicker.ariaLabel')}
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md border border-[hsl(var(--border))] transition-colors',
          'hover:bg-[hsl(var(--foreground)/0.04)] focus:outline-none text-[hsl(var(--foreground))]',
          isOpen && 'ring-1 ring-[hsl(var(--ring))]',
        )}
      >
        <Clock className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span className="tabular-nums">{display}</span>
        <ChevronDown
          className={cn('h-3 w-3 shrink-0 transition-transform ml-0.5', isOpen && 'rotate-180')}
          aria-hidden="true"
        />
      </button>

      {/* ── Popover ── */}
      {(open || isClosing) && anchor && (
        <>
          {/* Click-away backdrop */}
          <div
            className="fixed inset-0 z-[199]"
            onClick={closePopover}
            aria-hidden="true"
          />

          <div
            role="dialog"
            aria-label={t('timePicker.ariaLabel')}
            className={cn(
              'fixed z-[200] rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--popover))] shadow-xl overflow-hidden',
              isClosing ? 'dropdown-exit' : 'dropdown-enter',
            )}
            style={{ left: anchor.left, bottom: anchor.bottom, width: POPOVER_W }}
          >
            {/* Column headers */}
            <div className="flex text-[10px] font-medium text-[hsl(var(--muted-foreground)/0.7)] uppercase tracking-wide border-b border-[hsl(var(--border)/0.5)]">
              <div className="flex-1 text-center py-1.5">{t('timePicker.hour')}</div>
              <div className="w-px bg-[hsl(var(--border)/0.5)]" aria-hidden="true" />
              <div className="flex-1 text-center py-1.5">{t('timePicker.minute')}</div>
            </div>

            {/* Two columns */}
            <div className="flex" style={{ height: COL_HEIGHT_PX }}>
              <TimeColumn
                colRef={hourColRef}
                values={hours}
                selected={hour}
                onSelect={setHour}
              />
              <div className="w-px bg-[hsl(var(--border)/0.5)]" aria-hidden="true" />
              <TimeColumn
                colRef={minuteColRef}
                values={minutes}
                selected={minute}
                onSelect={setMinute}
              />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// TimeColumn
// ---------------------------------------------------------------------------

function TimeColumn({
  colRef,
  values,
  selected,
  onSelect,
}: {
  colRef: React.RefObject<HTMLDivElement | null>
  values: number[]
  selected: number
  onSelect: (v: number) => void
}): React.JSX.Element {
  return (
    <div
      ref={colRef}
      className="flex-1 overflow-y-auto py-1"
      role="listbox"
    >
      {values.map((v) => {
        const active = v === selected
        return (
          <button
            key={v}
            type="button"
            role="option"
            aria-selected={active}
            onClick={() => onSelect(v)}
            className={cn(
              'block w-full text-center text-xs tabular-nums transition-colors',
              'h-7 flex items-center justify-center',
              active
                ? 'bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))] font-semibold'
                : 'text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.05)]',
            )}
          >
            {pad(v)}
          </button>
        )
      })}
    </div>
  )
}
