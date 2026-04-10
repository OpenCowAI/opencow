// SPDX-License-Identifier: Apache-2.0

/**
 * EvoseNativeCapability — static gateway tools for Evose Agent/Workflow execution.
 *
 * Design:
 * - Exposes a small, stable tool surface:
 *   - `evose_run_agent`
 *   - `evose_run_workflow`
 *   - `evose_list_apps`
 * - App discovery/selection belongs to Skill/Catalog layer (not dynamic tool registration).
 * - Tool execution validates `app_id` against enabled settings entries.
 */

import { z } from 'zod/v4'
import type { ToolDescriptor } from '@opencow-ai/opencow-agent-sdk'
import type {
  NativeCapabilityMeta,
  NativeCapabilityToolContext,
} from '../types'
import { BaseNativeCapability } from '../baseNativeCapability'
import type { OpenCowSessionContext } from '../openCowSessionContext'
import type { EvoseService, AgentRunEvent } from '../../services/evoseService'
import type { SettingsService } from '../../services/settingsService'
import type { EvoseAppConfig, EvoseRelayEvent, EvoseSettings } from '../../../src/shared/types'
import {
  EVOSE_RUN_AGENT_LOCAL_NAME,
  EVOSE_RUN_WORKFLOW_LOCAL_NAME,
  EVOSE_LIST_APPS_LOCAL_NAME,
  deriveEvoseRelayKey,
} from '../../../src/shared/evoseNames'
import { createLogger } from '../../platform/logger'

const log = createLogger('EvoseNativeCapability')

export class EvoseNativeCapability extends BaseNativeCapability {
  readonly meta: NativeCapabilityMeta = {
    category: 'evose',
    description: 'Run Evose Agents & Workflows as MCP tools',
  }

  constructor(
    private readonly evoseService: EvoseService,
    private readonly settingsService: SettingsService,
  ) {
    super()
  }

  /**
   * Return static Evose gateway tools.
   *
   * Returns [] when credentials are missing — session proceeds normally.
   */
  override getToolDescriptors(
    ctx: NativeCapabilityToolContext,
  ): readonly ToolDescriptor<OpenCowSessionContext>[] {
    const { evose } = this.settingsService.getSettings()
    if (!evose.apiKey || evose.workspaceIds.length === 0) return []
    const enabledCount = evose.apps.filter((app) => app.enabled).length
    log.info(`Building Evose gateway MCP tools (enabled apps=${enabledCount})`)

    return [
      this.buildRunAgentTool(ctx),
      this.buildRunWorkflowTool(),
      this.buildListAppsTool(),
    ]
  }

  // ── Gateway: Run Agent ────────────────────────────────────────────────────

  private buildRunAgentTool(ctx: NativeCapabilityToolContext): ToolDescriptor<OpenCowSessionContext> {
    return this.tool({
      name: EVOSE_RUN_AGENT_LOCAL_NAME,
      description: '[Evose Gateway] Run an enabled Evose Agent by app_id',
      schema: {
        app_id:     z.string().describe('Evose Agent app_id (must be enabled in Settings)'),
        input:      z.string().describe('Input content to send to the Agent'),
        session_id: z.string().optional().describe('(Optional) Session ID for multi-turn conversations'),
      },
      execute: async ({ args, abortSignal }) => {
        const { evose } = this.settingsService.getSettings()
        const app = this.resolveEnabledApp(evose, args.app_id, 'agent')
        const relayKey = deriveEvoseRelayKey(EVOSE_RUN_AGENT_LOCAL_NAME, args.app_id)

        try {
          const result = await this.evoseService.runAgent({
            appId:     app.appId,
            input:     args.input,
            sessionId: args.session_id,
            signal:    abortSignal,
            onEvent:   (event: AgentRunEvent) => {
              switch (event.type) {
                case 'output':
                  // Agent text output -> EvoseRelayEvent.text
                  ctx.sessionContext.relay.emit(relayKey, { type: 'text', text: event.text } satisfies EvoseRelayEvent)
                  break

                case 'tool_call_started':
                  // Sub-tool started -> EvoseRelayEvent.tool_call_started (includes all fields)
                  ctx.sessionContext.relay.emit(relayKey, {
                    type: 'tool_call_started',
                    toolCallId: event.toolCallId,
                    toolName: event.toolName,
                    title: event.title,
                    iconUrl: event.iconUrl,
                    kwargs: event.kwargs,
                  } satisfies EvoseRelayEvent)
                  break

                case 'tool_call_completed':
                  // Sub-tool completed -> EvoseRelayEvent.tool_call_completed (emitted for both success and failure)
                  ctx.sessionContext.relay.emit(relayKey, {
                    type: 'tool_call_completed',
                    toolCallId: event.toolCallId,
                    toolName: event.toolName,
                    title: event.title,
                    result: event.result.slice(0, 2000),
                    isError: event.isError,
                  } satisfies EvoseRelayEvent)
                  break

                case 'started':
                case 'completed':
                case 'cancelled':
                  // Lifecycle events: no content to emit to the progress card
                  break
              }
            },
          })
          return this.textResult(result)
        } catch (err) {
          log.error(`Evose Agent tool error [${app.appId}/${app.name}]:`, err)
          return this.errorResult(err)
        } finally {
          ctx.sessionContext.relay.unregister(relayKey)
        }
      },
    })
  }

