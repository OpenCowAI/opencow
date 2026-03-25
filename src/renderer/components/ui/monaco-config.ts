// SPDX-License-Identifier: Apache-2.0

import type { editor } from 'monaco-editor'

/** Shared Monaco editor options for visual consistency across CodeViewer and CodeEditor. */
export const SHARED_MONACO_OPTIONS: editor.IStandaloneEditorConstructionOptions = {
  fontSize: 13,
  lineHeight: 20,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  wordWrap: 'on',
  tabSize: 2,
  renderWhitespace: 'selection',
  bracketPairColorization: { enabled: true },
  automaticLayout: true,
  padding: { top: 8 },
  lineNumbers: 'on',
  folding: true,
  contextmenu: false,
  overviewRulerLanes: 0,
  overviewRulerBorder: false,
  hideCursorInOverviewRuler: true,
  scrollbar: {
    verticalScrollbarSize: 8,
    horizontalScrollbarSize: 8
  }
}
