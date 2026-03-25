// SPDX-License-Identifier: Apache-2.0

import Editor, { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import { useMonacoTheme } from '@/hooks/useMonacoTheme'
import { SHARED_MONACO_OPTIONS } from './monaco-config'

loader.config({ monaco })

interface CodeEditorProps {
  value: string
  language: string
  onChange: (value: string) => void
  label?: string
}

export function CodeEditor({
  value,
  language,
  onChange,
  label
}: CodeEditorProps): React.JSX.Element {
  const monacoTheme = useMonacoTheme()

  return (
    <div
      aria-label={label}
      className="code-editor-surface h-full rounded-xl border border-[hsl(var(--border)/0.4)] bg-[hsl(var(--foreground)/0.02)] overflow-hidden"
    >
      <Editor
        value={value}
        language={language}
        theme={monacoTheme}
        onChange={(v) => onChange(v ?? '')}
        options={SHARED_MONACO_OPTIONS}
      />
    </div>
  )
}
