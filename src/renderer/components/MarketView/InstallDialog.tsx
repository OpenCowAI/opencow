// SPDX-License-Identifier: Apache-2.0

import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import {
  Download,
  Globe,
  FolderOpen,
  Loader2,
  Check,
  AlertCircle,
  Package,
  X,
  RotateCcw,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { surfaceProps } from '@/lib/surface'
import { useModalAnimation } from '@/hooks/useModalAnimation'
import { useBlockBrowserView } from '@/hooks/useBlockBrowserView'
import { useAppStore, selectProjectId } from '@/stores/appStore'
import { getAppAPI } from '@/windowAPI'
import { SessionChatLayout } from '@/components/ChatView/SessionChatLayout'
import type {
  MarketSkillSummary,
  MarketInstallResult,
  MarketInstallPreview,
  ManagedCapabilityCategory,
} from '@shared/types'
import type { InstallProgress, InstallStep } from '@/hooks/useMarketInstall'
import type { UseMarketAnalysisSessionResult } from '@/hooks/useMarketAnalysisSession'
import { getProviderTheme } from './providerTheme'

// ─── Helpers ──────────────────────────────────────────────

/**
 * Shorten an absolute install path for display.
 *
 * Global:  /Users/x/.opencow-dev/packages/foo → ~/.opencow-dev/packages/foo
 * Project: /Users/x/workspace/MyProject/.opencow-dev/packages/foo → MyProject/.opencow-dev/packages/foo
 *
 * The distinction matters — global and project paths must look different.
 */
function shortenPath(fullPath: string): string {
  const normalized = fullPath.replace(/\\/g, '/')
  // Split at the .opencow[-dev] / .claude boundary
  const m = normalized.match(/^(.+?)([/]\.(?:opencow(?:-dev)?|claude)[/].+)$/)
  if (!m) {
    const segments = normalized.split('/')
    return segments.length > 4 ? '…/' + segments.slice(-4).join('/') : normalized
  }

  const [, prefix, dotPart] = m
  const prefixSegments = prefix.split('/').filter(Boolean)

  // Home directories on macOS/Linux have ≤2 segments: /Users/name or /home/name
  // If the prefix is that short, it's a global (home-level) path → use ~
  if (prefixSegments.length <= 2) {
    return '~' + dotPart
  }

  // Otherwise it's a project path — show the project directory name for context
  const projectDir = prefixSegments[prefixSegments.length - 1]
  return projectDir + dotPart
}

// ─── Types ─────────────────────────────────────────────────

type DialogPhase = 'select' | 'analyzing' | 'preview' | 'installing' | 'success' | 'error'

interface InstallDialogProps {
  open: boolean
  skill: MarketSkillSummary | null
  installing: boolean
  result: MarketInstallResult | null
  error: string | null
  progress: InstallProgress | null
  /** Complete analysis session handle — provides state, actions, and Session Console data. */
  analysis: UseMarketAnalysisSessionResult
  onInstall: (scope: 'global' | 'project', namespacePrefix?: string) => void
  onClose: () => void
}

// ─── Phase derivation (pure data, no side effects) ─────────

function derivePhase(
  progress: InstallProgress | null,
  analyzing: boolean,
  analyzeError: string | null,
  preview: MarketInstallPreview | null,
): DialogPhase {
  if (!progress) {
    if (analyzing) return 'analyzing'
    if (analyzeError) return 'analyzing' // show error in analyzing phase UI
    // Only show preview when there are actual capabilities to install.
    // An empty preview (agent found nothing) should not show the Install button.
    if (preview && preview.capabilities.length > 0) return 'preview'
    if (preview) return 'analyzing' // empty result — show "no capabilities" in analyzing UI
    return 'select'
  }
  if (progress.steps.some((s) => s.status === 'error')) return 'error'
  if (progress.steps.every((s) => s.status === 'done')) return 'success'
  return 'installing'
}

/** Phases where backdrop-click / Escape can safely dismiss the dialog. */
const DISMISSABLE_PHASES: ReadonlySet<DialogPhase> = new Set(['select', 'preview', 'error', 'success'])

// ─── Step indicator ────────────────────────────────────────

function StepIndicator({ step }: { step: InstallStep }): React.JSX.Element {
  switch (step.status) {
    case 'done':
      return (
        <span className="flex items-center justify-center h-5 w-5 rounded-full bg-emerald-500 install-check-enter">
          <Check className="h-3 w-3 text-white" strokeWidth={3} />
        </span>
      )
    case 'active':
      return (
        <span className="flex items-center justify-center h-5 w-5 rounded-full border-2 border-[hsl(var(--primary))] install-step-active">
          <span className="h-2 w-2 rounded-full bg-[hsl(var(--primary))]" />
        </span>
      )
    case 'error':
      return (
        <span className="flex items-center justify-center h-5 w-5 rounded-full bg-red-500 install-error-shake">
          <X className="h-3 w-3 text-white" strokeWidth={3} />
        </span>
      )
    default:
      return (
        <span className="flex items-center justify-center h-5 w-5 rounded-full border-2 border-[hsl(var(--foreground)/0.12)]" />
      )
  }
}

// ─── Step list ─────────────────────────────────────────────

function StepList({ steps }: { steps: InstallStep[] }): React.JSX.Element {
  const doneCount = steps.filter((s) => s.status === 'done').length
  const progress = steps.length > 0 ? (doneCount / steps.length) * 100 : 0

  return (
    <div className="install-steps-enter">
      <div className="space-y-1 mb-4">
        {steps.map((step) => (
          <div
            key={step.id}
            className={cn(
              'flex items-center gap-3 px-3 py-2 rounded-lg transition-colors duration-200',
              step.status === 'active' && 'bg-[hsl(var(--primary)/0.04)]',
              step.status === 'error' && 'bg-red-500/5',
            )}
          >
            <StepIndicator step={step} />
            <span
              className={cn(
                'text-xs transition-colors duration-200',
                step.status === 'done' && 'text-[hsl(var(--foreground)/0.5)]',
                step.status === 'active' && 'text-[hsl(var(--foreground))] font-medium',
                step.status === 'error' && 'text-red-600 font-medium',
                step.status === 'pending' && 'text-[hsl(var(--foreground)/0.3)]',
              )}
            >
              {step.label}
            </span>
            {step.status === 'active' && (
              <Loader2 className="h-3 w-3 ml-auto text-[hsl(var(--primary)/0.5)] animate-spin" />
            )}
          </div>
        ))}
      </div>

      {/* Progress bar */}
      <div className="h-1 rounded-full bg-[hsl(var(--foreground)/0.06)] overflow-hidden">
        <div
          className="h-full rounded-full bg-[hsl(var(--primary))] transition-all duration-300 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  )
}

// ─── Main component ────────────────────────────────────────

export function InstallDialog({
  open,
  skill,
  installing,
  result,
  error,
  progress,
  analysis,
  onInstall,
  onClose,
}: InstallDialogProps): React.JSX.Element | null {
  const dialogRef = useRef<HTMLDivElement>(null)
  const { mounted, phase: animPhase } = useModalAnimation(open)
  useBlockBrowserView('install-dialog', open)
  const projectId = useAppStore(selectProjectId)
  const [scope, setScope] = useState<'global' | 'project'>('global')
  const [installPath, setInstallPath] = useState<string | null>(null)

  // ─── Namespace prefix for multi-capability packages ─────
  const defaultPrefix = useMemo(() => {
    if (!skill?.slug) return ''
    // Extract repo name from slug: "obra/superpowers" → "superpowers"
    return skill.slug.split('/').pop() ?? ''
  }, [skill?.slug])
  const [namespacePrefix, setNamespacePrefix] = useState(defaultPrefix)

  // Reset prefix when skill changes
  useEffect(() => {
    setNamespacePrefix(defaultPrefix)
  }, [defaultPrefix])

  // ─── Derive dialog phase from progress + analyze state ──
  const dialogPhase = derivePhase(progress, analysis.isAnalyzing, analysis.error, analysis.preview)

  // ─── Effects ───────────────────────────────────────────
  useEffect(() => {
    if (projectId) setScope('project')
    else setScope('global')
  }, [projectId, open])

  // Resolve install path when scope or prefix changes
  useEffect(() => {
    let cancelled = false
    const prefix = namespacePrefix || defaultPrefix || undefined
    getAppAPI()['market:resolve-install-path']({
      scope,
      projectId: scope === 'project' && projectId ? projectId : undefined,
      prefix,
    })
      .then((resolved) => { if (!cancelled) setInstallPath(resolved) })
      .catch(() => { if (!cancelled) setInstallPath(null) })
    return () => { cancelled = true }
  }, [scope, projectId, namespacePrefix, defaultPrefix])

  useEffect(() => {
    if (mounted) dialogRef.current?.focus()
  }, [mounted])

  // ─── Keyboard ──────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Stop propagation so the event doesn't bubble to MarketDialog's
        // onKeyDown handler — otherwise both dialogs close simultaneously.
        e.stopPropagation()
        if (DISMISSABLE_PHASES.has(dialogPhase)) onClose()
        return
      }
      if (e.key !== 'Tab') return
      const dialog = dialogRef.current
      if (!dialog) return
      const focusable = dialog.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [tabindex]:not([tabindex="-1"])',
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    },
    [onClose, dialogPhase],
  )

  if (!mounted || !skill) return null

  const theme = getProviderTheme(skill.marketplaceId)

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center overscroll-contain no-drag">
      {/* Overlay */}
      <div
        className={cn(
          'absolute inset-0 bg-black/50 surface-backdrop-isolate',
          animPhase === 'enter' && 'modal-overlay-enter',
          animPhase === 'exit' && 'modal-overlay-exit',
        )}
        onClick={() => DISMISSABLE_PHASES.has(dialogPhase) && onClose()}
        aria-hidden="true"
      />

      <div
        className={cn(
          'relative z-10 w-full mx-4 transition-all duration-300',
          dialogPhase === 'analyzing'
            ? 'max-w-[560px] max-h-[72vh]'
            : 'max-w-sm',
          animPhase === 'enter' && 'modal-content-enter',
          animPhase === 'exit' && 'modal-content-exit',
        )}
      >
        {/* Glass surface */}
        <div
          {...surfaceProps({ elevation: 'modal', color: 'card' })}
          className="absolute inset-0 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-lg pointer-events-none"
          aria-hidden="true"
        />

        {/* Content */}
        <div
          ref={dialogRef}
          role="dialog"
          aria-label={`Install ${skill.name}`}
          aria-modal="true"
          tabIndex={-1}
          onKeyDown={handleKeyDown}
          className={cn(
            'relative rounded-2xl outline-none overscroll-contain',
            dialogPhase === 'analyzing'
              ? 'flex flex-col h-[72vh] p-0'
              : 'p-6',
          )}
        >
          {/* ─── Skill header (visible in select/preview/installing/error — NOT analyzing or success) ── */}
          {dialogPhase !== 'success' && dialogPhase !== 'analyzing' && (
            <div className="flex items-start gap-3 mb-5">
              <div className="flex items-center justify-center h-9 w-9 rounded-xl shrink-0 bg-amber-500/10">
                <Download className="h-4 w-4 text-amber-500" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold truncate">
                  {dialogPhase === 'installing'
                    ? `Installing ${skill.name}…`
                    : dialogPhase === 'preview'
                      ? `Install ${skill.name}`
                      : dialogPhase === 'error'
                        ? 'Installation failed'
                        : skill.name}
                </h3>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[11px] text-[hsl(var(--muted-foreground)/0.6)]">
                    by {skill.author}
                  </span>
                  <span className={cn('text-[10px] px-1.5 py-0.5 rounded-md', theme.badge)}>
                    {theme.label}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════
           *  Phase 1 — Select scope
           * ═══════════════════════════════════════════════════════ */}
          {dialogPhase === 'select' && (
            <>
              {/* Scope selection */}
              <div className="space-y-2 mb-5">
                <p className="text-xs text-[hsl(var(--muted-foreground)/0.6)] mb-2">Install to:</p>

                <button
                  type="button"
                  onClick={() => setScope('global')}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors text-left',
                    scope === 'global'
                      ? 'border-[hsl(var(--primary)/0.4)] bg-[hsl(var(--primary)/0.04)]'
                      : 'border-[hsl(var(--border)/0.4)] hover:border-[hsl(var(--border)/0.6)]',
                  )}
                >
                  <Globe
                    className={cn(
                      'h-4 w-4 shrink-0',
                      scope === 'global'
                        ? 'text-[hsl(var(--primary))]'
                        : 'text-[hsl(var(--muted-foreground)/0.5)]',
                    )}
                  />
                  <div>
                    <p className="text-xs font-medium">Global</p>
                    <p className="text-[11px] text-[hsl(var(--muted-foreground)/0.5)]">
                      Available in all projects
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setScope('project')}
                  disabled={!projectId}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors text-left',
                    !projectId && 'opacity-40 cursor-not-allowed',
                    scope === 'project' && projectId
                      ? 'border-[hsl(var(--primary)/0.4)] bg-[hsl(var(--primary)/0.04)]'
                      : 'border-[hsl(var(--border)/0.4)] hover:border-[hsl(var(--border)/0.6)]',
                  )}
                >
                  <FolderOpen
                    className={cn(
                      'h-4 w-4 shrink-0',
                      scope === 'project' && projectId
                        ? 'text-[hsl(var(--primary))]'
                        : 'text-[hsl(var(--muted-foreground)/0.5)]',
                    )}
                  />
                  <div>
                    <p className="text-xs font-medium">Project</p>
                    <p className="text-[11px] text-[hsl(var(--muted-foreground)/0.5)]">
                      {projectId ? 'Scoped to current project' : 'No project selected'}
                    </p>
                  </div>
                </button>
              </div>

              {/* Install path preview */}
              {installPath && (
                <div className="flex items-start gap-2 mb-4 py-2 px-3 rounded-xl bg-[hsl(var(--foreground)/0.02)] border border-[hsl(var(--border)/0.3)]">
                  <FolderOpen className="h-3 w-3 text-[hsl(var(--muted-foreground)/0.4)] shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] text-[hsl(var(--muted-foreground)/0.5)] mb-0.5">Install path</p>
                    <p className="text-[10px] font-mono text-[hsl(var(--muted-foreground)/0.6)] truncate" title={installPath}>
                      {shortenPath(installPath)}
                    </p>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3 py-1.5 text-sm rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => skill && analysis.startAnalysis(skill.slug, skill.marketplaceId)}
                  className="px-3 py-1.5 text-sm rounded-lg font-medium bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                >
                  Next
                </button>
              </div>
            </>
          )}

          {/* ═══════════════════════════════════════════════════════
           *  Phase 1b — Analyzing (Session Console / error)
           * ═══════════════════════════════════════════════════════ */}
          {dialogPhase === 'analyzing' && (
            <>
              {/* Header bar for analyzing phase (since p-6 is removed) */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-[hsl(var(--border)/0.3)] shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="flex items-center justify-center h-7 w-7 rounded-lg shrink-0 bg-amber-500/10">
                    <Download className="h-3.5 w-3.5 text-amber-500" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-xs font-semibold truncate">
                      {analysis.error ? `Install ${skill.name}` : `Analyzing ${skill.name}…`}
                    </h3>
                    <span className="text-[10px] text-[hsl(var(--muted-foreground)/0.5)]">
                      by {skill.author}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => analysis.cancel()}
                  className="p-1.5 rounded-lg text-[hsl(var(--muted-foreground)/0.5)] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.05)] transition-colors"
                  aria-label="Cancel analysis"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Session Console or error/loading state */}
              {analysis.isAnalyzing && analysis.session ? (
                <SessionChatLayout
                  session={analysis.session}
                  onSendOrQueue={analysis.sendOrQueue}
                  onStop={analysis.onStop}
                  messageQueue={analysis.messageQueue}
                  isProcessing={analysis.isProcessing}
                  isPaused={analysis.isPaused}
                  controlsMaxW={null}
                  pausedPlaceholder="Analysis paused — send a message to continue"
                  controlsClassName="px-3"
                  hideContentViewer
                />
              ) : analysis.isAnalyzing && !analysis.session ? (
                /* Session is being created — show loading spinner */
                <div className="flex-1 flex items-center justify-center">
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--primary)/0.5)]" />
                    <p className="text-xs text-[hsl(var(--muted-foreground)/0.5)]">
                      Downloading repository…
                    </p>
                  </div>
                </div>
              ) : analysis.error ? (
                <div className="flex-1 flex items-center justify-center p-6">
                  <div className="flex flex-col items-center gap-3">
                    <AlertCircle className="h-6 w-6 text-amber-500" />
                    <p className="text-xs text-[hsl(var(--muted-foreground)/0.6)] text-center px-4 leading-relaxed">
                      Could not analyze repository structure
                    </p>
                    <p className="text-[10px] text-[hsl(var(--muted-foreground)/0.4)] text-center px-4 leading-relaxed">
                      {analysis.error}
                    </p>
                    <div className="flex gap-2 mt-2">
                      <button
                        type="button"
                        onClick={() => analysis.reset()}
                        className="px-3 py-1.5 text-sm rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                      >
                        Back
                      </button>
                      <button
                        type="button"
                        onClick={() => onInstall(scope)}
                        className="px-3 py-1.5 text-sm rounded-lg font-medium bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                      >
                        Install anyway
                      </button>
                    </div>
                  </div>
                </div>
              ) : analysis.preview && analysis.preview.capabilities.length === 0 ? (
                /* Agent completed but found no installable capabilities */
                <div className="flex-1 flex items-center justify-center p-6">
                  <div className="flex flex-col items-center gap-3">
                    <Package className="h-6 w-6 text-[hsl(var(--muted-foreground)/0.3)]" />
                    <p className="text-xs text-[hsl(var(--muted-foreground)/0.6)] text-center px-4 leading-relaxed">
                      No installable capabilities found
                    </p>
                    {analysis.preview.probeMessage && (
                      <p className="text-[10px] text-[hsl(var(--muted-foreground)/0.4)] text-center px-4 leading-relaxed">
                        {analysis.preview.probeMessage}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => analysis.reset()}
                      className="px-3 py-1.5 text-sm rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] mt-2"
                    >
                      Back
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          )}

          {/* ═══════════════════════════════════════════════════════
           *  Phase 1c — Preview (capability list + confirm)
           * ═══════════════════════════════════════════════════════ */}
          {dialogPhase === 'preview' && analysis.preview && (
            <>
              {/* Namespace prefix input (only for multi-capability repos) */}
              {analysis.preview.isMultiCapability && (
                <div className="mb-4">
                  <label className="flex items-center gap-1.5 text-[11px] text-[hsl(var(--muted-foreground)/0.6)] mb-1.5">
                    <Package className="h-3 w-3" />
                    Namespace prefix
                  </label>
                  <input
                    type="text"
                    value={namespacePrefix}
                    onChange={(e) => setNamespacePrefix(e.target.value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 50))}
                    maxLength={50}
                    placeholder={defaultPrefix}
                    aria-describedby="prefix-help"
                    className="w-full px-3 py-1.5 text-xs rounded-lg border border-[hsl(var(--border)/0.5)] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground)/0.3)] outline-none focus:border-[hsl(var(--primary)/0.5)] focus:ring-1 focus:ring-[hsl(var(--primary)/0.2)] transition-colors"
                  />
                  <p id="prefix-help" className="text-[10px] text-[hsl(var(--muted-foreground)/0.4)] mt-1 leading-relaxed">
                    Capabilities will be named <code className="font-mono text-[hsl(var(--foreground)/0.5)]">{namespacePrefix || defaultPrefix}:name</code>
                  </p>
                </div>
              )}

              {/* Degraded probe warning — API failed, preview may be incomplete */}
              {analysis.preview.probeStatus === 'degraded' && (
                <div className="flex items-start gap-2 mb-4 py-2.5 px-3 rounded-xl bg-amber-500/8 border border-amber-500/15">
                  <AlertCircle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] text-amber-600/90 leading-relaxed font-medium">
                      Preview may be incomplete — install is disabled
                    </p>
                    {analysis.preview.probeMessage && (
                      <p className="text-[10px] text-amber-600/60 leading-relaxed mt-0.5">
                        {analysis.preview.probeMessage}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => { analysis.reset(); if (skill) analysis.startAnalysis(skill.slug, skill.marketplaceId) }}
                    className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-lg border border-amber-500/20 text-amber-600/80 hover:bg-amber-500/8 transition-colors shrink-0"
                  >
                    <RotateCcw className="h-2.5 w-2.5" />
                    Retry
                  </button>
                </div>
              )}

              {/* Capability groups */}
              <div className="space-y-3 mb-5 max-h-[280px] overflow-y-auto">
                <CapabilityGroup
                  caps={analysis.preview.capabilities} category="skill" icon="🧩" label="Skills"
                  prefix={analysis.preview.isMultiCapability ? (namespacePrefix || defaultPrefix) : undefined}
                />
                <CapabilityGroup
                  caps={analysis.preview.capabilities} category="command" icon="⚡" label="Commands"
                  prefix={analysis.preview.isMultiCapability ? (namespacePrefix || defaultPrefix) : undefined}
                />
                <CapabilityGroup
                  caps={analysis.preview.capabilities} category="agent" icon="🤖" label="Agents"
                  prefix={analysis.preview.isMultiCapability ? (namespacePrefix || defaultPrefix) : undefined}
                />
                <CapabilityGroup
                  caps={analysis.preview.capabilities} category="rule" icon="📏" label="Rules"
                  prefix={analysis.preview.isMultiCapability ? (namespacePrefix || defaultPrefix) : undefined}
                />

                {/* Skipped directories */}
                {analysis.preview.skipped.length > 0 && (
                  <div className="pt-2 border-t border-[hsl(var(--border)/0.3)]">
                    <p className="text-[10px] text-[hsl(var(--muted-foreground)/0.4)] mb-1">Skipped</p>
                    {analysis.preview.skipped.map((s) => (
                      <p
                        key={s.dir}
                        className="text-[10px] text-[hsl(var(--muted-foreground)/0.35)] leading-relaxed"
                      >
                        {s.dir}/ — {s.reason}
                      </p>
                    ))}
                  </div>
                )}
              </div>

              {/* Scope indicator + install path */}
              <div className="mb-4 px-2">
                <div className="flex items-center gap-2">
                  {scope === 'global' ? (
                    <Globe className="h-3 w-3 text-[hsl(var(--muted-foreground)/0.5)]" />
                  ) : (
                    <FolderOpen className="h-3 w-3 text-[hsl(var(--muted-foreground)/0.5)]" />
                  )}
                  <span className="text-[11px] text-[hsl(var(--muted-foreground)/0.5)]">
                    {scope === 'global' ? 'Installing globally' : 'Installing to project'}
                  </span>
                </div>
                {installPath && (
                  <p className="text-[10px] font-mono text-[hsl(var(--muted-foreground)/0.4)] mt-1 ml-5 truncate" title={installPath}>
                    {shortenPath(installPath)}
                  </p>
                )}
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => analysis.reset()}
                  className="px-3 py-1.5 text-sm rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => onInstall(scope, analysis.preview?.isMultiCapability ? (namespacePrefix || defaultPrefix) : undefined)}
                  disabled={
                    analysis.preview?.probeStatus === 'degraded' ||
                    !analysis.preview?.capabilities.length ||
                    (analysis.preview?.isMultiCapability && !namespacePrefix && !defaultPrefix)
                  }
                  className="px-3 py-1.5 text-sm rounded-lg font-medium bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Install {analysis.preview.capabilities.length > 1 ? `${analysis.preview.capabilities.length} capabilities` : ''}
                </button>
              </div>
            </>
          )}

          {/* ═══════════════════════════════════════════════════════
           *  Phase 2 — Installing (step progression)
           * ═══════════════════════════════════════════════════════ */}
          {dialogPhase === 'installing' && progress && (
            <StepList steps={progress.steps} />
          )}

          {/* ═══════════════════════════════════════════════════════
           *  Phase 3 — Success (celebration + install info)
           * ═══════════════════════════════════════════════════════ */}
          {dialogPhase === 'success' && (
            <div className="flex flex-col items-center py-3">
              {/* ── Celebration icon with ring burst ── */}
              <div className="relative mb-5 flex items-center justify-center" style={{ width: 64, height: 64 }}>
                {/* Expanding rings */}
                <div className="absolute inset-0 rounded-full border-2 border-emerald-400/40 install-success-ring" />
                <div className="absolute inset-0 rounded-full border border-emerald-400/25 install-success-ring-2" />
                {/* Icon */}
                <div className="relative flex items-center justify-center h-16 w-16 rounded-full bg-emerald-500 install-complete-glow">
                  <Check className="h-8 w-8 text-white install-check-enter" strokeWidth={2.5} />
                </div>
              </div>

              {/* ── Name + version + author ── */}
              <div className="install-success-item text-center" style={{ animationDelay: '180ms' }}>
                <h3 className="text-sm font-semibold">
                  {result?.name ?? skill.name}
                </h3>
                <p className="text-[11px] text-[hsl(var(--muted-foreground)/0.5)] mt-0.5">
                  {(result?.version || skill.version) && (
                    <span>v{result?.version ?? skill.version} · </span>
                  )}
                  by {skill.author}
                </p>
              </div>

              {/* ── Install location card ── */}
              <div
                className="install-success-item w-full mt-4"
                style={{ animationDelay: '320ms' }}
              >
                <div className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl border border-emerald-500/15 bg-emerald-500/[0.04]">
                  {scope === 'global' ? (
                    <Globe className="h-4 w-4 text-emerald-500/80 shrink-0" />
                  ) : (
                    <FolderOpen className="h-4 w-4 text-emerald-500/80 shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-[hsl(var(--foreground)/0.8)]">
                      {scope === 'global' ? 'Installed globally' : 'Installed to project'}
                    </p>
                    {result?.installedPath && (
                      <p className="text-[10px] font-mono text-[hsl(var(--muted-foreground)/0.45)] truncate mt-px">
                        {shortenPath(result.installedPath)}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* ── Context hint ── */}
              <p
                className="install-success-item text-[11px] text-[hsl(var(--muted-foreground)/0.5)] text-center mt-3 leading-relaxed"
                style={{ animationDelay: '440ms' }}
              >
                {scope === 'global'
                  ? 'Ready to use in all your conversations'
                  : 'Ready to use in this project\u2019s conversations'}
              </p>

              {/* ── Done button ── */}
              <button
                type="button"
                onClick={onClose}
                className="install-success-item mt-5 px-5 py-1.5 text-sm rounded-lg font-medium bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                style={{ animationDelay: '550ms' }}
              >
                Done
              </button>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════
           *  Phase 4 — Error (step list + error detail + retry)
           * ═══════════════════════════════════════════════════════ */}
          {dialogPhase === 'error' && progress && (
            <>
              <StepList steps={progress.steps} />

              {/* Error message */}
              {progress.errorMessage && (
                <div className="flex items-start gap-2 mt-3 py-2.5 px-3 rounded-xl bg-red-500/8 border border-red-500/15">
                  <AlertCircle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-red-600/90 leading-relaxed break-all line-clamp-3">
                    {progress.errorMessage}
                  </p>
                </div>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-2 mt-4">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3 py-1.5 text-sm rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => onInstall(scope)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg font-medium bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                >
                  <RotateCcw className="h-3 w-3" />
                  Retry
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Capability Group (preview helper) ─────────────────────

function CapabilityGroup({
  caps,
  category,
  icon,
  label,
  prefix,
}: {
  caps: MarketInstallPreview['capabilities']
  category: ManagedCapabilityCategory
  icon: string
  label: string
  /** Namespace prefix to prepend to each capability name (e.g. "superpowers") */
  prefix?: string
}): React.JSX.Element | null {
  const items = caps.filter((c) => c.category === category)
  if (items.length === 0) return null
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="text-xs">{icon}</span>
        <span className="text-[11px] font-medium text-[hsl(var(--foreground)/0.7)]">
          {label}
        </span>
        <span className="text-[10px] text-[hsl(var(--muted-foreground)/0.4)]">
          ({items.length})
        </span>
      </div>
      <div className="flex flex-wrap gap-1">
        {items.map((item) => (
          <span
            key={item.name}
            className="px-2 py-0.5 text-[10px] rounded-md bg-[hsl(var(--foreground)/0.04)] text-[hsl(var(--foreground)/0.6)]"
          >
            {prefix ? (
              <>
                <span className="text-[hsl(var(--primary)/0.6)]">{prefix}:</span>
                {item.name}
              </>
            ) : (
              item.name
            )}
          </span>
        ))}
      </div>
    </div>
  )
}
