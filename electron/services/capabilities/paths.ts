// SPDX-License-Identifier: Apache-2.0

import path from 'node:path'
import os from 'node:os'

export interface ClaudeCodePaths {
  home: string
  claudeDir: string
  globalCommands: string
  globalSkills: string
  globalAgents: string
  globalRules: string
  globalSettings: string
  globalSettingsLocal: string
  claudeJson: string
  pluginCache: string
  marketplaces: string
  installedPlugins: string
  blocklist: string
  project?: {
    root: string
    claudeDir: string
    commands: string
    skills: string
    agents: string
    rules: string
    settings: string
    settingsLocal: string
    mcpJson: string
    claudeMd: string
  }
}

export function resolveClaudeCodePaths(projectPath?: string): ClaudeCodePaths {
  const home = os.homedir()
  const claudeDir = path.join(home, '.claude')
  return {
    home,
    claudeDir,
    globalCommands: path.join(claudeDir, 'commands'),
    globalSkills: path.join(claudeDir, 'skills'),
    globalAgents: path.join(claudeDir, 'agents'),
    globalRules: path.join(claudeDir, 'rules'),
    globalSettings: path.join(claudeDir, 'settings.json'),
    globalSettingsLocal: path.join(claudeDir, 'settings.local.json'),
    claudeJson: path.join(home, '.claude.json'),
    pluginCache: path.join(claudeDir, 'plugins', 'cache'),
    marketplaces: path.join(claudeDir, 'plugins', 'marketplaces'),
    installedPlugins: path.join(claudeDir, 'plugins', 'installed_plugins.json'),
    blocklist: path.join(claudeDir, 'plugins', 'blocklist.json'),
    project: projectPath
      ? {
          root: projectPath,
          claudeDir: path.join(projectPath, '.claude'),
          commands: path.join(projectPath, '.claude', 'commands'),
          skills: path.join(projectPath, '.claude', 'skills'),
          agents: path.join(projectPath, '.claude', 'agents'),
          rules: path.join(projectPath, '.claude', 'rules'),
          settings: path.join(projectPath, '.claude', 'settings.json'),
          settingsLocal: path.join(projectPath, '.claude', 'settings.local.json'),
          mcpJson: path.join(projectPath, '.mcp.json'),
          claudeMd: path.join(projectPath, 'CLAUDE.md'),
        }
      : undefined,
  }
}
