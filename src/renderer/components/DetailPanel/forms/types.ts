// SPDX-License-Identifier: Apache-2.0

/**
 * Generic form props shared by all capability forms.
 * Uses discriminated union for mode to ensure initialData
 * is always present in edit mode and absent in create mode.
 */
export type FormMode<T> =
  | { type: 'create' }
  | { type: 'create-from-template'; initialData: Partial<T>; templateId: string }
  | { type: 'edit'; initialData: T }

export type FormVariant = 'panel' | 'modal' | 'inline'

export interface CapabilityFormProps<T> {
  mode: FormMode<T>
  saving: boolean
  onSave: (data: T) => void
  onCancel: () => void
  onDirty?: (dirty: boolean) => void
  /** Visual variant: 'panel' (default, bordered) or 'modal' (IssueFormModal-like, borderless) */
  variant?: FormVariant
}

// ── Shared style helpers ─────────────────────────────────────────────

/** Standard bordered input for panel / borderless for modal */
const INPUT_PANEL =
  'w-full px-2 py-1.5 text-sm rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]'
const INPUT_MODAL =
  'w-full text-sm bg-transparent border-none outline-none placeholder:text-[hsl(var(--muted-foreground))] text-[hsl(var(--foreground))]'

/** Name field — larger text in modal mode */
const NAME_PANEL = INPUT_PANEL
const NAME_MODAL =
  'w-full text-lg font-medium bg-transparent border-none outline-none placeholder:text-[hsl(var(--muted-foreground))] text-[hsl(var(--foreground))]'

/** Select element */
const SELECT_PANEL =
  'w-full px-2 py-1.5 text-sm rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]'
const SELECT_MODAL =
  'w-full px-0 py-1 text-sm bg-transparent border-none outline-none text-[hsl(var(--foreground))] cursor-pointer'

/** Label — visible in panel, sr-only in modal */
const LABEL_PANEL = 'block text-xs font-medium mb-1'
const LABEL_MODAL = 'sr-only'

/** Header section */
const HEADER_PANEL = 'p-4 space-y-3 border-b border-[hsl(var(--border))]'
const HEADER_MODAL = 'px-5 py-4 space-y-3'

/** Footer section */
const FOOTER_PANEL = 'flex justify-end gap-2 p-3 border-t border-[hsl(var(--border))]'
const FOOTER_MODAL = 'flex items-center gap-2 px-5 py-3 border-t border-[hsl(var(--border))]'

/** Cancel button */
const CANCEL_PANEL =
  'px-3 py-1.5 text-sm rounded-md border border-[hsl(var(--border))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]'
const CANCEL_MODAL =
  'px-4 py-1.5 text-xs font-medium rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]'

/** Save button */
const SAVE_PANEL =
  'px-3 py-1.5 text-sm rounded-md font-medium bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90 transition-colors disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]'
const SAVE_MODAL =
  'px-4 py-1.5 text-xs font-medium rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90 disabled:opacity-50 transition-opacity'

export interface FormStyles {
  input: string
  name: string
  select: string
  label: string
  header: string
  footer: string
  cancel: string
  save: string
}

const PANEL_STYLES: FormStyles = {
  input: INPUT_PANEL,
  name: NAME_PANEL,
  select: SELECT_PANEL,
  label: LABEL_PANEL,
  header: HEADER_PANEL,
  footer: FOOTER_PANEL,
  cancel: CANCEL_PANEL,
  save: SAVE_PANEL,
}

const MODAL_STYLES: FormStyles = {
  input: INPUT_MODAL,
  name: NAME_MODAL,
  select: SELECT_MODAL,
  label: LABEL_MODAL,
  header: HEADER_MODAL,
  footer: FOOTER_MODAL,
  cancel: CANCEL_MODAL,
  save: SAVE_MODAL,
}

/** Inline: full-width in-page experience — visible labels, consistent containers, generous spacing */
const INPUT_INLINE =
  'w-full px-3 py-2 text-sm rounded-lg border border-[hsl(var(--border)/0.5)] bg-[hsl(var(--foreground)/0.02)] outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] placeholder:text-[hsl(var(--muted-foreground)/0.45)]'
const NAME_INLINE =
  'w-full px-3 py-2.5 text-base font-medium rounded-lg border border-[hsl(var(--border)/0.5)] bg-[hsl(var(--foreground)/0.02)] outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] placeholder:text-[hsl(var(--muted-foreground)/0.45)] text-[hsl(var(--foreground))]'
const SELECT_INLINE =
  'w-full px-3 py-2 text-sm rounded-lg border border-[hsl(var(--border)/0.5)] bg-[hsl(var(--foreground)/0.02)] text-[hsl(var(--foreground))] outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] cursor-pointer'
const LABEL_INLINE =
  'block text-[11px] font-medium text-[hsl(var(--muted-foreground)/0.5)] mb-1.5'
const HEADER_INLINE = 'px-6 pt-5 pb-4 space-y-4'
const FOOTER_INLINE =
  'flex items-center gap-2 px-6 py-3 border-t border-[hsl(var(--border)/0.4)]'
const CANCEL_INLINE = CANCEL_MODAL
const SAVE_INLINE = SAVE_MODAL

const INLINE_STYLES: FormStyles = {
  input: INPUT_INLINE,
  name: NAME_INLINE,
  select: SELECT_INLINE,
  label: LABEL_INLINE,
  header: HEADER_INLINE,
  footer: FOOTER_INLINE,
  cancel: CANCEL_INLINE,
  save: SAVE_INLINE,
}

/** Get the style set for the given variant (defaults to 'panel') */
export function formStyles(variant: FormVariant = 'panel'): FormStyles {
  if (variant === 'modal') return MODAL_STYLES
  if (variant === 'inline') return INLINE_STYLES
  return PANEL_STYLES
}
