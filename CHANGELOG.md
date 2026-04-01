# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.3.13] - 2026-03-31

### Added
- GitHub, GitLab, and Linear issue provider integration with bidirectional sync — pull remote issues into local workspace, push local changes back, and manage connections via Project Settings UI
- Remote issue MCP tools (`search_remote_issues`, `get_remote_issue`, `comment_remote_issue`) for AI agent access to external issue trackers
- Project Settings modal with provider add wizard, edit dialog, connection testing, and manual sync trigger
- Provider quick switcher for filtering the issue list by repository
- Batch operations toolbar with multi-select (Cmd/Ctrl+Click) for bulk status, priority, label, and delete actions
- Remote source metadata display in issue detail view (remote number, state, sync time)
- "Publish to remote" toggle in AI Issue Creator for creating issues directly on connected repositories

### Changed
- Streaming performance: dedicated progress throttle channel (200ms/5fps) reduces IPC round-trips by 75% for tool output while maintaining 50ms/20fps for text streaming
- StreamingMessageBuffer provides O(1) zero-copy streaming via direct ManagedSession reference
- DataBus skips expensive snapshotState() for non-mutating forwarding events during streaming
- IPC progress strings capped at 8000 characters to reduce structured-clone overhead
- Issue detail view layout simplified from resizable PanelGroup to fixed layout
- Optimistic issue patches for cross-store side effects avoid full loadIssues cascade

## [0.3.12] - 2026-03-31

