// SPDX-License-Identifier: Apache-2.0

import Editor, { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import { useMonacoTheme } from '@/hooks/useMonacoTheme'
import { SHARED_MONACO_OPTIONS } from './monaco-config'

loader.config({ monaco })

interface CodeViewerProps {
  content: string
  language: string
}

export function CodeViewer({ content, language }: CodeViewerProps): React.JSX.Element {
  const monacoTheme = useMonacoTheme()

  return (
    <Editor
      value={content}
      language={language}
      theme={monacoTheme}
      options={{
        ...SHARED_MONACO_OPTIONS,
        readOnly: true,
        domReadOnly: true
      }}
    />
  )
}
