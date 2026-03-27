// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Brain, Check, X } from 'lucide-react'
import { useMemoryStore, type PendingItem, type PendingMerge } from '@/stores/memoryStore'
import { CATEGORY_ICON_MAP } from '@/components/MemoryView/memoryCategoryConfig'
import { getAppAPI } from '@/windowAPI'
import { cn } from '@/lib/utils'
import type { MemoryCategory } from '@shared/types'

const AUTO_CONFIRM_SECONDS = 10

/**
 * MemoryToast — minimal confirmation card in the top-right corner.
 * Shows one item at a time (new memory or merge proposal).
 * Auto-confirms after timeout. Countdown pauses on hover or while editing.
 */
export function MemoryToast() {
  const { t } = useTranslation('memory')
  const shiftPendingItem = useMemoryStore((s) => s.shiftPendingItem)
  const confirmMemory = useMemoryStore((s) => s.confirmMemory)
  const rejectMemory = useMemoryStore((s) => s.rejectMemory)
  const editAndConfirmMemory = useMemoryStore((s) => s.editAndConfirmMemory)
  const confirmMerge = useMemoryStore((s) => s.confirmMerge)
  const rejectMerge = useMemoryStore((s) => s.rejectMerge)
  const pendingCount = useMemoryStore((s) => s.pendingItems.length)

  // Current item being displayed (new memory or merge)
  const [currentItem, setCurrentItem] = useState<PendingItem | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [secondsLeft, setSecondsLeft] = useState(AUTO_CONFIRM_SECONDS)
  const [exiting, setExiting] = useState<'confirm' | 'dismiss' | null>(null)
  const [isHovered, setIsHovered] = useState(false)

  const isProcessingRef = useRef(false)
  const mountedRef = useRef(true)
  const activeTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const currentItemRef = useRef(currentItem)
  const isEditingRef = useRef(isEditing)
  const editContentRef = useRef(editContent)
  const editTextareaRef = useRef<HTMLTextAreaElement>(null)
  currentItemRef.current = currentItem
  isEditingRef.current = isEditing
  editContentRef.current = editContent

  // Auto-resize textarea to fit content (min 3 lines, max 8 lines)
  useLayoutEffect(() => {
    const el = editTextareaRef.current
    if (!el || !isEditing) return
    el.style.height = 'auto'
    const lineHeight = 18 // text-xs leading-relaxed ≈ 18px
    const minHeight = lineHeight * 3 // 3 lines
    const maxHeight = lineHeight * 8 // 8 lines
    el.style.height = `${Math.min(Math.max(el.scrollHeight, minHeight), maxHeight)}px`
  }, [editContent, isEditing])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      for (const id of activeTimeoutsRef.current) clearTimeout(id)
      activeTimeoutsRef.current = []
    }
  }, [])

  const safeTimeout = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      activeTimeoutsRef.current = activeTimeoutsRef.current.filter((t) => t !== id)
      if (mountedRef.current) fn()
    }, ms)
    activeTimeoutsRef.current.push(id)
  }, [])

  // ── Helpers to extract info from current item ──

  const getContent = (item: PendingItem): string =>
    item.kind === 'new' ? item.memory.content : item.merge.newContent

  const getCategory = (item: PendingItem): MemoryCategory =>
    item.kind === 'new' ? item.memory.category : item.merge.category

  // ── Dequeue next ──

  useEffect(() => {
    if (currentItem === null && pendingCount > 0) {
      const next = shiftPendingItem()
      if (next) {
        setCurrentItem(next)
        setEditContent(getContent(next))
        setSecondsLeft(AUTO_CONFIRM_SECONDS)
        setIsEditing(false)
        setIsHovered(false)
        setExiting(null)
        isProcessingRef.current = false
      }
    }
  }, [currentItem, pendingCount, shiftPendingItem])

  // ── Countdown — pauses on hover or editing ──

  const paused = isHovered || isEditing
  useEffect(() => {
    if (!currentItem || paused) return
    const timer = setInterval(() => {
      setSecondsLeft((prev) => Math.max(0, prev - 1))
    }, 1000)
    return () => clearInterval(timer)
  }, [currentItem, paused])

  // ── Confirm handler ──

  const handleConfirm = useCallback(() => {
    const item = currentItemRef.current
    if (!item || isProcessingRef.current) return
    isProcessingRef.current = true
    setExiting('confirm')
    safeTimeout(() => {
      const editing = isEditingRef.current
      const content = editContentRef.current

      if (item.kind === 'new') {
        const mem = item.memory
        if (editing && content !== mem.content) {
          void editAndConfirmMemory(mem.id, content)
        } else {
          void confirmMemory(mem.id)
        }
      } else {
        // Merge: if user edited the new content, update the pending record first (lightweight IPC, no list reload)
        if (editing && content !== item.merge.newContent) {
          const api = getAppAPI()
          void api['memory:update'](item.merge.pendingId, { content }).then(() =>
            confirmMerge(item.merge.pendingId, item.merge.targetId),
          )
        } else {
          void confirmMerge(item.merge.pendingId, item.merge.targetId)
        }
      }
      setCurrentItem(null)
    }, 200)
  }, [confirmMemory, editAndConfirmMemory, confirmMerge, safeTimeout])

  // ── Auto-confirm at 0 ──

  useEffect(() => {
    if (secondsLeft === 0 && currentItem && !paused && !exiting) {
      handleConfirm()
    }
  }, [secondsLeft, currentItem, paused, exiting, handleConfirm])

  // ── Dismiss handler ──

  const handleDismiss = useCallback(() => {
    const item = currentItemRef.current
    if (!item || isProcessingRef.current) return
    isProcessingRef.current = true
    setExiting('dismiss')
    safeTimeout(() => {
      if (item.kind === 'new') {
        void rejectMemory(item.memory.id)
      } else {
        void rejectMerge(item.merge.pendingId)
      }
      setCurrentItem(null)
    }, 200)
  }, [rejectMemory, rejectMerge, safeTimeout])

  if (!currentItem) return null

  const isMerge = currentItem.kind === 'merge'
  const category = getCategory(currentItem)
  const CatIcon = CATEGORY_ICON_MAP.get(category)
  const timerPercent = (secondsLeft / AUTO_CONFIRM_SECONDS) * 100

  return (
    <div
      className={cn(
        'fixed top-4 right-4 z-50 w-[320px]',
        'bg-[hsl(var(--popover))] text-[hsl(var(--popover-foreground))]',
        'border border-[hsl(var(--border))] rounded-xl shadow-lg overflow-hidden',
        'motion-safe:transition-all motion-safe:duration-200',
        exiting && 'opacity-0 translate-x-4 transition-all duration-200',
        !exiting && 'animate-in fade-in slide-in-from-right-4 duration-300',
      )}
      role="alert"
      aria-label={isMerge ? t('toast.mergeHeader') : t('toast.header')}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Timer bar (thin, top) */}
      <div className="h-0.5 w-full bg-[hsl(var(--muted))]">
        <div
          className="h-full bg-[hsl(var(--primary))] transition-all duration-1000 ease-linear"
          style={{ width: `${timerPercent}%` }}
        />
      </div>

      {/* Body */}
      <div className="px-4 py-3">
        {/* Header row */}
        <div className="flex items-center gap-2 mb-2">
          <Brain className="h-3.5 w-3.5 text-[hsl(var(--primary))]" aria-hidden="true" />
          <span className="text-[11px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider flex-1">
            {isMerge ? t('toast.mergeHeader') : t('toast.header')}
          </span>
          <span className="text-[10px] text-[hsl(var(--muted-foreground)/0.5)] tabular-nums">
            {secondsLeft}s
          </span>
        </div>

        {/* Content */}
        {isEditing ? (
          <textarea
            ref={editTextareaRef}
            className="w-full rounded-md border border-[hsl(var(--border))] bg-transparent px-2.5 py-1.5 text-xs leading-relaxed text-[hsl(var(--foreground))] resize-none overflow-y-auto focus:outline-none focus:ring-1 focus:ring-[hsl(var(--ring))]"
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            autoFocus
            aria-label={t('toast.edit')}
          />
        ) : isMerge ? (
          <MergeContent merge={currentItem.merge} />
        ) : (
          <p className="text-xs text-[hsl(var(--foreground))] leading-relaxed line-clamp-3">
            {currentItem.memory.content}
          </p>
        )}

        {/* Meta */}
        <div className="flex items-center gap-1.5 mt-2">
          {CatIcon && <CatIcon className="h-3 w-3 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />}
          <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
            {t(`category.${category}`)}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center border-t border-[hsl(var(--border))]">
        <button
          type="button"
          onClick={handleDismiss}
          disabled={isProcessingRef.current}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 text-[11px] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--foreground)/0.03)] transition-colors"
          aria-label={t('toast.dismiss')}
        >
          <X className="h-3 w-3" aria-hidden="true" />
          {t('toast.dismiss')}
        </button>
        <div className="w-px h-5 bg-[hsl(var(--border))]" />
        {!isEditing && (
          <>
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 text-[11px] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--foreground)/0.03)] transition-colors"
              aria-label={t('toast.edit')}
            >
              {t('toast.edit')}
            </button>
            <div className="w-px h-5 bg-[hsl(var(--border))]" />
          </>
        )}
        <button
          type="button"
          onClick={handleConfirm}
          disabled={isProcessingRef.current}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 text-[11px] font-medium text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/0.05)] transition-colors"
          aria-label={t('toast.confirm')}
        >
          <Check className="h-3 w-3" aria-hidden="true" />
          {t('toast.confirm')}
        </button>
      </div>
    </div>
  )
}

// ── Merge Content Subcomponent ──────────────────────────────────────

function MergeContent({ merge }: { merge: PendingMerge }) {
  const { t } = useTranslation('memory')

  return (
    <div className="space-y-1.5">
      <div>
        <span className="text-[10px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider">
          {t('toast.mergeOld')}
        </span>
        <p className="text-xs text-[hsl(var(--muted-foreground))] leading-relaxed line-clamp-2 line-through decoration-[hsl(var(--muted-foreground)/0.4)]">
          {merge.oldContent}
        </p>
      </div>
      <div>
        <span className="text-[10px] font-medium text-[hsl(var(--primary))] uppercase tracking-wider">
          {t('toast.mergeNew')}
        </span>
        <p className="text-xs text-[hsl(var(--foreground))] leading-relaxed line-clamp-3">
          {merge.newContent}
        </p>
      </div>
    </div>
  )
}
