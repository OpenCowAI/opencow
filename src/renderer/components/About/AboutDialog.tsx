// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from 'react-i18next'
import { ExternalLink, X } from 'lucide-react'
import { Dialog } from '@/components/ui/Dialog'
import { useAppStore } from '@/stores/appStore'
import { APP_NAME, APP_VERSION } from '@shared/appIdentity'
import appIcon from '@/assets/app-icon.png'
import { UpdateStatus } from './UpdateStatus'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GITHUB_URL = 'https://github.com/OpenCowAI/opencow'
const WEBSITE_URL = 'https://opencow.ai'

// ---------------------------------------------------------------------------
// AboutDialog
// ---------------------------------------------------------------------------

/**
 * AboutDialog — lightweight modal displaying application identity, version,
 * and project links.
 *
 * Follows the same architectural pattern as SettingsModal:
 *   - State managed via Zustand (appStore.aboutDialogOpen)
 *   - Rendered through the shared Dialog base component (glass-safe, animated)
 *   - Mounted at root level in App.tsx
 *
 * Entry points:
 *   1. macOS menu → "About OpenCow" → IPC event → Zustand → this dialog
 *   2. Sidebar AppInfoWidget → brand area click → Zustand → this dialog
 */
export function AboutDialog(): React.JSX.Element | null {
  const { t } = useTranslation('common')
  const open = useAppStore((s) => s.aboutDialogOpen)
  const close = useAppStore((s) => s.closeAboutDialog)

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t('about.dialogAria')}
      size="sm"
    >
      {/* Content */}
      <div className="relative flex flex-col items-center px-6 pt-6 pb-5 text-center">
        {/* Close button */}
        <button
          onClick={close}
          className="absolute top-3 right-3 p-1 rounded-md hover:bg-[hsl(var(--foreground)/0.04)] transition-colors"
          aria-label={t('close')}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>

        {/* App Icon */}
        <img
          src={appIcon}
          alt={APP_NAME}
          className="h-20 w-20 rounded-2xl"
          draggable={false}
        />

        {/* App Name */}
        <h2 className="mt-4 text-lg font-semibold">{APP_NAME}</h2>

        {/* Version */}
        <p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">
          {t('about.version', { version: APP_VERSION })}
        </p>

        {/* Update status */}
        <UpdateStatus />

        {/* Description */}
        <p className="mt-3 text-sm text-[hsl(var(--muted-foreground))] leading-relaxed max-w-[280px]">
          {t('about.description')}
        </p>

        {/* Divider */}
        <div className="w-full mt-4 mb-4 border-t border-[hsl(var(--border)/0.5)]" />

        {/* Links & License */}
        <div className="flex items-center gap-4 text-xs">
          <a
            href={WEBSITE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[hsl(var(--primary))] hover:underline"
          >
            {t('about.website')}
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
          <span className="text-[hsl(var(--muted-foreground)/0.4)]">·</span>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[hsl(var(--primary))] hover:underline"
          >
            {t('about.viewOnGithub')}
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
          <span className="text-[hsl(var(--muted-foreground)/0.4)]">·</span>
          <span className="text-[hsl(var(--muted-foreground))]">{t('about.license')}</span>
        </div>

        {/* Copyright */}
        <p className="mt-2 text-[10px] text-[hsl(var(--muted-foreground)/0.5)]">
          {t('about.copyright', { year: new Date().getFullYear() })}
        </p>
      </div>
    </Dialog>
  )
}
