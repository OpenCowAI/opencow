// SPDX-License-Identifier: Apache-2.0

// i18n TypeScript type augmentation.
//
// NOTE: With moduleResolution "bundler" + TS 5.9, 'i18next' resolves to index.d.mts
// which does NOT properly export CustomTypeOptions for module augmentation.
//
// We intentionally DO NOT define `resources` here. Strict compile-time key checking
// conflicts with the widespread `labelKey: string` dynamic key pattern used across
// the codebase (50+ files). Translation key correctness is instead verified by the
// parity test (tests/i18n/parity.test.ts) which ensures en-US and zh-CN have
// identical key structures across all 9 namespaces.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common'
    allowObjectInHTMLChildren: false
  }
}

// react-i18next augments React.HTMLAttributes.children to include ObjectOrNever,
// which widens the children type beyond ReactNode when allowObjectInHTMLChildren
// resolves to true (due to TS 5.9 .d.mts module augmentation limitation).
// This override restores the original children type to prevent type conflicts
// with react-markdown and other libraries that expect children?: ReactNode.
import type { ReactNode } from 'react'
declare module 'react' {
  interface HTMLAttributes<T> {
    children?: ReactNode | undefined
  }
}
