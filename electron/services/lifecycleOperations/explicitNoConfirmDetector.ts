// SPDX-License-Identifier: Apache-2.0

export type ExplicitNoConfirmConfidence = 'high' | 'low'

export interface ExplicitNoConfirmDetectionResult {
  explicitNoConfirm: boolean
  confidence: ExplicitNoConfirmConfidence
  evidence: string | null
}

const POSITIVE_PATTERNS: readonly RegExp[] = [
  /\bskip\s+confirmation\b/i,
  /\bno\s+need\s+to\s+confirm\b/i,
  /\bno\s+confirmation\b/i,
  /\bdirect(?:ly)?\s+(?:run|execute|apply|create|do\s+it)\b/i,
  /\bauto(?:matically)?\s+(?:apply|execute|create)\b/i,
  /不用确认/,
  /无需确认/,
  /直接执行/,
  /直接创建/,
  /直接应用/,
]

const NEGATIVE_PATTERNS: readonly RegExp[] = [
  /\bconfirm\s+first\b/i,
  /\bneed\s+confirmation\b/i,
  /\bplease\s+confirm\b/i,
  /先确认/,
  /需要确认/,
]

export class ExplicitNoConfirmDetector {
  detect(input: string | undefined | null): ExplicitNoConfirmDetectionResult {
    if (!input || !input.trim()) {
      return {
        explicitNoConfirm: false,
        confidence: 'low',
        evidence: null,
      }
    }

    const text = input.trim()

    for (const pattern of NEGATIVE_PATTERNS) {
      const match = text.match(pattern)
      if (match) {
        return {
          explicitNoConfirm: false,
          confidence: 'low',
          evidence: match[0] ?? null,
        }
      }
    }

    for (const pattern of POSITIVE_PATTERNS) {
      const match = text.match(pattern)
      if (match) {
        return {
          explicitNoConfirm: true,
          confidence: 'high',
          evidence: match[0] ?? null,
        }
      }
    }

    return {
      explicitNoConfirm: false,
      confidence: 'low',
      evidence: null,
    }
  }
}
