// SPDX-License-Identifier: Apache-2.0

import {
  File,
  FileCode, FileText, FileImage, FileArchive, FileSpreadsheet,
  FileCog, FileTerminal, FileType,
  Braces, Globe, Paintbrush, Database, Terminal, Lock,
  TestTube, BookOpen, FileHeart, Settings, Cog,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useId } from 'react'
import { cn } from '@/lib/utils'

// === Registry Types ===

interface IconMapping {
  icon: LucideIcon
  className: string
}

// === Color Constants (semantic technology brand colors) ===

const C = {
  blue: 'text-blue-400',
  cyan: 'text-cyan-400',
  yellow: 'text-yellow-400',
  orange: 'text-orange-400',
  green: 'text-green-400',
  pink: 'text-pink-400',
  purple: 'text-purple-400',
  red: 'text-red-400',
  gray: 'text-[hsl(var(--muted-foreground))]',
} as const

// === Exact Filename Registry (highest priority) ===

const FILENAME_REGISTRY: Record<string, IconMapping> = {
  'package.json': { icon: Braces, className: C.orange },
  'package-lock.json': { icon: Braces, className: C.orange },
  'pnpm-lock.yaml': { icon: Lock, className: C.orange },
  'yarn.lock': { icon: Lock, className: C.orange },
  'tsconfig.json': { icon: Cog, className: C.blue },
  'vite.config.ts': { icon: TestTube, className: C.purple },
  'vitest.config.ts': { icon: TestTube, className: C.green },
  'electron.vite.config.ts': { icon: TestTube, className: C.purple },
  'tailwind.config.ts': { icon: Paintbrush, className: C.cyan },
  'tailwind.config.js': { icon: Paintbrush, className: C.cyan },
  '.prettierrc': { icon: Paintbrush, className: C.pink },
  '.eslintrc': { icon: Settings, className: C.purple },
  '.eslintrc.js': { icon: Settings, className: C.purple },
  '.eslintrc.json': { icon: Settings, className: C.purple },
  'eslint.config.js': { icon: Settings, className: C.purple },
  'eslint.config.ts': { icon: Settings, className: C.purple },
  'Dockerfile': { icon: FileTerminal, className: C.blue },
  'docker-compose.yml': { icon: FileTerminal, className: C.blue },
  'docker-compose.yaml': { icon: FileTerminal, className: C.blue },
  '.gitignore': { icon: FileText, className: C.gray },
  '.dockerignore': { icon: FileText, className: C.gray },
  'LICENSE': { icon: FileHeart, className: C.red },
  'LICENSE.md': { icon: FileHeart, className: C.red },
  'Makefile': { icon: Terminal, className: C.green },
  '.env': { icon: Lock, className: C.yellow },
  '.env.local': { icon: Lock, className: C.yellow },
  '.env.development': { icon: Lock, className: C.yellow },
  '.env.production': { icon: Lock, className: C.yellow },
  'CLAUDE.md': { icon: BookOpen, className: C.purple },
}

// === Extension Registry ===

