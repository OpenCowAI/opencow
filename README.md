<div align="center">

<p align="right">
  <strong>English</strong> · <a href="README.zh-CN.md">简体中文</a>
</p>

<img src="src/renderer/assets/opencow-ip.png" alt="OpenCow" width="160" />

# OpenCow

### One Task. One Agent. Delivered.

The open-source platform for task-driven autonomous AI.<br/>
Every task becomes an autonomous agent — campaigns, reports, features, audits<br/>
ship in parallel. For every team.

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-40-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[How It Works](#how-it-works) · [Features](#the-platform) · [Quick Start](#quick-start) · [Architecture](#architecture) · [Contributing](#contributing)

**[Website](https://opencow.ai)** · **[Download](https://opencow.ai/download)**

</div>

---

<div align="center">
<img src="resources/issues-preview-light.png" alt="OpenCow Issues Preview" width="820" />
</div>

## How It Works

### Task In. Result Out.

| Step | What happens |
|:----:|:-------------|
| **Create** | Write a task, not a prompt. Describe the deliverable — a campaign, a report, a feature, an audit. OpenCow links full context: project files, prior work, related tasks. |
| **Dispatch** | One task, one agent. Each task gets a dedicated agent with full context — project knowledge, team playbooks, organizational standards. 15 tasks, 15 agents, in parallel. |
| **Deliver** | Agents research, draft, build, and publish — autonomously. Real-time progress, instant notifications, approval gates at every step. Review. Ship. |

---

## The Platform

Everything to turn your task list into a parallel AI workforce.

<table>
<tr>
<td width="50%">

### Task-to-Agent Pipeline
Built-in task tracker where every task becomes an agent. Break projects into sub-tasks, each with a dedicated agent. Your task list IS your delivery plan.

`1 Task = 1 Agent` · `Sub-task hierarchy` · `Auto-linked context`

</td>
<td width="50%">

### Agent Intelligence
Equip agents with your org's knowledge, standards, and tools. Skills, playbooks, integrations — every agent follows your processes.

`Custom skills` · `6 capability types` · `Auto-sync standards`

</td>
</tr>
<tr>
<td>

### Agent Command Center
Real-time dashboard. Track every agent's progress and actions. Approve deliverables. One screen, full visibility.

`Live monitoring` · `Task-linked status` · `Approval gates`

</td>
<td>

### Work from Anywhere
Dispatch agents from Telegram, Discord, WeChat, or Lark. Schedule recurring workflows. Get notified via webhooks.

`4 IM platforms` · `Natural language` · `7 schedule types`

</td>
</tr>
</table>

---

## Everything. Built In.

No plugins. No integrations to configure. Every capability your AI workforce needs.

<table>
<tr>
<td width="25%" align="center">

**Task & Agent Core**
<br/><sub>Task Tracker · Agent Dashboard<br/>Live Monitor · Multi-Project</sub>

</td>
<td width="25%" align="center">

**Intelligence**
<br/><sub>Intelligence Hub · Marketplace<br/>Built-in Browser · Artifacts</sub>

</td>
<td width="25%" align="center">

**Automation**
<br/><sub>Scheduling · Webhooks<br/>Notifications · Live Preview</sub>

</td>
<td width="25%" align="center">

**Command & Control**
<br/><sub>IM Command · Terminal<br/>Command Palette · Themes</sub>

</td>
</tr>
</table>

---

## Built Different

The design decisions that define OpenCow.

| | Principle | What it means |
|:---:|:----------|:-------------|
| **1:1** | Task &rarr; Agent | One task, one agent. Full context. Full traceability. Zero ambiguity. |
| ✅ | Local & Private | Everything runs on your machine. Zero telemetry. Zero cloud. Your data never leaves. |
| **15+** | Parallel Agents | Deliver 15+ tasks simultaneously. Suspend and resume any agent without losing context. |
| **4-Layer** | Deep Context Engine | Every agent inherits organizational knowledge, project context, team standards, and task-specific instructions. |

---

## Quick Start

### From source (for contributors)

**Prerequisites:** [Node.js](https://nodejs.org/) >= 18 and [pnpm](https://pnpm.io/) >= 9

```bash
# Clone the repository
git clone https://github.com/OpenCowAI/opencow.git
cd opencow

# Install dependencies
pnpm install

# Launch in development mode (HMR enabled)
pnpm dev
```

### Download the app

Grab the latest release from [opencow.ai/download](https://opencow.ai/download) — free, open source, ready in 60 seconds.

---

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| **Desktop** | Electron 40 | Cross-platform, native-grade experience |
| **UI** | React 19 + Tailwind CSS 4 | Concurrent rendering, utility-first styling |
| **Language** | TypeScript (strict, zero `any`) | End-to-end type safety |
| **State** | Zustand | Lightweight reactive stores with row-level subscriptions |
| **Build** | electron-vite (Vite) | Sub-second HMR, triple-target build |
| **Database** | SQLite via Kysely | Local-first, type-safe schema with 35+ migrations |
| **Terminal** | xterm.js + WebGL | Hardware-accelerated terminal rendering |
| **Editor** | Monaco Editor | VS Code-grade editing experience |
| **Testing** | Vitest + React Testing Library | Fast, modern test runner |
| **AI** | Claude Agent SDK + Codex SDK + MCP | Multi-engine — choose Claude or Codex as your AI engine, with Model Context Protocol |

---

## Architecture

OpenCow follows a hardened Electron architecture with strict process isolation:

```
┌─────────────────────────────────────────────────────┐
│                   Renderer Process                   │
│  ┌───────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │  React 19  │  │  Zustand  │  │  271 Components  │  │
│  │ Components │  │  Stores   │  │  68 Hooks        │  │
│  └─────┬─────┘  └────┬─────┘  └────────┬─────────┘  │
│        └──────────────┴─────────────────┘            │
│                        │ IPC (contextBridge)         │
├────────────────────────┼────────────────────────────┤
│                    Main Process                      │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐  │
│  │  DataBus  │  │ Services │  │  Native Modules   │  │
│  │  Events   │  │  (47+)   │  │  SQLite · PTY     │  │
│  └──────────┘  └──────────┘  └───────────────────┘  │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐  │
│  │  Claude   │  │  Bot     │  │  Capability       │  │
│  │  Agent SDK│  │  Gateway  │  │  Center           │  │
│  └──────────┘  └──────────┘  └───────────────────┘  │
└─────────────────────────────────────────────────────┘
```

**Security model:**
- `contextIsolation: true` — renderer cannot access Node.js
- `nodeIntegration: false` — no direct module loading
- Type-safe IPC bridge via `contextBridge.exposeInMainWorld`
- Sandboxed file access with explicit path allowlists
- Separate data directories for dev (`~/.opencow-dev`) and production (`~/.opencow`)

---

## Project Structure

```
opencow/
├── electron/                  # Main process
│   ├── main.ts               # App entry point
│   ├── preload.ts            # Secure IPC bridge
│   ├── services/             # 47+ backend service modules
│   │   ├── capabilityCenter/ # AI capability management
│   │   ├── schedule/         # Cron automation engine
│   │   ├── messaging/        # Multi-channel messaging
│   │   ├── git/              # Git integration layer
│   │   └── ...
│   ├── database/             # SQLite schema & migrations
│   ├── sources/              # Hook, task, and stats data sources
│   └── ipc/                  # IPC channel handlers
├── src/
│   ├── renderer/             # React application
│   │   ├── components/       # 32 feature modules, 271 components
│   │   ├── hooks/            # 68 custom React hooks
│   │   ├── stores/           # 18 Zustand domain stores
│   │   ├── lib/              # Utilities & helpers
│   │   └── locales/          # i18n (en-US, zh-CN)
│   └── shared/               # Cross-process types & utilities
├── tests/                    # Vitest test suite
├── docs/                     # 520+ design docs & proposals
└── resources/                # App icons & tray assets
```

---

## Development

### Scripts

| Command | What it does |
|---------|-------------|
| `pnpm dev` | Start with HMR |
| `pnpm build` | Compile all targets |
| `pnpm preview` | Build + launch in production mode |
| `pnpm package` | Build + package `.app` (fast, for testing) |
| `pnpm package:dmg` | Build + package `.dmg` installer |
| `pnpm typecheck` | TypeScript strict check |
| `pnpm lint` | ESLint |
| `pnpm format` | Prettier |
| `pnpm test` | Run all tests |
| `pnpm test:watch` | Watch mode |

### Build Targets

electron-vite compiles three independent TypeScript targets:

| Target | Entry | Output |
|--------|-------|--------|
| Main | `electron/main.ts` | `out/main/` |
| Preload | `electron/preload.ts` | `out/preload/` |
| Renderer | `src/renderer/index.html` | `out/renderer/` |

### Path Aliases

- `@` &rarr; `src/renderer` (renderer only)
- `@shared` &rarr; `src/shared` (all targets)

### Code Standards

- **TypeScript** strict mode, zero `any` usage
- **Prettier** — no semicolons, single quotes, 100 char width, 2-space indent
- **ESLint** — strict rules with React Hooks plugin
- **Conventional Commits** — `feat:`, `fix:`, `perf:`, `refactor:`, etc.

---

## Packaging

```bash
# macOS .app (for local testing, fast)
pnpm package
# Output: dist/mac-arm64/OpenCow.app

# macOS .dmg (for distribution)
pnpm package:dmg
# Output: dist/OpenCow-{version}.dmg
```

Cross-platform builds for Windows and Linux are supported via electron-builder configuration in `package.json`.

---

## Contributing

We welcome contributions of all kinds — bug fixes, features, docs, and ideas.

```bash
# 1. Fork & clone
git clone https://github.com/<you>/opencow.git
cd opencow

# 2. Install & run
pnpm install && pnpm dev

# 3. Create a branch, make changes, submit a PR
git checkout -b feat/my-feature
```

Please read **[CONTRIBUTING.md](CONTRIBUTING.md)** for the full guide on code style, commit format, and review process.

---

## Community

- [X (Twitter)](https://x.com/OpenCowAI) — Follow us for updates
- [Discord](https://discord.gg/dDsjwb5pzN) — Chat with the community
- [GitHub Issues](https://github.com/OpenCowAI/opencow/issues) — Bug reports & feature requests
- [GitHub Discussions](https://github.com/OpenCowAI/opencow/discussions) — Questions & ideas
- [Code of Conduct](CODE_OF_CONDUCT.md) — Our community standards

---

## Star History

<div align="center">

<a href="https://www.star-history.com/?repos=OpenCowAI%2Fopencow&type=date&legend=top-left"> <picture>   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=OpenCowAI/opencow&type=date&theme=dark&legend=top-left" />   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=OpenCowAI/opencow&type=date&legend=top-left" />   <img alt="Star History Chart" src="https://api.star-history.com/image?repos=OpenCowAI/opencow&type=date&legend=top-left" /> </picture></a>

</div>

---

## License

[Apache-2.0](LICENSE) — completely free and open source. No paid tiers, no usage limits, no subscriptions.

> **Third-party SDKs:** OpenCow integrates with third-party AI SDKs (e.g. `@anthropic-ai/claude-agent-sdk`, `@openai/codex-sdk`) that are subject to their own license terms. Please review each SDK's license before use.

<div align="center">
<br />
<sub>Autonomous Agents for Every Team.</sub>
</div>
