// SPDX-License-Identifier: Apache-2.0

/**
 * Template selector for MCP Server creation.
 *
 * Renders a card grid of available templates. When a template with variants
 * is selected, shows an inline variant picker before confirming.
 */

import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Globe, Wrench, ChevronRight, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ALL_MCP_TEMPLATES } from '@shared/mcpTemplates'
import type { MCPServerTemplate } from '@shared/types'

// ── Icon resolver ─────────────────────────────────────────────────────

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Globe,
  Wrench,
}

function TemplateIcon({
  name,
  className,
}: {
  name: string
  className?: string
}): React.JSX.Element {
  const Icon = ICON_MAP[name]
  if (Icon) return <Icon className={className} />
  return <Globe className={className} />
}

// ── Props ─────────────────────────────────────────────────────────────

interface MCPTemplateSelectorProps {
  onSelect: (template: MCPServerTemplate, variantId?: string) => void
  onCancel: () => void
}

// ── Component ─────────────────────────────────────────────────────────

export function MCPTemplateSelector({
  onSelect,
  onCancel,
}: MCPTemplateSelectorProps): React.JSX.Element {
  const { t } = useTranslation('sessions')

  // Expanded template for variant selection (null = none expanded)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [selectedVariant, setSelectedVariant] = useState<string | undefined>(undefined)

  const handleCardClick = useCallback(
    (template: MCPServerTemplate) => {
      // No variants or Custom → select immediately
      if (template.variants.length <= 1) {
        onSelect(template, template.variants[0]?.id)
        return
      }

      // Toggle expand for variant selection
      if (expandedId === template.id) {
        setExpandedId(null)
        setSelectedVariant(undefined)
      } else {
        setExpandedId(template.id)
        setSelectedVariant(template.variants[0]?.id)
      }
    },
    [expandedId, onSelect],
  )

  const handleVariantConfirm = useCallback(
    (template: MCPServerTemplate) => {
      onSelect(template, selectedVariant)
    },
    [onSelect, selectedVariant],
  )

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-5 pt-4 pb-2">
        <p className="text-xs text-[hsl(var(--muted-foreground)/0.5)]">
          {t('capabilityCenter.mcpTemplates.subtitle', 'Select a pre-configured template or start from scratch')}
        </p>
      </div>

      {/* Template cards */}
      <div className="flex-1 overflow-y-auto px-5 py-2 space-y-2.5">
        {ALL_MCP_TEMPLATES.map((template) => {
          const isExpanded = expandedId === template.id
          const isCustom = template.id === '__custom__'

          return (
            <div key={template.id} className="group">
              {/* Card */}
              <button
                type="button"
                onClick={() => handleCardClick(template)}
                className={cn(
                  'w-full flex items-center gap-3.5 px-4 py-3 rounded-xl text-left',
                  'border transition-all outline-none',
                  'focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
                  isExpanded
                    ? 'border-[hsl(var(--primary)/0.3)] bg-[hsl(var(--primary)/0.03)]'
                    : 'border-[hsl(var(--border)/0.5)] hover:border-[hsl(var(--border))] hover:bg-[hsl(var(--foreground)/0.015)]',
                )}
              >
                {/* Icon */}
                <div
                  className={cn(
                    'flex items-center justify-center w-9 h-9 rounded-lg shrink-0',
                    isCustom
                      ? 'bg-[hsl(var(--muted-foreground)/0.08)]'
                      : 'bg-[hsl(var(--primary)/0.08)]',
                  )}
                >
                  <TemplateIcon
                    name={template.icon}
                    className={cn(
                      'w-4.5 h-4.5',
                      isCustom
                        ? 'text-[hsl(var(--muted-foreground)/0.5)]'
                        : 'text-[hsl(var(--primary)/0.7)]',
                    )}
                  />
                </div>

                {/* Text */}
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-[hsl(var(--foreground))]">
                    {template.name}
                  </span>
                  <p className="text-[11px] text-[hsl(var(--muted-foreground)/0.55)] mt-0.5 leading-tight truncate">
                    {template.description}
                  </p>
                </div>

                {/* Arrow */}
                <ChevronRight
                  className={cn(
                    'w-4 h-4 text-[hsl(var(--muted-foreground)/0.3)] transition-transform shrink-0',
                    isExpanded && 'rotate-90',
                  )}
                  aria-hidden="true"
                />
              </button>

              {/* Variant picker (expanded) */}
              {isExpanded && template.variants.length > 1 && (
                <div className="mt-1.5 ml-[52px] space-y-1 animate-in fade-in slide-in-from-top-1 duration-150">
                  {template.variants.map((variant) => {
                    const isActive = selectedVariant === variant.id
                    return (
                      <button
                        key={variant.id}
                        type="button"
                        onClick={() => setSelectedVariant(variant.id)}
                        className={cn(
                          'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left',
                          'transition-colors outline-none',
                          'focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
                          isActive
                            ? 'bg-[hsl(var(--primary)/0.06)]'
                            : 'hover:bg-[hsl(var(--foreground)/0.02)]',
                        )}
                      >
                        {/* Radio indicator */}
                        <div
                          className={cn(
                            'w-3.5 h-3.5 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors',
                            isActive
                              ? 'border-[hsl(var(--primary)/0.7)]'
                              : 'border-[hsl(var(--muted-foreground)/0.2)]',
                          )}
                        >
                          {isActive && (
                            <div className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--primary)/0.7)]" />
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-medium text-[hsl(var(--foreground))]">
                            {variant.label}
                          </span>
                          <p className="text-[10px] text-[hsl(var(--muted-foreground)/0.5)] leading-tight">
                            {variant.description}
                          </p>
                        </div>
                      </button>
                    )
                  })}

                  {/* Confirm button */}
                  <div className="pt-1.5">
                    <button
                      type="button"
                      onClick={() => handleVariantConfirm(template)}
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium',
                        'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]',
                        'hover:opacity-90 transition-opacity',
                        'outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
                      )}
                    >
                      <Check className="w-3 h-3" aria-hidden="true" />
                      {t('capabilityCenter.mcpTemplates.confirmVariant', 'Continue')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 px-5 py-3 border-t border-[hsl(var(--border))]">
        <div className="flex-1" />
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-1.5 text-xs font-medium rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
        >
          {t('common:cancel', 'Cancel')}
        </button>
      </div>
    </div>
  )
}
