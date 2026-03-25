// SPDX-License-Identifier: Apache-2.0

/**
 * iframeResolver — Resolve iframe frameId for recursive snapshots.
 *
 * Ported from Agent-Browser snapshot.rs `resolve_iframe_frame_id()`.
 *
 * Electron limitation: webContents.debugger doesn't support CDP sessionId,
 * so cross-origin iframes may not be accessible. Same-origin iframes work
 * via DOM.describeNode → contentDocument.frameId.
 *
 * v4 scope: Same-origin iframe support. Cross-origin is a known limitation.
 *
 * @license Derived from Agent-Browser (Apache-2.0, Copyright 2025 Vercel Inc.)
 */

import type { CdpFn } from './snapshotTypes'

/**
 * Resolve the frameId for an iframe element.
 *
 * Strategy:
 * 1. DOM.describeNode with depth:1 to access contentDocument
 * 2. Prefer contentDocument.frameId (same-origin)
 * 3. Fall back to node.frameId
 * 4. Throw if neither found (likely cross-origin in Electron)
 *
 * @param cdp - CDP command function
 * @param backendNodeId - The iframe element's backend node ID
 * @returns The resolved frameId string
 */
export async function resolveIframeFrameId(
  cdp: CdpFn,
  backendNodeId: number,
): Promise<string> {
  const result = (await cdp('DOM.describeNode', {
    backendNodeId,
    depth: 1,
  })) as {
    node: {
      contentDocument?: { frameId?: string }
      frameId?: string
    }
  }

  const node = result.node

  // Prefer contentDocument.frameId (same-origin iframe)
  if (node.contentDocument?.frameId) {
    return node.contentDocument.frameId
  }

  // Fallback to node.frameId
  if (node.frameId) {
    return node.frameId
  }

  throw new Error(
    `Unable to resolve frameId for iframe (backendNodeId=${backendNodeId}). ` +
    'This may be a cross-origin iframe, which is not supported in the current scope.',
  )
}
