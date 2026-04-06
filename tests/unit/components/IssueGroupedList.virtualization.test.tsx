// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ALL_VIEW } from '../../../src/shared/types'
import { useAppStore } from '../../../src/renderer/stores/appStore'
import { IssueGroupedList } from '../../../src/renderer/components/IssuesView/IssueGroupedList'
import { makeIssueSummary, resetIssueStore, setAppStoreIssues } from '../../helpers'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { changeLanguage: async () => undefined },
  }),
}))

vi.mock('react-virtuoso', () => ({
  Virtuoso: ({
    className,
    components,
  }: {
    className?: string
    components?: {
      List?: React.ComponentType<React.ComponentPropsWithoutRef<'div'>>
    }
  }) => {
    const ListComp = components?.List
    return (
      <div data-testid="virtuoso-scroller" data-classname={className ?? ''}>
        {ListComp ? (
          <ListComp
            data-testid="virtuoso-list"
            style={{ paddingTop: '0px', paddingBottom: '72px' }}
          />
        ) : null}
      </div>
    )
  },
}))

vi.mock('../../../src/renderer/components/IssuesView/DraggableIssueRow', () => ({
  DraggableIssueRow: () => <div data-testid="issue-row" />,
}))

describe('IssueGroupedList virtualization layout', () => {
  beforeEach(() => {
    resetIssueStore()
    setAppStoreIssues([makeIssueSummary({ id: 'issue-1', title: 'Issue 1' })])

    useAppStore.setState({
      activeViewId: ALL_VIEW.id,
      selectedIssueId: null,
      projects: [],
      allViewDisplay: {
        groupBy: null,
        sort: { field: 'updatedAt', order: 'desc' },
      },
    })
  })

  it('keeps horizontal padding on Virtuoso List and vertical padding on the outer container', () => {
    render(<IssueGroupedList />)

    const scroller = screen.getByTestId('virtuoso-scroller')
    const wrapper = scroller.parentElement
    const list = screen.getByTestId('virtuoso-list')

    expect(wrapper).not.toBeNull()
    expect(wrapper).toHaveClass('py-1')
    expect(scroller).toHaveAttribute('data-classname', expect.not.stringContaining('px-'))
    expect(scroller).toHaveAttribute('data-classname', expect.not.stringContaining('py-1'))
    expect(list).toHaveStyle({ paddingLeft: '0.25rem', paddingRight: '0.25rem' })
    expect(list).toHaveStyle({ paddingTop: '0px', paddingBottom: '72px' })
  })
})
