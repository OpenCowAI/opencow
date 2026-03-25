// SPDX-License-Identifier: Apache-2.0

import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AIEngineKind, ProviderStatus } from '@shared/types'
import { PillDropdown } from '@/components/ui/PillDropdown'
import { ENGINE_TABS } from './constants'
import { StatusBadge } from './StatusBadge'

interface DefaultEngineSelectProps {
  value: AIEngineKind
  statusByEngine: Record<AIEngineKind, ProviderStatus | null>
  onChange: (engineKind: AIEngineKind) => void
}

function resolveBadgeState(status: ProviderStatus | null): 'authenticated' | 'authenticating' | 'error' | 'unauthenticated' {
  if (!status) return 'unauthenticated'
  if (status.state === 'authenticated') return 'authenticated'
  if (status.state === 'authenticating') return 'authenticating'
  if (status.state === 'error') return 'error'
  return 'unauthenticated'
}

export function DefaultEngineSelect({
  value,
  statusByEngine,
  onChange,
}: DefaultEngineSelectProps): React.JSX.Element {
  const { t } = useTranslation('settings')
  const [open, setOpen] = useState(false)

  const selected = useMemo(() => (
    ENGINE_TABS.find((engine) => engine.kind === value) ?? ENGINE_TABS[0]
  ), [value])

  const handleSelect = useCallback((engineKind: AIEngineKind) => {
    if (engineKind !== value) {
      onChange(engineKind)
    }
    setOpen(false)
  }, [onChange, value])

  return (
    <PillDropdown
      open={open}
      onOpenChange={setOpen}
      position="below"
      align="left"
      trigger={(
        <button
          type="button"
          aria-label={t('provider.defaultEngine')}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((prev) => !prev)}
          className={cn(
            'w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-left transition-colors',
            'hover:bg-[hsl(var(--foreground)/0.03)] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]',
          )}
        >
          <span className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">{t(selected.labelKey)}</span>
            <span className="flex items-center gap-2">
              <StatusBadge state={resolveBadgeState(statusByEngine[value])} />
              <ChevronDown
                className={cn(
                  'h-4 w-4 text-[hsl(var(--muted-foreground))] transition-transform',
                  open && 'rotate-180',
                )}
                aria-hidden="true"
              />
            </span>
          </span>
        </button>
      )}
    >
      <div role="listbox" aria-label={t('provider.defaultEngine')} className="py-1">
        {ENGINE_TABS.map((engine) => {
          const isSelected = engine.kind === value
          return (
            <button
              key={`default-engine-option-${engine.kind}`}
              type="button"
              role="option"
              aria-selected={isSelected}
              onClick={() => handleSelect(engine.kind)}
              className={cn(
                'w-full px-3 py-2 text-left transition-colors',
                'flex items-center justify-between gap-2',
                isSelected
                  ? 'bg-[hsl(var(--primary)/0.10)]'
                  : 'hover:bg-[hsl(var(--foreground)/0.04)]',
              )}
            >
              <span className="text-sm font-medium">{t(engine.labelKey)}</span>
              <span className="flex items-center gap-2">
                <StatusBadge state={resolveBadgeState(statusByEngine[engine.kind])} />
                <Check
                  className={cn(
                    'h-4 w-4 text-[hsl(var(--primary))] transition-opacity',
                    isSelected ? 'opacity-100' : 'opacity-0',
                  )}
                  aria-hidden="true"
                />
              </span>
            </button>
          )
        })}
      </div>
    </PillDropdown>
  )
}
