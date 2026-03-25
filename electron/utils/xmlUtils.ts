// SPDX-License-Identifier: Apache-2.0

/** Escape special characters for use in XML attribute values. */
export function escapeXmlAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
