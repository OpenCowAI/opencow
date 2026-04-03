// SPDX-License-Identifier: Apache-2.0

import { contextBridge, ipcRenderer } from 'electron'
import type { IPCChannels, IPCEventChannels } from '@shared/types'
import type { OpenCowAPI } from '@shared/ipc'
import { IPC_EVENT_CHANNEL, APP_WINDOW_KEY } from '@shared/appIdentity'

// Build invoke methods from channel names
const invokeChannels: (keyof IPCChannels)[] = [
  'get-initial-state',
  'install-hooks',
  'uninstall-hooks',
  'get-hooks-status',
  'pin-project',
  'unpin-project',
  'archive-project',
  'unarchive-project',
  'reorder-projects',
  'reorder-pinned-projects',
  'get-onboarding-state',
  'complete-onboarding',
  'check-prerequisites',
  'list-project-files',
  'search-project-files',
  'read-file-content',
  'read-image-preview',
  'view-tool-file-content',
  'save-file-content',
  'project-file:rename',
  'project-file:delete',
  'project-file:restore-delete',
  'project-file:create',
  'project-file:create-directory',
  'download-file',
  'list-claude-capabilities',
  'read-capability-source',
  'list-inbox-messages',
  'update-inbox-message',
  'get-inbox-stats',
  'dismiss-inbox-message',
  'mark-all-inbox-read',
  'list-issues',
  'count-issues',
  'get-issue',
  'create-issue',
  'update-issue',
  'delete-issue',
  'mark-issue-read',
  'mark-issue-unread',
  'list-child-issues',
  'list-custom-labels',
  'create-custom-label',
  'delete-custom-label',
  'update-custom-label',
  'get-context-candidates',
  // Issue Providers (GitHub/GitLab Integration)
  'issue-provider:list',
  'issue-provider:get',
  'issue-provider:create',
  'issue-provider:update',
  'issue-provider:delete',
  'issue-provider:test-connection',
  'issue-provider:sync-now',
  // Issue Views
  'list-issue-views',
  'create-issue-view',
  'update-issue-view',
  'delete-issue-view',
  'reorder-issue-views',
  // Settings
  'get-settings',
  'update-settings',
  // Update checker
  'check-for-updates',
  // Command Phase
  'command:start-session',
  'command:send-message',
  'command:answer-question',
  'command:stop-session',
  'command:resume-session',
  'command:list-managed-sessions',
  'command:get-managed-session',
  'command:get-session-messages',
  'command:delete-session',
  // Provider
  'provider:get-status',
  'provider:login',
  'provider:cancel-login',
  'provider:logout',
  'provider:get-credential',
  // Webhooks
  'webhook:test',
  // Messaging — unified IM
  'messaging:get-all-statuses',
  'messaging:start',
  'messaging:stop',
  'messaging:test',
  // Messaging — WeChat QR code login
  'messaging:weixin-start-qr-login',
  'messaging:weixin-cancel-qr-login',
  // App lifecycle
  'app:relaunch',
  'clipboard:write-text',
  // Project management
  'create-project',
  'create-new-project',
  'list-all-projects',
  'update-project',
  'rename-project',
  'delete-project',
  // Project discovery & import (onboarding)
  'discover-importable-projects',
  'import-discovered-projects',
  // Directory picker
  'select-directory',
  // Session Notes
  'list-session-notes',
  'count-session-notes-by-issue',
  'create-session-note',
  'update-session-note',
  'delete-session-note',
  // Artifacts
  'list-artifacts',
  'get-artifact-content',
  'update-artifact-meta',
  'list-starred-artifacts',
  'star-session-artifact',
  'star-project-file',
  // Logging
  'log:write',
  // Tray Popover
  'tray-popover:open-main',
  'tray-popover:navigate-issue',
  'tray-popover:quit',
  'tray-popover:resize',
  'tray-popover:get-issues',
  // Schedule CRUD
  'schedule:list',
  'schedule:get',
  'schedule:create',
  'schedule:update',
  'schedule:delete',
  // Schedule Control
  'schedule:pause',
  'schedule:resume',
  'schedule:trigger-now',
  // Schedule Executions
  'schedule:list-executions',
  // Schedule Preview
  'schedule:preview-next-runs',
  // Pipeline CRUD
  'pipeline:list',
  'pipeline:get',
  'pipeline:create',
  'pipeline:update',
  'pipeline:delete',
  // Evose
  'evose:fetch-apps',
  // Browser
  'browser:show',
  'browser:hide',
  'browser:create-profile',
  'browser:list-profiles',
  'browser:delete-profile',
  'browser:open-view',
  'browser:close-view',
  'browser:sync-bounds',
  'browser:execute',
  'browser:get-page-info',
  'browser:get-active-view',
  'browser:get-session-view',
  'browser:get-issue-view',
  'browser:get-focused-context',
  // Browser overlay lifecycle (new channels for BrowserSheet)
  'browser:ensure-source-view',
  'browser:display-source',
  'browser:detach-view',
  'browser:reattach-view',
  'browser:set-view-visible',
  // Capability Center
  'capability:snapshot',
  'capability:import:pick-files',
  'capability:import:discover',
  'capability:import:execute',
  'capability:clone:discover',
  'capability:clone:execute',
  'capability:save',
  'capability:save-form',
  'capability:delete',
  'capability:toggle',
  'capability:set-tags',
  'capability:test-mcp',
  'capability:publish',
  'capability:unpublish',
  'capability:sync',
  'capability:detect-drift',
  'capability:diagnostics',
  'capability:versions',
  'capability:version-detail',
  'capability:bundle-files',
  'capability:view-bundle-file-content',
  // Skills Marketplace
  'market:providers',
  'market:search',
  'market:browse',
  'market:detail',
  'market:install',
  'market:analyze',
  'market:start-analysis-session',
  'market:cancel-analyze',
  'market:resolve-install-path',
  'market:check-updates',
  // Package lifecycle
  'package:list',
  'package:uninstall',
  'package:verify',
  // Repository Sources
  'repo-source:list',
  'repo-source:create',
  'repo-source:update',
  'repo-source:delete',
  'repo-source:test-connection',
  'repo-source:sync',
  'repo-source:browse',
  // Git integration
  'git:get-status',
  'git:is-repo',
  'git:force-refresh',
  'git:file-diff',
  // Terminal
  'terminal:ensure',
  'terminal:spawn',
  'terminal:write',
  'terminal:resize',
  'terminal:kill',
  'terminal:kill-all',
  'terminal:get-info',
  'terminal:list',
  'terminal:replay',
  // Memory
  'memory:list',
  'memory:get',
  'memory:search',
  'memory:create',
  'memory:update',
  'memory:delete',
  'memory:archive',
  'memory:bulk-delete',
  'memory:bulk-archive',
  'memory:confirm',
  'memory:reject',
  'memory:edit-and-confirm',
  'memory:confirm-merge',
  'memory:reject-merge',
  'memory:stats',
  'memory:get-settings',
  'memory:update-settings',
  'memory:export',
]

const eventChannels: (keyof IPCEventChannels)[] = [
  IPC_EVENT_CHANNEL,
  'tray-popover:will-hide',
]

const api = {} as Record<string, unknown>

// Register invoke methods
for (const channel of invokeChannels) {
  api[channel] = (...args: unknown[]) => ipcRenderer.invoke(channel, ...args)
}

// Register event listeners with `on:` prefix
for (const channel of eventChannels) {
  const key = `on:${channel}`
  api[key] = (callback: (data: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown): void => {
      callback(data)
    }
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  }
}

// Dynamic per-terminal output listener (channel = `terminal:output:${id}`)
api['terminal:onOutput'] = (terminalId: string, callback: (data: string) => void) => {
  const channel = `terminal:output:${terminalId}`
  const handler = (_event: Electron.IpcRendererEvent, data: string): void => {
    callback(data)
  }
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

contextBridge.exposeInMainWorld(APP_WINDOW_KEY, api as unknown as OpenCowAPI)
