// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react'
import { CodeEditor } from '@/components/ui/code-editor'
import { validateCapabilityName } from '@shared/capabilityValidation'
import { formStyles, type CapabilityFormProps } from './types'

interface CommandFormFields {
  name: string
  description: string
  argumentHint: string
  body: string
}

type Props = CapabilityFormProps<CommandFormFields>

export function CommandForm({ mode, saving, onSave, onCancel, onDirty, variant }: Props): React.JSX.Element {
  const s = formStyles(variant)
  const initial =
    mode.type === 'edit'
      ? mode.initialData
      : { name: '', description: '', argumentHint: '', body: '' }
  const [name, setName] = useState(initial.name)
  const [description, setDescription] = useState(initial.description)
  const [argumentHint, setArgumentHint] = useState(initial.argumentHint)
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
    onSave({ name: name.trim(), description, argumentHint, body })
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
          <label htmlFor="cmd-name" className={s.label}>
            Name
          </label>
          <input
            id="cmd-name"
            name="cmd-name"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              markDirty()
            }}
            disabled={mode.type === 'edit'}
            placeholder="command-name…"
            aria-label="Name"
            autoFocus={variant === 'modal'}
            autoComplete="off"
            spellCheck={false}
            className={`${s.name} disabled:opacity-50`}
          />
        </div>
        <div>
          <label htmlFor="cmd-desc" className={s.label}>
            Description
          </label>
          <input
            id="cmd-desc"
            name="cmd-desc"
            type="text"
            value={description}
            onChange={(e) => {
              setDescription(e.target.value)
              markDirty()
            }}
            placeholder="What this command does…"
            aria-label="Description"
            autoComplete="off"
            className={s.input}
          />
        </div>
        <div>
          <label htmlFor="cmd-hint" className={s.label}>
            Argument Hint
          </label>
          <input
            id="cmd-hint"
            name="cmd-hint"
            type="text"
            value={argumentHint}
            onChange={(e) => {
              setArgumentHint(e.target.value)
              markDirty()
            }}
            placeholder="<arg1> [arg2]…"
            aria-label="Argument Hint"
            autoComplete="off"
            spellCheck={false}
            className={variant === 'modal'
              ? 'w-full font-mono text-xs bg-transparent border-none outline-none placeholder:text-[hsl(var(--muted-foreground))] text-[hsl(var(--foreground))] opacity-70'
              : s.input
            }
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
            label="Command body editor"
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
