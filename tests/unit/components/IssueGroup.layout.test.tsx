// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { IssueGroup } from '../../../src/renderer/components/IssuesView/IssueGroup'

describe('IssueGroup layout parity', () => {
  it('applies the same hover corner radius as issue rows', () => {
    render(
      <IssueGroup label="In Progress" count={2}>
        <div>child content</div>
      </IssueGroup>
    )

    const header = screen.getByRole('button')
    expect(header).toHaveClass('rounded-lg')
  })
})
