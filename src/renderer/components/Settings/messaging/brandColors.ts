// SPDX-License-Identifier: Apache-2.0

/**
 * Canonical hex brand colors for each IM platform.
 *
 * Single source of truth — imported by both PlatformIcons (SVG fill)
 * and platformConfig (Tailwind accent classes).
 */

import type { IMPlatformType } from '@shared/types'

export const BRAND_COLORS: Record<IMPlatformType, string> = {
  telegram: '#2aabee',
  feishu:   '#3370ff',
  discord:  '#5865f2',
  weixin:   '#07C160',
}
