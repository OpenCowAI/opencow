// SPDX-License-Identifier: Apache-2.0

import { createContext, useContext, memo, useState, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { HelpCircle, Send, Loader2, Check } from 'lucide-react'
// ─── Types ──────────────────────────────────────────────────────────────────────

export interface QuestionOption {
  label: string
  description?: string
}

export interface Question {
  question: string
  header?: string
  options?: QuestionOption[]
  multiSelect?: boolean
}

// ─── Context ────────────────────────────────────────────────────────────────────

/**
 * Provided by SessionMessageList so deeply-nested AskUserQuestionCard instances
 * can send the user's answer without prop-drilling through 5 component layers.
 * Mirrors the TaskEventsProvider pattern from TaskWidgets.tsx.
 */
export interface AskUserQuestionActions {
  /** Send the composed answer text. Returns true on success. */
  sendAnswer: (text: string) => Promise<boolean>
  /**
   * Whether the session can currently accept a message (idle / awaiting_input /
   * awaiting_question / stopped / error).  This gates the Confirm button on every card.
   */
  canAcceptInput: boolean
}

const AskUserQuestionContext = createContext<AskUserQuestionActions | null>(null)

export const AskUserQuestionProvider = AskUserQuestionContext.Provider

export function useAskUserQuestionActions(): AskUserQuestionActions | null {
  return useContext(AskUserQuestionContext)
}

// ─── Shared constants ───────────────────────────────────────────────────────────

const EMPTY_SET = new Set<number>()

// ─── AskUserQuestionCard ────────────────────────────────────────────────────────

export const AskUserQuestionCard = memo(function AskUserQuestionCard({
  questions,
  toolUseId
}: {
  questions: Question[]
  toolUseId: string
}): React.JSX.Element {
  const { t } = useTranslation('sessions')
  const askActions = useAskUserQuestionActions()

  // Whether the session can accept input right now (idle / awaiting_input / …).
  const canSend = askActions !== null && askActions.canAcceptInput

  // ── Selection state: Map<questionIndex, Set<optionIndex>> ─────────────
  const [selections, setSelections] = useState<Map<number, Set<number>>>(
    () => new Map()
  )
  const [additionalNotes, setAdditionalNotes] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSubmitted, setIsSubmitted] = useState(false)

  const hasAnySelection = useMemo(() => {
    for (const s of selections.values()) {
      if (s.size > 0) return true
    }
    return false
  }, [selections])

  const canSubmit =
    canSend &&
    !isSubmitting &&
    !isSubmitted &&
    (hasAnySelection || additionalNotes.trim().length > 0)

  // ── Callbacks ─────────────────────────────────────────────────────────
  const toggleOption = useCallback(
    (qIndex: number, optIndex: number, multiSelect: boolean) => {
      if (isSubmitted) return // lock after submission
      setSelections((prev) => {
        const next = new Map(prev)
        const current = new Set(next.get(qIndex) ?? [])
        if (multiSelect) {
          if (current.has(optIndex)) current.delete(optIndex)
          else current.add(optIndex)
        } else {
          current.clear()
          current.add(optIndex)
        }
        next.set(qIndex, current)
        return next
      })
    },
    [isSubmitted]
  )

  const buildAnswerText = useCallback((): string => {
    const parts: string[] = []
    for (let qi = 0; qi < questions.length; qi++) {
      const q = questions[qi]
      const selected = selections.get(qi)
      if (!selected || selected.size === 0) continue

      if (questions.length > 1) {
        parts.push(`Q${qi + 1}: ${q.question}`)
      }

      const labels = Array.from(selected)
        .sort((a, b) => a - b)
        .map((idx) => q.options?.[idx]?.label)
        .filter(Boolean) as string[]

      parts.push(labels.join(', '))
    }

    if (additionalNotes.trim()) {
      parts.push(additionalNotes.trim())
    }
    return parts.join('\n')
  }, [questions, selections, additionalNotes])

  const handleConfirm = useCallback(async () => {
    if (!askActions || isSubmitting || isSubmitted) return
    const text = buildAnswerText()
    if (!text) return

    setIsSubmitting(true)
    try {
      const ok = await askActions.sendAnswer(text)
      if (ok) setIsSubmitted(true)
    } finally {
      setIsSubmitting(false)
    }
  }, [askActions, isSubmitting, isSubmitted, buildAnswerText])

  // After submission, lock textarea
  const textareaDisabled = isSubmitted || isSubmitting

  return (
    <div
      className="max-w-lg rounded-xl border border-[hsl(var(--border)/0.5)] bg-[hsl(var(--card))] text-[hsl(var(--card-foreground))]"
      role="region"
      aria-label="User questions card"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[hsl(var(--border)/0.5)]">
        <HelpCircle
          className="w-3.5 h-3.5 shrink-0 text-[hsl(var(--muted-foreground))]"
          aria-hidden="true"
        />
        <span className="text-sm font-medium text-[hsl(var(--foreground))]">
          Questions
        </span>
        {isSubmitted && (
          <span className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] text-green-600 dark:text-green-400">
            <Check className="w-3 h-3" aria-hidden="true" />
            {t('askUser.sent')}
          </span>
        )}
        <span className="ml-auto text-[10px] text-[hsl(var(--muted-foreground)/0.6)]">
          {questions.length > 1 ? `${questions.length} questions` : ''}
        </span>
      </div>

      {/* Question list — checkboxes are ALWAYS clickable (local state only) */}
      <div className="px-3 py-2 space-y-3">
        {questions.map((q, i) => (
          <QuestionItem
            key={i}
            question={q}
            index={i}
            showIndex={questions.length > 1}
            interactive={!isSubmitted}
            selectedOptions={selections.get(i) ?? EMPTY_SET}
            onToggleOption={(optIdx) =>
              toggleOption(i, optIdx, q.multiSelect ?? false)
            }
          />
        ))}
      </div>

      {/* Footer: textarea + confirm — ALWAYS visible */}
      <div className="px-3 pb-2 pt-1 space-y-2 border-t border-[hsl(var(--border)/0.3)]">
        {/* Additional notes textarea */}
        <textarea
          value={additionalNotes}
          onChange={(e) => setAdditionalNotes(e.target.value)}
          disabled={textareaDisabled}
          placeholder="Add additional context..."
          rows={1}
          className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground)/0.5)] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--ring))] resize-y min-h-[1.875rem] disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label="Additional notes for your answer"
        />
        {/* Confirm button */}
        <div className="flex items-center justify-end gap-2">
          {!canSend && !isSubmitted && (
            <span className="text-[10px] text-[hsl(var(--muted-foreground)/0.5)] italic">
              Waiting for session…
            </span>
          )}
          <button
            onClick={handleConfirm}
            disabled={!canSubmit}
            className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label={
              isSubmitted
                ? 'Answer submitted'
                : 'Confirm and send answer'
            }
          >
            {isSubmitting ? (
              <Loader2
                className="w-3 h-3 motion-safe:animate-spin"
                aria-hidden="true"
              />
            ) : isSubmitted ? (
              <Check className="w-3 h-3" aria-hidden="true" />
            ) : (
              <Send className="w-3 h-3" aria-hidden="true" />
            )}
            {isSubmitted
              ? t('askUser.sent')
              : isSubmitting
                ? 'Sending\u2026'
                : t('askUser.confirmBtn')}
          </button>
        </div>
      </div>
    </div>
  )
})

