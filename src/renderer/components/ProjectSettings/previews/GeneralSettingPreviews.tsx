// SPDX-License-Identifier: Apache-2.0

import { cn } from '@/lib/utils'

type MiniTone = 'faint' | 'soft' | 'base' | 'strong'

const TONE_CLASS: Record<MiniTone, string> = {
  faint: 'bg-[hsl(var(--foreground)/0.05)]',
  soft: 'bg-[hsl(var(--foreground)/0.08)]',
  base: 'bg-[hsl(var(--foreground)/0.12)]',
  strong: 'bg-[hsl(var(--foreground)/0.17)]',
}

function MiniBar({ className, tone = 'base' }: { className?: string; tone?: MiniTone }): React.JSX.Element {
  return <span className={cn('block h-1.5 rounded-full', TONE_CLASS[tone], className)} aria-hidden="true" />
}

function MiniBlock({ className, tone = 'base' }: { className?: string; tone?: MiniTone }): React.JSX.Element {
  return <span className={cn('block rounded', TONE_CLASS[tone], className)} aria-hidden="true" />
}

function MiniDot({ tone = 'base' }: { tone?: MiniTone }): React.JSX.Element {
  return <span className={cn('h-1.5 w-1.5 rounded-full', TONE_CLASS[tone])} aria-hidden="true" />
}

function MiniListRow({
  leftTone = 'soft',
  mainTone = 'base',
  widthClass = 'w-[82%]',
}: {
  leftTone?: MiniTone
  mainTone?: MiniTone
  widthClass?: string
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-1.5">
      <MiniDot tone={leftTone} />
      <MiniBlock tone={mainTone} className={cn('h-2', widthClass)} />
    </div>
  )
}

function FilesIdeSkeleton({ compact = false }: { compact?: boolean }): React.JSX.Element {
  return (
    <div className={cn('grid', compact ? 'grid-cols-[0.75fr_1.45fr] gap-1' : 'grid-cols-[0.72fr_1.55fr] gap-1.5')}>
      <div className="space-y-1">
        <MiniBlock tone="soft" className="h-1.5 w-9 rounded-full" />
        <MiniListRow leftTone="soft" mainTone="soft" widthClass="w-[84%]" />
        <MiniListRow leftTone="faint" mainTone="faint" widthClass="w-[72%]" />
        <MiniListRow leftTone="faint" mainTone="soft" widthClass="w-[78%]" />
      </div>
      <div className="space-y-1">
        <div className={cn('grid grid-cols-3', compact ? 'gap-0.5' : 'gap-1')}>
          <MiniBar tone="soft" />
          <MiniBar tone="base" />
          <MiniBar tone="faint" className="w-[70%]" />
        </div>
        <MiniBlock tone="faint" className="h-1.5 w-full rounded-full" />
        <MiniBlock tone="base" className={cn('w-full rounded-md', compact ? 'h-5.5' : 'h-6.5')} />
        <MiniBlock tone="soft" className="h-1.5 w-[72%] rounded-full" />
      </div>
    </div>
  )
}

export function TopTabPreview({ tab }: { tab: 'issues' | 'chat' | 'schedule' }): React.JSX.Element {
  return (
    <div className="space-y-1.5" aria-hidden="true">
      <div className="grid grid-cols-3 gap-1">
        <MiniBar tone={tab === 'issues' ? 'strong' : 'soft'} />
        <MiniBar tone={tab === 'chat' ? 'strong' : 'soft'} />
        <MiniBar tone={tab === 'schedule' ? 'strong' : 'soft'} />
      </div>

      {tab === 'issues' && (
        <div className="space-y-1">
          <div className="flex items-center gap-1">
            <MiniBlock tone="soft" className="h-1.5 w-10 rounded-full" />
            <MiniBlock tone="soft" className="h-1.5 w-8 rounded-full" />
          </div>
          <MiniListRow leftTone="strong" mainTone="base" widthClass="w-[92%]" />
          <MiniListRow leftTone="soft" mainTone="base" widthClass="w-[85%]" />
          <MiniListRow leftTone="faint" mainTone="soft" widthClass="w-[76%]" />
        </div>
      )}

      {tab === 'chat' && (
        <div className="space-y-1">
          <MiniBlock tone="soft" className="h-2.5 w-[72%] ml-auto rounded-md" />
          <MiniBlock tone="base" className="h-2.5 w-[86%] rounded-md" />
          <MiniBlock tone="soft" className="h-2.5 w-[66%] ml-auto rounded-md" />
          <MiniBlock tone="faint" className="h-2 w-[95%] rounded-full" />
        </div>
      )}

      {tab === 'schedule' && (
        <div className="space-y-1">
          <div className="flex items-center gap-1">
            <MiniBlock tone="soft" className="h-1.5 w-8 rounded-full" />
            <MiniBlock tone="faint" className="h-1.5 w-12 rounded-full" />
          </div>
          <div className="grid grid-cols-4 gap-1">
            <MiniBlock tone="faint" className="h-5" />
            <MiniBlock tone="base" className="h-5" />
            <MiniBlock tone="soft" className="h-5" />
            <MiniBlock tone="faint" className="h-5" />
          </div>
          <MiniBlock tone="base" className="h-1.5 w-[90%] rounded-full" />
          <MiniBlock tone="soft" className="h-1.5 w-[64%] rounded-full" />
        </div>
      )}
    </div>
  )
}

