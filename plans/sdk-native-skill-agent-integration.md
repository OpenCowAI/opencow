# SDK Native Skill & Agent Integration (Phase 1B.11d v2)

> **Status:** RFC — pending review
> **Author:** Hiko + Claude
> **Date:** 2026-04-10
> **Phase:** 1B.11d (follows 1B.11c)
> **Supersedes:** `skill-driven-capability-discovery.md` (v1, incorrect premise)

---

## TL;DR

OpenCow 的 CapabilityCenter 完全绕开了 SDK 内置的 SkillTool / AgentTool / Commands / Agents 机制,自己重造了一套功能弱、bug 多的 skill/agent 加载管道。本 RFC 的方向是**拆掉山寨,接入 SDK 原生**。

**两条并行通道:**
- **Native capability(8 个)** 走 Phase 1B.11b/c 已建成的 inline tool 出口 → `Options.tools`(启动时全量加载)
- **Marketplace skill / agent** 走 SDK 原生的 SkillTool / AgentTool → `Options.commands` / `Options.agents`(SDK 自己管 catalog、delta-emit、激活)

**结果:** 代码净减少 ~400 行,删掉 keyword matcher + 自造 catalog 拼接 + 自造激活逻辑。

---

## 1. 问题陈述

### 1.1 源码级证据(2026-04-10 亲手验证)

| 证据 | 引用 | 含义 |
|---|---|---|
| OpenCow electron/ 目录 `\bSkillTool\b` grep = 0 | `grep -rn "\\bSkillTool\\b" electron/` | **SDK 的 SkillTool 从未被 import 或引用** |
| OpenCow electron/ 目录 `\bAgentTool\b` grep = 0 | `grep -rn "\\bAgentTool\\b" electron/` | **SDK 的 AgentTool 从未被 import 或引用** |
| `ClaudeSessionLaunchOptions` 没有 `commands`/`agents`/`refreshTools` | `sessionLaunchOptions.ts:50-62` | **SDK 的 skill/agent/refresh 三条路被断开** |
| SDK `getAllBaseTools()` 无条件包含 SkillTool(line 212) + AgentTool(line 195) | `tools.ts:193-251` | SDK 假设这两个 tool 永远在,但 OpenCow 的 query 调用没给它们对应的 commands/agents 数据 |
| SDK `getModelInvocableCommands` 从 4 个目录扫 skill | `loadSkillsDir.ts:723-808` | SDK 有完整的 skill 扫描 + memoize 缓存机制 |
| SDK `formatCommandsWithinBudget`(1% context budget) | `SkillTool/prompt.ts:67-167` | SDK 有 catalog 拼装机制 |
| SDK `getSkillListingAttachment` 用 delta-emit | `attachments.ts:2680-2752` | SDK 有 delta catalog 注入机制 |
| SDK `Options.refreshTools` mid-turn 刷新 | `Tool.ts:178` + `query.ts:1655-1667` | SDK 有 turn 之间刷新 tool list 的机制 |

### 1.2 OpenCow 重造了什么

| 功能 | SDK 已有(file:line) | OpenCow 山寨版 |
|---|---|---|
| Skill 扫描 | `loadSkillsDir.ts:723`(4 目录 + memoize) | `capabilityStore.ts`(自己一套) |
| Skill 数据模型 | `Command` type(`types/command.ts:25-57`) | `DocumentCapabilityEntry`(`shared/types.ts`) |
| Skill catalog 拼装 | `formatCommandsWithinBudget`(1% budget, truncate) | `promptSegmentBuilder.ts`(`<skill>` XML) |
| Skill catalog 注入 | `getSkillListingAttachment`(delta attachment) | 全量塞 system prompt |
| Skill 激活 | 模型 call `Skill('name')` 工具 | keyword matcher(`skillActivationEngine.ts:78-296`) |
| Skill body 加载 | `SkillTool` inline → `newMessages` 进对话 | 永远塞在 system prompt |
| Agent 调用 | `AgentTool({ subagent_type, prompt })` → fork 子 query | 不存在;agent body 直接拼 system prompt |
| Agent 子 query 隔离 | `runAgent` 起独立 query + tool 集 | 不存在 |

### 1.3 山寨版造成的问题

1. **模型无法主动调用 marketplace skill/agent** — 它们只是 system prompt 文本
2. **keyword matcher 中文命中率近 0** — 已源码验证(`skillActivationEngine.ts` 用 `\s+` split,中文不分词)
3. **`ccb-XTyTIQFpUSI-` 事故** — 表层是 allowlist 太窄(已灭火),深层是 SkillTool 不在 tool list
4. **Token 浪费** — skill body 永远在 system prompt,无 delta、无 budget、无 on-demand
5. **双套维护** — CapabilityCenter 和 SDK 各有一套扫描/缓存/注入逻辑

