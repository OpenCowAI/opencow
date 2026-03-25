// SPDX-License-Identifier: Apache-2.0

import {
  File, Folder, FolderOpen,
  FileCode, FileText, FileImage, FileArchive, FileSpreadsheet,
  FileCog, FileTerminal, FileType,
  Braces, Globe, Paintbrush, Database, Terminal, Lock,
  TestTube, BookOpen, FileHeart, Settings, Cog,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

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

export function FileIcon({ filename, isDirectory, isExpanded, className = 'h-4 w-4 shrink-0' }: FileIconProps): React.JSX.Element {
  if (isDirectory) {
    const Icon = isExpanded ? FolderOpen : Folder
    return <Icon className={`${className} ${C.gray}`} aria-hidden="true" />
  }

  const { icon: Icon, className: colorClass } = resolveFileIcon(filename)
  return <Icon className={`${className} ${colorClass}`} aria-hidden="true" />
}
