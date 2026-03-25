// SPDX-License-Identifier: Apache-2.0

/**
 * Git platform factory — creates platform adapters by identifier.
 */

import type { RepoSourcePlatform } from '../../../../src/shared/types'
import type { GitPlatform } from './types'
import { GitHubPlatform } from './githubPlatform'
import { GitLabPlatform } from './gitlabPlatform'

export type { GitPlatform, GitPlatformConfig, RepoMeta, RepoTreeEntry } from './types'

const platformCache = new Map<RepoSourcePlatform, GitPlatform>()

/** Get or create a GitPlatform instance for the given platform ID. */
export function getPlatform(platform: RepoSourcePlatform): GitPlatform {
  let instance = platformCache.get(platform)
  if (instance) return instance

  switch (platform) {
    case 'github':
      instance = new GitHubPlatform()
      break
    case 'gitlab':
      instance = new GitLabPlatform()
      break
    default:
      throw new Error(`Unsupported platform: ${platform}`)
  }

  platformCache.set(platform, instance)
  return instance
}
