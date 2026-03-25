// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { validateCapabilityName } from '@shared/capabilityValidation'
import { formStyles, type CapabilityFormProps } from './types'
import { SectionDivider } from './SectionDivider'

interface MCPServerFormFields {
  name: string
  type: string
  command: string
  args: string[]
  env: Record<string, string>
  configFile: '.mcp.json' | '.claude.json'
}

interface Props extends CapabilityFormProps<MCPServerFormFields> {
  /** Optional slot for template options, rendered after Environment Variables */
  templateOptionsSlot?: React.ReactNode
}

export function MCPServerForm({
  mode,
  saving,
  onSave,
  onCancel,
  onDirty,
  variant,
  templateOptionsSlot,
}: Props): React.JSX.Element {
  const { t } = useTranslation('sessions')
  const s = formStyles(variant)
  const isModal = variant === 'modal'
  const isFromTemplate = mode.type === 'create-from-template'
  const initial =
    mode.type === 'edit'
      ? mode.initialData
      : isFromTemplate
        ? {
            name: mode.initialData.name ?? '',
            type: mode.initialData.type ?? 'stdio',
            command: mode.initialData.command ?? '',
            args: mode.initialData.args ?? ([] as string[]),
            env: mode.initialData.env ?? ({} as Record<string, string>),
            configFile: mode.initialData.configFile ?? ('.mcp.json' as const),
          }
        : {
            name: '',
            type: 'stdio',
            command: '',
            args: [] as string[],
            env: {} as Record<string, string>,
            configFile: '.mcp.json' as const,
          }
  const [name, setName] = useState(initial.name)
  const [type, setType] = useState(initial.type)
  const [command, setCommand] = useState(initial.command)
  const [args, setArgs] = useState<string[]>(initial.args)
  const [envEntries, setEnvEntries] = useState<Array<{ key: string; value: string }>>(
    Object.entries(initial.env).map(([key, value]) => ({ key, value }))
  )
  const [configFile, setConfigFile] = useState<'.mcp.json' | '.claude.json'>(initial.configFile)
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
    if (!command.trim()) {
      setError('Command is required')
      return
    }
    setError(null)
    const env: Record<string, string> = {}
    for (const entry of envEntries) {
      if (entry.key.trim()) env[entry.key.trim()] = entry.value
    }
    onSave({
      name: name.trim(),
      type,
      command: command.trim(),
      args: args.filter((a) => a.trim()),
      env,
      configFile
    })
  }

  // ── Shared inline select wrapper for modal (custom chevron) ──
  const ModalSelect = ({
    id,
    value,
    onChange,
    label,
    children,
  }: {
    id: string
    value: string
    onChange: (v: string) => void
    label: string
    children: React.ReactNode
  }): React.JSX.Element => (
    <div className="relative flex-1">
      <label htmlFor={id} className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))] opacity-60 mb-0.5 block">
        {label}
      </label>
      <select
        id={id}
        name={id}
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          markDirty()
        }}
        aria-label={label}
        className="w-full py-1 pr-6 text-sm bg-transparent border-none outline-none text-[hsl(var(--foreground))] appearance-none cursor-pointer"
      >
        {children}
      </select>
      <ChevronDown
        className="absolute right-0 bottom-1.5 w-3.5 h-3.5 text-[hsl(var(--muted-foreground))] pointer-events-none"
        aria-hidden="true"
      />
    </div>
  )

  return (
    <div className="flex flex-col h-full">
      <div className={`${isModal ? 'px-5 py-4' : 'p-4'} space-y-3 flex-1 overflow-y-auto`}>
        {error && (
          <p className="text-xs text-red-500" role="alert">
            {error}
          </p>
        )}

        {/* Name */}
        <div>
          <label htmlFor="mcp-name" className={s.label}>
            Name
          </label>
          <input
            id="mcp-name"
            name="mcp-name"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              markDirty()
            }}
            disabled={mode.type === 'edit'}
            placeholder="server-name…"
            aria-label="Name"
            autoFocus={isModal && !isFromTemplate}
            autoComplete="off"
            spellCheck={false}
            className={`${s.name} disabled:opacity-50`}
          />
          {isFromTemplate && initial.name && (
            <p className="text-[10px] text-[hsl(var(--muted-foreground)/0.4)] mt-1">
              {t('capabilityCenter.mcpTemplates.nameHint', 'Changing this name may affect tool integration behavior')}
            </p>
          )}
        </div>

        {/* ── Connection Config ── */}
        {isModal ? (
          <>
            <SectionDivider label={t('capabilityCenter.formSections.connectionConfig', 'Connection')} />
            <div className="flex gap-4">
              <ModalSelect
                id="mcp-config"
                value={configFile}
                onChange={(v) => setConfigFile(v as '.mcp.json' | '.claude.json')}
                label="Config File"
              >
                <option value=".mcp.json">.mcp.json</option>
                <option value=".claude.json">.claude.json</option>
              </ModalSelect>
              <ModalSelect
                id="mcp-type"
                value={type}
                onChange={setType}
                label="Transport"
              >
                <option value="stdio">stdio</option>
                <option value="sse">sse</option>
                <option value="http">http</option>
              </ModalSelect>
            </div>
            <div>
              <label htmlFor="mcp-command" className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))] opacity-60 mb-0.5 block">
                Command
              </label>
              <input
                id="mcp-command"
                name="mcp-command"
                type="text"
                value={command}
                onChange={(e) => {
                  setCommand(e.target.value)
                  markDirty()
                }}
                placeholder="npx or /path/to/binary…"
                aria-label="Command"
                autoComplete="off"
                spellCheck={false}
                className="w-full py-1 text-sm bg-transparent border-none outline-none placeholder:text-[hsl(var(--muted-foreground))] text-[hsl(var(--foreground))] font-mono"
              />
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="mcp-config" className={s.label}>
                  Config File
                </label>
                <select
                  id="mcp-config"
                  name="mcp-config"
                  value={configFile}
                  onChange={(e) => {
                    setConfigFile(e.target.value as '.mcp.json' | '.claude.json')
                    markDirty()
                  }}
                  aria-label="Config File"
                  className={s.select}
                >
                  <option value=".mcp.json">.mcp.json</option>
                  <option value=".claude.json">.claude.json</option>
                </select>
              </div>
              <div>
                <label htmlFor="mcp-type" className={s.label}>
                  Type
                </label>
                <select
                  id="mcp-type"
                  name="mcp-type"
                  value={type}
                  onChange={(e) => {
                    setType(e.target.value)
                    markDirty()
                  }}
                  aria-label="Type"
                  className={s.select}
                >
                  <option value="stdio">stdio</option>
                  <option value="sse">sse</option>
                  <option value="http">http</option>
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="mcp-command" className={s.label}>
                Command
              </label>
              <input
                id="mcp-command"
                name="mcp-command"
                type="text"
                value={command}
                onChange={(e) => {
                  setCommand(e.target.value)
                  markDirty()
                }}
                placeholder="npx or /path/to/binary…"
                aria-label="Command"
                autoComplete="off"
                spellCheck={false}
                className={s.input}
              />
            </div>
          </>
        )}

        {/* ── Arguments ── */}
        {isModal ? (
          <SectionDivider
            label={t('capabilityCenter.formSections.launchArgs', 'Arguments')}
            action={
              <button
                type="button"
                onClick={() => {
                  setArgs([...args, ''])
                  markDirty()
                }}
                aria-label="Add Argument"
                className="flex items-center gap-1 text-[10px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
              >
                <Plus className="h-3 w-3" aria-hidden="true" />
                Add
              </button>
            }
          />
        ) : (
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Arguments</span>
            <button
              type="button"
              onClick={() => {
                setArgs([...args, ''])
                markDirty()
              }}
              aria-label="Add Argument"
              className="p-1 rounded-md hover:bg-[hsl(var(--foreground)/0.04)] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        )}
        <div className="space-y-2">
          {args.map((arg, i) => (
            <div
              key={i}
              className={cn(
                'flex gap-2 items-center',
                isModal && 'bg-[hsl(var(--foreground)/0.02)] rounded-lg px-3 py-2'
              )}
            >
              <input
                name={`mcp-arg-${i}`}
                type="text"
                value={arg}
                onChange={(e) => {
                  const a = [...args]
                  a[i] = e.target.value
                  setArgs(a)
                  markDirty()
                }}
                placeholder={`arg ${i + 1}…`}
                aria-label={`Argument ${i + 1}`}
                autoComplete="off"
                spellCheck={false}
                className={cn(
                  'flex-1 text-sm outline-none',
                  isModal
                    ? 'bg-transparent border-none placeholder:text-[hsl(var(--muted-foreground))] text-[hsl(var(--foreground))] font-mono'
                    : 'px-2 py-1.5 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]'
                )}
              />
              <button
                type="button"
                onClick={() => {
                  setArgs(args.filter((_, j) => j !== i))
                  markDirty()
                }}
                aria-label={`Remove Argument ${i + 1}`}
                className="p-1 rounded-md hover:bg-red-500/10 text-[hsl(var(--muted-foreground))] hover:text-red-500 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>

        {/* ── Environment Variables ── */}
        {isModal ? (
          <SectionDivider
            label={t('capabilityCenter.formSections.envVars', 'Environment Variables')}
            action={
              <button
                type="button"
                onClick={() => {
                  setEnvEntries([...envEntries, { key: '', value: '' }])
                  markDirty()
                }}
                aria-label="Add Environment Variable"
                className="flex items-center gap-1 text-[10px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
              >
                <Plus className="h-3 w-3" aria-hidden="true" />
                Add
              </button>
            }
          />
        ) : (
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Environment Variables</span>
            <button
              type="button"
              onClick={() => {
                setEnvEntries([...envEntries, { key: '', value: '' }])
                markDirty()
              }}
              aria-label="Add Environment Variable"
              className="p-1 rounded-md hover:bg-[hsl(var(--foreground)/0.04)] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        )}
        <div className="space-y-2">
          {envEntries.map((entry, i) => (
            <div
              key={i}
              className={cn(
                'flex gap-2 items-center',
                isModal && 'bg-[hsl(var(--foreground)/0.02)] rounded-lg px-3 py-2'
              )}
            >
              <input
                name={`mcp-env-key-${i}`}
                type="text"
                value={entry.key}
                onChange={(e) => {
                  const u = [...envEntries]
                  u[i] = { ...u[i], key: e.target.value }
                  setEnvEntries(u)
                  markDirty()
                }}
                placeholder="KEY…"
                aria-label={`Env key ${i + 1}`}
                autoComplete="off"
                spellCheck={false}
                className={cn(
                  'text-sm outline-none',
                  isModal
                    ? 'w-1/3 bg-transparent border-none placeholder:text-[hsl(var(--muted-foreground))] text-[hsl(var(--foreground))] font-mono'
                    : 'w-1/3 px-2 py-1.5 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]'
                )}
              />
              {isModal && (
                <span className="text-xs text-[hsl(var(--muted-foreground))] opacity-40">=</span>
              )}
              <input
                name={`mcp-env-val-${i}`}
                type="text"
                value={entry.value}
                onChange={(e) => {
                  const u = [...envEntries]
                  u[i] = { ...u[i], value: e.target.value }
                  setEnvEntries(u)
                  markDirty()
                }}
                placeholder="value…"
                aria-label={`Env value ${i + 1}`}
                autoComplete="off"
                className={cn(
                  'flex-1 text-sm outline-none',
                  isModal
                    ? 'bg-transparent border-none placeholder:text-[hsl(var(--muted-foreground))] text-[hsl(var(--foreground))]'
                    : 'px-2 py-1.5 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]'
                )}
              />
              <button
                type="button"
                onClick={() => {
                  setEnvEntries(envEntries.filter((_, j) => j !== i))
                  markDirty()
                }}
                aria-label={`Remove Env ${i + 1}`}
                className="p-1 rounded-md hover:bg-red-500/10 text-[hsl(var(--muted-foreground))] hover:text-red-500 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>

        {/* Template options slot (only when creating from template) */}
        {templateOptionsSlot}
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
