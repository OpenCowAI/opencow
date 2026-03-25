// SPDX-License-Identifier: Apache-2.0

/**
 * MCP Server Template Registry.
 *
 * Provides pre-configured templates for common MCP servers.
 * The renderer uses this to render the template selector UI.
 */

import type { MCPServerTemplate } from '../types'
import { chromeDevToolsTemplate } from './chromeDevTools'

/** All built-in MCP server templates, in display order. */
export const MCP_SERVER_TEMPLATES: readonly MCPServerTemplate[] = [
  chromeDevToolsTemplate,
] as const

/**
 * Sentinel template for "Custom" (blank form).
 * Empty serverConfig, no options or variants.
 */
export const CUSTOM_MCP_TEMPLATE: MCPServerTemplate = {
  id: '__custom__',
  name: 'Custom',
  icon: 'Wrench',
  description: 'Start from scratch with a blank configuration',
  serverConfig: { type: 'stdio', command: '', args: [] },
  variants: [],
  options: [],
  tags: [],
}

/** All templates including Custom (always last). */
export const ALL_MCP_TEMPLATES: readonly MCPServerTemplate[] = [
  ...MCP_SERVER_TEMPLATES,
  CUSTOM_MCP_TEMPLATE,
]
