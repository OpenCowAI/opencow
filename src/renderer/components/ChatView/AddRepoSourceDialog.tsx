// SPDX-License-Identifier: Apache-2.0

/**
 * AddRepoSourceDialog — modal form for creating or editing a repo source.
 *
 * Features:
 *   - URL input with auto-platform detection (GitHub/GitLab)
 *   - Name auto-fill from URL (overrideable)
 *   - PAT auth toggle with secure token input
 *   - Branch override (collapsible advanced section)
 *   - "Test Connection" button with inline status
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { GitBranch, CheckCircle2, XCircle, Loader2, Eye, EyeOff, ChevronDown, ChevronRight } from 'lucide-react'
import { Dialog } from '@/components/ui/Dialog'
import { cn } from '@/lib/utils'
import type { RepoSource, RepoSourceInput, RepoSourceUpdateInput, RepoSourcePlatform } from '@shared/types'

// ─── URL parsing (lightweight client-side) ──────────────────

function detectPlatform(url: string): RepoSourcePlatform | null {
  const lower = url.toLowerCase()
  if (lower.includes('github.com') || (!lower.includes('://') && !lower.includes('gitlab'))) return 'github'
  if (lower.includes('gitlab')) return 'gitlab'
  return null
}

function extractNameFromUrl(url: string): string {
  try {
    const trimmed = url.trim().replace(/\.git$/, '')
    if (trimmed.includes('://')) {
      const parts = new URL(trimmed).pathname.replace(/^\/|\/$/g, '').split('/')
      return parts.length >= 2 ? `${parts[parts.length - 2]}/${parts[parts.length - 1]}` : ''
    }
    // Shorthand: owner/repo
    return trimmed
  } catch {
    return ''
  }
}

// ─── Types ──────────────────────────────────────────────────

interface AddRepoSourceDialogProps {
  open: boolean
  onClose: () => void
  onSubmit: (input: RepoSourceInput) => Promise<void>
  onTestConnection?: (id: string) => Promise<{ ok: boolean; error?: string }>
  /** Pass an existing source to enable edit mode. */
  editSource?: RepoSource
}

// ─── Component ──────────────────────────────────────────────

