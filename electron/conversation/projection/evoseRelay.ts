// SPDX-License-Identifier: Apache-2.0

import type { ContentBlock, EvoseRelayEvent } from '../../../src/shared/types'
import { isEvoseToolName, deriveEvoseRelayKey } from '../../../src/shared/evoseNames'
import type { SessionContext } from '../../command/sessionContext'
import { DISPATCH_THROTTLE_INTERVAL_MS } from '../constants'
import { createLogger } from '../../platform/logger'

const log = createLogger('projection/evoseRelay')

/**
 * Register Evose relay handlers for tool_use blocks in the finalized assistant message.
 *
 * Key design:
 *   The relay key is derived via `deriveEvoseRelayKey(toolName, appId)` — a
 *   deterministic function of block content. The MCP tool handler in
 *   EvoseNativeCapability uses the same function, guaranteeing both sides
 *   converge on the identical key.
 *
 *   `block.id` (the Claude API tool_use_id) is NOT used as the relay key
 *   because it cannot cross the MCP protocol boundary — the SDK's in-process
 *   MCP server handler never receives it. `block.id` is still used inside
 *   handler closures for session state updates (locating the correct
 *   ToolUseBlock within the message).
 */
export function registerEvoseRelayForProjection(
  blocks: ContentBlock[],
  messageId: string,
  ctx: SessionContext,
): void {
  const { session, relay } = ctx

  for (const block of blocks) {
    if (block.type !== 'tool_use' || !isEvoseToolName(block.name)) continue

    const toolUseId = typeof block.id === 'string' ? block.id.trim() : ''
    if (!toolUseId) {
      log.warn(`Skipping Evose relay registration for messageId=${messageId}: missing toolUseId`)
      continue
    }

    const appId = typeof block.input?.['app_id'] === 'string' ? block.input['app_id'] : ''
    const relayKey = deriveEvoseRelayKey(block.name, appId)

    log.info(
      `Registering Evose relay: messageId=${messageId}, toolUseId=${toolUseId}, relayKey=${relayKey}`,
    )

    session.setActiveToolUseId(messageId, toolUseId)

    relay.register(relayKey, {
      onChunk: (data: unknown) => {
        const evt = data as EvoseRelayEvent
        session.handleEvoseRelayEvent(messageId, toolUseId, evt)
        session.setActiveToolUseId(messageId, toolUseId)
      },
      onFlush: () => {
        ctx.dispatchRelayProgress(messageId)
      },
      throttleMs: DISPATCH_THROTTLE_INTERVAL_MS,
      onDone: () => {
        session.setActiveToolUseId(messageId, null)
      },
    })
  }
}