export function ChatLayoutPreview({ mode }: { mode: 'default' | 'files' }): React.JSX.Element {
  if (mode === 'default') {
    return (
      <div className="space-y-1" aria-hidden="true">
        <MiniBlock tone="soft" className="h-1.5 w-9 rounded-full" />
        <MiniBlock tone="base" className="h-2.5 w-[84%] rounded-md" />
        <MiniBlock tone="soft" className="h-2.5 w-[64%] ml-auto rounded-md" />
        <MiniBlock tone="base" className="h-2.5 w-[90%] rounded-md" />
        <MiniBlock tone="faint" className="h-2 w-full rounded-full" />
      </div>
    )
  }

  return (
    <div className="grid grid-cols-[1.25fr_1fr] gap-1.5" aria-hidden="true">
      <div className="space-y-1">
        <MiniBlock tone="soft" className="h-1.5 w-8 rounded-full" />
        <MiniBlock tone="base" className="h-2.5 w-[88%] rounded-md" />
        <MiniBlock tone="soft" className="h-2.5 w-[66%] ml-auto rounded-md" />
        <MiniBlock tone="faint" className="h-2 w-[98%] rounded-full" />
      </div>
      <FilesIdeSkeleton compact />
    </div>
  )
}

export function FilesLayoutPreview({ mode }: { mode: 'ide' | 'browser' }): React.JSX.Element {
  if (mode === 'ide') {
    return (
      <div aria-hidden="true">
        <FilesIdeSkeleton />
      </div>
    )
  }

  return (
    <div className="space-y-1.5" aria-hidden="true">
      <div className="flex items-center gap-1">
        <MiniDot tone="soft" />
        <MiniBlock tone="soft" className="h-1.5 w-9 rounded-full" />
        <MiniBlock tone="faint" className="h-1.5 w-1.5 rounded-full" />
        <MiniBlock tone="faint" className="h-1.5 w-8 rounded-full" />
        <MiniBlock tone="faint" className="h-1.5 w-1.5 rounded-full" />
        <MiniBlock tone="base" className="h-1.5 w-8 rounded-full" />
        <MiniBlock tone="soft" className="ml-auto h-1.5 w-14 rounded-full" />
      </div>
      <div className="grid grid-cols-3 gap-1">
        <div className="space-y-1 rounded-md border border-[hsl(var(--foreground)/0.07)] p-1">
          <MiniBlock tone="faint" className="mx-auto h-4.5 w-4.5 rounded-sm" />
          <MiniBlock tone="soft" className="h-1.5 w-[92%] rounded-full" />
          <MiniBlock tone="faint" className="h-1.5 w-[70%] rounded-full" />
        </div>
        <div className="space-y-1 rounded-md border border-[hsl(var(--foreground)/0.07)] p-1">
          <MiniBlock tone="soft" className="mx-auto h-4.5 w-4.5 rounded-sm" />
          <MiniBlock tone="base" className="h-1.5 w-[88%] rounded-full" />
          <MiniBlock tone="faint" className="h-1.5 w-[66%] rounded-full" />
        </div>
        <div className="space-y-1 rounded-md border border-[hsl(var(--foreground)/0.07)] p-1">
          <MiniBlock tone="faint" className="mx-auto h-4.5 w-4.5 rounded-sm" />
          <MiniBlock tone="soft" className="h-1.5 w-[84%] rounded-full" />
          <MiniBlock tone="faint" className="h-1.5 w-[62%] rounded-full" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-1">
        <MiniBlock tone="faint" className="h-1.5 w-full rounded-full" />
        <MiniBlock tone="soft" className="h-1.5 w-[78%] rounded-full" />
      </div>
    </div>
  )
}
