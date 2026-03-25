// SPDX-License-Identifier: Apache-2.0

import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Info } from 'lucide-react'

function GuideStep({
  step,
  title,
  description,
}: {
  step: number
  title: string
  description: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex gap-3">
      <span className="flex-none flex items-center justify-center h-5 w-5 rounded-full bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] text-xs font-bold">
        {step}
      </span>
      <div className="min-w-0">
        <p className="text-xs font-medium">{title}</p>
        <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5 leading-relaxed">{description}</p>
      </div>
    </div>
  )
}

export function SetupGuideTooltip(): React.JSX.Element {
  const { t } = useTranslation('settings')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="p-0.5 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
        aria-label={t('messaging.telegram.setupGuideAria')}
      >
        <Info className="h-3.5 w-3.5" aria-hidden="true" />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1.5 z-50 w-80 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--popover))] text-[hsl(var(--popover-foreground))] shadow-lg">
          <div className="px-4 py-3 border-b border-[hsl(var(--border))]">
            <p className="text-sm font-semibold">{t('messaging.telegram.setupGuide')}</p>
            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
              {t('messaging.telegram.setupDesc')}
            </p>
          </div>

          <div className="px-4 py-3 space-y-3">
            <GuideStep step={1} title={t('messaging.telegram.steps.createBot')} description={
              <>{t('messaging.telegram.steps.createBotDesc')}</>
            } />
            <GuideStep step={2} title={t('messaging.telegram.steps.copyToken')} description={t('messaging.telegram.steps.copyTokenDesc')} />
            <GuideStep step={3} title={t('messaging.telegram.steps.getChatId')} description={
              <span className="[&_code]:text-xs [&_code]:bg-[hsl(var(--muted))] [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:break-all" dangerouslySetInnerHTML={{ __html: t('messaging.telegram.steps.getChatIdDesc') }} />
            } />
            <GuideStep step={4} title={t('messaging.telegram.steps.testAndStart')} description={t('messaging.telegram.steps.testAndStartDesc')} />
          </div>

          <div className="px-4 py-2.5 border-t border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.3)] rounded-b-lg">
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              {t('messaging.telegram.helpCommand')}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
