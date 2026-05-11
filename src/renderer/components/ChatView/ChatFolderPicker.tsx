// SPDX-License-Identifier: Apache-2.0

import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Folder, FolderPlus, Check } from 'lucide-react'
import { PillDropdown } from '@/components/ui/PillDropdown'
import { getAppAPI } from '@/windowAPI'
import { cn } from '@/lib/utils'

/**
 * ChatFolderPicker — Compact pill below the chat hero input that lets
 * the user retarget the working directory of the *next* new session.
 *
 * Lives only in the sidebar Chat panel (not project-detail chat) and
 * has no effect on existing sessions — workspace is bound at session
 * start.  Default is `$HOME`; `value` is the user-picked custom path
 * (string) or `null` to mean "use default".
 *
 * Returning a `null` from `onChange` resets to the home directory.
 */

interface ChatFolderPickerProps {
  /** Resolved $HOME — used both as the default label and as a sentinel. */
  homeDir: string
  /** Current user-picked custom path (null = use default $HOME). */
  value: string | null
  /** Notify the parent when the user picks a different folder, or null to reset. */
  onChange: (path: string | null) => void
}

function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  const idx = trimmed.lastIndexOf('/')
  return idx === -1 ? trimmed : trimmed.slice(idx + 1) || trimmed
}

function tildify(path: string, homeDir: string): string {
  if (path === homeDir) return '~'
  if (path.startsWith(homeDir + '/')) return '~' + path.slice(homeDir.length)
  return path
}

export function ChatFolderPicker({
  homeDir,
  value,
  onChange,
}: ChatFolderPickerProps): React.JSX.Element {
  const { t } = useTranslation('sessions')
  const [open, setOpen] = useState(false)
  const [browsing, setBrowsing] = useState(false)

  const currentPath = value ?? homeDir
  const isAtHome = currentPath === homeDir
  const pillLabel = isAtHome ? t('chatFolder.home') : basename(currentPath)

  const handleBrowse = useCallback(async () => {
    if (browsing) return
    setBrowsing(true)
    try {
      const picked = await getAppAPI()['select-directory']()
      if (picked) {
        // Normalize: picking $HOME via the dialog should behave the
        // same as the default state (null = home).
        onChange(picked === homeDir ? null : picked)
        setOpen(false)
      }
    } finally {
      setBrowsing(false)
    }
  }, [browsing, homeDir, onChange])

  return (
    <PillDropdown
      open={open}
      onOpenChange={setOpen}
      position="below"
      align="left"
      trigger={
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t('chatFolder.triggerAria')}
          title={currentPath}
          className={cn(
            // Inline / borderless — visually attached to the chat input
            // card sitting above it.  Only a soft hover wash separates it
            // from the surrounding surface.
            'inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs',
            'text-[hsl(var(--muted-foreground))]',
            'hover:bg-[hsl(var(--foreground)/0.04)] hover:text-[hsl(var(--foreground))]',
            'transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
            open && 'bg-[hsl(var(--foreground)/0.04)] text-[hsl(var(--foreground))]',
          )}
        >
          <Folder className="w-3.5 h-3.5" aria-hidden="true" />
          <span className="font-medium text-[hsl(var(--foreground))] truncate max-w-[200px]">{pillLabel}</span>
          <ChevronDown
            className={cn(
              'w-3 h-3 transition-transform',
              open && 'rotate-180',
            )}
            aria-hidden="true"
          />
        </button>
      }
      dropdownClassName="w-[280px] rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--popover))] text-[hsl(var(--popover-foreground))] shadow-lg overflow-hidden"
    >
      <div className="py-1" role="menu">
        {/* Current selection — shows the chosen folder (or $HOME default) */}
        <div
          role="menuitemradio"
          aria-checked="true"
          className="w-full flex items-start gap-2.5 px-3 py-2 text-left"
        >
          <Folder className="w-4 h-4 mt-0.5 shrink-0 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-[hsl(var(--foreground))] truncate">{pillLabel}</div>
            <div className="text-xs text-[hsl(var(--muted-foreground))] truncate">{tildify(currentPath, homeDir)}</div>
          </div>
          <Check className="w-4 h-4 mt-0.5 shrink-0 text-[hsl(var(--primary))]" aria-hidden="true" />
        </div>

        {/* Quick reset back to $HOME — only when currently on a custom folder */}
        {!isAtHome && (
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onChange(null)
              setOpen(false)
            }}
            className={cn(
              'w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm',
              'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]',
              'hover:bg-[hsl(var(--foreground)/0.04)] transition-colors',
            )}
          >
            <Folder className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span className="flex-1 truncate">{t('chatFolder.useHome')}</span>
          </button>
        )}

        {/* Separator */}
        <div className="my-1 mx-3 h-px bg-[hsl(var(--border)/0.6)]" />

        {/* Native folder picker — always available.  `browsing` guards
            against double-firing the IPC dialog but is intentionally
            not surfaced as a spinner: the OS dialog is the only
            visible affordance the user needs while it's open. */}
        <button
          type="button"
          role="menuitem"
          onClick={handleBrowse}
          disabled={browsing}
          className={cn(
            'w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm',
            'text-[hsl(var(--foreground))]',
            'hover:bg-[hsl(var(--foreground)/0.04)] transition-colors',
            'disabled:cursor-not-allowed',
          )}
        >
          <FolderPlus className="w-4 h-4 shrink-0 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
          <span className="flex-1 truncate">{t('chatFolder.chooseDifferent')}</span>
        </button>
      </div>
    </PillDropdown>
  )
}
