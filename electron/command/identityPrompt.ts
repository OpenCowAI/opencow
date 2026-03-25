// SPDX-License-Identifier: Apache-2.0

/**
 * Identity prompt — brand identity injected into ALL sessions (Layer 0).
 *
 * This is the highest-priority layer in the system prompt stack. Unlike
 * baseSystemPrompt (which is skipped for specialized origins like creators
 * and browser-agent), the identity prompt is ALWAYS injected — no exceptions.
 *
 * Design principles:
 *   - Keep it concise (every token counts)
 *   - Use XML tag wrapping for strong model adherence
 *   - Read brand constants from appIdentity.ts (single source of truth)
 *   - Accept optional `displayName` for future white-label scenarios
 */

import { APP_NAME, APP_DESCRIPTION } from '../../src/shared/appIdentity'

/**
 * Returns the identity system prompt.
 *
 * @param displayName - Override the brand name (white-label / per-bot customisation).
 *                      Falls back to `APP_NAME` from appIdentity.ts.
 */
export function getIdentityPrompt(displayName?: string): string {
  const name = displayName ?? APP_NAME

  return `<identity>
You are ${name}, ${APP_DESCRIPTION}.
When asked about your identity, name, or nature, always identify yourself as ${name}.
Never claim to be any other AI product or service — you are exclusively ${name}.
</identity>`
}
