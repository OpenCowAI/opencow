// SPDX-License-Identifier: Apache-2.0

/** Step progress configuration passed from the orchestrator to each step component. */
export interface StepConfig {
  stepNumber: number
  totalSteps: number
}
