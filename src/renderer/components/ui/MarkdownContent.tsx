// SPDX-License-Identifier: Apache-2.0

import { memo, useState, useEffect, useRef, useLayoutEffect, createContext, useContext } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import rehypeRaw from 'rehype-raw'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { detectLanguage } from '@/lib/codeBlockDetector'
import { MermaidBlock } from './MermaidBlock'
import {
  MarkdownTable,
  MarkdownThead,
  MarkdownTbody,
  MarkdownTr,
  MarkdownTh,
  MarkdownTd,
} from './MarkdownTable'
import { slugify } from '@/lib/extractToc'

// ---------------------------------------------------------------------------
// Streaming Context
//
// Allows deeply nested components (SmartPre) to read streaming state
// without prop drilling or recreating the components object.
// ---------------------------------------------------------------------------

const StreamingContext = createContext(false)

// ---------------------------------------------------------------------------
// Slug counter context — deduplicates heading IDs within a single render pass
// ---------------------------------------------------------------------------

interface SlugCounter {
  current: Map<string, number>
}

const SlugCounterContext = createContext<SlugCounter>({ current: new Map() })

/**
 * Recursively extract plain text from React children.
 * Used to derive heading slugs from rendered heading content.
 */
function extractTextFromChildren(children: React.ReactNode): string {
  if (typeof children === 'string') return children
  if (typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(extractTextFromChildren).join('')
  if (children && typeof children === 'object' && 'props' in children) {
    return extractTextFromChildren((children as React.ReactElement<{ children?: React.ReactNode }>).props.children)
  }
  return ''
}

/**
 * Factory: create a heading component that auto-generates a slugified `id`.
 * The slug counter context ensures duplicate headings get `-1`, `-2` suffixes,
 * matching the IDs produced by `extractToc()`.
 */
function makeHeading(Tag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6', className: string) {
  return function Heading({ children }: { children?: React.ReactNode }): React.JSX.Element {
    const slugCounter = useContext(SlugCounterContext)
    const text = extractTextFromChildren(children)
    let slug = slugify(text)
    const count = slugCounter.current.get(slug) ?? 0
    slugCounter.current.set(slug, count + 1)
    if (count > 0) slug = `${slug}-${count}`
    return <Tag id={slug} className={className}>{children}</Tag>
  }
}

// ---------------------------------------------------------------------------
// CollapsiblePre — standard code block with expand/collapse
// ---------------------------------------------------------------------------

/** Collapsed height threshold for code blocks (in px). */
const CODE_BLOCK_COLLAPSED_HEIGHT = 384 // = Tailwind max-h-96

function CollapsiblePre({ children }: { children?: React.ReactNode }): React.JSX.Element {
  const preRef = useRef<HTMLPreElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)

  useLayoutEffect(() => {
    const el = preRef.current
    if (el) {
      setOverflows(el.scrollHeight > CODE_BLOCK_COLLAPSED_HEIGHT)
    }
  }, [children])

  return (
    <div className="relative my-2 group/code">
      <pre
        ref={preRef}
        className={cn(
          'bg-[hsl(var(--muted))] rounded p-1.5 text-sm font-mono overflow-x-auto',
          !expanded && 'overflow-y-hidden',
          overflows && !expanded && 'cursor-pointer'
        )}
        style={!expanded && overflows ? { maxHeight: CODE_BLOCK_COLLAPSED_HEIGHT } : undefined}
        onClick={overflows && !expanded ? () => setExpanded(true) : undefined}
        role={overflows && !expanded ? 'button' : undefined}
        tabIndex={overflows && !expanded ? 0 : undefined}
        aria-label={overflows && !expanded ? 'Show all code' : undefined}
        onKeyDown={overflows && !expanded ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(true) } } : undefined}
      >
        {children}
      </pre>

      {overflows && !expanded && (
        <div
          className="absolute bottom-0 inset-x-0 flex justify-center rounded-b pointer-events-none"
          style={{ background: 'linear-gradient(to top, hsl(var(--muted)) 40%, transparent)' }}
        >
          <span className="flex items-center gap-0.5 px-2 py-1 mb-1 text-[11px] text-[hsl(var(--muted-foreground))]">
            Show more <ChevronDown className="w-3 h-3" aria-hidden="true" />
          </span>
        </div>
      )}

      {overflows && expanded && (
        <div className="flex justify-center">
          <button
            onClick={() => setExpanded(false)}
            className="flex items-center gap-0.5 px-2 py-0.5 text-[11px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
            aria-label="Collapse code"
          >
            Show less <ChevronUp className="w-3 h-3" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SmartPre — routes mermaid code blocks to MermaidBlock, rest to CollapsiblePre
// ---------------------------------------------------------------------------

function SmartPre({ children }: { children?: React.ReactNode }): React.JSX.Element {
  const isStreaming = useContext(StreamingContext)
  const mermaidCode = detectLanguage(children, 'mermaid')

  if (mermaidCode) {
    // During streaming the code may be incomplete — show as plain code block
    if (isStreaming) {
      return (
        <div className="my-2">
          <pre className="bg-[hsl(var(--muted))] rounded p-1.5 text-sm font-mono overflow-x-auto">
            {children}
          </pre>
        </div>
      )
    }
    return <MermaidBlock code={mermaidCode} />
  }

  return <CollapsiblePre>{children}</CollapsiblePre>
}

// ---------------------------------------------------------------------------
// Markdown component overrides — module-level constant, never recreated
// ---------------------------------------------------------------------------

const MARKDOWN_COMPONENTS: React.ComponentProps<typeof ReactMarkdown>['components'] = {
  h1: makeHeading('h1', 'text-base font-medium mt-4 mb-1 text-[hsl(var(--foreground))]'),
  h2: makeHeading('h2', 'text-sm font-semibold mt-3 mb-1 text-[hsl(var(--foreground))]'),
  h3: makeHeading('h3', 'text-sm font-semibold mt-2 mb-1 text-[hsl(var(--foreground))]'),
  h4: makeHeading('h4', 'text-sm font-medium mt-2 mb-0.5 text-[hsl(var(--foreground))]'),
  h5: makeHeading('h5', 'text-xs font-semibold mt-2 mb-0.5 text-[hsl(var(--foreground))]'),
  h6: makeHeading('h6', 'text-xs font-medium mt-1 mb-0.5 text-[hsl(var(--muted-foreground))]'),
  p: ({ children }) => (
    <p className="text-sm leading-relaxed mb-0.5 text-[hsl(var(--foreground))]">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="list-disc pl-4 mb-0.5 text-sm space-y-0">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal pl-4 mb-0.5 text-sm space-y-0">{children}</ol>
  ),
  li: ({ children }) => (
    <li className="text-sm leading-relaxed text-[hsl(var(--foreground))] py-1">{children}</li>
  ),
  code: ({ children, className }) => {
    if (className) {
      return (
        <code className={cn(className, 'block text-sm font-mono')}>
          {children}
        </code>
      )
    }
    return (
      <code className="bg-[hsl(var(--muted))] rounded px-1 py-0.5 text-sm font-mono">
        {children}
      </code>
    )
  },
  pre: SmartPre,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-[hsl(var(--border))] pl-2 my-2 text-sm text-[hsl(var(--muted-foreground))] italic">
      {children}
    </blockquote>
  ),
  hr: () => (
    <hr className="border-t border-[hsl(var(--border))] my-1" />
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      className="text-[hsl(var(--primary))] underline hover:no-underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))] rounded-sm"
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  ),
  table: MarkdownTable,
  thead: MarkdownThead,
  tbody: MarkdownTbody,
  tr: MarkdownTr,
  th: MarkdownTh,
  td: MarkdownTd,
  strong: ({ children }) => (
    <strong className="font-semibold">{children}</strong>
  ),
  em: ({ children }) => (
    <em className="italic">{children}</em>
  ),
  del: ({ children }) => (
    <del className="line-through text-[hsl(var(--muted-foreground))]">{children}</del>
  )
}

// ---------------------------------------------------------------------------
// MarkdownContent
// ---------------------------------------------------------------------------

// Stable plugin arrays — module-level constants so ReactMarkdown never sees
// a new array reference across renders and can reuse its unified processor.
const REMARK_PLUGINS: React.ComponentProps<typeof ReactMarkdown>['remarkPlugins'] = [remarkGfm]

// Full pipeline: rehypeRaw (embedded HTML) + rehypeHighlight (syntax colors).
// Used when NOT streaming — runs highlight.js language auto-detection once.
const REHYPE_PLUGINS_FULL: React.ComponentProps<typeof ReactMarkdown>['rehypePlugins'] =
  [rehypeRaw, [rehypeHighlight, { detect: true }]]

// Streaming pipeline: rehypeRaw only — skip rehypeHighlight entirely.
// highlight.js auto-detection (`detect: true`) is the single most expensive
// per-frame operation during streaming (~40% of frame budget for long code
// blocks).  Code renders as plain monospace during streaming and gets syntax
// colors on the final (isStreaming → false) render.
const REHYPE_PLUGINS_STREAMING: React.ComponentProps<typeof ReactMarkdown>['rehypePlugins'] =
  [rehypeRaw]

// ---------------------------------------------------------------------------
// Frozen-prefix split — incremental markdown rendering for streaming
//
// During streaming, markdown text only GROWS (appends).  ReactMarkdown is a
// batch processor: it re-parses the ENTIRE string from scratch every frame.
// For a 2000-word response, that's ~7-8ms/frame even without highlight.js.
//
// The frozen-prefix split exploits the append-only property:
//   1. Find the last paragraph boundary (\n\n) outside code fences.
//   2. Everything BEFORE the boundary is "frozen" — complete markdown blocks
//      that will never change.  Render once, memoize with React.memo.
//   3. Everything AFTER is the "active tail" — the in-progress block being
//      streamed.  Re-parse per frame, but it's typically <200 chars.
//
// Result: per-frame markdown parse drops from O(full_text) to O(tail_block),
// a ~95% reduction for long responses.
// ---------------------------------------------------------------------------

/**
 * Incremental stable split point scanner.
 *
 * During streaming, content only GROWS (append-only).  A full O(N) scan from
 * the start on every frame is wasteful — for 10KB content that's ~0.5ms.
 *
 * This class caches the scan position and code-fence state between calls.
 * Each `update(text)` only scans the NEWLY APPENDED portion, making per-frame
 * cost O(delta) instead of O(N) — typically ~50 chars ≈ 0.001ms.
 *
 * Usage: create one instance per MarkdownContent mount (via useRef), call
 * `update()` each render, and read `.splitPoint`.
 *
 * The scanner auto-resets when the text shrinks (different content), ensuring
 * correctness when the component receives an entirely new markdown string.
 */
class IncrementalSplitScanner {
  /** Position right after the last confirmed paragraph boundary. */
  splitPoint = 0

  /**
   * Whether the end of the scanned text is inside a fenced code block.
   *
   * When `true`, the active tail (content after `splitPoint`) contains a
   * code fence opener that hasn't been closed yet.  Consumers use this to
   * bypass ReactMarkdown for the active tail and render code content
   * directly as `<pre><code>` — eliminating the AST parsing bottleneck
   * during long code block streaming.
   */
  inFencedCode = false

  /**
   * Absolute offset of the LAST code fence opener that is still open.
   * -1 when `inFencedCode` is false.
   *
   * This marks the start of the ``` / ~~~ line — consumers can slice
   * the active tail at `openFenceOffset - splitPoint` to separate
   * any prose before the fence from the code content after it.
   */
  openFenceOffset = -1

  /** How far we've already scanned. */
  private _scannedUpTo = 0

  /** Scan `text` for stable split points, resuming from previous state. */
  update(text: string): void {
    const len = text.length

    // If text shrunk or changed (not append-only), reset and full-scan.
    if (len < this._scannedUpTo) {
      this.splitPoint = 0
      this._scannedUpTo = 0
      this.inFencedCode = false
      this.openFenceOffset = -1
    }

    let i = this._scannedUpTo

    while (i < len) {
      // ── Detect fenced code blocks at line start ──
      if ((i === 0 || text.charCodeAt(i - 1) === 10 /* \n */) && i + 2 < len) {
        const c = text.charCodeAt(i)
        if ((c === 96 /* ` */ || c === 126 /* ~ */) &&
            text.charCodeAt(i + 1) === c && text.charCodeAt(i + 2) === c) {
          if (!this.inFencedCode) {
            // Opening fence — record its position
            this.inFencedCode = true
            this.openFenceOffset = i
          } else {
            // Closing fence — clear fence state
            this.inFencedCode = false
            this.openFenceOffset = -1
          }
          // Skip to end of line (fence may have language specifier)
          i += 3
          while (i < len && text.charCodeAt(i) !== 10) i++
          continue
        }
      }

      // ── Detect blank line (\n\n) outside fenced code ──
      if (!this.inFencedCode && text.charCodeAt(i) === 10 && i + 1 < len && text.charCodeAt(i + 1) === 10) {
        // Consume all consecutive newlines
        let end = i + 2
        while (end < len && text.charCodeAt(end) === 10) end++
        this.splitPoint = end
        // After advancing the split point, any previously tracked fence
        // opener is now inside the frozen prefix — clear it.
        this.openFenceOffset = -1
        i = end
        continue
      }

      i++
    }

    this._scannedUpTo = len
  }

  /** Reset scan state (e.g. when switching from streaming to non-streaming). */
  reset(): void {
    this.splitPoint = 0
    this._scannedUpTo = 0
    this.inFencedCode = false
    this.openFenceOffset = -1
  }
}

/**
 * Memo'd streaming markdown — used for the **frozen prefix** only.
 *
 * `React.memo` compares `content` by value (`===` on strings), so
 * identical content skips re-render entirely.  Since the frozen prefix
 * only grows when a new paragraph boundary is found, this renders at
 * most once per paragraph — not per frame.
 *
 * Uses remarkGfm + rehypeRaw (but NOT rehypeHighlight) — the final
 * non-streaming render applies full highlighting via REHYPE_PLUGINS_FULL.
 */
const FrozenPrefixMarkdown = memo(function FrozenPrefixMarkdown({ content }: { content: string }): React.JSX.Element {
  return (
    <ReactMarkdown
      remarkPlugins={REMARK_PLUGINS}
      rehypePlugins={REHYPE_PLUGINS_STREAMING}
      components={MARKDOWN_COMPONENTS}
    >
      {content}
    </ReactMarkdown>
  )
})

// ---------------------------------------------------------------------------
// Active tail renderers — the core of the streaming performance fix
//
// During streaming, the active tail (content after the last paragraph
// boundary) is re-rendered on every committed frame.  Using ReactMarkdown
// for this is the BOTTLENECK — full AST parsing (remark → MDAST → HAST →
// React elements) takes 5-11ms for a 200-line code block.
//
// Two specialized renderers eliminate this:
//   1. RawCodeTail — for code block tails: ZERO AST parsing.
//   2. LightProseTail — for prose tails: ReactMarkdown with NO plugins.
//
// When the tail moves to the frozen prefix (or streaming ends), full
// ReactMarkdown rendering produces the final quality output.
// ---------------------------------------------------------------------------

// Empty plugin arrays — module-level constants for stable reference identity.
const REMARK_PLUGINS_NONE: React.ComponentProps<typeof ReactMarkdown>['remarkPlugins'] = []
const REHYPE_PLUGINS_NONE: React.ComponentProps<typeof ReactMarkdown>['rehypePlugins'] = []

/**
 * Extract the language specifier from a code fence opening line.
 * e.g. "```typescript\n" → "typescript", "~~~\n" → ""
 */
function extractFenceLanguage(fenceLine: string): string {
  // Strip the ``` or ~~~ prefix and any trailing whitespace/newline
  return fenceLine.replace(/^[`~]{3,}\s*/, '').replace(/\s*$/, '')
}

/**
 * LightProseTail — lightweight ReactMarkdown for prose active tails.
 *
 * Strips ALL plugins (remarkGfm, rehypeRaw) for maximum parse speed.
 * ReactMarkdown without plugins still handles the core CommonMark syntax:
 * headings, paragraphs, emphasis, strong, code spans, links, images, lists.
 *
 * GFM features (tables, strikethrough, task lists) and embedded HTML are
 * temporarily unavailable in the active tail — they render correctly when
 * the tail moves to the frozen prefix or when streaming ends.
 *
 * Performance: ~2-3ms for a 500-char prose fragment (vs ~7-8ms with plugins).
 */
const LightProseTail = memo(function LightProseTail({ content }: { content: string }): React.JSX.Element {
  return (
    <ReactMarkdown
      remarkPlugins={REMARK_PLUGINS_NONE}
      rehypePlugins={REHYPE_PLUGINS_NONE}
      components={MARKDOWN_COMPONENTS}
    >
      {content}
    </ReactMarkdown>
  )
})

/**
 * RawCodeTail — zero-parse renderer for code block content during streaming.
 *
 * When the active tail is inside a fenced code block, there is NO markdown
 * to parse — the content is literal source code.  This component renders
 * it directly as `<pre><code>`, eliminating the 5-11ms/frame ReactMarkdown
 * AST parsing overhead entirely.
 *
 * Any prose BEFORE the code fence (within the same active tail) is rendered
 * via `LightProseTail` — handles core CommonMark syntax (emphasis, links,
 * etc.) while keeping the tail lightweight.  The prose content is typically
 * stable once the code fence opens, so memo skips re-render on most frames.
 *
 * Visual contract:
 *   - Code content appears in a monospace `<pre>` block (same as ReactMarkdown)
 *   - No syntax highlighting during streaming (same as current — rehypeHighlight
 *     was already disabled during streaming)
 *   - When the code block completes and moves to the frozen prefix, full
 *     ReactMarkdown renders it with proper AST + syntax classes
 *   - When streaming ends entirely, the final render adds rehypeHighlight colors
 *
 * @param proseBefore  Prose content before the code fence (may be empty)
 * @param lang         Language specifier from the fence (e.g. "typescript")
 * @param codeContent  Code after the fence opening line (the body being streamed)
 */
const RawCodeTail = memo(function RawCodeTail({
  proseBefore,
  lang,
  codeContent,
}: {
  proseBefore: string
  lang: string
  codeContent: string
}): React.JSX.Element {
  return (
    <>
      {proseBefore && <LightProseTail content={proseBefore} />}
      <div className="relative my-2 group/code">
        <pre className="bg-[hsl(var(--muted))] rounded p-1.5 text-sm font-mono overflow-x-auto">
          <code className={lang ? `language-${lang}` : undefined}>
            {codeContent}
          </code>
        </pre>
      </div>
    </>
  )
})

// ---------------------------------------------------------------------------
// Shared base className for the markdown wrapper div.
// ---------------------------------------------------------------------------
const MARKDOWN_BASE_CN = 'text-sm text-[hsl(var(--foreground))] leading-relaxed'

interface MarkdownContentProps {
  content: string
  className?: string
  /** When true, mermaid code blocks render as plain code (content may be incomplete). */
  isStreaming?: boolean
}

export const MarkdownContent = memo(function MarkdownContent({
  content,
  className,
  isStreaming
}: MarkdownContentProps): React.JSX.Element {
  // Fresh slug counter per render pass — ensures heading IDs match extractToc() output.
  // ReactMarkdown renders all components synchronously so this is safe.
  const slugCounterRef = useRef<Map<string, number>>(new Map())
  slugCounterRef.current = new Map()

  // Incremental split scanner — persists scan state between streaming frames.
  // O(delta) per frame instead of O(N) full scan.
  const scannerRef = useRef<IncrementalSplitScanner>(new IncrementalSplitScanner())

  // ── Non-streaming: two-phase rendering with deferred highlighting ──
  //
  // When isStreaming transitions from true → false, applying rehypeHighlight
  // synchronously blocks the main thread for 50-100ms per code block
  // (highlight.js language auto-detection is O(lines × languages)).
  // With 3 visible code blocks, that's 150-300ms of unresponsive UI.
  //
  // Fix: render immediately WITHOUT highlighting (same visual as streaming),
  // then apply full highlighting in an idle callback.  The user sees content
  // instantly; syntax colors appear ~50-100ms later — imperceptible.
  const [highlightReady, setHighlightReady] = useState(!isStreaming)

  useEffect(() => {
    if (isStreaming) {
      // Reset when entering streaming mode — next finalization starts fresh
      setHighlightReady(false)
      return
    }
    // Defer highlighting to next idle frame
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(() => setHighlightReady(true))
      return () => cancelIdleCallback(id)
    }
    // Fallback for environments without requestIdleCallback
    const id = setTimeout(() => setHighlightReady(true), 50)
    return () => clearTimeout(id)
  }, [isStreaming])

  if (!isStreaming) {
    // Reset streaming state so the next streaming session starts clean.
    scannerRef.current.reset()
    const rehypePlugins = highlightReady ? REHYPE_PLUGINS_FULL : REHYPE_PLUGINS_STREAMING
    return (
      <StreamingContext.Provider value={false}>
        <SlugCounterContext.Provider value={slugCounterRef}>
          <div className={cn(MARKDOWN_BASE_CN, className)}>
            <ReactMarkdown
              remarkPlugins={REMARK_PLUGINS}
              rehypePlugins={rehypePlugins}
              components={MARKDOWN_COMPONENTS}
            >
              {content}
            </ReactMarkdown>
          </div>
        </SlugCounterContext.Provider>
      </StreamingContext.Provider>
    )
  }

  // ── Streaming: frozen-prefix split ──
  //
  // Incrementally scan for the last paragraph boundary outside code fences.
  // Only the newly-appended text is scanned — O(delta) instead of O(N).
  // Frozen prefix → memo'd (parsed once, skips on subsequent frames).
  // Active tail   → dual-mode renderer (see below).
  const scanner = scannerRef.current
  scanner.update(content)
  const splitPoint = scanner.splitPoint
  const frozenPrefix = splitPoint > 0 ? content.slice(0, splitPoint) : ''
  const activeTail = content.slice(splitPoint)

  // ── Render active tail — direct pass-through (no throttle) ──
  //
  // The dual-mode renderers make per-frame throttling unnecessary:
  //   - RawCodeTail: 0ms parse cost (plain <pre><code> text node)
  //   - LightProseTail: ~2-3ms (ReactMarkdown without plugins)
  //
  // Both are well within the 16ms frame budget.  Any additional throttle
  // here only increases token-to-pixel latency (the main-process
  // DispatchThrottle already batches at ~16ms intervals).
  //
  // Mode selection:
  //   1. Code tail (inFencedCode=true): RawCodeTail — ZERO AST parsing.
  //      Prose before the fence rendered via LightProseTail (memo'd, stable).
  //   2. Prose tail (inFencedCode=false): LightProseTail — core CommonMark.
  //
  // When the tail moves to the frozen prefix or streaming ends, full
  // ReactMarkdown rendering produces the final quality output.
  const isCodeTail = scanner.inFencedCode
  let tailElement: React.JSX.Element | null = null
  if (activeTail) {
    if (isCodeTail && scanner.openFenceOffset >= 0) {
      // Split the tail at the code fence boundary
      const fenceOffsetInTail = scanner.openFenceOffset - splitPoint
      const proseBefore = fenceOffsetInTail > 0 ? activeTail.slice(0, fenceOffsetInTail).trimEnd() : ''
      const fenceAndCode = activeTail.slice(Math.max(0, fenceOffsetInTail))
      // Extract language from the fence opening line (e.g. "```typescript\n...")
      const firstNewline = fenceAndCode.indexOf('\n')
      const fenceLine = firstNewline >= 0 ? fenceAndCode.slice(0, firstNewline) : fenceAndCode
      const lang = extractFenceLanguage(fenceLine)
      const codeContent = firstNewline >= 0 ? fenceAndCode.slice(firstNewline + 1) : ''
      tailElement = <RawCodeTail proseBefore={proseBefore} lang={lang} codeContent={codeContent} />
    } else {
      // Prose tail or unknown fence position — use lightweight ReactMarkdown
      tailElement = <LightProseTail content={activeTail} />
    }
  }

  return (
    <StreamingContext.Provider value={true}>
      <SlugCounterContext.Provider value={slugCounterRef}>
        <div className={cn(MARKDOWN_BASE_CN, className)}>
          {frozenPrefix && <FrozenPrefixMarkdown content={frozenPrefix} />}
          {tailElement}
        </div>
      </SlugCounterContext.Provider>
    </StreamingContext.Provider>
  )
})
