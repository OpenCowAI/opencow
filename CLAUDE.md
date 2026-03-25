# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenCow is a Mac desktop client built with Electron and React for visually managing multiple Claude Code sessions and tasks.

**Core problem:** When developers run multiple Claude Code tasks across several terminals simultaneously, there is no easy way to get a quick overview of each task's status and progress. OpenCow solves this by providing a unified dashboard for monitoring and managing all active Claude Code sessions.

## Tech Stack

| Layer            | Choice                              |
|------------------|-------------------------------------|
| Desktop          | Electron (latest stable)            |
| UI               | React 19, functional components + hooks |
| Language         | TypeScript strict mode              |
| Styling          | Tailwind CSS                        |
| State Management | Zustand                             |
| Build            | Vite (electron-vite) + electron-builder |
| Testing          | Vitest + React Testing Library      |

## Architecture Highlights

### Two-Phase Delivery

1. **Monitor (MVP):** Read-only mode -- displays Claude Code sessions, tasks, and their statuses.
2. **Command (future):** Issue tasks, create/resume sessions directly from OpenCow.

The Monitor phase MUST NOT be blocked by design decisions intended for the Command phase.

### Claude Code Integration

OpenCow integrates with Claude Code through official interfaces only (MUST NOT modify Claude Code internals):

- **Hooks:** Register hooks via `settings.json` to listen for `SessionStart`, `Stop`, `TaskCompleted`, `Notification`, and other events, receiving JSON on stdin.
- **CLI:** Use `claude -p --output-format json` to programmatically query session state.
- **File system watching:** Watch `~/.claude/tasks/` (task state) and `~/.claude/projects/` (session memory).
- **MCP:** OpenCow runs a local MCP server to receive status updates pushed by Claude Code.

### Electron Security Constraints

- `contextIsolation: true` (must be enabled)
- `nodeIntegration: false` (disabled in the renderer process)
- Main and Renderer processes communicate via typed, validated IPC channels
- File system access is restricted to `~/.claude/` and directories the user explicitly opens

## Development Commands

```bash
# Install dependencies
pnpm install

# Development mode (Vite HMR + Electron)
pnpm dev

# Type checking
pnpm typecheck            # Run both node and web type checks
pnpm typecheck:node       # Main process only
pnpm typecheck:web        # Renderer process only

# Lint
pnpm lint

# Format
pnpm format

# Testing
pnpm test                 # Run all tests
pnpm test:watch           # Watch mode
npx vitest run <file>     # Run a single test file

# Build
pnpm build                # Build the renderer process
pnpm package              # Package the Electron .app (unsigned, directory output)
pnpm package:dmg          # Package as .dmg
```

## Code Conventions

- TypeScript strict mode; zero `any` usage
- Component files use PascalCase (`TaskCard.tsx`); utility files use camelCase (`parseHookEvent.ts`)
- Prefer functional components with hooks; avoid class components
- Prefer Tailwind utility classes for styling
- Follow the Conventional Commits format for commit messages
- Modules that handle Claude Code data (hook payloads, CLI JSON, task file parsing) MUST have type definitions and unit tests

## Quality Gates

1. `tsc --noEmit` -- zero errors
2. ESLint -- zero warnings
3. Prettier -- consistent formatting
4. Vitest -- all tests pass; new modules MUST include tests
5. UI components MUST have `aria-label` or semantic HTML and support keyboard navigation
6. Respect `prefers-reduced-motion` and `prefers-color-scheme`
7. WCAG 2.1 AA compliance

## Documentation

- When producing plans, analyses, or design documents, generate `.md` files for traceability.
- Start each document with a concise summary of the core idea before expanding into details.
- For flowcharts and architecture diagrams, prefer Mermaid syntax.

## Animation Guidelines

- Entry/exit transitions should feel natural and intentional.
- Dialog, Popover, Tooltip, and Toast components must include animations, and animations of the same type must be consistent across the application.
