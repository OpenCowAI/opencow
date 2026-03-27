// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Archive, Trash2, Save, Brain } from 'lucide-react'
import { useAppStore } from '@/stores/appStore'
import { useMemoryStore } from '@/stores/memoryStore'
import { Tooltip } from '@/components/ui/Tooltip'
import { ProjectPicker } from '@/components/ui/ProjectPicker'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { CategoryPillMenu } from '@/components/MemoryView/CategoryPillMenu'
import { cn } from '@/lib/utils'
import type { MemoryItem, MemoryCategory } from '@shared/types'
import { getAppAPI } from '@/windowAPI'

interface MemoryDetailViewProps {
  memoryId: string
}

export function MemoryDetailView({ memoryId }: MemoryDetailViewProps): React.JSX.Element {
  const { t } = useTranslation('memory')
  const closeDetail = useAppStore((s) => s.closeDetail)
  const updateMemory = useMemoryStore((s) => s.updateMemory)
  const deleteMemory = useMemoryStore((s) => s.deleteMemory)
  const archiveMemory = useMemoryStore((s) => s.archiveMemory)

  const [memory, setMemory] = useState<MemoryItem | null>(null)
  const [editContent, setEditContent] = useState('')
  const [editCategory, setEditCategory] = useState<MemoryCategory>('fact')
  const [editProjectId, setEditProjectId] = useState<string | null>(null)
  const [isDirty, setIsDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-resize textarea to fit content
  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(320, Math.max(120, el.scrollHeight))}px`
  }, [])

  // Resize on content load
  useEffect(() => {
    resizeTextarea()
  }, [memory, resizeTextarea])

  useEffect(() => {
    setLoadError(false)
    const api = getAppAPI()
    api['memory:get'](memoryId).then((item) => {
      if (item) {
        setMemory(item)
        setEditContent(item.content)
        setEditCategory(item.category)
        setEditProjectId(item.projectId)
        setIsDirty(false)
      } else {
        setLoadError(true)
      }
    }).catch(() => setLoadError(true))
  }, [memoryId])

  const handleSave = useCallback(async () => {
    if (!memory || saving) return
    setSaving(true)
    try {
      await updateMemory(memory.id, {
        content: editContent,
        category: editCategory,
        scope: editProjectId ? 'project' : 'user',
        projectId: editProjectId,
      })
      setIsDirty(false)
      const api = getAppAPI()
      const updated = await api['memory:get'](memoryId)
      if (updated) setMemory(updated)
    } finally {
      setSaving(false)
    }
  }, [memory, editContent, editCategory, saving, updateMemory, memoryId])

  const handleDelete = useCallback(async () => {
    if (!memory) return
    await deleteMemory(memory.id)
    closeDetail()
  }, [memory, deleteMemory, closeDetail])

  const handleArchive = useCallback(async () => {
    if (!memory) return
    await archiveMemory(memory.id)
    closeDetail()
  }, [memory, archiveMemory, closeDetail])

  if (loadError) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-xs text-red-500">{t('detail.loadError')}</p>
      </div>
    )
  }

  if (!memory) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-xs text-[hsl(var(--muted-foreground))]">{t('detail.loading')}</p>
      </div>
    )
  }

  const sourceLabel = memory.source.replace(/_/g, ' ')
  const created = new Date(memory.createdAt)
  const updated = new Date(memory.updatedAt)
  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-[hsl(var(--border))] px-4 py-3 flex items-center gap-2">
        <button
          onClick={closeDetail}
          className="p-1 rounded-md hover:bg-[hsl(var(--foreground)/0.05)] transition-colors"
          aria-label={t('create.cancel')}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <Brain className="h-4 w-4 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
        <span className="text-sm font-medium text-[hsl(var(--foreground))] truncate flex-1">
          {t('detail.title')}
        </span>
        <div className="flex items-center gap-1">
          <Tooltip content={t('archive')} position="bottom">
            <button
              onClick={() => void handleArchive()}
              className="p-1.5 rounded-md hover:bg-[hsl(var(--foreground)/0.05)] transition-colors"
              aria-label={t('archive')}
            >
              <Archive className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
            </button>
          </Tooltip>
          <Tooltip content={t('delete')} position="bottom">
            <button
              onClick={() => setDeleteConfirmOpen(true)}
              className="p-1.5 rounded-md hover:bg-red-500/10 transition-colors"
              aria-label={t('delete')}
            >
              <Trash2 className="h-3.5 w-3.5 text-red-500/70" aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
        <div>
          <label className="block text-xs font-medium text-[hsl(var(--muted-foreground))] mb-1.5">
            {t('detail.contentLabel')}
          </label>
          <textarea
            ref={textareaRef}
            value={editContent}
            onChange={(e) => { setEditContent(e.target.value); setIsDirty(true); resizeTextarea() }}
            className="w-full min-h-[120px] max-h-[320px] rounded-lg border border-[hsl(var(--border))] bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[hsl(var(--ring))] resize-none overflow-y-auto"
            aria-label={t('detail.contentLabel')}
          />
        </div>

        {/* Category */}
        <div>
          <label className="block text-xs font-medium text-[hsl(var(--muted-foreground))] mb-1.5">
            {t('detail.categoryLabel')}
          </label>
          <CategoryPillMenu
            value={editCategory}
            onChange={(cat) => { if (cat) { setEditCategory(cat); setIsDirty(true) } }}
            position="below"
          />
        </div>

        {/* Metadata */}
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-[hsl(var(--muted-foreground))]">{t('detail.detailsTitle')}</h3>
          <div className="grid grid-cols-2 gap-y-2 text-xs items-center">
            <span className="text-[hsl(var(--muted-foreground))]">{t('detail.scope')}</span>
            <ProjectPicker
              value={editProjectId}
              onChange={(pid) => { setEditProjectId(pid); setIsDirty(true) }}
              placeholder={t('create.scopeUser')}
              ariaLabel={t('detail.scope')}
              triggerClassName="rounded-full py-0.5 px-2 text-[11px]"
              position="below"
            />

            <span className="text-[hsl(var(--muted-foreground))]">{t('detail.source')}</span>
            <span className="text-[hsl(var(--foreground))]">{sourceLabel}</span>

            <span className="text-[hsl(var(--muted-foreground))]">{t('detail.confidence')}</span>
            <span className="text-[hsl(var(--foreground))]">{Math.round(memory.confidence * 100)}%</span>

            <span className="text-[hsl(var(--muted-foreground))]">{t('detail.used')}</span>
            <span className="text-[hsl(var(--foreground))]">{t('detail.usedTimes', { count: memory.accessCount })}</span>

            <span className="text-[hsl(var(--muted-foreground))]">{t('detail.version')}</span>
            <span className="text-[hsl(var(--foreground))]">v{memory.version}</span>

            <span className="text-[hsl(var(--muted-foreground))]">{t('detail.created')}</span>
            <span className="text-[hsl(var(--foreground))]">{created.toLocaleString()}</span>

            <span className="text-[hsl(var(--muted-foreground))]">{t('detail.updated')}</span>
            <span className="text-[hsl(var(--foreground))]">{updated.toLocaleString()}</span>

            {memory.confirmedBy && (
              <>
                <span className="text-[hsl(var(--muted-foreground))]">{t('detail.confirmedBy')}</span>
                <span className="text-[hsl(var(--foreground))]">{memory.confirmedBy}</span>
              </>
            )}
          </div>
        </div>

        {memory.tags.length > 0 && (
          <div>
            <h3 className="text-xs font-medium text-[hsl(var(--muted-foreground))] mb-1.5">{t('detail.tagsTitle')}</h3>
            <div className="flex flex-wrap gap-1">
              {memory.tags.map((tag) => (
                <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {memory.reasoning && (
          <div>
            <h3 className="text-xs font-medium text-[hsl(var(--muted-foreground))] mb-1.5">{t('detail.reasoningTitle')}</h3>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">{memory.reasoning}</p>
          </div>
        )}
      </div>

      {/* Save bar */}
      {isDirty && (
        <div className="border-t border-[hsl(var(--border))] px-4 py-3 flex items-center justify-end gap-2">
          <button
            onClick={() => { setEditContent(memory.content); setEditCategory(memory.category); setEditProjectId(memory.projectId); setIsDirty(false) }}
            className="px-3 py-1.5 text-xs rounded-md hover:bg-[hsl(var(--foreground)/0.05)] transition-colors"
          >
            {t('detail.discard')}
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-opacity',
              'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]',
              saving ? 'opacity-50' : 'hover:opacity-90',
            )}
          >
            <Save className="h-3 w-3" aria-hidden="true" />
            {saving ? t('detail.saving') : t('detail.save')}
          </button>
        </div>
      )}

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        open={deleteConfirmOpen}
        variant="destructive"
        title={t('detail.deleteConfirmTitle')}
        message={t('detail.deleteConfirmMessage')}
        confirmLabel={t('detail.deleteConfirmAction')}
        onConfirm={() => { setDeleteConfirmOpen(false); void handleDelete() }}
        onCancel={() => setDeleteConfirmOpen(false)}
      />
    </div>
  )
}
