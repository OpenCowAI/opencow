# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

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
