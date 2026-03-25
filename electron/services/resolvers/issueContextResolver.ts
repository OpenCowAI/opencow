// SPDX-License-Identifier: Apache-2.0

import type { IssueStore } from '../issueStore'
import type { ManagedSessionStore } from '../managedSessionStore'
import type { ContextRefType } from '../../../src/shared/types'
import { escapeXmlAttr } from '../../utils/xmlUtils'

export interface ContextRefResolver {
  readonly type: ContextRefType
  resolve(id: string): Promise<string | null>
}

export class IssueContextResolver implements ContextRefResolver {
  readonly type = 'issue' as const

  constructor(
    private readonly issueStore: IssueStore,
    private readonly sessionStore: ManagedSessionStore,
  ) {}

  async resolve(id: string): Promise<string | null> {
    const issue = await this.issueStore.get(id)
    if (!issue?.sessionId) return null

    const session = await this.sessionStore.get(issue.sessionId)
    if (!session?.messages.length) return null

    const transcript = session.messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => {
        const role = m.role === 'user' ? 'User' : 'Claude'
        const text = m.content
          .map((block) => {
            if (block.type === 'text') return block.text
            if (block.type === 'slash_command') return block.expandedText
            return ''
          })
          .filter(Boolean)
          .join('\n')
        return `${role}: ${text}`
      })
      .filter((line) => line.length > 8) // Filter out empty lines that only contain the role name
      .join('\n')

    if (!transcript) return null

    return [
      `<source type="issue" id="${escapeXmlAttr(id)}" title="${escapeXmlAttr(issue.title)}">`,
      `  <conversation>`,
      transcript
        .split('\n')
        .map((l) => `    ${l}`)
        .join('\n'),
      `  </conversation>`,
      `</source>`,
    ].join('\n')
  }
}
