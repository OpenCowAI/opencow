// SPDX-License-Identifier: Apache-2.0

import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { DayPicker } from 'react-day-picker'
import { CalendarDays, ChevronLeft, ChevronRight, ChevronDown, X } from 'lucide-react'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DateTimePickerProps {
  /** datetime-local string, e.g. "2026-03-01T14:30" */
  value: string
  onChange: (v: string) => void
  /** Earliest selectable date. Dates before this are disabled in the calendar. */
  minDate?: Date
  placeholder?: string
  className?: string
}

interface AnchorPos { left: number; bottom: number }

// ---------------------------------------------------------------------------
// Calendar styles
//
// Defined at module level so the string is created once (not on every render)
// and injected into document.head exactly once via ensureCalendarStyles().
// Scoped to the `.dtp-cal` wrapper class to avoid global namespace pollution.
// ---------------------------------------------------------------------------

const CALENDAR_STYLES = `
  .dtp-cal .day_button {
    width: 28px; height: 28px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 11px; cursor: pointer;
    transition: background-color 0.12s, color 0.12s;
  }
  .dtp-cal .day_button:hover {
    background: hsl(var(--foreground) / 0.07);
  }
  .dtp-cal .selected .day_button {
    background: hsl(var(--primary));
    color: hsl(var(--primary-foreground));
  }
  .dtp-cal .selected .day_button:hover {
    background: hsl(var(--primary) / 0.88);
  }
  .dtp-cal .today:not(.selected):not(.disabled) .day_button {
    font-weight: 700;
    color: hsl(var(--primary));
    box-shadow: inset 0 0 0 1.5px hsl(var(--primary) / 0.55);
  }
  .dtp-cal .disabled .day_button {
    opacity: 0.25; cursor: not-allowed; color: hsl(var(--muted-foreground));
    font-weight: 400; box-shadow: none;
  }
  .dtp-cal .disabled .day_button:hover { background: transparent; }
  .dtp-cal .outside .day_button { opacity: 0.35; }
`

