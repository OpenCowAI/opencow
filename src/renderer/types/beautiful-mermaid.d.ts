// SPDX-License-Identifier: Apache-2.0

/**
 * Ambient type declarations for beautiful-mermaid.
 *
 * The package ships raw TypeScript source (designed for Bun) with .ts extension
 * imports that are incompatible with our tsconfig. This declaration file provides
 * the types we need without requiring tsc to resolve the package internals.
 */

declare module 'beautiful-mermaid' {
  export interface RenderOptions {
    /** Background color. Default: '#FFFFFF' */
    bg?: string
    /** Foreground / primary text color. Default: '#27272A' */
    fg?: string
    /** Edge/connector color */
    line?: string
    /** Arrow heads, highlights */
    accent?: string
    /** Secondary text, edge labels */
    muted?: string
    /** Node/box fill tint */
    surface?: string
    /** Node/group stroke color */
    border?: string
    /** Font family. Default: 'Inter' */
    font?: string
    /** Canvas padding in px. Default: 40 */
    padding?: number
    /** Horizontal spacing between sibling nodes. Default: 24 */
    nodeSpacing?: number
    /** Vertical spacing between layers. Default: 40 */
    layerSpacing?: number
    /** Spacing between disconnected components */
    componentSpacing?: number
    /** Render with transparent background. Default: false */
    transparent?: boolean
  }

  export interface DiagramColors {
    bg: string
    fg: string
    line?: string
    accent?: string
    muted?: string
    surface?: string
    border?: string
  }

  export type ThemeName = string

  export const THEMES: Record<string, DiagramColors>
  export const DEFAULTS: Readonly<{ bg: string; fg: string }>

  /** Render Mermaid diagram text to an SVG string — synchronously. */
  export function renderMermaidSVG(text: string, options?: RenderOptions): string

  /** Render Mermaid diagram text to an SVG string — async (same result as sync). */
  export function renderMermaidSVGAsync(text: string, options?: RenderOptions): Promise<string>
}
