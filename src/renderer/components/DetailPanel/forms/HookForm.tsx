// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formStyles, type CapabilityFormProps } from './types'
import { SectionDivider } from './SectionDivider'

const HOOK_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'SessionStart',
  'Stop',
  'Notification',
  'TaskCompleted'
] as const

interface HookRuleField {
  type: string
  command: string
}

interface HookFormFields {
  eventName: string
  rules: HookRuleField[]
}

type Props = CapabilityFormProps<HookFormFields>

export function HookForm({ mode, saving, onSave, onCancel, onDirty, variant }: Props): React.JSX.Element {
  const { t } = useTranslation('sessions')
  const s = formStyles(variant)
  const isModal = variant === 'modal'
  const initial =
    mode.type === 'edit'
      ? mode.initialData
      : { eventName: '', rules: [{ type: 'command', command: '' }] }
  const [eventName, setEventName] = useState(initial.eventName)
  const [rules, setRules] = useState<HookRuleField[]>(
    initial.rules.length > 0 ? initial.rules : [{ type: 'command', command: '' }]
  )
  const [error, setError] = useState<string | null>(null)

  const markDirty = (): void => {
    onDirty?.(true)
  }

  const addRule = (): void => {
    setRules([...rules, { type: 'command', command: '' }])
    markDirty()
  }

  const removeRule = (index: number): void => {
    setRules(rules.filter((_, i) => i !== index))
    markDirty()
  }

  const updateRule = (index: number, field: keyof HookRuleField, value: string): void => {
    const updated = rules.map((r, i) => (i === index ? { ...r, [field]: value } : r))
    setRules(updated)
    markDirty()
  }

  const handleSave = (): void => {
    if (!eventName.trim()) {
      setError('Event name is required')
      return
    }
    const validRules = rules.filter((r) => r.command.trim() !== '')
    if (validRules.length === 0) {
      setError('At least one rule with a command is required')
      return
    }
    setError(null)
    onSave({ eventName, rules: validRules })
  }

  return (
    <div className="flex flex-col h-full">
      <div className={`${isModal ? 'px-5 py-4' : 'p-4'} space-y-3 flex-1 overflow-y-auto`}>
        {error && (
          <p className="text-xs text-red-500" role="alert">
            {error}
          </p>
        )}

        {/* ── Trigger Event ── */}
        {isModal && (
          <SectionDivider label={t('capabilityCenter.formSections.triggerEvent', 'Trigger Event')} />
        )}
        <div>
          <label htmlFor="hook-event" className={s.label}>
            Event Name
          </label>
          <div className={isModal ? 'relative' : ''}>
            <select
              id="hook-event"
              name="hook-event"
              value={eventName}
              onChange={(e) => {
                setEventName(e.target.value)
                markDirty()
              }}
              disabled={mode.type === 'edit'}
              aria-label="Event Name"
              className={cn(
                isModal
                  ? 'w-full py-2 pr-8 text-base font-medium bg-transparent border-none outline-none text-[hsl(var(--foreground))] appearance-none cursor-pointer disabled:opacity-50'
                  : `${s.select} disabled:opacity-50`,
              )}
            >
              <option value="">Select event…</option>
              {HOOK_EVENTS.map((ev) => (
                <option key={ev} value={ev}>
                  {ev}
                </option>
              ))}
            </select>
            {isModal && (
              <ChevronDown
                className="absolute right-0 top-1/2 -translate-y-1/2 w-4 h-4 text-[hsl(var(--muted-foreground))] pointer-events-none"
                aria-hidden="true"
              />
            )}
          </div>
        </div>

        {/* ── Commands ── */}
        {isModal ? (
          <SectionDivider
            label={t('capabilityCenter.formSections.executeCommands', 'Commands')}
            action={
              <button
                type="button"
                onClick={addRule}
                aria-label="Add Rule"
                className="flex items-center gap-1 text-[10px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
              >
                <Plus className="h-3 w-3" aria-hidden="true" />
                Add
              </button>
            }
          />
        ) : (
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Rules</span>
            <button
              type="button"
              onClick={addRule}
              aria-label="Add Rule"
              className="p-1 rounded-md hover:bg-[hsl(var(--foreground)/0.04)] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        )}

        <div className="space-y-2">
          {rules.map((rule, i) => (
            <div
              key={i}
              className={cn(
                'flex gap-2 items-center',
                isModal && 'bg-[hsl(var(--foreground)/0.02)] rounded-lg px-3 py-2'
              )}
            >
              {isModal ? (
                <span className="shrink-0 text-xs text-[hsl(var(--muted-foreground))] opacity-60 font-mono">
                  command
                </span>
              ) : (
                <select
                  name={`rule-type-${i}`}
                  value={rule.type}
                  onChange={(e) => updateRule(i, 'type', e.target.value)}
                  aria-label={`Rule ${i + 1} type`}
                  className="w-24 px-2 py-1.5 text-sm rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                >
                  <option value="command">command</option>
                </select>
              )}
              <input
                name={`rule-cmd-${i}`}
                type="text"
                value={rule.command}
                onChange={(e) => updateRule(i, 'command', e.target.value)}
                placeholder="/path/to/script…"
                aria-label={`Rule ${i + 1} command`}
                autoComplete="off"
                spellCheck={false}
                className={cn(
                  'flex-1 text-sm outline-none',
                  isModal
                    ? 'bg-transparent border-none placeholder:text-[hsl(var(--muted-foreground))] text-[hsl(var(--foreground))] font-mono'
                    : 'px-2 py-1.5 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]'
                )}
              />
              {rules.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeRule(i)}
                  aria-label={`Remove Rule ${i + 1}`}
                  className="p-1 rounded-md hover:bg-red-500/10 text-[hsl(var(--muted-foreground))] hover:text-red-500 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className={s.footer}>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel"
          className={s.cancel}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          aria-label={saving ? 'Saving…' : 'Save'}
          className={s.save}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
