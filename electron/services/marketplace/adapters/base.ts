// SPDX-License-Identifier: Apache-2.0

/**
 * Base class for marketplace adapters.
 *
 * Provides ONLY the interface contract and minimal shared behaviour
 * (toInfo, checkAvailability). All utility concerns (HTTP, GitHub, parsing)
 * live in `../utils/` and are composed via imports — not inherited.
 */

import type {
  MarketplaceId,
  MarketProviderInfo,
  MarketSearchParams,
  MarketSearchResult,
  MarketBrowseParams,
  MarketSkillDetail,
} from '../../../../src/shared/types'
import type { MarketplaceProvider, MarketplaceSearchResponse, MarketplaceSettings } from '../types'
import { fetchWithTimeout } from '../utils/http'

export abstract class BaseMarketplaceAdapter implements MarketplaceProvider {
  abstract readonly id: MarketplaceId
  abstract readonly displayName: string
  abstract readonly icon: string
  abstract readonly url: string

  abstract search(params: MarketSearchParams): Promise<MarketplaceSearchResponse>
  abstract browse(params: MarketBrowseParams): Promise<MarketSearchResult>
  abstract getDetail(slug: string): Promise<MarketSkillDetail>
  abstract download(slug: string, targetDir: string): Promise<void>

  /** Override in subclass to pick relevant fields from settings. No-op by default. */
   
  configure(_settings: MarketplaceSettings): void {}

  toInfo(available: boolean): MarketProviderInfo {
    return {
      id: this.id,
      displayName: this.displayName,
      icon: this.icon,
      url: this.url,
      available,
    }
  }

  async checkAvailability(): Promise<boolean> {
    try {
      const resp = await fetchWithTimeout(this.url, { method: 'HEAD' }, 5_000)
      return resp.ok
    } catch {
      return false
    }
  }
}
