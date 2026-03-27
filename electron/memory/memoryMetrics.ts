// SPDX-License-Identifier: Apache-2.0

/**
 * Lightweight in-memory metrics collector for the memory system.
 * Provides observability into extraction success/failure rates and quality gate effectiveness.
 */

export interface MemoryMetricsSnapshot {
  extractionsAttempted: number
  extractionsSucceeded: number
  extractionsFailed: number
  extractionsRateLimited: number
  candidatesProduced: number
  candidatesDeduplicated: number
  candidatesRejectedLowConfidence: number
  candidatesRejectedContentTooLong: number
  memoriesCreated: number
}

export class MemoryMetricsCollector {
  private metrics: MemoryMetricsSnapshot = {
    extractionsAttempted: 0,
    extractionsSucceeded: 0,
    extractionsFailed: 0,
    extractionsRateLimited: 0,
    candidatesProduced: 0,
    candidatesDeduplicated: 0,
    candidatesRejectedLowConfidence: 0,
    candidatesRejectedContentTooLong: 0,
    memoriesCreated: 0,
  }

  recordExtractionAttempt(): void {
    this.metrics.extractionsAttempted++
  }

  recordExtractionSuccess(candidateCount: number): void {
    this.metrics.extractionsSucceeded++
    this.metrics.candidatesProduced += candidateCount
  }

  recordExtractionFailure(): void {
    this.metrics.extractionsFailed++
  }

  recordRateLimited(): void {
    this.metrics.extractionsRateLimited++
  }

  recordQualityGateRejection(reason: string): void {
    switch (reason) {
      case 'exact_duplicate':
      case 'too_similar':
        this.metrics.candidatesDeduplicated++
        break
      case 'low_confidence':
        this.metrics.candidatesRejectedLowConfidence++
        break
      case 'content_too_long':
        this.metrics.candidatesRejectedContentTooLong++
        break
    }
  }

  recordMemoryCreated(): void {
    this.metrics.memoriesCreated++
  }

  getSnapshot(): MemoryMetricsSnapshot {
    return { ...this.metrics }
  }

  reset(): void {
    for (const key of Object.keys(this.metrics) as (keyof MemoryMetricsSnapshot)[]) {
      this.metrics[key] = 0
    }
  }
}