---

## 2. 设计原则

1. **SDK first** — 优先使用 SDK 原生机制,只在 SDK 不能覆盖的地方写 OpenCow 代码
2. **二分法** — Native capability(Electron 进程独有)走 inline tool;Skill/Agent(markdown 文件)走 SDK SkillTool/AgentTool
3. **拆山寨** — 删除 OpenCow 自造的 skill/agent catalog/activation 管道,只保留 OpenCow 独有的业务逻辑(marketplace mount、eligibility、distribution)
4. **可见性 ≠ 治理** — 所有 native tool 默认可见,mutating 操作的治理在 LifecycleOperationCoordinator(已灭火 commit `d03bac05`)

---

## 3. 目标架构

```
┌───────────────────────────────────────────────────────────────────────┐
│ 用户 → OpenCow UI → sessionOrchestrator.runSession()                   │
└───────────────────────────────────────────────────────────────────────┘
                              │
           ┌──────────────────┼──────────────────┐
           │                  │                  │
           ▼                  ▼                  ▼
   Native Capability    Marketplace Skill    Marketplace Agent
   (8 个, TypeScript)   (markdown + frontmatter)(markdown + frontmatter)
           │                  │                  │
           │                  │                  │
     ┌─────┴─────┐    ┌──────┴──────┐    ┌──────┴──────┐
     │ Phase 1B  │    │ toSdkCommand│    │ toSdkAgent  │
     │ inline    │    │ (NEW)       │    │ Definition  │
     │ tool exit │    │             │    │ (NEW)       │
     └─────┬─────┘    └──────┬──────┘    └──────┬──────┘
           │                  │                  │
           ▼                  ▼                  ▼
     Options.tools      Options.commands    Options.agents
     (SdkTool[])        (Command[])         (AgentDefinition[])
           │                  │                  │
           └──────────────────┼──────────────────┘
                              │
                              ▼
                     SDK query() runtime
                     ┌────────────────────────────────────┐
                     │ getAllBaseTools() 无条件包含:          │
                     │   SkillTool (line 212)              │
                     │   AgentTool (line 195)              │
                     │                                    │
                     │ SkillTool.prompt() →                │
                     │   formatCommandsWithinBudget()      │
                     │   (1% context budget, delta-emit)   │
                     │                                    │
                     │ 模型 call Skill('name') →            │
                     │   inline: newMessages 进对话          │
                     │   fork: 子 agent query              │
                     │                                    │
                     │ 模型 call AgentTool({...}) →         │
                     │   fork: 独立子 query + tool 集        │
                     └────────────────────────────────────┘
```

---

## 4. 改动清单

### 4.1 新建文件

| 文件 | 行数 | 角色 |
|---|---|---|
| `electron/services/capabilityCenter/sdkCommandAdapter.ts` | ~100 | `toSdkCommand(entry: DocumentCapabilityEntry): Command` — 把 OpenCow skill 转成 SDK Command 格式 |
| `electron/services/capabilityCenter/sdkAgentAdapter.ts` | ~80 | `toSdkAgentDefinition(entry: DocumentCapabilityEntry): AgentDefinition` — 同上, for agent |
| `tests/unit/capabilityCenter/sdkCommandAdapter.test.ts` | ~100 | 转换器单测 |
| `tests/unit/capabilityCenter/sdkAgentAdapter.test.ts` | ~80 | 转换器单测 |

### 4.2 修改文件

| 文件 | 改动 |
|---|---|
| `electron/command/sessionLaunchOptions.ts:50-62` | `ClaudeSessionLaunchOptions` 加 `commands?: unknown[]`, `agents?: unknown[]`, `refreshTools?: () => unknown[]` |
| `electron/command/sessionOrchestrator.ts:runSession()` | 在 `options` 里加: `options.commands = capabilityPlan.skills.map(toSdkCommand)`, `options.agents = capabilityPlan.agents.map(toSdkAgentDefinition)` |
| `electron/services/capabilityCenter/sessionInjector.ts` | `buildCapabilityPlan` 不再把 skill 拼进 `capabilityPrompt`;skill 改由 `plan.sdkCommands` 返回;agent 改由 `plan.sdkAgents` 返回 |
| `electron/command/injection/claudeInjectionAdapter.ts` | 不再注入 skill/agent prompt 段(改由 SDK 的 SkillTool/AgentTool 自己管) |

