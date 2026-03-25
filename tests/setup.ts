// SPDX-License-Identifier: Apache-2.0

/**
 * Vitest global setup for jsdom environment.
 *
 * ProseMirror (used by TipTap) relies on several DOM APIs that jsdom
 * does not implement. We provide minimal stubs here so that tests
 * using the TipTap editor can run without errors.
 */

import type { CapabilitySnapshot } from '../src/shared/types'
import { APP_WINDOW_KEY } from '../src/shared/appIdentity'

function createEmptyCapabilitySnapshot(): CapabilitySnapshot {
  return {
    skills: [],
    agents: [],
    commands: [],
    rules: [],
    hooks: [],
    mcpServers: [],
    diagnostics: [],
    version: 1,
    timestamp: Date.now(),
  }
}

if (typeof window !== 'undefined') {
  const appAPI = ((window as unknown as Record<string, unknown>)[APP_WINDOW_KEY] ?? {}) as Record<string, unknown>

  if (typeof appAPI['capability:snapshot'] !== 'function') {
    appAPI['capability:snapshot'] = async () => createEmptyCapabilitySnapshot()
  }
  if (typeof appAPI['on:opencow:event'] !== 'function') {
    appAPI['on:opencow:event'] = () => () => {}
  }

  ;(window as unknown as Record<string, unknown>)[APP_WINDOW_KEY] = appAPI
}

// ── window.matchMedia ────────────────────────────────────────────────────────
// Monaco Editor's useMonacoTheme hook calls window.matchMedia which jsdom
// does not implement. We provide a minimal no-op stub.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList
}

// ── i18n ─────────────────────────────────────────────────────────────────────
// Component tests that use useTranslation() need i18next initialized.
// We initialize with en-US translations so rendered text matches test assertions.
import { initI18n } from '../src/renderer/i18n'
try {
  initI18n()
} catch {
  // Already initialized — safe to ignore
}

// Range —— ProseMirror calls getBoundingClientRect / getClientRects
if (typeof Range !== 'undefined') {
  if (!Range.prototype.getBoundingClientRect) {
    Range.prototype.getBoundingClientRect = () =>
      ({ bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0, toJSON: () => '{}' }) as DOMRect
  }

  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = () => ({
      item: () => null,
      length: 0,
      *[Symbol.iterator] (): Generator<DOMRect> {
        /* empty */
      }
    }) as DOMRectList
  }
}

// elementFromPoint —— ProseMirror view uses this for hit-testing
if (typeof document !== 'undefined' && !document.elementFromPoint) {
  document.elementFromPoint = () => null
}

// queryCommandSupported —— Monaco Editor clipboard module checks this.
// jsdom does not implement it, so we provide a minimal stub.
if (typeof document !== 'undefined' && !document.queryCommandSupported) {
  document.queryCommandSupported = () => false
}

// IntersectionObserver —— SessionScrollNav uses this for scroll-nav tracking.
// jsdom does not implement it, so we provide a minimal no-op stub.
if (typeof globalThis.IntersectionObserver === 'undefined') {
  globalThis.IntersectionObserver = class IntersectionObserver {
    readonly root: Element | null = null
    readonly rootMargin: string = '0px'
    readonly thresholds: readonly number[] = [0]
    constructor(_cb: IntersectionObserverCallback, _opts?: IntersectionObserverInit) {}
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] { return [] }
  } as unknown as typeof globalThis.IntersectionObserver
}
