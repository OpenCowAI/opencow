// SPDX-License-Identifier: Apache-2.0

/**
 * Shared type guard utilities.
 *
 * These are intentionally tiny and dependency-free so they can be imported
 * from both renderer and electron main processes without bundler issues.
 */

/**
 * Type-safe check: is `value` a non-null, non-array plain object?
 *
 * JavaScript's `typeof null === 'object'` and `typeof [] === 'object'`
 * make raw `typeof` checks unreliable for object validation.
 * This guard eliminates that entire class of bugs.
 *
 * @example
 *   isPlainObject({})          // true
 *   isPlainObject({ a: 1 })    // true
 *   isPlainObject(null)        // false
 *   isPlainObject([1, 2])      // false
 *   isPlainObject('string')    // false
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