// ─── QuestionItem ───────────────────────────────────────────────────────────────

function QuestionItem({
  question,
  index,
  showIndex,
  interactive,
  selectedOptions,
  onToggleOption
}: {
  question: Question
  index: number
  showIndex: boolean
  interactive?: boolean
  selectedOptions?: Set<number>
  onToggleOption?: (optIndex: number) => void
}): React.JSX.Element {
  return (
    <div>
      {/* Question text */}
      <div className="flex items-start gap-1.5">
        {showIndex && (
          <span className="shrink-0 text-[10px] font-mono text-[hsl(var(--muted-foreground)/0.5)] mt-px select-none">
            Q{index + 1}
          </span>
        )}
        <p className="text-sm font-medium text-[hsl(var(--foreground))] leading-relaxed">
          {question.header && (
            <span className="inline-flex items-center px-1.5 py-0 rounded-full bg-[hsl(var(--primary)/0.08)] text-[hsl(var(--accent-foreground))] text-[10px] font-medium mr-1.5 align-middle">
              {question.header}
            </span>
          )}
          {question.question}
        </p>
      </div>

      {/* Options */}
      {question.options && question.options.length > 0 && (
        <div
          className={`mt-1.5 space-y-0.5 ${showIndex ? 'ml-5' : ''}`}
          role={interactive ? (question.multiSelect ? 'group' : 'radiogroup') : undefined}
          aria-label={interactive ? question.question : undefined}
        >
          {question.options.map((opt, j) => (
            <OptionItem
              key={j}
              option={opt}
              multiSelect={question.multiSelect}
              interactive={interactive}
              selected={selectedOptions?.has(j)}
              onToggle={() => onToggleOption?.(j)}
            />
          ))}
        </div>
      )}

      {/* Multi-select hint */}
      {question.multiSelect && (
        <p
          className={`mt-1 text-[10px] text-[hsl(var(--muted-foreground)/0.5)] italic ${showIndex ? 'ml-5' : ''}`}
        >
          Multiple selections allowed
        </p>
      )}
    </div>
  )
}

// ─── OptionItem ─────────────────────────────────────────────────────────────────

function OptionItem({
  option,
  multiSelect,
  interactive,
  selected,
  onToggle
}: {
  option: QuestionOption
  multiSelect?: boolean
  interactive?: boolean
  selected?: boolean
  onToggle?: () => void
}): React.JSX.Element {
  const selectedBg = selected ? 'bg-[hsl(var(--primary)/0.08)]' : ''
  const clickable = interactive !== false
  const interactiveCls = clickable
    ? 'cursor-pointer hover:bg-[hsl(var(--foreground)/0.04)]'
    : 'opacity-70'

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      if (clickable) onToggle?.()
    },
    [clickable, onToggle]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (clickable && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault()
        onToggle?.()
      }
    },
    [clickable, onToggle]
  )

  return (
    <label
      className={`flex items-start gap-2 text-sm px-2 py-0.5 rounded-sm transition-colors ${interactiveCls} ${selectedBg}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      tabIndex={clickable ? 0 : undefined}
    >
      <input
        type="checkbox"
        checked={!!selected}
        readOnly
        tabIndex={-1}
        className="mt-0.5 h-3 w-3 shrink-0 rounded-sm border border-[hsl(var(--border))] accent-[hsl(var(--primary))] pointer-events-none"
      />
      <div className="min-w-0">
        <span className="text-[hsl(var(--foreground))]">{option.label}</span>
        {option.description && (
          <span className="text-[hsl(var(--muted-foreground)/0.7)]">
            {' \u2014 '}
            {option.description}
          </span>
        )}
      </div>
    </label>
  )
}
