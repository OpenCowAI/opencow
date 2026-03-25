// SPDX-License-Identifier: Apache-2.0

import { useState, useEffect, useRef, useCallback } from 'react'
import { EXIT_DURATION } from './useModalAnimation'

/**
 * Manages popover lifecycle: open/close, enter/exit animation, click-outside
 * dismissal, Escape key, and focus return.
 *
 * Animation contract:
 * - Enter/exit lifecycle is handled here
 * - Consumers only apply `animCls` and render when `mounted === true`
 * - Animation classes are the global styles in `globals.css`:
 *   `dropdown-enter/dropdown-exit` or `popover-enter/popover-exit`
 *
 * Usage:
 * ```tsx
 * const p = usePopover()
 *
 * <button ref={p.triggerRef} onClick={p.toggle} aria-expanded={p.open} aria-haspopup="true">
 *   Open
 * </button>
 *
 * {p.mounted && (
 *   <div ref={p.contentRef} className={cn('popover-base', p.animCls)}>
 *     <button onClick={() => { p.closeImmediate(); doAction() }}>Pick</button>
 *   </div>
 * )}
 * ```
 */
export type PopoverAnimationPreset = 'dropdown' | 'popover'

export interface UsePopoverOptions {
  /** Exit animation duration in ms; defaults to EXIT_DURATION. */
  duration?: number
  /** Controlled mode: open state from parent. */
  open?: boolean
  /** Controlled mode: state callback to parent. */
  onOpenChange?: (open: boolean) => void
  /** Which global animation preset to use. */
  animationPreset?: PopoverAnimationPreset
}

type OpenUpdater = boolean | ((prev: boolean) => boolean)

export function usePopover(options: UsePopoverOptions | number = {}) {
  const normalized = typeof options === 'number' ? { duration: options } : options
  const duration = normalized.duration ?? EXIT_DURATION
  const animationPreset = normalized.animationPreset ?? 'dropdown'
  const onOpenChange = normalized.onOpenChange

  const isControlled = normalized.open !== undefined
  const [internalOpen, setInternalOpen] = useState(false)
  const open = normalized.open ?? internalOpen

  const [mounted, setMounted] = useState(open)
  const [phase, setPhase] = useState<'enter' | 'exit' | null>(open ? 'enter' : null)

  const triggerRef = useRef<HTMLButtonElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const mountedRef = useRef(open)
  const closeImmediatelyRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const setOpen = useCallback((next: OpenUpdater) => {
    const resolve = (prev: boolean): boolean => (
      typeof next === 'function' ? (next as (prev: boolean) => boolean)(prev) : next
    )

    if (isControlled) {
      onOpenChange?.(resolve(open))
      return
    }

    setInternalOpen((prev) => {
      const nextValue = resolve(prev)
      onOpenChange?.(nextValue)
      return nextValue
    })
  }, [isControlled, onOpenChange, open])

  // ── Animation lifecycle (same pattern as useModalAnimation) ──
  useEffect(() => {
    clearTimeout(timerRef.current)

    if (open) {
      closeImmediatelyRef.current = false
      mountedRef.current = true
      // eslint-disable-next-line react-hooks/set-state-in-effect -- animation mount/phase are intentionally derived from open transitions
      setMounted(true)
      setPhase('enter')
    } else if (mountedRef.current) {
      if (closeImmediatelyRef.current) {
        closeImmediatelyRef.current = false
        mountedRef.current = false
        setMounted(false)
        setPhase(null)
        return
      }

      setPhase('exit')
      timerRef.current = setTimeout(() => {
        mountedRef.current = false
        setMounted(false)
        setPhase(null)
      }, duration)
    }

    return () => clearTimeout(timerRef.current)
  }, [open, duration])

  // ── Click outside ──
  useEffect(() => {
    if (!mounted) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target) || contentRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [mounted, setOpen])

  // ── Escape key ──
  useEffect(() => {
    if (!mounted) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [mounted, setOpen])

  const openPopover = useCallback(() => setOpen(true), [setOpen])
  const toggle = useCallback(() => setOpen((v) => !v), [setOpen])
  const close = useCallback(() => setOpen(false), [setOpen])

  /** Close immediately without exit animation (e.g. after selecting an item). */
  const closeImmediate = useCallback(() => {
    clearTimeout(timerRef.current)
    closeImmediatelyRef.current = true
    setOpen(false)
    mountedRef.current = false
    setMounted(false)
    setPhase(null)
  }, [setOpen])

  /** Global popover/dropdown animation classes derived from current phase. */
  const animCls =
    phase === 'enter'
      ? animationPreset === 'popover' ? 'popover-enter' : 'dropdown-enter'
      : phase === 'exit'
        ? animationPreset === 'popover' ? 'popover-exit' : 'dropdown-exit'
        : ''

  return {
    open,
    mounted,
    phase,
    triggerRef,
    contentRef,
    setOpen,
    openPopover,
    toggle,
    close,
    closeImmediate,
    animCls,
  }
}
