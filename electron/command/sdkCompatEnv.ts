// SPDX-License-Identifier: Apache-2.0

/**
 * OpenCow SDK compatibility env defaults.
 *
 * The published npm SDK package currently does not ship the vendored
 * `dist/vendor/ripgrep` fallback, so forcing the SDK onto system `rg`
 * avoids guaranteed `Glob`/`Grep` failures when a working ripgrep is on PATH.
 *
 * Respect explicit user overrides.
 */
export function ensureSdkCompatEnv(): void {
  if (process.env.USE_BUILTIN_RIPGREP === undefined) {
    process.env.USE_BUILTIN_RIPGREP = '0'
  }
}
