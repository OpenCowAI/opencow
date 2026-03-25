// SPDX-License-Identifier: Apache-2.0

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { createLogger } from '@/lib/logger'

const log = createLogger('ErrorBoundary')

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    log.error('Render error', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100vh',
            padding: '2rem',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            color: '#333'
          }}
        >
          <h1 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.75rem' }}>
            Something went wrong
          </h1>
          <pre
            style={{
              maxWidth: '80%',
              padding: '1rem',
              borderRadius: '0.5rem',
              backgroundColor: '#fef2f2',
              color: '#991b1b',
              fontSize: '0.8rem',
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word'
            }}
          >
            {this.state.error.message}
            {'\n\n'}
            {this.state.error.stack}
          </pre>
          <button
            onClick={() => this.setState({ error: null })}
            style={{
              marginTop: '1rem',
              padding: '0.5rem 1.5rem',
              borderRadius: '0.375rem',
              border: '1px solid #d1d5db',
              backgroundColor: '#fff',
              cursor: 'pointer',
              fontSize: '0.875rem'
            }}
          >
            Retry
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