### 4.3 删除代码

| 路径 | 删什么 |
|---|---|
| `electron/services/capabilityCenter/skillActivationEngine.ts` | 整个 keyword matcher(`scoreImplicitSkillMatch` / `scoreNameCandidate` / `resolveImplicitMatches` / 所有 `ImplicitSkillMatchPolicy`)。保留 `resolveSkillActivationDecisions` 的 explicit/agent/always 分支(仍然用来决定哪些 skill 进 `plan.sdkCommands`) |
| `electron/services/capabilityCenter/promptSegmentBuilder.ts` | 删除 `buildSkillPromptSegment` 的 `<skill>` XML 拼接(SDK 的 SkillTool 自己管 inline/fork) |
| `electron/command/policy/sessionPolicyInputFactory.ts` | 删除 `derivePromptPolicy` 里 `resolveImplicitSkillActivationQuery` 调用(不再需要 keyword 隐式匹配) |

### 4.4 净效果

| | 新增 | 删除 | 净 |
|---|---|---|---|
| 转换器 + tests | ~360 | 0 | +360 |
| sessionOrchestrator / sessionLaunchOptions | ~30 | 0 | +30 |
| sessionInjector 改动 | ~20 | ~80 | -60 |
| skillActivationEngine 删除 | 0 | ~200 | -200 |
| promptSegmentBuilder 删除 | 0 | ~60 | -60 |
| sessionPolicyInputFactory 删除 | 0 | ~50 | -50 |
| claudeInjectionAdapter 改动 | ~5 | ~20 | -15 |
| **合计** | **~415** | **~410** | **~0 (净持平,但删了 400 行山寨换了 400 行正确代码 + 测试)** |

---

## 5. 落地步骤

### Step 0(已完成,commit `d03bac05`):灭火
- 修正 `GENERAL_PURPOSE_NATIVE_TOOLS` 为全 8 个 capability 全开
- 表层消灭 `ccb-XTyTIQFpUSI-` 事故

### Step 1(0.5 天):SessionLaunchOptions 加字段 + toSdkOptions 透传
- 加 `commands?` / `agents?` / `refreshTools?` 到 `ClaudeSessionLaunchOptions`
- `toSdkOptions()` 无脑透传

### Step 2(1 天):写 `toSdkCommand` / `toSdkAgentDefinition` 转换器
- 把 `DocumentCapabilityEntry`(OpenCow 数据模型)转成 `Command`(SDK 数据模型)
- 字段映射:
  - `entry.name` → `cmd.name`
  - `entry.description` → `cmd.description`
  - `entry.body` → skill markdown body(SDK 的 `processPromptSlashCommand` 渲染它)
  - `entry.attributes.whenToUse` → `cmd.whenToUse`
  - `entry.metadata.allowedTools` → `cmd.allowedTools`
  - `entry.metadata.model` → `cmd.model`
  - `entry.metadata.context` → `cmd.context`(`'inline'` | `'fork'`)
  - `entry.scope` → `cmd.source`(`'projectSettings'` | `'userSettings'` | ...)
- AgentDefinition 类似映射
- 单测覆盖

### Step 3(0.5 天):sessionOrchestrator 接通
- `buildCapabilityPlan` 返回 `plan.sdkCommands: Command[]` 和 `plan.sdkAgents: AgentDefinition[]`
- `runSession` 里:
  ```ts
  options.commands = capabilityPlan.sdkCommands
  options.agents = capabilityPlan.sdkAgents
  ```
- 同时把 EvoseSkillProvider 产出的虚拟 skill 也走 `toSdkCommand` 路径(Evose app 变成 SDK Command,可以被 SkillTool 调)

### Step 4(0.5 天):删除山寨代码
- skillActivationEngine.ts keyword matcher 段
- promptSegmentBuilder.ts skill/agent 拼接段
- sessionPolicyInputFactory.ts implicit derivation
- claudeInjectionAdapter.ts skill/agent prompt 注入段

### Step 5(1 天):测试
- 单测:转换器 + sessionOrchestrator 改动
- 集成测试:复跑 `ccb-XTyTIQFpUSI-` prompt
  - 验证 SkillTool 在 tool list 里
  - 验证 marketplace skill 的 catalog 注入(via SDK delta-emit)
  - 验证模型能 `Skill('name')` 调用 marketplace skill
- 回归:capability tests 全过

### Step 6(0.5 天):删 Codex 路径(与 v1 RFC 相同)

**总计:~4 天**

---

## 6. Open Questions

