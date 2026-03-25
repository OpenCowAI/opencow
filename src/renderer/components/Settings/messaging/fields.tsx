// SPDX-License-Identifier: Apache-2.0

/**
 * Shared form field primitives for messaging config panels.
 */

import { useState, useId } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'

// ── Text field ───────────────────────────────────────────────────────────────

interface TextFieldProps {
  label: string
  value: string
  placeholder: string
  type?: string
  disabled?: boolean
  onChange: (value: string) => void
  suffix?: React.ReactNode
}

export function TextField({
  label,
  value,
  placeholder,
  type = 'text',
  disabled,
  onChange,
  suffix,
}: TextFieldProps): React.JSX.Element {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium mb-1">{label}</label>
      <div className="relative">
        <input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[hsl(var(--ring))] disabled:opacity-50"
        />
        {suffix && (
          <div className="absolute right-2 top-1/2 -translate-y-1/2">{suffix}</div>
        )}
      </div>
    </div>
  )
}

// ── Secret field (text field with show/hide toggle) ──────────────────────────

interface SecretFieldProps {
  label: string
  value: string
  placeholder: string
  disabled?: boolean
  onChange: (value: string) => void
}

export function SecretField({
  label,
  value,
  placeholder,
  disabled,
  onChange,
}: SecretFieldProps): React.JSX.Element {
  const { t } = useTranslation('settings')
  const [visible, setVisible] = useState(false)

  return (
    <TextField
      label={label}
      value={value}
      placeholder={placeholder}
      type={visible ? 'text' : 'password'}
      disabled={disabled}
      onChange={onChange}
      suffix={
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
          aria-label={visible ? t('messaging.hideSecret') : t('messaging.showSecret')}
        >
          {visible
            ? <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
            : <Eye className="h-3.5 w-3.5" aria-hidden="true" />
          }
        </button>
      }
    />
  )
}