const EXTENSION_REGISTRY: Record<string, IconMapping> = {
  // TypeScript
  ts: { icon: FileCode, className: C.blue },
  tsx: { icon: FileCode, className: C.cyan },
  // JavaScript
  js: { icon: FileCode, className: C.yellow },
  jsx: { icon: FileCode, className: C.yellow },
  mjs: { icon: FileCode, className: C.yellow },
  cjs: { icon: FileCode, className: C.yellow },
  // Data / Config
  json: { icon: Braces, className: C.yellow },
  yaml: { icon: FileCog, className: C.red },
  yml: { icon: FileCog, className: C.red },
  toml: { icon: FileCog, className: C.orange },
  // Markup
  html: { icon: Globe, className: C.orange },
  xml: { icon: FileCode, className: C.orange },
  svg: { icon: FileImage, className: C.orange },
  // Styles
  css: { icon: Paintbrush, className: C.blue },
  scss: { icon: Paintbrush, className: C.pink },
  less: { icon: Paintbrush, className: C.purple },
  // Documentation
  md: { icon: FileText, className: C.blue },
  mdx: { icon: FileText, className: C.blue },
  txt: { icon: FileText, className: C.gray },
  // Languages
  py: { icon: FileCode, className: C.green },
  rs: { icon: FileCode, className: C.orange },
  go: { icon: FileCode, className: C.cyan },
  java: { icon: FileCode, className: C.red },
  kt: { icon: FileCode, className: C.purple },
  swift: { icon: FileCode, className: C.orange },
  c: { icon: FileCode, className: C.blue },
  cpp: { icon: FileCode, className: C.blue },
  h: { icon: FileCode, className: C.purple },
  rb: { icon: FileCode, className: C.red },
  php: { icon: FileCode, className: C.purple },
  lua: { icon: FileCode, className: C.blue },
  // Shell
  sh: { icon: Terminal, className: C.green },
  bash: { icon: Terminal, className: C.green },
  zsh: { icon: Terminal, className: C.green },
  fish: { icon: Terminal, className: C.green },
  // Database
  sql: { icon: Database, className: C.blue },
  graphql: { icon: Database, className: C.pink },
  prisma: { icon: Database, className: C.purple },
  // Images
  png: { icon: FileImage, className: C.pink },
  jpg: { icon: FileImage, className: C.pink },
  jpeg: { icon: FileImage, className: C.pink },
  gif: { icon: FileImage, className: C.pink },
  webp: { icon: FileImage, className: C.pink },
  ico: { icon: FileImage, className: C.pink },
  avif: { icon: FileImage, className: C.pink },
  // Media
  mp4: { icon: FileType, className: C.purple },
  mov: { icon: FileType, className: C.purple },
  mp3: { icon: FileType, className: C.green },
  wav: { icon: FileType, className: C.green },
  // Archives
  zip: { icon: FileArchive, className: C.yellow },
  tar: { icon: FileArchive, className: C.yellow },
  gz: { icon: FileArchive, className: C.yellow },
  rar: { icon: FileArchive, className: C.yellow },
  // Spreadsheet
  csv: { icon: FileSpreadsheet, className: C.green },
  xlsx: { icon: FileSpreadsheet, className: C.green },
  xls: { icon: FileSpreadsheet, className: C.green },
  // Lock files
  lock: { icon: Lock, className: C.gray },
  // Env
  env: { icon: Lock, className: C.yellow },
}

// === Pattern matchers for special filenames ===

const PATTERN_MATCHERS: Array<{ test: (name: string) => boolean; mapping: IconMapping }> = [
  { test: (n) => n.startsWith('tsconfig') && n.endsWith('.json'), mapping: { icon: Cog, className: C.blue } },
  { test: (n) => n.startsWith('.env'), mapping: { icon: Lock, className: C.yellow } },
  { test: (n) => n.startsWith('README'), mapping: { icon: BookOpen, className: C.blue } },
  { test: (n) => n.startsWith('CHANGELOG'), mapping: { icon: FileText, className: C.green } },
  { test: (n) => n.startsWith('LICENSE'), mapping: { icon: FileHeart, className: C.red } },
]

const DEFAULT_FILE: IconMapping = { icon: File, className: C.gray }

// === Resolution Logic ===

function resolveFileIcon(filename: string): IconMapping {
  // 1. Exact filename match
  const exact = FILENAME_REGISTRY[filename]
  if (exact) return exact

  // 2. Pattern match
  for (const { test, mapping } of PATTERN_MATCHERS) {
    if (test(filename)) return mapping
  }

  // 3. Extension match
  const ext = filename.split('.').pop()?.toLowerCase()
  if (ext) {
    const byExt = EXTENSION_REGISTRY[ext]
    if (byExt) return byExt
  }

  return DEFAULT_FILE
}

// === Component ===

interface FileIconProps {
  filename: string
  isDirectory?: boolean
  isExpanded?: boolean
  className?: string
}

