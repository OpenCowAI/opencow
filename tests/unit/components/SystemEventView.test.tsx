// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { SystemEventView } from '../../../src/renderer/components/DetailPanel/SessionPanel/SystemEventView'
import type { SystemEvent } from '../../../src/shared/types'

function renderEvent(event: SystemEvent) {
  return render(<ul><SystemEventView event={event} /></ul>)
}

describe('SystemEventView', () => {
  describe('task_started', () => {
    it('renders task description', () => {
      renderEvent({ type: 'task_started', taskId: 'task-1', description: 'Research SDK types' })
      expect(screen.getByText(/Task started/)).toBeInTheDocument()
      expect(screen.getByText(/Research SDK types/)).toBeInTheDocument()
    })
  })

  describe('task_notification', () => {
    it('renders completed status with summary', () => {
      renderEvent({
        type: 'task_notification',
        taskId: 'task-1',
        status: 'completed',
        summary: 'Found 3 files'
      })
      expect(screen.getByText(/completed/i)).toBeInTheDocument()
      expect(screen.getByText(/Found 3 files/)).toBeInTheDocument()
    })

    it('renders failed status', () => {
      renderEvent({
        type: 'task_notification',
        taskId: 'task-1',
        status: 'failed',
        summary: 'Timeout'
      })
      expect(screen.getByText(/failed/i)).toBeInTheDocument()
    })

    it('renders stopped status', () => {
      renderEvent({
        type: 'task_notification',
        taskId: 'task-1',
        status: 'stopped',
        summary: 'User cancelled'
      })
      expect(screen.getByText(/stopped/i)).toBeInTheDocument()
    })

    it('renders duration when usage provided', () => {
      renderEvent({
        type: 'task_notification',
        taskId: 'task-1',
        status: 'completed',
        summary: 'Done',
        usage: { totalTokens: 1200, toolUses: 5, durationMs: 42000 }
      })
      expect(screen.getByText(/42\.0s/)).toBeInTheDocument()
    })
  })

  describe('hook', () => {
    it('renders hook name when running', () => {
      renderEvent({
        type: 'hook',
        hookId: 'h-1',
        hookName: 'PreToolUse',
        hookTrigger: 'PreToolUse'
      })
      expect(screen.getByText(/Hook: PreToolUse/)).toBeInTheDocument()
    })

    it('renders outcome when complete', () => {
      renderEvent({
        type: 'hook',
        hookId: 'h-1',
        hookName: 'PostToolUse',
        hookTrigger: 'PostToolUse',
        outcome: 'success'
      })
      expect(screen.getByText(/success/)).toBeInTheDocument()
    })

    it('renders error outcome', () => {
      renderEvent({
        type: 'hook',
        hookId: 'h-1',
        hookName: 'PreToolUse',
        hookTrigger: 'PreToolUse',
        outcome: 'error',
        exitCode: 1
      })
      expect(screen.getByText(/error/)).toBeInTheDocument()
    })
  })

  describe('compact_boundary', () => {
    it('renders auto trigger with token count', () => {
      renderEvent({ type: 'compact_boundary', trigger: 'auto', preTokens: 127000 })
      expect(screen.getByText(/Context compressed/)).toBeInTheDocument()
      expect(screen.getByText(/auto/)).toBeInTheDocument()
      expect(screen.getByText(/127k/)).toBeInTheDocument()
    })

    it('renders manual trigger', () => {
      renderEvent({ type: 'compact_boundary', trigger: 'manual', preTokens: 50000 })
      expect(screen.getByText(/manual/)).toBeInTheDocument()
      expect(screen.getByText(/50k/)).toBeInTheDocument()
    })

    it('has accessible aria-label', () => {
      renderEvent({ type: 'compact_boundary', trigger: 'auto', preTokens: 127000 })
      expect(screen.getByLabelText(/Context compressed/)).toBeInTheDocument()
    })

    it('renders small token count without k suffix', () => {
      renderEvent({ type: 'compact_boundary', trigger: 'auto', preTokens: 500 })
      expect(screen.getByText(/500 tokens/)).toBeInTheDocument()
    })
  })
})
