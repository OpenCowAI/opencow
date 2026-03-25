// SPDX-License-Identifier: Apache-2.0

import type { BiweeklyConfig } from '../../../src/shared/types'

export class BiweeklyCalculator {
  isBigWeek(date: Date, config: BiweeklyConfig): boolean {
    const ref = new Date(config.referenceDate)
    const msPerWeek = 7 * 24 * 60 * 60 * 1000
    const weeksDiff = Math.floor((date.getTime() - ref.getTime()) / msPerWeek)
    const isEvenWeek = weeksDiff % 2 === 0
    return config.referenceIsBig ? isEvenWeek : !isEvenWeek
  }

  isWorkday(date: Date, config: BiweeklyConfig): boolean {
    const isBig = this.isBigWeek(date, config)
    const dayOfWeek = date.getDay() === 0 ? 7 : date.getDay() // ISO weekday
    const workDays = isBig ? config.bigWeekDays : config.smallWeekDays
    return workDays.includes(dayOfWeek)
  }
}
