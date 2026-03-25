// SPDX-License-Identifier: Apache-2.0

import { APP_WINDOW_KEY } from '@shared/appIdentity'
import type { OpenCowAPI } from '@shared/ipc'

/**
 * Typed accessor for the contextBridge-exposed renderer API.
 *
 * This is the single point where the unsafe `window[key]` cast lives.
 * All renderer code must call this function instead of accessing
 * `window.opencow` directly — this way, changing APP_WINDOW_KEY in
 * appIdentity.ts only requires updating this file, not 40+ consumers.
 *
 * @example
 *   import { getAppAPI } from '@/windowAPI'
 *   const result = await getAppAPI().invoke('get-initial-state')
 */
export function getAppAPI(): OpenCowAPI {
  return (window as unknown as Record<string, unknown>)[APP_WINDOW_KEY] as OpenCowAPI
}