### Added
- Editing support for queued items during sequential agent dispatch (#10)

### Changed
- GitHub Actions upgraded to Node.js 24 compatible versions: checkout v6, setup-node v6, pnpm/action-setup v5, node 22 LTS (#12)
- GitHub issue templates improved for better triage quality (#8)

### Fixed
- Streaming rendering pipeline optimized end-to-end for reduced latency (#11)
- Collapsed sub-issues no longer leak as orphan items in issue views (#9)
- Memory extraction now skips assistant responses in slash-command-driven turns to prevent template pollution (#7)

## [0.3.11] - 2026-03-30

### Added
- Engine-agnostic sessions with seamless per-turn engine switching — changing the default AI engine in Settings takes effect on the next message without restarting the session
- Structured dev-tracing logs across session lifecycle (QueryLifecycle, SessionOrchestrator, ManagedSession state transitions)
- Structured dev-tracing logs across memory system lifecycle (extraction, quality gate, retrieval, debounce queue)
- Project name display for project-scoped memories in list (e.g., "Project · OpenCow")

### Changed
- Memory maxContentLength raised from 500 to 1000 to accommodate structured knowledge
- Scope terminology unified: "User" → "Global" across memory UI
- Settings switch components (Updates, Memory) now reuse shared `Switch` from `ui/switch`

### Fixed
- Engine drift detection now runs before fast path in `resumeSessionInternal`, preventing silent engine switch ignoring for active sessions
- Silent memory loss from oversized content: three-layer defense (raised limit, prompt constraint, graceful truncation)
- Zero-candidate extraction failures now log diagnostic details (response structure, filter reasons)

## [0.3.10] - 2026-03-29

### Added
- Persistent memory system with LLM extraction, merge, quality gate, and management UI
- Cross-scope memory extraction with LLM-driven scope classification (user vs project)
- Memory Toast for real-time memory confirmation/editing with merge diff view
- MemoryView panel with search, category filter, bulk operations, and project scoping
- Memory Settings section with extraction delay configuration
- HeadlessLLMClient using Vercel AI SDK for engine-agnostic memory extraction

### Changed
- RepoAnalyzer migrated to SessionOrchestrator for engine-agnostic marketplace analysis
- Provider auth system extended with HTTPAuth abstraction and engine-specific API key providers (AnthropicApiKeyProvider / OpenAIApiKeyProvider)
- Memory extraction content strategy: full conversation with turn-based recent-priority compression (replaces last-10-messages window)
- Extraction pipeline excludes non-conversational sessions (market-analyzer, schedule)

### Fixed
- CapabilityCacheManager infinite recursion on package install (invalidate → dispatch → invalidate loop)
- MCP server configuration extracted to shared module to prevent SDK fatal exits
- UI lag during active agent streaming reduced
- Marketplace InstallDialog prevents Install button on empty/failed analysis results

## [0.3.9] - 2026-03-27

### Added
- (To be filled in before publishing the GitHub Release)

### Changed
-

### Fixed
-

## [0.3.8] - 2026-03-27

### Added
- (To be filled in before publishing the GitHub Release)

### Changed
-

### Fixed
-

## [0.3.7] - 2026-03-27

### Added
- (To be filled in before publishing the GitHub Release)

### Changed
-

### Fixed
-

## [0.3.6] - 2026-03-27

### Added
- (To be filled in before publishing the GitHub Release)

### Changed
-

### Fixed
-

## [0.3.5] - 2026-03-27

### Added
- (To be filled in before publishing the GitHub Release)

### Changed
-

### Fixed
-

## [0.3.4] - 2026-03-27

### Added
- (To be filled in before publishing the GitHub Release)

### Changed
-

### Fixed
-

## [0.3.3] - 2026-03-27

### Added
- (To be filled in before publishing the GitHub Release)

### Changed
-

### Fixed
-

## [0.3.2] - 2026-03-26

### Added
- macOS code signing and notarization in CI release workflow
- Hardened runtime entitlements for Electron app

### Changed
-

### Fixed
-

## [0.3.1] - 2026-03-26

### Added
- GitHub Release update checker with automatic and manual update checking
- In-app update notification banner with dismiss-per-version persistence
- Update status widget in About dialog (checking/up-to-date/available states)
- Updates section in Settings with auto-check toggle and interval configuration
- Release CI workflow for automated macOS builds and GitHub Release publishing
- 42 new tests for semver parsing, asset matching, and update store

### Changed
- Decomposed monolithic updateChecker into modular service architecture
- macOS app icon now uses rounded-rect shape for proper Dock rendering

### Fixed
- Check for Updates button now works (added IPC channel to preload whitelist)
- Settings shows explicit feedback when already up to date after manual check
- Tray menu state properly clears when no update is available

## [0.3.0] - 2026-03-26

### Added
- Initial release of OpenCow desktop application.
- Task-to-agent pipeline: one task = one agent.
- 15+ parallel agent sessions with suspend/resume.
- 4-layer deep context engine (org, project, team, task).
- Built-in task tracker with sub-task hierarchy.
- Capability Center with 6 capability types (skills, agents, commands, rules, hooks, MCP servers).
- Multi-engine support: Claude Agent SDK + OpenAI Codex SDK.
- IM integrations: Telegram, Discord, Feishu/Lark bots.
- Schedule automation with 7 trigger types.
- SQLite database with 35+ migrations via Kysely.
- Monaco Editor and xterm.js terminal integration.
- i18n support for English and Simplified Chinese.
- Event router architecture for session lifecycle management.
- Slash tools aligned with engine policy and native capabilities.
- File access security model with explicit path allowlists.
- Session orchestration revamp with provider drift detection.
- **Browser Agent** — Built-in browser with snapshot-ref system for accessibility-based element interaction, scroll controls, and screenshot rendering.
- **HTML Generation** — Interactive browser preview cards for AI-generated HTML content via `gen_html` tool.
- **WeChat (Weixin) Bot** — Full integration with image sending via CDN upload pipeline.
- **Evose Integration** — Distinct source origin for Evose skills, implicit skill reconfiguration, and alias-based activation.
- **Issue Store** — Extracted from appStore with dedicated action coordinators and test helpers.
- **IPC Dispatch Throttling** — SDK v0.2.50+ compatibility and session race recovery.
- **Command Palette** — Locale-aware search keywords loaded from i18n.

### Changed
- **Branding** — Replaced legacy Claude Code references with OpenCow branding throughout onboarding and UI.
- **Streaming Performance** — 60fps streaming dispatch, split-path streaming store, rAF coalescing, and row-level store subscriptions.
- **Session Architecture** — Centralized session state machine, unified orchestrator into SessionRuntime, and split SessionSnapshot for O(1) streaming.
- **AppStore** — Decomposed into domain slices with dedicated actions layer.
- **Browser Overlay** — Auto-protect all modals from native WebContentsView.

### Fixed
- Browser scroll defaults to actual viewport height instead of hardcoded 500px.
- Browser stop button no longer closes the browser window.
- Artifact modal no longer obscured by native WebContentsView.
- Streaming render cascade eliminated with narrow selectors and batch upserts.
- Stale state reads, scroll drift, and destroyed-view API calls in browser.
- Collapsed sidebar width preventing content clipping.
- Tray icon, issue store robustness, and floating promise cleanup.

### Security
- Added URL scheme validation for `shell.openExternal` (http/https only).
- Bumped `undici` to ^7.24.0 (CRLF injection + memory DoS fixes).
- Bumped `yaml` to ^2.8.3 (stack overflow DoS fix).
- Updated `@anthropic-ai/claude-agent-sdk` to ^0.2.83.
