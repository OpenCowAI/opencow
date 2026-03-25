// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react'
import { Check, Cpu, Palette } from 'lucide-react'
import { CodeEditor } from '@/components/ui/code-editor'
import { PillDropdown, PILL_TRIGGER } from '@/components/ui/PillDropdown'
import { validateCapabilityName } from '@shared/capabilityValidation'
import { cn } from '@/lib/utils'
import { formStyles, type CapabilityFormProps } from './types'

interface AgentFormFields {
  name: string
  description: string
  model: string
  color: string
  body: string
}

type Props = CapabilityFormProps<AgentFormFields>

// ── Model options ────────────────────────────────────────────────────
const MODEL_OPTIONS = [
  { value: '', label: 'Default' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'opus', label: 'Opus' },
  { value: 'haiku', label: 'Haiku' },
] as const

export function AgentForm({ mode, saving, onSave, onCancel, onDirty, variant }: Props): React.JSX.Element {
  const s = formStyles(variant)
  const isModal = variant === 'modal'
  const initial =
    mode.type === 'edit'
      ? mode.initialData
      : { name: '', description: '', model: '', color: '', body: '' }
  const [name, setName] = useState(initial.name)
  const [description, setDescription] = useState(initial.description)
  const [model, setModel] = useState(initial.model)
  const [color, setColor] = useState(initial.color)
  const [body, setBody] = useState(initial.body)
  const [error, setError] = useState<string | null>(null)

  // Pill dropdown states (modal only)
  const [modelOpen, setModelOpen] = useState(false)
  const [colorOpen, setColorOpen] = useState(false)

  const markDirty = (): void => {
    onDirty?.(true)
  }

  const handleSave = (): void => {
    const nameError = validateCapabilityName(name)
    if (nameError) {
      setError(nameError)
      return
    }
    setError(null)
    onSave({ name: name.trim(), description, model, color, body })
  }

  const modelLabel = MODEL_OPTIONS.find((o) => o.value === model)?.label ?? 'Default'

  return (
    <div className="flex flex-col h-full">
      <div className={s.header}>
        {error && (
          <p className="text-xs text-red-500" role="alert">
            {error}
          </p>
        )}
        <div>
          <label htmlFor="agent-name" className={s.label}>
            Name
          </label>
          <input
            id="agent-name"
            name="agent-name"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              markDirty()
            }}
            disabled={mode.type === 'edit'}
            placeholder="agent-name…"
            aria-label="Name"
            autoFocus={isModal}
            autoComplete="off"
            spellCheck={false}
            className={`${s.name} disabled:opacity-50`}
          />
        </div>
        <div>
          <label htmlFor="agent-desc" className={s.label}>
            Description
          </label>
          <input
            id="agent-desc"
            name="agent-desc"
            type="text"
            value={description}
            onChange={(e) => {
              setDescription(e.target.value)
              markDirty()
            }}
            placeholder="What this agent does…"
            aria-label="Description"
            autoComplete="off"
            className={s.input}
          />
        </div>

        {/* Model + Color — inline grid in panel mode */}
        {!isModal && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="agent-model" className={s.label}>
                Model
              </label>
              <select
                id="agent-model"
                name="agent-model"
                value={model}
                onChange={(e) => {
                  setModel(e.target.value)
                  markDirty()
                }}
                aria-label="Model"
                className={s.select}
              >
                {MODEL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="agent-color" className={s.label}>
                Color
              </label>
              <input
                id="agent-color"
                name="agent-color"
                type="text"
                value={color}
                onChange={(e) => {
                  setColor(e.target.value)
                  markDirty()
                }}
                placeholder="#hex…"
                aria-label="Color"
                autoComplete="off"
                spellCheck={false}
                className={s.input}
              />
            </div>
          </div>
        )}
      </div>

      {/* CodeEditor */}
      <div className={`flex-1 min-h-0 flex flex-col ${isModal ? 'border-t border-[hsl(var(--border)/0.4)]' : ''}`}>
        {variant === 'inline' && (
          <div className="px-6 pb-2">
            <span className="block text-[11px] font-medium text-[hsl(var(--muted-foreground)/0.5)]">
              Content
            </span>
          </div>
        )}
        <div className={`flex-1 min-h-0 ${variant === 'inline' ? 'px-6 pb-2' : ''}`}>
          <CodeEditor
            value={body}
            language="markdown"
            onChange={(v) => {
              setBody(v)
              markDirty()
            }}
            label="Agent body editor"
          />
        </div>
      </div>

      {/* Footer */}
      <div className={s.footer}>
        {/* Model + Color pills — modal only */}
        {isModal && (
          <>
            {/* Model pill */}
            <PillDropdown
              open={modelOpen}
              onOpenChange={setModelOpen}
              trigger={
                <button
                  onClick={() => setModelOpen((prev) => !prev)}
                  className={PILL_TRIGGER}
                  aria-label="Select model"
                >
                  <Cpu className="w-3.5 h-3.5" />
                  {modelLabel}
                </button>
              }
            >
              {MODEL_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => {
                    setModel(opt.value)
                    setModelOpen(false)
                    markDirty()
                  }}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors',
                    model === opt.value
                      ? 'bg-[hsl(var(--primary)/0.08)]'
                      : 'hover:bg-[hsl(var(--foreground)/0.04)]'
                  )}
                >
                  <span className="flex-1">{opt.label}</span>
                  {model === opt.value && <Check className="w-3 h-3" />}
                </button>
              ))}
            </PillDropdown>

            {/* Color pill */}
            <PillDropdown
              open={colorOpen}
              onOpenChange={setColorOpen}
              trigger={
                <button
                  onClick={() => setColorOpen((prev) => !prev)}
                  className={PILL_TRIGGER}
                  aria-label="Set color"
                >
                  {color ? (
                    <span
                      className="w-3 h-3 rounded-full border border-[hsl(var(--border))]"
                      style={{ backgroundColor: color }}
                      aria-hidden="true"
                    />
                  ) : (
                    <Palette className="w-3.5 h-3.5" />
                  )}
                  {color || 'Color'}
                </button>
              }
            >
              <div className="px-3 py-2">
                <input
                  type="text"
                  value={color}
                  onChange={(e) => {
                    setColor(e.target.value)
                    markDirty()
                  }}
                  placeholder="#hex…"
                  aria-label="Color value"
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full text-xs bg-transparent border-none outline-none placeholder:text-[hsl(var(--muted-foreground))] text-[hsl(var(--foreground))]"
                />
              </div>
            </PillDropdown>
          </>
        )}

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
