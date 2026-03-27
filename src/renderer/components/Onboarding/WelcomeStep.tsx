// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from 'react-i18next'
import { Monitor, Bell, Shield } from 'lucide-react'
import opencowIp from '@/assets/opencow-ip.png'

interface WelcomeStepProps {
  onStart: () => void
}

/** Feature card for the welcome screen */
function FeatureItem({
  icon: Icon,
  title,
  desc,
}: {
  icon: React.ElementType
  title: string
  desc: string
}): React.JSX.Element {
  return (
    <div className="flex items-start gap-3 text-left">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--accent))]">
        <Icon className="h-4 w-4 text-[hsl(var(--primary))]" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-[hsl(var(--muted-foreground))]">{desc}</p>
      </div>
    </div>
  )
}

export function WelcomeStep({ onStart }: WelcomeStepProps): React.JSX.Element {
  const { t } = useTranslation('onboarding')

  return (
    <div className="text-center onboarding-step-enter">
      {/* Logo area */}
      <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center">
        <img src={opencowIp} alt="OpenCow" className="h-20 w-20 object-contain" draggable={false} />
      </div>

      <h1 className="text-2xl font-bold mb-2">{t('welcome.title')}</h1>
      <p className="text-[hsl(var(--muted-foreground))] mb-8">
        {t('welcome.subtitle')}
      </p>

      {/* Feature highlights */}
      <div className="mb-8 space-y-4 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5">
        <FeatureItem
          icon={Monitor}
          title={t('welcome.features.monitoring.title')}
          desc={t('welcome.features.monitoring.desc')}
        />
        <FeatureItem
          icon={Bell}
          title={t('welcome.features.notifications.title')}
          desc={t('welcome.features.notifications.desc')}
        />
        <FeatureItem
          icon={Shield}
          title={t('welcome.features.privacy.title')}
          desc={t('welcome.features.privacy.desc')}
        />
      </div>

      <button
        onClick={onStart}
        className="px-6 py-2.5 rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] font-medium text-sm hover:opacity-90 transition-opacity"
        aria-label={t('welcome.getStarted')}
      >
        {t('welcome.getStarted')}
      </button>
    </div>
  )
}