function ensureCalendarStyles(): void {
  if (typeof document === 'undefined') return
  const attr = 'data-dtp-calendar'
  const existing = document.querySelector(`style[${attr}]`) as HTMLStyleElement | null
  if (existing?.textContent === CALENDAR_STYLES) return   // already up-to-date
  existing?.remove()                                      // stale (HMR) → replace
  const el = document.createElement('style')
  el.setAttribute(attr, '')
  el.textContent = CALENDAR_STYLES
  document.head.appendChild(el)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a local "yyyy-MM-dd" string without UTC conversion side-effects. */
function toLocalDateStr(d: Date): string {
  const y  = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${mo}-${dd}`
}

function formatDisplayDate(d: Date): string {
  return d.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Width of the popover in pixels (matches w-72 = 288px). Used for right-edge clamping. */
const POPOVER_W        = 288
const DEFAULT_TIME     = '09:00'
const POPOVER_ANIM_MS  = 100

// ---------------------------------------------------------------------------
// DateTimePicker
// ---------------------------------------------------------------------------

/**
 * Calendar + time picker.
 *
 * Trigger pill matches the visual style of ProjectPicker / ActionTypeDropdown.
 * Popover uses `position: fixed` anchored to the trigger's viewport rect so it
 * is never clipped by modal `overflow-hidden` / `overflow-auto` containers.
 */
export function DateTimePicker({
  value,
  onChange,
  minDate,
  placeholder = 'Pick date & time',
  className,
}: DateTimePickerProps): React.JSX.Element {
  const [open, setOpen]           = useState(false)
  const [isClosing, setIsClosing] = useState(false)
  const [anchor, setAnchor]       = useState<AnchorPos | null>(null)
  const triggerRef                = useRef<HTMLButtonElement>(null)
  const closeTimer                = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Inject calendar CSS into <head> once — never on re-renders
  useEffect(() => { ensureCalendarStyles() }, [])

  // ── Derive state from value ────────────────────────────────────────────────

  const parsed      = value ? new Date(value) : null
  const isValid     = parsed !== null && !isNaN(parsed.getTime())
  const selectedDate: Date | undefined = isValid ? parsed : undefined
  // Time string is only meaningful when we have a valid date
  const timeStr = isValid ? value.slice(11, 16) : DEFAULT_TIME
  const fullLabel   = isValid && parsed
    ? `${formatDisplayDate(parsed)} · ${timeStr}`
    : undefined

  // ── Handlers ──────────────────────────────────────────────────────────────

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
      // Clamp left so the popover never overflows the viewport's right edge
      const clampedLeft = Math.min(r.left, window.innerWidth - POPOVER_W - 8)
      setAnchor({ left: clampedLeft, bottom: window.innerHeight - r.top + 6 })
    }
    setOpen(true)
  }

  const handleClear = (e: React.MouseEvent): void => {
    e.stopPropagation()  // prevent the outer button click (which would re-open picker)
    onChange('')
    closePopover()
  }

  // Memoize the isOpen indicator used by trigger styling
  const isOpen = useMemo(() => open && !isClosing, [open, isClosing])

  const handleDaySelect = useCallback((day: Date | undefined): void => {
    if (!day) return
    // Preserve current time when switching days; fall back to DEFAULT_TIME for fresh picks
    onChange(`${toLocalDateStr(day)}T${timeStr}`)
  }, [timeStr, onChange])

  const handleTimeChange = useCallback((t: string): void => {
    // Guard: time must not be editable before a date is chosen
    if (!isValid || !selectedDate) return
    onChange(`${toLocalDateStr(selectedDate)}T${t}`)
  }, [isValid, selectedDate, onChange])

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    // No `relative` — popover is `fixed`, not `absolute`, so a relative ancestor
    // would have no effect and would only mislead readers.
    <div className={cn('inline-block', className)}>

      {/* ── Trigger ── */}
      <button
        ref={triggerRef}
        type="button"
        onClick={handleToggle}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md border border-[hsl(var(--border))] transition-colors',
          'hover:bg-[hsl(var(--foreground)/0.04)] focus:outline-none',
          isOpen && 'ring-1 ring-[hsl(var(--ring))]',
          fullLabel ? 'text-[hsl(var(--foreground))]' : 'text-[hsl(var(--muted-foreground))]',
        )}
      >
        <CalendarDays className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span>{fullLabel ?? placeholder}</span>

        {fullLabel ? (
          // Clear button — separate interactive zone via stopPropagation
          <span
            role="button"
            aria-label="Clear selection"
            onClick={handleClear}
            className="ml-0.5 p-0.5 rounded-full hover:bg-[hsl(var(--foreground)/0.12)] transition-colors"
          >
            <X className="h-2.5 w-2.5" aria-hidden="true" />
          </span>
        ) : (
          <ChevronDown
            className={cn('h-3 w-3 shrink-0 transition-transform ml-0.5', isOpen && 'rotate-180')}
            aria-hidden="true"
          />
        )}
      </button>

      {/* ── Popover ── Stays mounted during isClosing so exit animation can play */}
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
            aria-label="Pick date and time"
            className={cn(
              'fixed z-[200] rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--popover))] shadow-xl p-3 w-72',
              isClosing ? 'dropdown-exit' : 'dropdown-enter',
            )}
            style={{ left: anchor.left, bottom: anchor.bottom }}
          >
            {/* Calendar */}
            <div className="dtp-cal">
              <DayPicker
                mode="single"
                selected={selectedDate}
                onSelect={handleDaySelect}
                disabled={minDate ? [{ before: minDate }] : undefined}
                classNames={{
                  root:            'w-full',
                  months:          'w-full',
                  month:           'w-full',
                  month_caption:   'flex items-center justify-between mb-3 px-0.5',
                  caption_label:   'text-[12px] font-semibold text-[hsl(var(--foreground))]',
                  nav:             'flex items-center gap-0.5',
                  button_previous: [
                    'h-6 w-6 flex items-center justify-center rounded-md transition-colors',
                    'text-[hsl(var(--muted-foreground))]',
                    'hover:bg-[hsl(var(--foreground)/0.07)] hover:text-[hsl(var(--foreground))]',
                  ].join(' '),
                  button_next: [
                    'h-6 w-6 flex items-center justify-center rounded-md transition-colors',
                    'text-[hsl(var(--muted-foreground))]',
                    'hover:bg-[hsl(var(--foreground)/0.07)] hover:text-[hsl(var(--foreground))]',
                  ].join(' '),
                  month_grid: 'w-full border-collapse',
                  weekdays:   'flex mb-1',
                  weekday:    'flex-1 text-center text-[10px] font-medium text-[hsl(var(--muted-foreground)/0.55)] py-0.5',
                  week:       'flex',
                  day:        'flex-1 flex items-center justify-center p-0.5',
                  day_button: 'day_button',  // styled via .dtp-cal scoped CSS
                  // Map rdp modifier class names → unprefixed names used by .dtp-cal CSS
                  today:      'today',
                  selected:   'selected',
                  disabled:   'disabled',
                  outside:    'outside',
                }}
                components={{
                  Chevron: ({ orientation }) =>
                    orientation === 'left'
                      ? <ChevronLeft  className="h-3.5 w-3.5" aria-hidden="true" />
                      : <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />,
                }}
              />
            </div>

            {/*
             * Time row — grayed out until a date is selected.
             * Prevents the hidden-state bug where changing time before picking
             * a date would silently default the date to today.
             */}
            <div className={cn(
              'flex items-center gap-2 mt-1 pt-2.5 border-t border-[hsl(var(--border)/0.5)]',
              !isValid && 'opacity-40 pointer-events-none select-none',
            )}>
              <span className="text-[11px] text-[hsl(var(--muted-foreground))] shrink-0">
                Time
              </span>
              <input
                type="time"
                value={timeStr}
                disabled={!isValid}
                onChange={(e) => handleTimeChange(e.target.value)}
                className="px-2 py-1 text-xs rounded-md border border-[hsl(var(--border))] bg-transparent focus:outline-none focus:ring-1 focus:ring-[hsl(var(--ring))] text-[hsl(var(--foreground))]"
              />
              {isValid && (
                <button
                  type="button"
                  onClick={closePopover}
                  className="ml-auto px-3 py-1 text-[11px] rounded-md bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:bg-[hsl(var(--primary)/0.88)] transition-colors font-medium"
                >
                  Done
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
