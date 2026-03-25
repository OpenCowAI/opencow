// SPDX-License-Identifier: Apache-2.0

import { truncate } from '@shared/unicode'

const MAX_NAME_LENGTH = 80

/**
 * Structured return value for sanitizeSessionName.
 *
 * Separates command name from user text for independent UI consumption:
 * - `text`: Sanitized session name (the user's actual input text)
 * - `commandName`: Command/Skill name (e.g. "/yg.code.quality"), null for non-command messages
 */
export interface SanitizedName {
  text: string
  commandName: string | null
}

/**
 * Extract a structured session name from a raw user message in Claude Code JSONL.
 *
 * Processing priority:
 * 1. Skill/Command invocation -> separate <command-name> and <command-args>
 * 2. Filter noise (caveat tags, interruption markers)
 * 3. Remove residual HTML/XML tags
 * 4. Normalize whitespace, truncate
 */
export function sanitizeSessionName(raw: string): SanitizedName | null {
  if (!raw || !raw.trim()) return null

  let text = raw
  let commandName: string | null = null

  // 1. Skill/Command invocation: separate <command-name> and <command-args>
  // Return null (skip) when no valid args, letting the parser continue to find the next real user message
  if (text.includes('<command-message>')) {
    const argsMatch = text.match(/<command-args>([\s\S]*?)<\/command-args>/)
    if (argsMatch && argsMatch[1].trim()) {
      const nameMatch = text.match(/<command-name>(\/[^<]+)<\/command-name>/)
      commandName = nameMatch ? nameMatch[1] : null
      text = argsMatch[1]
    } else {
      // No valid args -> this is a pure directive (/clear, /compact, /superpowers:brainstorm, etc.), skip
      return null
    }
  }

  // 2. Filter entire noise content

  // Skill content injection: system-injected full skill definition ("Base directory for this skill: ...")
  if (/^Base directory for this skill:/i.test(text.trim())) {
    return null
  }

  // Skill invocation directive: system-injected invocation instructions ("Invoke the ... skill ...")
  if (/^Invoke the .+ skill/i.test(text.trim())) {
    return null
  }

  // Built-in slash commands (/clear, /compact, /help, etc.): no user semantics
  if (/^\/\w+\s*$/.test(text.trim())) {
    return null
  }

  // Context compaction continuation prompt: system-injected, not user input
  if (/^This session is being continued from a previous conversation/i.test(text.trim())) {
    return null
  }

  // local-command-caveat: the entire message is system-injected, no user semantics
  if (/<local-command-caveat>/.test(text) && !text.replace(/<[^>]*>/g, '').replace(/Caveat:[\s\S]*/i, '').trim()) {
    return null
  }

  // [Request interrupted...] / [Error...] bracketed system markers
  if (/^\[(?:Request interrupted|Error)[^\]]*\]$/.test(text.trim())) {
    return null
  }

  // 3. Remove all HTML/XML tags
  text = text.replace(/<[^>]*>/g, '')

  // 4. Remove leading @ symbol (Markdown mention marker)
  text = text.replace(/^@\s*/, '')

  // 5. Normalize whitespace
  text = text.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim()

  if (!text) return null

  // 6. Truncate
  text = truncate(text, { max: MAX_NAME_LENGTH })

  return { text, commandName }
}
