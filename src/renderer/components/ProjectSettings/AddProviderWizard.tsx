// SPDX-License-Identifier: Apache-2.0

import { useState, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, XCircle, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Dialog } from '@/components/ui/Dialog'
import { IssueProviderIcon } from './IssueProviderIcons'
import { resolveModalExitDurationMs } from '@/hooks/useModalAnimation'
import { useIssueProviderStore } from '@/stores/issueProviderStore'
import type { IssueProviderPlatform, IssueProviderTestResult } from '@shared/types'

interface AddProviderWizardProps {
  projectId: string
  onClose: () => void
  onCreated: () => void
}

type WizardStep = 'platform' | 'credentials' | 'verify'

/**
 * Parse a GitHub/GitLab URL into owner and repo name.
 * Supports formats like:
 *   https://github.com/owner/repo
 *   https://gitlab.com/owner/repo
 *   github.com/owner/repo
 */
function parseRepoUrl(url: string): { owner: string; name: string } | null {
  const trimmed = url.trim()
  if (!trimmed) return null

  try {
    // Normalize: add protocol if missing
    const normalized = trimmed.startsWith('http') ? trimmed : `https://${trimmed}`
    const parsed = new URL(normalized)
    // Remove leading slash and trailing .git
    const path = parsed.pathname.replace(/^\//, '').replace(/\.git$/, '')
    const parts = path.split('/').filter(Boolean)
    if (parts.length >= 2) {
      return { owner: parts[0], name: parts[1] }
    }
  } catch {
    // Not a valid URL — ignore
  }
  return null
}

export function AddProviderWizard({ projectId, onClose, onCreated }: AddProviderWizardProps): React.JSX.Element {
  const { t } = useTranslation('projectSettings')
  const { createProvider, deleteProvider, testConnection } = useIssueProviderStore()

  // Two-phase close: set open→false to trigger Dialog exit animation, then call real onClose
  const [open, setOpen] = useState(true)
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose }, [onClose])
  const requestClose = useCallback(() => {
    setOpen(false)
    setTimeout(() => onCloseRef.current(), resolveModalExitDurationMs())
  }, [])

  const [step, setStep] = useState<WizardStep>('platform')
  const [platform, setPlatform] = useState<IssueProviderPlatform | null>(null)
  const [owner, setOwner] = useState('')
  const [name, setName] = useState('')
  const [token, setToken] = useState('')
  const [apiBaseUrl, setApiBaseUrl] = useState('')
  // Linear-specific fields
  const [linearTeamId, setLinearTeamId] = useState('')
  const [linearTeamKey, setLinearTeamKey] = useState('')
  const [testResult, setTestResult] = useState<IssueProviderTestResult | null>(null)
  const [creating, setCreating] = useState(false)
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clean up the success timer on unmount to prevent state updates on unmounted component
  useEffect(() => {
    return () => {
      if (successTimerRef.current) clearTimeout(successTimerRef.current)
    }
  }, [])

  const handlePlatformSelect = useCallback((p: IssueProviderPlatform) => {
    setPlatform(p)
    setStep('credentials')
  }, [])

  const handleUrlPaste = useCallback((url: string) => {
    const parsed = parseRepoUrl(url)
    if (parsed) {
      setOwner(parsed.owner)
      setName(parsed.name)
    }
  }, [])

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const linearTeamIdTrimmed = linearTeamId.trim()
  const isValidTeamId = UUID_RE.test(linearTeamIdTrimmed)

  const canProceedToVerify = platform === 'linear'
    ? isValidTeamId && linearTeamKey.trim() !== '' && token.trim() !== ''
    : owner.trim() !== '' && name.trim() !== '' && token.trim() !== ''

  const handleConnect = useCallback(async () => {
    if (!platform || !canProceedToVerify) return
    setCreating(true)
    setTestResult(null)
    setStep('verify')

    // Local variable to track created provider — avoids stale closure with React state.
    let newProviderId: string | null = null

    try {
      const isLinear = platform === 'linear'
      const provider = await createProvider({
        projectId,
        platform,
        // Linear uses workspace slug / team key for display; GitHub/GitLab use owner/repo
        repoOwner: isLinear ? linearTeamKey.trim() : owner.trim(),
        repoName: isLinear ? linearTeamKey.trim() : name.trim(),
        authToken: token.trim(),
        apiBaseUrl: isLinear ? null : (apiBaseUrl.trim() || null),
        ...(isLinear ? {
          metadata: JSON.stringify({
            teamId: linearTeamId.trim(),
            teamKey: linearTeamKey.trim(),
            tokenType: 'apiKey',
          }),
        } : {}),
      })
      newProviderId = provider.id

      const result = await testConnection(provider.id)
      setTestResult(result)

      if (result.ok) {
        // Short delay so user sees the success state (cleared on unmount)
        successTimerRef.current = setTimeout(() => {
          successTimerRef.current = null
          onCreated()
        }, 800)
      } else {
        // Connection failed — roll back the provider record so user can retry cleanly.
        // This prevents orphaned records with bad credentials from polluting the DB.
        await deleteProvider(provider.id)
        newProviderId = null
      }
    } catch (err) {
      // On exception, also clean up any created provider
      if (newProviderId) {
        await deleteProvider(newProviderId).catch(() => { /* best-effort */ })
      }
      setTestResult({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' })
    } finally {
      setCreating(false)
    }
  }, [platform, canProceedToVerify, createProvider, deleteProvider, projectId, owner, name, token, apiBaseUrl, linearTeamId, linearTeamKey, testConnection, onCreated])

  const handleBack = useCallback(() => {
    if (step === 'credentials') {
      setStep('platform')
    } else if (step === 'verify') {
      setStep('credentials')
      setTestResult(null)
    }
  }, [step])

  const handleRetry = useCallback(() => {
    setStep('credentials')
    setTestResult(null)
  }, [])

  return (
    <Dialog open={open} onClose={requestClose} title={t('addProvider.title')} size="lg" preventOverlayClose>
      <div className="flex flex-col min-h-[380px]">
        {/* Close button */}
        <button
          onClick={requestClose}
          className="absolute top-4 right-4 p-1 rounded-md text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.06)] transition-colors z-10"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 px-6 pt-5 pb-4">
          {(['platform', 'credentials', 'verify'] as const).map((s, i) => {
            const labels = [
              t('addProvider.stepPlatform'),
              t('addProvider.stepCredentials'),
              t('addProvider.stepVerify'),
            ]
            const isActive = s === step
            const isPast =
              (s === 'platform' && (step === 'credentials' || step === 'verify')) ||
              (s === 'credentials' && step === 'verify')

            return (
              <div key={s} className="flex items-center gap-2">
                {i > 0 && (
                  <div
                    className={cn(
                      'h-px w-6',
                      isPast || isActive ? 'bg-[hsl(var(--primary))]' : 'bg-[hsl(var(--border))]',
                    )}
                  />
                )}
                <span
                  className={cn(
                    'text-xs font-medium px-2 py-0.5 rounded-full transition-colors',
                    isActive && 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]',
                    isPast && 'text-[hsl(var(--primary))]',
                    !isActive && !isPast && 'text-[hsl(var(--muted-foreground))]',
                  )}
                >
                  {labels[i]}
                </span>
              </div>
            )
          })}
        </div>

        <div className="flex-1 px-6 pb-2">
          {/* Step 1: Platform Selection */}
          {step === 'platform' && (
            <div className="grid grid-cols-3 gap-4 pt-4">
              <button
                onClick={() => handlePlatformSelect('github')}
                className={cn(
                  'flex flex-col items-center gap-3 p-6 rounded-xl border-2 transition-all',
                  'hover:border-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/0.04)]',
                  platform === 'github'
                    ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.04)]'
                    : 'border-[hsl(var(--border))]',
                )}
              >
                <span className="inline-flex items-center justify-center h-10 w-10 rounded-lg bg-gray-900 text-white dark:bg-gray-200 dark:text-gray-900">
                  <IssueProviderIcon platform="github" className="w-5 h-5" />
                </span>
                <div className="text-center">
                  <p className="text-sm font-medium">{t('addProvider.platform.github')}</p>
                  <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
                    {t('addProvider.platform.githubDesc')}
                  </p>
                </div>
              </button>

              <button
                onClick={() => handlePlatformSelect('gitlab')}
                className={cn(
                  'flex flex-col items-center gap-3 p-6 rounded-xl border-2 transition-all',
                  'hover:border-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/0.04)]',
                  platform === 'gitlab'
                    ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.04)]'
                    : 'border-[hsl(var(--border))]',
                )}
              >
                <span className="inline-flex items-center justify-center h-10 w-10 rounded-lg bg-white dark:bg-gray-800 border border-[hsl(var(--border))]">
                  <IssueProviderIcon platform="gitlab" className="w-5 h-5" />
                </span>
                <div className="text-center">
                  <p className="text-sm font-medium">{t('addProvider.platform.gitlab')}</p>
                  <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
                    {t('addProvider.platform.gitlabDesc')}
                  </p>
                </div>
              </button>

              <button
                onClick={() => handlePlatformSelect('linear')}
                className={cn(
                  'flex flex-col items-center gap-3 p-6 rounded-xl border-2 transition-all',
                  'hover:border-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/0.04)]',
                  platform === 'linear'
                    ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.04)]'
                    : 'border-[hsl(var(--border))]',
                )}
              >
                <span className="inline-flex items-center justify-center h-10 w-10 rounded-lg bg-indigo-600 text-white">
                  <IssueProviderIcon platform="linear" className="w-5 h-5" />
                </span>
                <div className="text-center">
                  <p className="text-sm font-medium">{t('addProvider.platform.linear')}</p>
                  <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
                    {t('addProvider.platform.linearDesc')}
                  </p>
                </div>
              </button>
            </div>
          )}

          {/* Step 2: Repository & Token (or Linear Team & Token) */}
          {step === 'credentials' && (
            <div className="space-y-4 pt-2">
              {platform === 'linear' ? (
                /* ── Linear-specific fields ─────────────────────────── */
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium mb-1.5">
                        {t('addProvider.linear.teamKey')}
                      </label>
                      <input
                        type="text"
                        value={linearTeamKey}
                        onChange={(e) => setLinearTeamKey(e.target.value)}
                        placeholder={t('addProvider.linear.teamKeyPlaceholder')}
                        className="w-full px-3 py-2 text-sm rounded-lg border border-[hsl(var(--border))] bg-transparent outline-none focus:border-[hsl(var(--primary))] transition-colors font-mono"
                      />
                      <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
                        {t('addProvider.linear.teamKeyHint')}
                      </p>
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1.5">
                        {t('addProvider.linear.teamId')}
                      </label>
                      <input
                        type="text"
                        value={linearTeamId}
                        onChange={(e) => setLinearTeamId(e.target.value)}
                        placeholder={t('addProvider.linear.teamIdPlaceholder')}
                        className={cn(
                          'w-full px-3 py-2 text-sm rounded-lg border bg-transparent outline-none transition-colors font-mono',
                          linearTeamIdTrimmed && !isValidTeamId
                            ? 'border-red-500 focus:border-red-500'
                            : 'border-[hsl(var(--border))] focus:border-[hsl(var(--primary))]',
                        )}
                      />
                      {linearTeamIdTrimmed && !isValidTeamId ? (
                        <p className="text-xs text-red-500 mt-1">
                          {t('addProvider.linear.teamIdInvalid')}
                        </p>
                      ) : (
                        <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
                          {t('addProvider.linear.teamIdHint')}
                        </p>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium mb-1.5">
                      {t('addProvider.linear.tokenLabel')}
                    </label>
                    <input
                      type="password"
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      placeholder={t('addProvider.linear.tokenPlaceholder')}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-[hsl(var(--border))] bg-transparent outline-none focus:border-[hsl(var(--primary))] transition-colors font-mono"
                    />
                    <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
                      {t('addProvider.linear.tokenHint')}
                    </p>
                  </div>
                </>
              ) : (
                /* ── GitHub / GitLab fields ─────────────────────────── */
                <>
                  {/* URL parser */}
                  <div>
                    <label className="block text-xs text-[hsl(var(--muted-foreground))] mb-1.5">
                      {t('addProvider.repo.orPasteUrl')}
                    </label>
                    <input
                      type="text"
                      placeholder={t('addProvider.repo.urlPlaceholder')}
                      onChange={(e) => handleUrlPaste(e.target.value)}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-[hsl(var(--border))] bg-transparent outline-none focus:border-[hsl(var(--primary))] transition-colors"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium mb-1.5">
                        {t('addProvider.repo.owner')}
                      </label>
                      <input
                        type="text"
                        value={owner}
                        onChange={(e) => setOwner(e.target.value)}
                        placeholder={t('addProvider.repo.ownerPlaceholder')}
                        className="w-full px-3 py-2 text-sm rounded-lg border border-[hsl(var(--border))] bg-transparent outline-none focus:border-[hsl(var(--primary))] transition-colors"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1.5">
                        {t('addProvider.repo.name')}
                      </label>
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder={t('addProvider.repo.namePlaceholder')}
                        className="w-full px-3 py-2 text-sm rounded-lg border border-[hsl(var(--border))] bg-transparent outline-none focus:border-[hsl(var(--primary))] transition-colors"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium mb-1.5">
                      {t('addProvider.token.label')}
                    </label>
                    <input
                      type="password"
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      placeholder={t('addProvider.token.placeholder')}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-[hsl(var(--border))] bg-transparent outline-none focus:border-[hsl(var(--primary))] transition-colors font-mono"
                    />
                    <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
                      {t('addProvider.token.hint')}
                    </p>
                  </div>
                </>
              )}

              {platform === 'gitlab' && (
                <div>
                  <label className="block text-xs font-medium mb-1.5">
                    {t('addProvider.apiBaseUrl.label')}
                  </label>
                  <input
                    type="text"
                    value={apiBaseUrl}
                    onChange={(e) => setApiBaseUrl(e.target.value)}
                    placeholder={t('addProvider.apiBaseUrl.placeholder')}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-[hsl(var(--border))] bg-transparent outline-none focus:border-[hsl(var(--primary))] transition-colors"
                  />
                  <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
                    {t('addProvider.apiBaseUrl.hint')}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Step 3: Verify Connection */}
          {step === 'verify' && (
            <div className="flex flex-col items-center justify-center py-8 gap-4">
              {!testResult && (
                <>
                  <Loader2 className="h-8 w-8 animate-spin text-[hsl(var(--primary))]" />
                  <p className="text-sm text-[hsl(var(--muted-foreground))]">
                    {t('addProvider.verify.testing')}
                  </p>
                </>
              )}

              {testResult?.ok && (
                <>
                  <CheckCircle2 className="h-10 w-10 text-green-500" />
                  <p className="text-sm font-medium text-green-600 dark:text-green-400">
                    {t('addProvider.verify.success')}
                  </p>
                </>
              )}

              {testResult && !testResult.ok && (
                <>
                  <XCircle className="h-10 w-10 text-red-500" />
                  <div className="text-center">
                    <p className="text-sm font-medium text-red-600 dark:text-red-400">
                      {t('addProvider.verify.failed')}
                    </p>
                    {testResult.error && (
                      <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1 max-w-xs">
                        {testResult.error}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={handleRetry}
                    className="mt-2 px-4 py-1.5 text-xs font-medium rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors"
                  >
                    {t('addProvider.verify.retry')}
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-end px-6 py-4 border-t border-[hsl(var(--border))]">
          <div className="flex items-center gap-2">
            {step !== 'platform' && step !== 'verify' && (
              <button
                onClick={handleBack}
                className="px-4 py-1.5 text-xs font-medium rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors"
              >
                {t('addProvider.actions.back')}
              </button>
            )}

            {step === 'credentials' && (
              <button
                onClick={handleConnect}
                disabled={!canProceedToVerify || creating}
                className={cn(
                  'px-4 py-1.5 text-xs font-medium rounded-lg transition-all',
                  'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]',
                  (!canProceedToVerify || creating) && 'opacity-50 cursor-not-allowed',
                  canProceedToVerify && !creating && 'hover:opacity-90',
                )}
              >
                {t('addProvider.actions.connect')}
              </button>
            )}
          </div>
        </div>
      </div>
    </Dialog>
  )
}
