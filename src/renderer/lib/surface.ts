// SPDX-License-Identifier: Apache-2.0

import type { SurfaceElevation, SurfaceSemanticColor } from '@shared/types'

// ---------------------------------------------------------------------------
// Surface Props Generator
// ---------------------------------------------------------------------------

/**
 * Configuration for a texture-aware surface element.
 * Used by {@link surfaceProps} to generate the correct data attributes
 * and CSS custom property for the texture system.
 */
export interface SurfaceConfig {
  /** Surface elevation level — controls glass intensity. */
  elevation: SurfaceElevation
  /** Semantic color variable name — the surface's base background color. */
  color: SurfaceSemanticColor
  /** Enable hover/focus glow effect (optional, defaults to false). */
  glow?: boolean
}

/**
 * Props to spread onto a surface element.
 * Includes data attributes that mark elevation/semantic-color, and the
 * inline style that exposes the surface's base color via `--_surface-color`.
 */
export interface SurfaceProps {
  'data-surface': SurfaceElevation
  'data-surface-glow'?: ''
  style: React.CSSProperties
}

/**
 * Generate data attributes + inline style for a raised surface.
 *
 * Currently inert — produces structural markers but no visual effect. Kept
 * so future surface treatments (e.g. a curated highlight) can opt in
 * without re-tagging every card / popover / modal in the tree.
 */
export function surfaceProps(config: SurfaceConfig): SurfaceProps {
  const props: SurfaceProps = {
    'data-surface': config.elevation,
    style: { '--_surface-color': `var(--${config.color})` } as React.CSSProperties,
  }

  if (config.glow) {
    props['data-surface-glow'] = ''
  }

  return props
}