function AppleFolderIcon({
  className,
  isExpanded,
}: {
  className: string
  isExpanded?: boolean
}): React.JSX.Element {
  const gradientId = useId()
  const bodyGradId = `${gradientId}-body`
  const tabGradId = `${gradientId}-tab`
  const stripeGradId = `${gradientId}-stripe`
  const glossGradId = `${gradientId}-gloss`

  const tones = isExpanded
    ? {
        tabTop: '#5EC8F6',
        tabBottom: '#4ABAEF',
        bodyTop: '#75D4FF',
        bodyBottom: '#42BBF0',
        edge: '#4FA5D8',
        stripeTop: '#2FA9DF',
        stripeBottom: '#208FCD',
        shadow: 'drop-shadow-[0_0.8px_0.8px_rgba(12,90,137,0.35)]',
      }
    : {
        tabTop: '#69D2FF',
        tabBottom: '#53C3F5',
        bodyTop: '#88DCFF',
        bodyBottom: '#4AC2F4',
        edge: '#58AFDE',
        stripeTop: '#38B4E8',
        stripeBottom: '#279CD7',
        shadow: 'drop-shadow-[0_0.8px_0.8px_rgba(12,90,137,0.28)]',
      }

  return (
    <span className={cn('inline-flex align-middle', className)} aria-hidden="true">
      <svg
        viewBox="0 0 64 62"
        className={cn('h-full w-full', tones.shadow)}
        role="presentation"
      >
        <defs>
          <linearGradient id={tabGradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={tones.tabTop} />
            <stop offset="100%" stopColor={tones.tabBottom} />
          </linearGradient>
          <linearGradient id={bodyGradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={tones.bodyTop} />
            <stop offset="100%" stopColor={tones.bodyBottom} />
          </linearGradient>
          <linearGradient id={stripeGradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={tones.stripeTop} />
            <stop offset="100%" stopColor={tones.stripeBottom} />
          </linearGradient>
          <linearGradient id={glossGradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.66" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g transform="scale(1 1.2)">
          {isExpanded && (
            <path
              d="M7.2 20.1h47.2c2.8 0 5 2.2 5 5v16.8c0 2.8-2.2 5-5 5H9.9c-2.1 0-4-1.3-4.7-3.2L2.8 35.6c-0.8-2.7 1.2-5.5 4-5.5Z"
              fill={`url(#${bodyGradId})`}
              opacity="0.68"
            />
          )}
          {/* Top-left tab */}
          <path
            d="M4.5 14.2V10.6c0-2.6 2.1-4.7 4.7-4.7h15.6c1.3 0 2.6 0.55 3.5 1.52l1.9 2.06c0.75 0.8 1.8 1.26 2.9 1.26h20.7c3.1 0 5.7 2.5 5.7 5.7v2.05H4.5v-4.35Z"
            fill={`url(#${tabGradId})`}
            stroke={tones.edge}
            strokeWidth="1.05"
            strokeLinejoin="round"
          />

          {/* Main front body */}
          {isExpanded ? (
            <path
              d="M4.2 24.3h55.6c2.2 0 4 1.8 4 4v17.7c0 2.2-1.8 4-4 4H4.2c-2.2 0-4-1.8-4-4V28.3c0-2.2 1.8-4 4-4Z"
              fill={`url(#${bodyGradId})`}
              stroke={tones.edge}
              strokeWidth="1.05"
              strokeLinejoin="round"
            />
          ) : (
            <path
              d="M4.2 17.8H59.8c2.2 0 4 1.8 4 4v24.2c0 2.2-1.8 4-4 4H4.2c-2.2 0-4-1.8-4-4V21.8c0-2.2 1.8-4 4-4Z"
              fill={`url(#${bodyGradId})`}
              stroke={tones.edge}
              strokeWidth="1.05"
              strokeLinejoin="round"
            />
          )}

          {/* Inner dark line near top edge */}
          {isExpanded ? (
            <path
              d="M2.3 28.55c0-1.6 1.3-2.9 2.9-2.9h53.6c1.6 0 2.9 1.3 2.9 2.9v0.85H2.3v-0.85Z"
              fill={`url(#${stripeGradId})`}
            />
          ) : (
            <path
              d="M2.3 22.15c0-1.6 1.3-2.9 2.9-2.9h53.6c1.6 0 2.9 1.3 2.9 2.9v0.95H2.3v-0.95Z"
              fill={`url(#${stripeGradId})`}
            />
          )}

          {/* Gloss on upper body */}
          {isExpanded ? (
            <path
              d="M6.2 24.95h51.6c1.7 0 3 1.3 3 3v1.95H6.2v-4.95Z"
              fill={`url(#${glossGradId})`}
            />
          ) : (
            <path
              d="M6.2 18.65h51.6c1.7 0 3 1.3 3 3v2.3H6.2v-5.3Z"
              fill={`url(#${glossGradId})`}
            />
          )}
        </g>
      </svg>
    </span>
  )
}

export function FileIcon({ filename, isDirectory, isExpanded, className = 'h-4 w-4 shrink-0' }: FileIconProps): React.JSX.Element {
  if (isDirectory) {
    return <AppleFolderIcon className={className} isExpanded={isExpanded} />
  }

  const { icon: Icon, className: colorClass } = resolveFileIcon(filename)
  return <Icon className={`${className} ${colorClass}`} aria-hidden="true" />
}
