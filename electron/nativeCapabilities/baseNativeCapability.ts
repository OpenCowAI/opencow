// SPDX-License-Identifier: Apache-2.0
//
// BaseNativeCapability — thin OpenCow re-export of the SDK Capability Provider
// framework, parameterised on `OpenCowSessionContext`.
//
// Subclasses extend this and override `getToolDescriptors(ctx)`, building
// each tool with the SDK's `this.tool({ name, description, schema, execute })`
// helper. The helper preserves per-tool schema typing through a closure so
// `execute` callbacks receive `args` typed as
// `{ [K in keyof TSchema]: z.output<TSchema[K]> }` — no `as string` casts
// needed in handler bodies.
//
// Subclasses keep their existing import path:
//
//   import { BaseNativeCapability } from './baseNativeCapability'
//
// `BaseNativeCapability` resolves to `BaseCapabilityProvider<OpenCowSessionContext>`
// (a typed alias). All SDK helpers (`tool`, `textResult`, `errorResult`,
// default `getToolDescriptors` returning `[]`) are inherited.

import { BaseCapabilityProvider } from '@opencow-ai/opencow-agent-sdk'

import type { OpenCowSessionContext } from './openCowSessionContext'

/**
 * OpenCow's pre-parameterised base class. Subclasses just `extends
 * BaseNativeCapability` and get `OpenCowSessionContext` automatically — no
 * need to write the generic at every declaration site.
 */
export abstract class BaseNativeCapability extends BaseCapabilityProvider<OpenCowSessionContext> {}
