// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import { isAllowedCapabilityPath, validateCapabilityPath } from '../../../electron/security/pathValidator'

describe('pathValidator', () => {
  // ── Legacy Claude Code paths ────────────────────────────────────
  it('allows paths within ~/.claude/', () => {
    const p = path.join(os.homedir(), '.claude', 'commands', 'test.md')
    expect(() => validateCapabilityPath(p)).not.toThrow()
  })

  it('allows ~/.claude.json', () => {
    const p = path.join(os.homedir(), '.claude.json')
    expect(() => validateCapabilityPath(p)).not.toThrow()
  })

  it('allows project .claude/ paths', () => {
    const p = '/project/.claude/commands/test.md'
    expect(() => validateCapabilityPath(p, '/project')).not.toThrow()
  })

  it('allows project .mcp.json', () => {
    expect(() => validateCapabilityPath('/project/.mcp.json', '/project')).not.toThrow()
  })

  // ── Capability Center global store ────────────────────────────────
  it('allows paths within ~/.opencow/ (production)', () => {
    const p = path.join(os.homedir(), '.opencow', 'capabilities', 'skills', 'test', 'skill.md')
    expect(isAllowedCapabilityPath(p)).toBe(true)
  })

  it('allows paths within ~/.opencow-dev/ (development)', () => {
    const p = path.join(os.homedir(), '.opencow-dev', 'capabilities', 'skills', 'test', 'skill.md')
    expect(isAllowedCapabilityPath(p)).toBe(true)
  })

  // ── Capability Center project store ───────────────────────────────
  it('allows project-level .opencow/ paths', () => {
    const p = '/project/.opencow/skills/my-skill/skill.md'
    expect(isAllowedCapabilityPath(p, '/project')).toBe(true)
  })

  it('allows project-level .opencow-dev/ paths', () => {
    const p = '/project/.opencow-dev/skills/my-skill/skill.md'
    expect(isAllowedCapabilityPath(p, '/project')).toBe(true)
  })

  // ── Rejection cases ─────────────────────────────────────────────
  it('rejects paths outside allowed directories', () => {
    expect(() => validateCapabilityPath('/etc/passwd')).toThrow('Access denied')
  })

  it('rejects path traversal attempts', () => {
    const p = path.join(os.homedir(), '.claude', '..', '..', 'etc', 'passwd')
    expect(() => validateCapabilityPath(p)).toThrow('Access denied')
  })

  it('rejects /tmp paths', () => {
    const p = '/tmp/opencow-market-abc123/SKILL.md'
    expect(isAllowedCapabilityPath(p)).toBe(false)
  })

  // ── Boolean API ─────────────────────────────────────────────────
  it('isAllowedCapabilityPath returns boolean', () => {
    expect(isAllowedCapabilityPath(path.join(os.homedir(), '.claude', 'test.md'))).toBe(true)
    expect(isAllowedCapabilityPath('/etc/passwd')).toBe(false)
  })
})
