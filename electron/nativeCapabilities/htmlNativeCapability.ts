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
import type { ToolDescriptor } from '@opencow-ai/opencow-agent-sdk'
import type { NativeCapabilityMeta, NativeCapabilityToolContext } from './types'
import { BaseNativeCapability } from './baseNativeCapability'
import type { OpenCowSessionContext } from './openCowSessionContext'
import { GEN_HTML_DEFAULT_TITLE } from '@shared/genHtmlInput'

/**
 * Sanity check that `args.html` looks like HTML (vs. a textual description).
 * Matches the start of any plausible HTML document or top-level container —
 * intentionally permissive so legitimate snippets (a single `<div>…</div>`)
 * pass while plain prose ("一个简单的 AI Agent 介绍页面…") fails fast.
 */
const HTML_OPENER_RE =
  /<\s*(!doctype|html|head|body|main|section|article|aside|header|footer|nav|div|span|p|h[1-6]|ul|ol|li|table|form|svg|figure|pre|code|blockquote|details|dialog|template)\b/i

export class HtmlNativeCapability extends BaseNativeCapability {
  readonly meta: NativeCapabilityMeta = {
    category: 'html',
    description: 'Generate HTML content for browser-style preview in session console',
  }

  override getToolDescriptors(
    _ctx: NativeCapabilityToolContext,
  ): readonly ToolDescriptor<OpenCowSessionContext>[] {
    return [
      this.tool({
        name: 'gen_html',
        description:
          'Generate an HTML page for browser-style preview in the session console. '
          + 'Users can click to view the full rendered page and optionally download it. '
          + 'IMPORTANT: When the user asks to generate HTML, create an HTML page, or produce HTML output, '
          + 'ALWAYS use this gen_html tool — do NOT use the Write tool to write .html files. '
          + 'Use for: any HTML output the user requests, interactive dashboards, data visualizations, '
          + 'email templates, landing pages, changelogs, reports, or rich visual content. '
          + 'Only fall back to the Write tool for Markdown (.md) files when the user has NOT '
          + 'specified HTML as the output format and the content does not require visual rendering. '
          + 'Schema has exactly two fields: `title` and `html`. Pass the raw HTML markup in `html` — '
          + 'do NOT invent any "content" / "summary" / "description" field; there is no such field.',
        schema: {
          title: z.string().optional().describe('Display title for the HTML page (shown in preview card header)'),
          html: z.string().describe(
            'Raw HTML markup of the page. MUST be valid HTML starting with <!DOCTYPE, <html, '
            + 'or another top-level HTML element. Inline <style> and <script> are allowed. '
            + 'This field is NOT a description of the page — pass the literal markup.',
          ),
        },
        execute: async ({ args }) => {
          const body = args.html?.trim() ?? ''
          if (body.length === 0) {
            return this.errorResult(
              'gen_html requires non-empty HTML markup in the "html" field.',
            )
          }
          // Defense-in-depth: if a future model again misuses this tool by
          // sending a textual description in `html`, fail loudly so the model
          // self-corrects on the next turn instead of silently rendering
          // prose as a "page". Cheap heuristic — must contain at least one
          // common HTML tag opener.
          if (!HTML_OPENER_RE.test(body)) {
            return this.errorResult(
              'gen_html "html" field must be raw HTML markup, not a textual description. '
              + 'Wrap your content in proper HTML tags (e.g. `<!DOCTYPE html><html>…</html>`).',
            )
          }
          const title = args.title?.trim() || GEN_HTML_DEFAULT_TITLE
          return this.textResult(
            `HTML page "${title}" generated. Browser preview card is now visible in the session console.`,
          )
        },
      }),
    ]
  }
}
