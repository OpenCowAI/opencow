// SPDX-License-Identifier: Apache-2.0

/**
 * HtmlNativeCapability — Generate HTML content for browser-style preview.
 *
 * Provides the `gen_html` tool that allows Claude to produce HTML content
 * rendered as an interactive browser preview card in the session console.
 *
 * Content stays in-memory (not written to disk). Users can optionally
 * download via the preview dialog's Download button.
 */

import { z } from 'zod/v4'
import type { NativeCapabilityMeta, NativeCapabilityToolContext } from './types'
import { BaseNativeCapability, type ToolConfig } from './baseNativeCapability'
import { parseGenHtmlInput } from '@shared/genHtmlInput'

export class HtmlNativeCapability extends BaseNativeCapability {
  readonly meta: NativeCapabilityMeta = {
    category: 'html',
    name: 'HTML Preview',
    description: 'Generate HTML content for browser-style preview in session console',
    version: '1.0.0',
  }

  protected toolConfigs(_context: NativeCapabilityToolContext): ToolConfig[] {
    return [
      {
        name: 'gen_html',
        description:
          'Generate HTML content for browser preview. The content is displayed as an interactive '
          + 'browser-style preview card in the session console. Users can click to view the full '
          + 'rendered page and optionally download it. '
          + 'IMPORTANT: When the user asks to generate HTML, create an HTML page, or produce HTML output, '
          + 'ALWAYS use this gen_html tool — do NOT use the Write tool to write .html files. '
          + 'This tool is the correct way to deliver HTML content because it provides an interactive '
          + 'browser-style preview with download capability. '
          + 'Use for: any HTML output the user requests, interactive dashboards, data visualizations, '
          + 'email templates, landing pages, changelogs, reports, or rich visual content. '
          + 'Only fall back to the Write tool for Markdown (.md) files when the user has NOT '
          + 'specified HTML as the output format and the content does not require visual rendering.',
        schema: {
          title: z.string().describe('Display title for the HTML page (shown in preview card header)'),
          content: z.string()
            .optional()
            .describe('Complete HTML content. Can include inline <style> and <script> tags.'),
          html: z.string()
            .optional()
            .describe('Legacy alias of content. Prefer content for new calls.'),
        },
        execute: async (args) => {
          const { title, content } = parseGenHtmlInput(args)
          if (!content) {
            return this.errorResult(
              'gen_html requires non-empty HTML content. Provide it in "content" (preferred) or "html".',
            )
          }
          return this.textResult(
            `HTML page "${title}" generated. Browser preview card is now visible in the session console.`,
          )
        },
      },
    ]
  }
}
