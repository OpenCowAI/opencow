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
 * Includes data attributes for the CSS texture system and the
 * inline style that declares the surface's semantic color.
 */
export interface SurfaceProps {
  'data-surface': SurfaceElevation
  'data-surface-glow'?: ''
  style: React.CSSProperties
}

/**
 * Generate data attributes and inline style for a texture-aware surface.
 *
 * In **plain** mode, these attributes have zero visual effect — no CSS rules
 * match `[data-surface]` outside of `.texture-glass`.
 *
 * In **glass** mode, the CSS in `textures.css` reads `data-surface` and
 * `--_surface-color` to apply the correct elevation-aware glass behavior.
 *
 * @example
 * ```tsx
 * // Card surface (raised elevation, card color)
 * <div {...surfaceProps({ elevation: 'raised', color: 'card' })} className="...">
 *
 * // Dialog surface (modal elevation, card color)
 * <div {...surfaceProps({ elevation: 'modal', color: 'card' })} className="...">
 *
 * // Interactive card with glow on hover
 * <div {...surfaceProps({ elevation: 'raised', color: 'card', glow: true })} className="...">
 * ```
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
