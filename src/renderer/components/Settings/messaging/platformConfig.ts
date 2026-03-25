// SPDX-License-Identifier: Apache-2.0

/**
 * Centralized platform configuration for the messaging settings UI.
 *
 * All platform metadata, adapter availability flags, and derived lists are
 * defined here so that adding a new IM platform requires only a single-file edit.
 */

import type { SVGAttributes } from 'react'
import type { IMPlatformType } from '@shared/types'
import { TelegramIcon, FeishuIcon, DiscordIcon, WeixinIcon } from './PlatformIcons'
import { BRAND_COLORS } from './brandColors'

export { BRAND_COLORS }

// ── Per-platform visual metadata ─────────────────────────────────────────────

/** A lightweight React component that renders a platform brand SVG icon. */
type PlatformIconComponent = (props: SVGAttributes<SVGSVGElement>) => React.JSX.Element

export interface PlatformMeta {
  /** i18n key under `settings` namespace for the platform display name. */
  labelKey: string
  /** i18n key for a short one-line description (shown in selection cards). */
  descriptionKey: string
  /** i18n key for estimated setup time (e.g. "~3 min"). */
  setupTimeKey: string
  /** Tailwind classes for the platform badge (bg + text). */
  color: string
  /** Tailwind color for the top accent bar on connection cards. */
  accentColor: string
  /** Tailwind background class for the icon container. */
  iconBg: string
  /** Brand icon component — renders an inline SVG. */
  icon: PlatformIconComponent
  /**
   * Whether a working backend adapter exists for this platform.
   * When `false`, the UI still allows full credential configuration and
   * persistence, but the enable toggle and test button are disabled.
   */
  adapterReady: boolean
  /**
   * When `true`, the platform is hidden from all UI surfaces (selection cards,
   * add-bot popover, etc.).  The entry is kept in PLATFORM_META so that any
   * persisted connections still render gracefully; it simply won't appear in
   * ALL_PLATFORMS.
   */
  hidden?: boolean
}

export const PLATFORM_META: Record<IMPlatformType, PlatformMeta> = {
  telegram: {
    labelKey: 'messaging.platforms.telegram',
    descriptionKey: 'messaging.platformDesc.telegram',
    setupTimeKey: 'messaging.setupTime.fast',
    color: 'bg-sky-500/10 text-sky-600',
    accentColor: `bg-[${BRAND_COLORS.telegram}]`,
    iconBg: 'bg-sky-500/10',
    icon: TelegramIcon,
    adapterReady: true,
  },
  feishu: {
    labelKey: 'messaging.platforms.feishu',
    descriptionKey: 'messaging.platformDesc.feishu',
    setupTimeKey: 'messaging.setupTime.medium',
    color: 'bg-blue-500/10 text-blue-600',
    accentColor: `bg-[${BRAND_COLORS.feishu}]`,
    iconBg: 'bg-blue-500/10',
    icon: FeishuIcon,
    adapterReady: true,
  },
  discord: {
    labelKey: 'messaging.platforms.discord',
    descriptionKey: 'messaging.platformDesc.discord',
    setupTimeKey: 'messaging.setupTime.fast',
    color: 'bg-indigo-500/10 text-indigo-600',
    accentColor: `bg-[${BRAND_COLORS.discord}]`,
    iconBg: 'bg-indigo-500/10',
    icon: DiscordIcon,
    adapterReady: true,
  },
  weixin: {
    labelKey: 'messaging.platforms.weixin',
    descriptionKey: 'messaging.platformDesc.weixin',
    setupTimeKey: 'messaging.setupTime.medium',
    color: 'bg-green-500/10 text-green-600',
    accentColor: `bg-[${BRAND_COLORS.weixin}]`,
    iconBg: 'bg-green-500/10',
    icon: WeixinIcon,
    adapterReady: true,
  },
}

// ── Derived convenience lists ────────────────────────────────────────────────

/** All visible platform keys, ordered for display (excludes hidden platforms). */
export const ALL_PLATFORMS = (Object.keys(PLATFORM_META) as IMPlatformType[]).filter(
  (p) => !PLATFORM_META[p].hidden,
)

/**
 * Check whether a platform's backend adapter is ready.
 * When `false`, the config UI is fully functional but start/stop/test are disabled.
 */
export function isPlatformSupported(platform: IMPlatformType): boolean {
  return PLATFORM_META[platform].adapterReady
}
