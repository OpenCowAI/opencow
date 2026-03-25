// SPDX-License-Identifier: Apache-2.0

/**
 * cursorDetector — Detect non-standard interactive elements via JS injection.
 *
 * Ported from Agent-Browser snapshot.rs `find_cursor_interactive_elements()`.
 *
 * Many real-world sites use <div onclick>, <span style="cursor:pointer">, or
 * contenteditable without ARIA roles. Without cursor detection, interactive
 * coverage on such sites can be below 50%.
 *
 * Pipeline:
 * 1. Inject CURSOR_DETECT_JS → marks elements with data-__oc-ci attribute
 * 2. DOM.querySelectorAll('[data-__oc-ci]') → get nodeIds
 * 3. DOM.describeNode → get backendNodeId for each
 * 4. Build backendNodeId → CursorElementInfo map
 * 5. Cleanup: remove data-__oc-ci attributes
 *
 * @license Derived from Agent-Browser (Apache-2.0, Copyright 2025 Vercel Inc.)
 */

import type { CdpFn, CursorElementInfo } from './snapshotTypes'
import type { BrowserExecutionContext } from '../types'

// ─── Injected JS ─────────────────────────────────────────────────────────

/**
 * IIFE injected into the page to detect non-standard interactive elements.
 * Mirrors Agent-Browser snapshot.rs lines 474-533.
 *
 * Uses data-__oc-ci (OpenCow cursor-interactive) attribute prefix to avoid
 * collision with other tools.
 *
 * NOTE: The INTERACTIVE_ROLES set below is intentionally different from
 * refAllocator's INTERACTIVE_ROLES. This set is used as a *skip filter*
 * (elements with these ARIA roles are already handled by the AX tree),
 * while refAllocator's set determines ref allocation. The cursor detector's
 * set is a superset because it also includes container roles (listbox, menu,
 * tablist, etc.) that the AX tree already represents.
 */
const CURSOR_DETECT_JS = `
(function () {
  var INTERACTIVE_TAGS = new Set([
    'A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'DETAILS', 'SUMMARY'
  ]);

  var INTERACTIVE_ROLES = new Set([
    'button', 'link', 'checkbox', 'radio', 'tab', 'menuitem',
    'menuitemcheckbox', 'menuitemradio', 'option', 'switch',
    'treeitem', 'combobox', 'searchbox', 'slider', 'spinbutton',
    'textbox', 'listbox', 'menu', 'menubar', 'tablist', 'tree',
    'grid', 'row', 'gridcell', 'columnheader', 'rowheader'
  ]);

  function isInheritedCursor(el) {
    if (!el.parentElement) return false;
    return window.getComputedStyle(el.parentElement).cursor === 'pointer';
  }

  var results = [];
  var all = document.body ? document.body.querySelectorAll('*') : [];

  for (var i = 0; i < all.length; i++) {
    var el = all[i];

    // Skip standard interactive tags
    if (INTERACTIVE_TAGS.has(el.tagName)) continue;

    // Skip elements with interactive ARIA roles
    var role = el.getAttribute('role');
    if (role && INTERACTIVE_ROLES.has(role)) continue;

    var style = window.getComputedStyle(el);
    var hasCursorPointer = style.cursor === 'pointer';
    var hasOnClick = typeof el.onclick === 'function' || el.hasAttribute('onclick');
    var tabIndex = el.getAttribute('tabindex');
    var hasTabIndex = tabIndex !== null && tabIndex !== '-1';
    var isEditable = el.isContentEditable;

    // Must have at least one interactive signal
    if (!hasCursorPointer && !hasOnClick && !hasTabIndex && !isEditable) continue;

    // Skip inherited cursor:pointer (not a direct signal)
    if (hasCursorPointer && !hasOnClick && !hasTabIndex && !isEditable) {
      if (isInheritedCursor(el)) continue;
    }

    // Skip zero-size elements
    var rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;

    // Mark element for CDP retrieval
    el.setAttribute('data-__oc-ci', String(results.length));

    results.push({
      text: (el.textContent || '').trim().substring(0, 100),
      tagName: el.tagName.toLowerCase(),
      hasOnClick: hasOnClick,
      hasCursorPointer: hasCursorPointer,
      hasTabIndex: hasTabIndex,
      isEditable: isEditable
    });
  }

  return results;
})()
`

/** Cleanup script — removes data-__oc-ci marker attributes. */
const CURSOR_CLEANUP_JS = `
(function () {
  var marked = document.querySelectorAll('[data-__oc-ci]');
  for (var i = 0; i < marked.length; i++) {
    marked[i].removeAttribute('data-__oc-ci');
  }
  return marked.length;
})()
`

// ─── Detection Pipeline ──────────────────────────────────────────────────

/**
 * Detect non-standard interactive elements in the current page.
 *
 * @returns Map from backendNodeId → CursorElementInfo
 */
export async function detectCursorInteractiveElements(
  cdp: CdpFn,
  context: BrowserExecutionContext = {},
): Promise<Map<number, CursorElementInfo>> {
  const result = new Map<number, CursorElementInfo>()

  // Step 1: Inject detection script
  const evalResult = (await cdp('Runtime.evaluate', {
    expression: CURSOR_DETECT_JS,
    returnByValue: true,
  }, undefined, context)) as { result?: { value?: unknown } }

  const detectedElements = (evalResult.result?.value ?? []) as Array<{
    text: string
    tagName: string
    hasOnClick: boolean
    hasCursorPointer: boolean
    hasTabIndex: boolean
    isEditable: boolean
  }>

  if (detectedElements.length === 0) {
    return result
  }

  try {
    // Step 2: Get DOM root
    const doc = (await cdp('DOM.getDocument', { depth: 0 }, undefined, context)) as {
      root: { nodeId: number }
    }

    // Step 3: Query all marked elements
    const queryResult = (await cdp('DOM.querySelectorAll', {
      nodeId: doc.root.nodeId,
      selector: '[data-__oc-ci]',
    }, undefined, context)) as { nodeIds?: number[] }

    const nodeIds = queryResult.nodeIds ?? []

    // Step 4: Describe each node to get backendNodeId
    for (const nodeId of nodeIds) {
      try {
        const desc = (await cdp('DOM.describeNode', { nodeId }, undefined, context)) as {
          node?: {
            backendNodeId: number
            attributes?: string[]
          }
        }

        if (!desc.node) continue

        const { backendNodeId, attributes } = desc.node
        if (!attributes) continue

        // Parse flat [name, value, name, value, ...] attribute array
        let dataIndex: number | undefined
        for (let i = 0; i < attributes.length; i += 2) {
          if (attributes[i] === 'data-__oc-ci') {
            dataIndex = parseInt(attributes[i + 1], 10)
            break
          }
        }

        if (dataIndex === undefined || dataIndex >= detectedElements.length) continue

        result.set(backendNodeId, detectedElements[dataIndex])
      } catch {
        // Individual node description may fail — skip silently
      }
    }
  } finally {
    // Step 5: Always cleanup markers
    await cdp('Runtime.evaluate', {
      expression: CURSOR_CLEANUP_JS,
      returnByValue: true,
    }, undefined, context).catch(() => {})
  }

  return result
}
