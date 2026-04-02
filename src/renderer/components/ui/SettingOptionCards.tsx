// SPDX-License-Identifier: Apache-2.0

import { useMemo, useRef } from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SettingOptionCardSpec<TValue extends string> {
  value: TValue
  label: string
  description?: string
  preview: React.ReactNode
  disabled?: boolean
}

interface SettingOptionCardProps {
  optionIndex: number
  selected: boolean
  disabled?: boolean
  label: string
  description?: string
  preview: React.ReactNode
  onClick: () => void
  onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => void
  tabIndex: number
}

function SettingOptionCard({
  optionIndex,
  selected,
  disabled,
  label,
  description,
  preview,
  onClick,
  onKeyDown,
  tabIndex,
}: SettingOptionCardProps): React.JSX.Element {
  return (
    <button
      type="button"
      role="radio"
      data-setting-option-index={optionIndex}
      aria-checked={selected}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      onKeyDown={onKeyDown}
      tabIndex={tabIndex}
      className={cn(
        'group relative w-full rounded-xl border p-3 text-left transition-all',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-1 focus-visible:ring-offset-[hsl(var(--background))]',
        disabled
          ? 'cursor-not-allowed border-[hsl(var(--border)/0.7)] opacity-45'
          : selected
            ? 'border-[hsl(var(--primary)/0.45)] bg-[hsl(var(--primary)/0.09)] shadow-sm'
            : 'border-[hsl(var(--border))] bg-[hsl(var(--card))] hover:border-[hsl(var(--ring)/0.55)] hover:bg-[hsl(var(--foreground)/0.02)]',
      )}
    >
      <span
        className={cn(
          'absolute right-2 top-2 inline-flex h-4 w-4 items-center justify-center rounded-full border transition-colors',
          selected
            ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]'
            : 'border-[hsl(var(--border))] bg-[hsl(var(--background))] text-transparent group-hover:border-[hsl(var(--ring)/0.6)]',
        )}
        aria-hidden="true"
      >
        <Check className="h-3 w-3" />
      </span>

      <div className="space-y-1 pr-5">
        <p className="text-sm font-medium text-[hsl(var(--foreground))]">{label}</p>
        {description && (
          <p className="text-[11px] leading-relaxed text-[hsl(var(--muted-foreground))]">{description}</p>
        )}
      </div>

      <div
        className={cn(
          'mt-3 rounded-lg border border-[hsl(var(--border)/0.55)] bg-[hsl(var(--muted)/0.14)] p-2',
          selected && 'border-[hsl(var(--primary)/0.22)] bg-[hsl(var(--primary)/0.05)]',
        )}
      >
        {preview}
      </div>
    </button>
  )
}

interface SettingOptionCardGroupProps<TValue extends string> {
  value: TValue
  onChange: (value: TValue) => void
  options: readonly SettingOptionCardSpec<TValue>[]
  ariaLabel: string
  columns?: 2 | 3
  className?: string
}

export function SettingOptionCardGroup<TValue extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  columns = 3,
  className,
}: SettingOptionCardGroupProps<TValue>): React.JSX.Element {
  const groupRef = useRef<HTMLDivElement>(null)
  const enabledOptions = useMemo(() => options.filter((option) => !option.disabled), [options])
  const selectedEnabledIndex = enabledOptions.findIndex((option) => option.value === value)
  const activeEnabledIndex = selectedEnabledIndex >= 0 ? selectedEnabledIndex : 0
  const activeValue = enabledOptions[activeEnabledIndex]?.value ?? null

  const focusOption = (targetValue: TValue): void => {
    const targetIndex = options.findIndex((option) => option.value === targetValue)
    if (targetIndex < 0) return
    const el = groupRef.current?.querySelector<HTMLButtonElement>(
      `[data-setting-option-index="${targetIndex}"]`,
    )
    el?.focus()
  }

  const moveSelectionBy = (current: TValue, delta: -1 | 1): void => {
    if (enabledOptions.length <= 1) return
    const currentIndex = enabledOptions.findIndex((option) => option.value === current)
    const safeIndex = currentIndex >= 0 ? currentIndex : 0
    const nextIndex = (safeIndex + delta + enabledOptions.length) % enabledOptions.length
    const nextValue = enabledOptions[nextIndex].value
    onChange(nextValue)
    requestAnimationFrame(() => focusOption(nextValue))
  }

  const moveSelectionToBoundary = (direction: 'start' | 'end'): void => {
    if (enabledOptions.length === 0) return
    const target = direction === 'start'
      ? enabledOptions[0].value
      : enabledOptions[enabledOptions.length - 1].value
    onChange(target)
    requestAnimationFrame(() => focusOption(target))
  }

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'grid grid-cols-1 gap-2.5 md:gap-3',
        columns === 3 ? 'md:grid-cols-3' : 'md:grid-cols-2',
        className,
      )}
    >
      {options.map((option, index) => (
        <SettingOptionCard
          key={option.value}
          optionIndex={index}
          selected={value === option.value}
          disabled={option.disabled}
          label={option.label}
          description={option.description}
          preview={option.preview}
          onClick={() => onChange(option.value)}
          onKeyDown={(e) => {
            if (option.disabled) return
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
              e.preventDefault()
              moveSelectionBy(option.value, 1)
              return
            }
            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
              e.preventDefault()
              moveSelectionBy(option.value, -1)
              return
            }
            if (e.key === 'Home') {
              e.preventDefault()
              moveSelectionToBoundary('start')
              return
            }
            if (e.key === 'End') {
              e.preventDefault()
              moveSelectionToBoundary('end')
            }
          }}
          tabIndex={activeValue == null || option.value === activeValue ? 0 : -1}
        />
      ))}
    </div>
  )
}