### 6.1 SDK 的 SkillTool / AgentTool 在 OpenCow 的 query 调用链上是否工作

SDK `sdkRuntime.ts:487-512` 初始化 tool list 时走 `getAllBaseTools()` → 无条件包含 `SkillTool`、`AgentTool`。但 `sdkRuntime.ts:434` 也读 `options.tools`(OpenCow 的 inline 出口)并 push 进 `sdkTools`。**两个来源合并**。

**需要验证:** `SkillTool.call()` 内部调 `getModelInvocableCommands()` 时,它是读 `options.commands`(OpenCow 传的)还是从文件系统扫?(大概率两者都读,合并去重)。如果 SDK 不读 `options.commands`,我们需要改 `commandRuntime.ts` 让它也接受外部传入的 commands。

**优先验证此项** — Step 1 的一部分。

### 6.2 EvoseSkillProvider 的虚拟 skill 怎么走 SDK

Evose app 是 OpenCow 独有的(不是文件系统上的 markdown)。现在它通过 `EvoseSkillProvider` 投影成 `DocumentCapabilityEntry`。新方向下,这些 entry 也要走 `toSdkCommand()` 转成 SDK Command,让 SkillTool 能 catalog 它们。

**关键:** Evose 的 `metadata.nativeRequirements` 桥仍然需要 — 激活 Evose skill 后,对应的 evose native tool 需要进入 allowlist。这个桥在 `sessionInjector.ts:356-382` 的 `collectNativeRequirementsFromSkills` 里。新架构下,这个函数需要改为从 SkillTool 的激活状态读(而不是从 promptSegmentBuilder 的 full/catalog 模式读)。

### 6.3 `metadata.nativeRequirements` 在 SDK 侧怎么触发

现有桥:`skill.metadata.nativeRequirements` → `collectNativeRequirementsFromSkills` → `capabilityPlan.nativeRequirements` → `sessionOrchestrator` merge 进 allowlist。

新架构下,这个桥**仍然需要**,但触发点变了:不是「CapabilityCenter 的 full/catalog 模式决策」触发,而是「SDK 的 SkillTool 激活状态」触发。需要设计一个回调:SDK SkillTool call 成功后 → 通知 OpenCow → OpenCow 把对应的 nativeRequirements 加进 allowlist → `refreshTools()` 重算 inline tool list。

这是**最复杂的一个连接点**,可能需要 1-2 天额外工作。Step 3 里会详细设计。

### 6.4 capability prompt layers 还剩什么

删掉 skill/agent 拼接后,`capabilityPrompt` 还剩 **rules** 段。Rule 不走 SkillTool/AgentTool,它是「始终注入 system prompt」的强制性指令。保留。

---

## 7. 验收标准

- [ ] SDK 的 SkillTool 出现在模型的 tool list
- [ ] SDK 的 AgentTool 出现在模型的 tool list
- [ ] Marketplace skill 能被 `Skill('name')` 调用(inline 模式)
- [ ] Marketplace agent 能被 `AgentTool({ subagent_type: 'name', ... })` 调用
- [ ] Evose 虚拟 skill 能被 `Skill('evose:app-name')` 调用
- [ ] Native capability tools(8 个)始终在 tool list(inline tool 出口)
- [ ] `skillActivationEngine.ts` 的 keyword matcher 函数全部删除
- [ ] `ccb-XTyTIQFpUSI-` 复跑通过
- [ ] `pnpm typecheck:node` / `:web` 无新增 error
- [ ] 全部 capability tests pass

---

## 8. 与 Phase 1B 的关系

| Phase | 角色 |
|---|---|
| 1B.0–1B.10 | SDK Capability Provider 框架 |
| 1B.11 / 1B.11b | OpenCow 切到 SDK 框架 + inline tool 出口 |
| 1B.11c | 删 TInput 死泛型 + 框架 schema 校验 + 类型化 args |
| **1B.11d v2 (本 RFC)** | **拆山寨,接 SDK 原生 SkillTool/AgentTool** |
| 1B.11e | NativeCapabilityRegistry shim 清理 |
| 1B.11f | Codex 删除 |

---

## 9. 一句话总结

**把 OpenCow 从「SDK 是一个 query 引擎,其他全自己造」的姿势,矫正到「SDK 管 skill/agent 发现和激活(它比我们做得好),OpenCow 只管 Electron 进程独有的 8 个 native capability 和 marketplace 业务逻辑(mount/eligibility/distribution)」的姿势。代码量持平(删山寨 + 加转换器 + 测试),但行为正确性和可维护性量级提升。**
