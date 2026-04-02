// SPDX-License-Identifier: Apache-2.0

import { createContext, useContext, useState, useCallback, useMemo } from 'react'

/**
 * A file or directory selected as conversation context for an Issue session.
 */
export interface ContextFile {
  /** Relative path within the project (e.g. "src/components/App.tsx") */
  path: string
  /** Display name (basename) */
  name: string
  /** Whether this is a directory (true) or file (false) */
  isDirectory: boolean
}

interface ContextFilesContextValue {
  files: ContextFile[]
  addFile: (file: ContextFile) => void
  addFiles: (files: ContextFile[]) => void
  acknowledgeFiles: (paths: string[]) => void
  removeFile: (path: string) => void
  clear: () => void
}

const ContextFilesContext = createContext<ContextFilesContextValue>({
  files: [],
  addFile: () => {},
  addFiles: () => {},
  acknowledgeFiles: () => {},
  removeFile: () => {},
  clear: () => {},
})

export function ContextFilesProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [files, setFiles] = useState<ContextFile[]>([])

  const addFile = useCallback((file: ContextFile) => {
    setFiles((prev) => (prev.some((f) => f.path === file.path) ? prev : [...prev, file]))
  }, [])

  const addFiles = useCallback((newFiles: ContextFile[]) => {
    setFiles((prev) => {
      const existing = new Set(prev.map((f) => f.path))
      const toAdd = newFiles.filter((f) => !existing.has(f.path))
      return toAdd.length > 0 ? [...prev, ...toAdd] : prev
    })
  }, [])

  /**
   * Acknowledge files that have been consumed by an editor insertion pipeline.
   * Unacknowledged files remain queued to avoid data loss when editor is not ready.
   */
  const acknowledgeFiles = useCallback((paths: string[]) => {
    if (paths.length === 0) return
    setFiles((prev) => {
      const consumed = new Set(paths)
      const next = prev.filter((f) => !consumed.has(f.path))
      return next.length === prev.length ? prev : next
    })
  }, [])

  const removeFile = useCallback((path: string) => {
    setFiles((prev) => prev.filter((f) => f.path !== path))
  }, [])

  const clear = useCallback(() => setFiles([]), [])

  const value = useMemo(
    () => ({ files, addFile, addFiles, acknowledgeFiles, removeFile, clear }),
    [files, addFile, addFiles, acknowledgeFiles, removeFile, clear],
  )

  return <ContextFilesContext.Provider value={value}>{children}</ContextFilesContext.Provider>
}

export function useContextFiles(): ContextFilesContextValue {
  return useContext(ContextFilesContext)
}