export function AddRepoSourceDialog({
  open,
  onClose,
  onSubmit,
  editSource,
}: AddRepoSourceDialogProps) {
  const { t } = useTranslation('sessions')
  const isEdit = !!editSource

  // ── Form state ────────────────────────────────────────────
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [platform, setPlatform] = useState<RepoSourcePlatform>('github')
  const [authMethod, setAuthMethod] = useState<'none' | 'pat'>('none')
  const [token, setToken] = useState('')
  const [branch, setBranch] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showToken, setShowToken] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ── Initialise from edit source ───────────────────────────
  useEffect(() => {
    if (open && editSource) {
      setUrl(editSource.url)
      setName(editSource.name)
      setPlatform(editSource.platform)
      setAuthMethod(editSource.hasCredential ? 'pat' : 'none')
      setBranch(editSource.branch ?? '')
      setToken('')
      setShowAdvanced(!!editSource.branch)
    } else if (open) {
      setUrl('')
      setName('')
      setPlatform('github')
      setAuthMethod('none')
      setToken('')
      setBranch('')
      setShowAdvanced(false)
    }
    setError(null)
    setSubmitting(false)
  }, [open, editSource])

  // ── Auto-detect platform + name from URL ──────────────────
  useEffect(() => {
    if (isEdit) return
    const detected = detectPlatform(url)
    if (detected) setPlatform(detected)
    const extracted = extractNameFromUrl(url)
    if (extracted && !name) setName(extracted)
  }, [url, isEdit, name])

  // ── Submit handler ────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (!url.trim()) {
      setError(t('repoSource.errorUrlRequired', 'Repository URL is required'))
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      const input: RepoSourceInput = {
        name: name.trim() || extractNameFromUrl(url),
        url: url.trim(),
        platform,
        branch: branch.trim() || undefined,
        auth: authMethod === 'pat' && token
          ? { method: 'pat', token }
          : { method: 'none' },
      }
      await onSubmit(input)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSubmitting(false)
    }
  }, [url, name, platform, authMethod, token, branch, onSubmit, onClose, t])

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isEdit
        ? t('repoSource.editTitle', 'Edit Repository Source')
        : t('repoSource.addTitle', 'Add Repository Source')
      }
      size="lg"
    >
      <div className="flex flex-col">
        {/* ── Header ─────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[hsl(var(--border)/0.4)]">
          <h2 className="text-[15px] font-semibold text-[hsl(var(--foreground))]">
            {isEdit
              ? t('repoSource.editTitle', 'Edit Repository Source')
              : t('repoSource.addTitle', 'Add Repository Source')
            }
          </h2>
        </div>

        <div className="flex flex-col gap-4 px-6 py-4">
        {/* ── URL ──────────────────────────────────── */}
        <div>
          <label className="block text-xs font-medium text-[hsl(var(--muted-foreground))] mb-1.5">
            {t('repoSource.url', 'Repository URL')}
          </label>
          <div className="relative">
            <input
              type="text"
              value={url}
              onChange={(e) => { setUrl(e.target.value); if (error) setError(null) }}
              placeholder="https://github.com/owner/repo"
              disabled={isEdit}
              className={cn(
                'w-full px-3 py-2 rounded-md text-sm outline-none transition-colors',
                'bg-[hsl(var(--background))] border border-[hsl(var(--border))]',
                'focus:border-[hsl(var(--ring))] focus:ring-1 focus:ring-[hsl(var(--ring))]',
                'placeholder:text-[hsl(var(--muted-foreground)/0.5)]',
                isEdit && 'opacity-60 cursor-not-allowed'
              )}
            />
            {url.trim() && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded text-[10px] font-medium bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]">
                {platform === 'github' ? 'GitHub' : 'GitLab'}
              </span>
            )}
          </div>
        </div>

        {/* ── Name ─────────────────────────────────── */}
        <div>
          <label className="block text-xs font-medium text-[hsl(var(--muted-foreground))] mb-1.5">
            {t('repoSource.name', 'Display Name')}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={extractNameFromUrl(url) || 'my-skills'}
            className={cn(
              'w-full px-3 py-2 rounded-md text-sm outline-none transition-colors',
              'bg-[hsl(var(--background))] border border-[hsl(var(--border))]',
              'focus:border-[hsl(var(--ring))] focus:ring-1 focus:ring-[hsl(var(--ring))]',
              'placeholder:text-[hsl(var(--muted-foreground)/0.5)]',
            )}
          />
        </div>

        {/* ── Authentication ───────────────────────── */}
        <div>
          <label className="block text-xs font-medium text-[hsl(var(--muted-foreground))] mb-1.5">
            {t('repoSource.auth', 'Authentication')}
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setAuthMethod('none')}
              className={cn(
                'px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                authMethod === 'none'
                  ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]'
                  : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted)/0.8)]'
              )}
            >
              {t('repoSource.authNone', 'Public')}
            </button>
            <button
              type="button"
              onClick={() => setAuthMethod('pat')}
              className={cn(
                'px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                authMethod === 'pat'
                  ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]'
                  : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted)/0.8)]'
              )}
            >
              PAT Token
            </button>
          </div>

          {authMethod === 'pat' && (
            <div className="mt-2 relative">
              <input
                type={showToken ? 'text' : 'password'}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={isEdit && editSource?.hasCredential ? '••••••••' : 'ghp_xxxx / glpat-xxxx'}
                className={cn(
                  'w-full px-3 py-2 pr-10 rounded-md text-sm font-mono outline-none transition-colors',
                  'bg-[hsl(var(--background))] border border-[hsl(var(--border))]',
                  'focus:border-[hsl(var(--ring))] focus:ring-1 focus:ring-[hsl(var(--ring))]',
                  'placeholder:text-[hsl(var(--muted-foreground)/0.5)]',
                )}
              />
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
              >
                {showToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          )}
        </div>

        {/* ── Advanced (collapsible) ───────────────── */}
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-1 text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
        >
          {showAdvanced ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {t('repoSource.advanced', 'Advanced')}
        </button>

        {showAdvanced && (
          <div>
            <label className="block text-xs font-medium text-[hsl(var(--muted-foreground))] mb-1.5">
              {t('repoSource.branch', 'Branch')}
            </label>
            <input
              type="text"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="main"
              className={cn(
                'w-full px-3 py-2 rounded-md text-sm outline-none transition-colors',
                'bg-[hsl(var(--background))] border border-[hsl(var(--border))]',
                'focus:border-[hsl(var(--ring))] focus:ring-1 focus:ring-[hsl(var(--ring))]',
                'placeholder:text-[hsl(var(--muted-foreground)/0.5)]',
              )}
            />
          </div>
        )}

        {/* ── Error ────────────────────────────────── */}
        {error && (
          <div className="flex items-center gap-2 text-xs text-[hsl(var(--destructive))]">
            <XCircle className="h-3.5 w-3.5 shrink-0" />
            {error}
          </div>
        )}

        {/* ── Actions ──────────────────────────────── */}
        <div className="flex justify-end gap-2 pt-2 border-t border-[hsl(var(--border)/0.4)]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-md text-xs font-medium text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] transition-colors"
          >
            {t('common:cancel')}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !url.trim()}
            className={cn(
              'px-4 py-1.5 rounded-md text-xs font-medium transition-colors',
              'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]',
              'hover:bg-[hsl(var(--primary)/0.9)]',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {submitting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              isEdit ? t('common.save', 'Save') : t('repoSource.add', 'Add')
            )}
          </button>
        </div>
        </div>
      </div>
    </Dialog>
  )
}
