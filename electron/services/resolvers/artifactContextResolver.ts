// SPDX-License-Identifier: Apache-2.0

import type { ArtifactStore } from '../artifactStore'
import type { ContextRefType } from '../../../src/shared/types'
import type { ContextRefResolver } from './issueContextResolver'
import { escapeXmlAttr } from '../../utils/xmlUtils'

export class ArtifactContextResolver implements ContextRefResolver {
  readonly type: ContextRefType = 'artifact'

  constructor(private readonly artifactStore: ArtifactStore) {}

  async resolve(id: string): Promise<string | null> {
    const rows = await this.artifactStore.list({ starred: true })
    const row = rows.find((r) => r.id === id)
    if (!row) return null
    if (!row.starred) return null // Skip if unstarred
    if (!row.content) return null

    const label = row.title || row.file_path || id
    const contentPreview = row.content

    return [
      `<source type="artifact" id="${escapeXmlAttr(id)}" kind="${escapeXmlAttr(row.kind)}" name="${escapeXmlAttr(label)}">`,
      `  <content>`,
      contentPreview
        .split('\n')
        .map((l) => `    ${l}`)
        .join('\n'),
      `  </content>`,
      `</source>`,
    ].join('\n')
  }
}
