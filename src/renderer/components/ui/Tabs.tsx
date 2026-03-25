// SPDX-License-Identifier: Apache-2.0

import { createContext, useContext, useId, useMemo } from 'react'
import { cn } from '@/lib/utils'

interface TabsContextValue {
  value: string
  onValueChange: (value: string) => void
  baseId: string
}

const TabsContext = createContext<TabsContextValue | null>(null)

function useTabsContext(): TabsContextValue {
  const context = useContext(TabsContext)
  if (!context) {
    throw new Error('Tabs components must be used inside <Tabs>.')
  }
  return context
}

function toDomSafeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-')
}

interface TabsProps {
  value: string
  onValueChange: (value: string) => void
  className?: string
  children: React.ReactNode
}

export function Tabs({
  value,
  onValueChange,
  className,
  children,
}: TabsProps): React.JSX.Element {
  const autoId = useId()
  const contextValue = useMemo(() => ({
    value,
    onValueChange,
    baseId: autoId,
  }), [autoId, onValueChange, value])

  return (
    <TabsContext.Provider value={contextValue}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  )
}

interface TabsListProps {
  children: React.ReactNode
  className?: string
  ariaLabel?: string
}

export function TabsList({ children, className, ariaLabel }: TabsListProps): React.JSX.Element {
  return (
    <div role="tablist" aria-label={ariaLabel} className={className}>
      {children}
    </div>
  )
}

interface TabsTriggerProps {
  value: string
  children: React.ReactNode
  className?: string
  activeClassName?: string
  inactiveClassName?: string
  disabled?: boolean
}

export function TabsTrigger({
  value,
  children,
  className,
  activeClassName,
  inactiveClassName,
  disabled = false,
}: TabsTriggerProps): React.JSX.Element {
  const context = useTabsContext()
  const active = context.value === value
  const safeId = toDomSafeId(value)

  return (
    <button
      id={`${context.baseId}-tab-${safeId}`}
      type="button"
      role="tab"
      disabled={disabled}
      aria-selected={active}
      aria-controls={`${context.baseId}-panel-${safeId}`}
      onClick={() => {
        if (!disabled && !active) context.onValueChange(value)
      }}
      className={cn(className, active ? activeClassName : inactiveClassName)}
    >
      {children}
    </button>
  )
}

interface TabsContentProps {
  value: string
  children: React.ReactNode
  className?: string
  forceMount?: boolean
}

export function TabsContent({
  value,
  children,
  className,
  forceMount = false,
}: TabsContentProps): React.JSX.Element | null {
  const context = useTabsContext()
  const active = context.value === value
  const safeId = toDomSafeId(value)

  if (!forceMount && !active) return null

  return (
    <div
      id={`${context.baseId}-panel-${safeId}`}
      role="tabpanel"
      hidden={!active}
      aria-labelledby={`${context.baseId}-tab-${safeId}`}
      className={cn(className, !active && 'hidden')}
    >
      {children}
    </div>
  )
}
