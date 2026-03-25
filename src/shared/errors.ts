// SPDX-License-Identifier: Apache-2.0

/**
 * Shared error types for OpenCow.
 * Placed in shared/ so both main-process and renderer can import without circular deps.
 */

/**
 * Structured error thrown when an Evose API call fails.
 *
 * Object.setPrototypeOf is required: TypeScript's `extends Error` breaks
 * `instanceof` checks when targeting ES5 (prototype chain is not set correctly).
 */
export class EvoseApiError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message)
    this.name = 'EvoseApiError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/**
 * Thrown when an Evose Agent run receives a `run_cancelled` SSE event,
 * indicating the agent was terminated before producing a result.
 *
 * Distinct from EvoseApiError (HTTP/business errors) — this is a runtime
 * cancellation that happens after the stream has started.
 */
export class EvoseAgentCancelledError extends Error {
  constructor() {
    super('Evose agent was cancelled before completing')
    this.name = 'EvoseAgentCancelledError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
