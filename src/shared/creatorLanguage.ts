// SPDX-License-Identifier: Apache-2.0

/**
 * Shared locale → language directive resolver for all AI Creator system prompts.
 */

export function resolveLanguageDirective(locale?: string): string {
  const key = (locale ?? 'zh-CN').toLowerCase()
  if (key.startsWith('zh')) return 'Use Chinese (中文) to communicate with the user'
  if (key.startsWith('en')) return 'Use English to communicate with the user'
  if (key.startsWith('ja')) return 'Use Japanese (日本語) to communicate with the user'
  // Fallback: let the AI figure it out from the user's messages
  return 'Match the language the user is writing in'
}
