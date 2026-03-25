// SPDX-License-Identifier: Apache-2.0

/**
 * Chrome DevTools MCP — Google's official browser debugging & automation server.
 *
 * Template data sourced from `chrome-devtools-mcp@0.19.0` source code analysis.
 * See: docs/proposals/chrome-devtools-mcp-integration.md
 */

import type { MCPServerTemplate } from '../types'

export const chromeDevToolsTemplate: MCPServerTemplate = {
  id: 'chrome-devtools',
  name: 'Chrome DevTools',
  icon: 'Globe',
  description: 'Control and debug Chrome via DevTools Protocol (by Google)',
  serverConfig: {
    type: 'stdio',
    command: 'npx',
    args: ['-y', 'chrome-devtools-mcp@^0.19.0'],
  },
  variants: [
    {
      id: 'full',
      label: 'Full',
      description: '38 tools — automation, debugging, performance, network, extensions',
      serverConfig: {},
    },
    {
      id: 'slim-headless',
      label: 'Slim + Headless',
      description: '3 basic tools (navigate/evaluate/screenshot), minimal resources',
      serverConfig: {
        args: ['-y', 'chrome-devtools-mcp@^0.19.0', '--slim', '--headless'],
      },
    },
    {
      id: 'headless',
      label: 'Headless',
      description: 'Full toolset, no Chrome UI window',
      serverConfig: {
        args: ['-y', 'chrome-devtools-mcp@^0.19.0', '--headless'],
      },
    },
    {
      id: 'connect-existing',
      label: 'Connect Existing',
      description: 'Connect to a running Chrome (preserves login state)',
      serverConfig: {
        args: [
          '-y',
          'chrome-devtools-mcp@^0.19.0',
          '--browserUrl=http://127.0.0.1:9222',
        ],
      },
    },
  ],
  options: [
    {
      id: 'no-telemetry',
      label: 'Disable Google Telemetry',
      description: 'Do not send usage statistics to Google',
      type: 'boolean',
      defaultValue: true,
      argMapping: { flag: '--no-usage-statistics', condition: 'when-true' },
    },
    {
      id: 'no-crux',
      label: 'Disable CrUX Data',
      description: 'Do not send page URLs to Google CrUX API',
      type: 'boolean',
      defaultValue: false,
      argMapping: { flag: '--no-performance-crux', condition: 'when-true' },
    },
    {
      id: 'isolated',
      label: 'Isolated Profile',
      description: 'Use a temporary Chrome profile, auto-cleaned on exit',
      type: 'boolean',
      defaultValue: false,
      argMapping: { flag: '--isolated', condition: 'when-true' },
    },
    {
      id: 'viewport',
      label: 'Viewport Size',
      description: 'Format: WIDTHxHEIGHT (e.g. 1280x720)',
      type: 'string',
      defaultValue: '',
      argMapping: { flag: '--viewport' },
    },
  ],
  tags: ['browser', 'debugging', 'performance', 'google'],
}
