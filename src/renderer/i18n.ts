// SPDX-License-Identifier: Apache-2.0

// src/renderer/i18n.ts
//
// TypeScript 5.9 with moduleResolution: "bundler" does not properly resolve
// i18next's .d.mts default/named exports. Workaround: import as namespace
// and access the default property, which is the i18n singleton instance.
import * as i18nextModule from 'i18next'
import { initReactI18next } from 'react-i18next'
import type { SupportedLocale } from '@shared/i18n'
import { createLogger } from '@/lib/logger'

const log = createLogger('i18n')

// The runtime default export is the i18n singleton instance.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const i18n = (i18nextModule as any).default ?? i18nextModule

import zhCNCommon from './locales/zh-CN/common.json'
import zhCNNavigation from './locales/zh-CN/navigation.json'
import zhCNIssues from './locales/zh-CN/issues.json'
import zhCNSessions from './locales/zh-CN/sessions.json'
import zhCNInbox from './locales/zh-CN/inbox.json'
import zhCNFiles from './locales/zh-CN/files.json'
import zhCNSchedule from './locales/zh-CN/schedule.json'
import zhCNDashboard from './locales/zh-CN/dashboard.json'
import zhCNSettings from './locales/zh-CN/settings.json'
import zhCNOnboarding from './locales/zh-CN/onboarding.json'

import enUSCommon from './locales/en-US/common.json'
import enUSNavigation from './locales/en-US/navigation.json'
import enUSIssues from './locales/en-US/issues.json'
import enUSSessions from './locales/en-US/sessions.json'
import enUSInbox from './locales/en-US/inbox.json'
import enUSFiles from './locales/en-US/files.json'
import enUSSchedule from './locales/en-US/schedule.json'
import enUSDashboard from './locales/en-US/dashboard.json'
import enUSSettings from './locales/en-US/settings.json'
import enUSOnboarding from './locales/en-US/onboarding.json'
import enUSMemory from './locales/en-US/memory.json'

import zhCNMemory from './locales/zh-CN/memory.json'

const NS = [
  'common',
  'navigation',
  'issues',
  'sessions',
  'inbox',
  'files',
  'schedule',
  'dashboard',
  'settings',
  'onboarding',
  'memory',
] as const

/**
 * Key used to cache the resolved locale in localStorage.
 * Prevents first-frame language flicker on app restart — the cached value
 * is applied immediately at init time, before the async IPC round-trip
 * to fetch settings from the main process.
 */
const LOCALE_CACHE_KEY = 'opencow:locale'

/**
 * Register all translation resources and set initial language.
 * Called synchronously before ReactDOM.createRoot().
 *
 * Uses a localStorage-cached locale as the initial language to eliminate
 * first-frame language flicker. The authoritative locale from settings
 * is applied later via applyLocale() after the initial state loads.
 */
export function initI18n(): void {
  const cachedLocale = localStorage.getItem(LOCALE_CACHE_KEY) as SupportedLocale | null
  const initialLng: SupportedLocale = cachedLocale === 'zh-CN' || cachedLocale === 'en-US'
    ? cachedLocale
    : 'en-US'

  i18n.use(initReactI18next).init({
    lng: initialLng,
    fallbackLng: 'en-US',
    defaultNS: 'common',
    ns: [...NS],
    resources: {
      'zh-CN': {
        common: zhCNCommon,
        navigation: zhCNNavigation,
        issues: zhCNIssues,
        sessions: zhCNSessions,
        inbox: zhCNInbox,
        files: zhCNFiles,
        schedule: zhCNSchedule,
        dashboard: zhCNDashboard,
        settings: zhCNSettings,
        onboarding: zhCNOnboarding,
        memory: zhCNMemory,
      },
      'en-US': {
        common: enUSCommon,
        navigation: enUSNavigation,
        issues: enUSIssues,
        sessions: enUSSessions,
        inbox: enUSInbox,
        files: enUSFiles,
        schedule: enUSSchedule,
        dashboard: enUSDashboard,
        settings: enUSSettings,
        onboarding: enUSOnboarding,
        memory: enUSMemory,
      },
    },
    interpolation: { escapeValue: false },
    // DEV mode: log missing translation keys as console errors — safety net during migration
    ...(import.meta.env.DEV && {
      saveMissing: true,
      missingKeyHandler: (
        _lngs: readonly string[],
        ns: string,
        key: string,
      ) => {
        log.error(`Missing translation key: ${ns}:${key}`)
      },
    }),
  })
}

/**
 * Apply a specific locale. No-op if already set (avoids unnecessary re-renders).
 * Also caches the locale to localStorage so initI18n() can use it on next launch.
 *
 * Called by useAppBootstrap on initial load, settings:updated events,
 * LanguageSelector, and OnboardingLanguageSwitcher.
 */
export async function applyLocale(locale: SupportedLocale): Promise<void> {
  localStorage.setItem(LOCALE_CACHE_KEY, locale)
  if (i18n.language !== locale) {
    await i18n.changeLanguage(locale)
  }
}