  // ── Gateway: Run Workflow ─────────────────────────────────────────────────

  private buildRunWorkflowTool(): ToolDescriptor<OpenCowSessionContext> {
    return this.tool({
      name: EVOSE_RUN_WORKFLOW_LOCAL_NAME,
      description: '[Evose Gateway] Run an enabled Evose Workflow by app_id',
      schema: {
        app_id: z.string().describe('Evose Workflow app_id (must be enabled in Settings)'),
        inputs: z.record(z.string(), z.unknown()).describe('Input parameters required by the Workflow (key-value pairs)'),
      },
      execute: async ({ args, abortSignal }) => {
        const { evose } = this.settingsService.getSettings()
        const app = this.resolveEnabledApp(evose, args.app_id, 'workflow')

        try {
          const result = await this.evoseService.runWorkflow({
            appId:  app.appId,
            inputs: args.inputs,
            signal: abortSignal,
          })
          return this.textResult(result)
        } catch (err) {
          log.error(`Evose Workflow tool error [${app.appId}/${app.name}]:`, err)
          return this.errorResult(err)
        }
      },
    })
  }

  // ── Gateway: List Apps ────────────────────────────────────────────────────

  private buildListAppsTool(): ToolDescriptor<OpenCowSessionContext> {
    return this.tool({
      name: EVOSE_LIST_APPS_LOCAL_NAME,
      description: '[Evose Gateway] List Evose apps configured in Settings',
      schema: {
        type: z.enum(['agent', 'workflow']).optional().describe('Optional filter by app type'),
        include_disabled: z.boolean().optional().describe('Include disabled apps (default: false)'),
      },
      execute: async ({ args }) => {
        const { evose } = this.settingsService.getSettings()
        const includeDisabled = args.include_disabled === true

        const apps = evose.apps
          .filter((app) => includeDisabled || app.enabled)
          .filter((app) => !args.type || app.type === args.type)
          .map((app) => ({
            app_id: app.appId,
            name: app.name,
            type: app.type,
            enabled: app.enabled,
            description: app.description ?? '',
          }))

        return this.textResult(JSON.stringify({ total: apps.length, apps }, null, 2))
      },
    })
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private resolveEnabledApp(
    evose: EvoseSettings,
    appId: string,
    expectedType: EvoseAppConfig['type'],
  ): EvoseAppConfig {
    const trimmed = appId.trim()
    if (!trimmed) throw new Error('Missing required argument: app_id')

    const app = evose.apps.find((candidate) => candidate.appId === trimmed)
    if (!app) throw new Error(`Unknown app_id: "${trimmed}". Use evose_list_apps first.`)
    if (app.type !== expectedType) {
      throw new Error(`app_id "${trimmed}" is type "${app.type}", expected "${expectedType}"`)
    }
    if (!app.enabled) {
      throw new Error(`App "${app.name}" (${trimmed}) is disabled in Settings`)
    }
    return app
  }

}
