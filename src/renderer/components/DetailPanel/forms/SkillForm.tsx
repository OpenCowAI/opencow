// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react'
import { CodeEditor } from '@/components/ui/code-editor'
import { validateCapabilityName } from '@shared/capabilityValidation'
import { formStyles, type CapabilityFormProps } from './types'

interface SkillFormFields {
  name: string
  description: string
  body: string
}

type Props = CapabilityFormProps<SkillFormFields>

export function SkillForm({ mode, saving, onSave, onCancel, onDirty, variant }: Props): React.JSX.Element {
  const s = formStyles(variant)
  const initial = mode.type === 'edit' ? mode.initialData : { name: '', description: '', body: '' }
  const [name, setName] = useState(initial.name)
  const [description, setDescription] = useState(initial.description)
  const [body, setBody] = useState(initial.body)
  const [error, setError] = useState<string | null>(null)

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
    onSave({ name: name.trim(), description, body })
  }

  return (
    <div className="flex flex-col h-full">
      <div className={s.header}>
        {error && (
          <p className="text-xs text-red-500" role="alert">
            {error}
          </p>
        )}
        <div>
          <label htmlFor="skill-name" className={s.label}>
            Name
          </label>
          <input
            id="skill-name"
            name="skill-name"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              markDirty()
            }}
            disabled={mode.type === 'edit'}
            placeholder="skill-name…"
            aria-label="Name"
            autoFocus={variant === 'modal'}
            autoComplete="off"
            spellCheck={false}
            className={`${s.name} disabled:opacity-50`}
          />
        </div>
        <div>
          <label htmlFor="skill-desc" className={s.label}>
            Description
          </label>
          <input
            id="skill-desc"
            name="skill-desc"
            type="text"
            value={description}
            onChange={(e) => {
              setDescription(e.target.value)
              markDirty()
            }}
            placeholder="What this skill does…"
            aria-label="Description"
            autoComplete="off"
            className={s.input}
          />
        </div>
      </div>
      <div className={`flex-1 min-h-0 flex flex-col ${variant === 'modal' ? 'border-t border-[hsl(var(--border)/0.4)]' : ''}`}>
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
            label="Skill body editor"
          />
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
