// SPDX-License-Identifier: Apache-2.0

/**
 * Renders MCP server template options as form controls.
 *
 * Stateless — values and onChange are managed by the parent (CapabilityCreateModal).
 * Each option is rendered based on its type: boolean → Switch, string → input, select → dropdown.
 */

import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import type { MCPServerOption } from '@shared/types'

interface MCPTemplateOptionsProps {
  options: MCPServerOption[]
  values: Record<string, boolean | string>
  onChange: (optionId: string, value: boolean | string) => void
}

export function MCPTemplateOptions({
  options,
  values,
  onChange,
}: MCPTemplateOptionsProps): React.JSX.Element {
  return (
    <div className="space-y-1">
      {options.map((opt) => (
        <div
          key={opt.id}
          className="flex items-center justify-between gap-4 py-2 px-0.5"
        >
          {/* Label + description */}
          <div className="flex-1 min-w-0">
            <span className="text-sm text-[hsl(var(--foreground))]">
              {opt.label}
            </span>
            {opt.description && (
              <p className="text-[11px] text-[hsl(var(--muted-foreground)/0.55)] mt-0.5 leading-tight">
                {opt.description}
              </p>
            )}
          </div>

          {/* Control */}
          {opt.type === 'boolean' && (
            <Switch
              checked={(values[opt.id] as boolean) ?? (opt.defaultValue as boolean)}
              onChange={(v) => onChange(opt.id, v)}
              size="sm"
              label={opt.label}
            />
          )}

          {opt.type === 'string' && (
            <input
              type="text"
              value={(values[opt.id] as string) ?? (opt.defaultValue as string)}
              onChange={(e) => onChange(opt.id, e.target.value)}
              placeholder={opt.description}
              aria-label={opt.label}
              autoComplete="off"
              spellCheck={false}
              className={cn(
                'w-36 px-2 py-1 text-xs rounded-md font-mono',
                'bg-[hsl(var(--foreground)/0.02)] border border-[hsl(var(--border)/0.5)]',
                'outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
                'placeholder:text-[hsl(var(--muted-foreground)/0.35)]',
                'text-[hsl(var(--foreground))]',
              )}
            />
          )}

          {opt.type === 'select' && opt.choices && (
            <select
              value={(values[opt.id] as string) ?? (opt.defaultValue as string)}
              onChange={(e) => onChange(opt.id, e.target.value)}
              aria-label={opt.label}
              className={cn(
                'px-2 py-1 text-xs rounded-md',
                'bg-[hsl(var(--foreground)/0.02)] border border-[hsl(var(--border)/0.5)]',
                'outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
                'text-[hsl(var(--foreground))] cursor-pointer',
              )}
            >
              {opt.choices.map((choice) => (
                <option key={choice} value={choice}>
                  {choice}
                </option>
              ))}
            </select>
          )}
        </div>
      ))}
    </div>
  )
}
