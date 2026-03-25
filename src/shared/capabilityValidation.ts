// SPDX-License-Identifier: Apache-2.0

const NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/

/** Validate a capability name for use as a filename. Returns error message or null. */
export function validateCapabilityName(name: string): string | null {
  const trimmed = name.trim()
  if (trimmed === '') return 'Name is required'
  if (!NAME_PATTERN.test(trimmed)) {
    return 'Name can only contain letters, numbers, hyphens, and underscores, and must start with a letter or number'
  }
  return null
}
