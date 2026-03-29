// SPDX-License-Identifier: Apache-2.0

/**
 * VirtuosoShell — Module-level Virtuoso sub-components and layout constants.
 *
 * Extracted from SessionMessageList.tsx.  These components MUST be defined
 * at module level to maintain stable references across renders.  Defining
 * them inline would create new component types each render, causing React
 * to unmount/remount the scroller DOM element and reset scrollTop to 0.
 *
 * See the CRITICAL comment block in the original file for the full explanation.
 */

import { createContext, useContext, forwardRef } from 'react'

/** Display variant for user messages — defined here to avoid circular imports. */
export type MessageListVariant = 'cli' | 'chat'

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

/**
 * Bottom padding (px) for the Virtuoso Footer spacer.
 *
 * Virtuoso measures Footer height via ResizeObserver and includes it in the
 * total scroll extent, making this the idiomatic way to add bottom breathing
 * room to a virtualised list.  We use inline styles (not Tailwind classes) to
 * guarantee the spacer is never purged or overridden.
 */
export const FOOTER_BASE_PADDING = 24

/**
 * Over-scan buffer — tells Virtuoso to render items this far outside the
 * visible viewport.  Larger top values reduce blank-flash when scrolling up
 * through complex cards; smaller bottom values reduce wasted renders below.
 */
export const INCREASE_VIEWPORT_BY = { top: 800, bottom: 200 } as const

// ---------------------------------------------------------------------------
// Virtuoso context — carries per-instance config to module-level sub-components.
//
// IMPORTANT: Only include props that are used by Scroller/List sub-components
// AND that are stable across session lifecycle changes.  Props that change
// frequently (like footerNode) must use a separate React Context to avoid
// triggering Virtuoso's full item re-render when context changes.
// ---------------------------------------------------------------------------

export interface VirtuosoContext {
  variant: MessageListVariant
}

// ---------------------------------------------------------------------------
// Footer node context — dedicated channel for VirtuosoFooter.
//
// Separated from VirtuosoContext because footerNode changes on session
// lifecycle transitions (e.g. Stop Session → ArtifactsSummaryBlock appears)
// while variant is effectively constant after mount.  Bundling them in
// Virtuoso's context prop would cause Virtuoso to re-render ALL visible
// items on every footerNode change — a costly no-op since items don't use
// footerNode.  With a dedicated React Context, only VirtuosoFooter re-renders.
// ---------------------------------------------------------------------------

export const FooterNodeContext = createContext<React.ReactNode>(undefined)

// ---------------------------------------------------------------------------
// Virtuoso sub-components — MUST be defined at module level.
//
// CRITICAL: Defining forwardRef components inline inside the render function
// (or inside the components={{...}} object literal) creates a NEW component
// type on every render.  React treats different types as different components:
//   old Scroller (type A) → unmount → new Scroller (type B) → mount
// When the Scroller DOM element is destroyed, scrollTop resets to 0 — the
// list snaps to the top.  This was the root cause of the scroll-to-top bug.
//
// By defining components at module level, the reference is stable across
// renders, so React reuses the existing DOM element and preserves scrollTop.
//
// The `context` prop is injected by Virtuoso from <Virtuoso context={...}>
// and carries instance-specific configuration without closures.
// ---------------------------------------------------------------------------

type VirtuosoSubComponentProps = React.ComponentPropsWithoutRef<'div'> & {
  context?: VirtuosoContext
}

const VirtuosoScroller = forwardRef<HTMLDivElement, VirtuosoSubComponentProps>(
  function VirtuosoScroller({ style, context, ...props }, ref) {
    return (
      <div
        ref={ref}
        style={style}
        {...props}
      />
    )
  },
)

const VirtuosoList = forwardRef<HTMLDivElement, VirtuosoSubComponentProps>(
  function VirtuosoList({ style, context, ...props }, ref) {
    const isChat = context?.variant === 'chat'
    return (
      <div
        ref={ref}
        style={isChat ? {
          ...style,
          maxWidth: 640,
          width: '100%',
          marginLeft: 'auto',
          marginRight: 'auto',
        } : style}
        className="py-2 space-y-0.5 px-3"
        role="list"
        aria-label="Session messages"
        {...props}
      />
    )
  },
)

// Footer — module-level for reference stability (same principle as Scroller/List).
// Uses a dedicated React Context (FooterNodeContext) instead of Virtuoso's context
// prop, so footerNode changes only trigger a Footer re-render — not a full item
// re-render of the entire visible list.
//
// IMPORTANT: Always renders a SINGLE stable <div> regardless of whether footerNode
// is present.  A single div with a stable `paddingBottom` minimises the DOM diff
// when the footer content transitions (e.g. spacer → ArtifactsSummaryBlock).
//
// The paddingBottom (FOOTER_BASE_PADDING) provides visual breathing room below the
// last content element.  The parent Virtuoso container's `bottom` tracks the
// overlay height — so the footer is never hidden behind the floating panel.
//
// NOTE: footerNode is gated by `mountSettled` in the Provider (see render section).
// On mount, the context value is `undefined` for ~3 frames while Virtuoso performs
// its initial measurement cycle.  This prevents the footer content (e.g.
// ArtifactsSummaryBlock) from rendering during layout settling, eliminating the
// visual jitter that would otherwise occur on issue switch.
function VirtuosoFooter() {
  const footerNode = useContext(FooterNodeContext)
  return (
    <div
      className={footerNode ? 'mt-3 px-3' : undefined}
      style={{ paddingBottom: FOOTER_BASE_PADDING }}
      aria-label={footerNode ? 'Session summary' : undefined}
      aria-hidden={footerNode ? undefined : true}
    >
      {footerNode}
    </div>
  )
}

// Stable components object — all references are module-level constants,
// so Virtuoso never sees a component identity change across renders.
export const VIRTUOSO_COMPONENTS = {
  Scroller: VirtuosoScroller,
  List: VirtuosoList,
  Footer: VirtuosoFooter,
}
