# Skill-Driven Capability Discovery (Phase 1B.11d) — SUPERSEDED

> **Status:** ~~RFC~~ **SUPERSEDED** by `sdk-native-skill-agent-integration.md`
> **Author:** Hiko + Claude
> **Date:** 2026-04-10
> **Superseded reason:** This RFC assumed OpenCow should build its own progressive disclosure mechanism (catalog + meta-tool + NativeSkillProvider projection). Source-level analysis revealed that the SDK already has a complete skill/agent discovery system (SkillTool, AgentTool, Commands API, delta-emit catalog, refreshTools) that OpenCow completely bypasses. The correct approach is to tear down OpenCow's redundant CapabilityCenter skill/agent pipeline and connect to the SDK's native mechanisms. See `sdk-native-skill-agent-integration.md` for the replacement RFC.

---

## TL;DR

把 OpenCow 的 native capability 和 marketplace skill 统一到**单一的 skill 抽象**之下,通过**「catalog 注入 system prompt + 一个 `Skill` 工具」**的渐进式披露机制让 LLM 自己决定激活哪些能力。

**核心结论:**

1. **OpenCow 已经有了 90% 的基础设施** — `metadata.nativeRequirements` 桥、skill 的 `full`/`catalog` 双模式、`appendProjectedEvoseSkills` 投影模式、每轮重算的 `planSessionPolicy`。我们要做的不是发明,是把缺的拼图补齐。
2. **删除 keyword matcher**(`skillActivationEngine.ts` 的 `scoreImplicitSkillMatch` 等)。模型自己读 catalog,自己决策,框架不算分。
3. **Native capability 投影成虚拟 skill**(7 个新 SkillProvider,跟 EvoseSkillProvider 同构)。
4. **新增内置 `Skill` meta-tool**,模型调用它把某个 skill 从 `catalog` 翻成 `full` 模式,触发 `nativeRequirements` 进入下一轮 `Options.tools`。
5. **Marketplace skill 同步迁移到同一机制** — 一套架构覆盖所有 skill 来源,无双轨。
6. **顺手删 Codex** 路径,后续作为独立任务。

**预期改动:** 净减少 ~600 行代码(删的比加的多)。落地约 **5 个工作日**:0.5 RFC + 2.5 主体 + 1 shim 清理 + 1 Codex 删除。

---

## 1. Background — 当前状态(已验证)

### 1.1 现有架构的三层数据流

```
┌──────────────────────────────────────────────────────────────────┐
│ 第一层:Skill 注册                                                  │
│                                                                  │
│  CapabilityCenter.getSnapshot()                                  │
│    ├─ discoveryEngine.buildSnapshot() — 文件系统 skill            │
│    │   (marketplace / project local / global,                   │
│    │    全部走 CapabilityStore.list)                              │
│    └─ appendProjectedEvoseSkills() — Evose 虚拟投影                │
│        (硬编码后处理,把 EvoseSettings.apps 转成 DocumentCapabilityEntry) │
│                                                                  │
│  → snapshot.skills: DocumentCapabilityEntry[]                    │
└──────────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────────┐
│ 第二层:每轮 Plan 构建(per user message)                            │
│                                                                  │
│  sessionOrchestrator.runSession()                                │
│    └─ planSessionPolicy({ origin, prompt })                       │
│        ├─ derivePromptPolicy(prompt)                              │
│        │   └─ resolveImplicitSkillActivationQuery (keyword matcher)│
│        └─ buildCapabilityPlan({ snapshot, request })              │
│            ├─ resolveSkillActivationDecisions(skills, ...)        │
│            │   ├─ explicit (slash command) → mode='full'          │
│            │   ├─ agent metadata → mode='full'                    │
│            │   ├─ always=true → mode='full'                       │
│            │   ├─ implicit (keyword scoring) → mode='full'        │
│            │   └─ default → mode='catalog'                        │
│            ├─ buildSkillPromptSegment(skill, decision)            │
│            │   ├─ mode='full' → <skill><instructions>{body}      │
│            │   └─ mode='catalog' → <skill><frontmatter>{meta}    │
│            └─ collectNativeRequirementsFromSkills(...)            │
│                ↑ 只对 mode='full' 的 skill 提取 nativeRequirements   │
│                                                                  │
│  → CapabilityPlan {                                              │
│       capabilityPrompt,        // 拼接后的 system prompt 段       │
│       nativeRequirements,      // 从激活 skill 收集的 native 需求     │
│       ...                                                        │
│    }                                                             │
└──────────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────────┐
│ 第三层:Tool Wiring                                                │
│                                                                  │
│  sessionOrchestrator (line 772-780)                              │
│    └─ merge plan.nativeRequirements into                         │
│        sessionPolicy.tools.native.allow                          │
│    └─ getInlineToolsForSession({ allowlist })                    │
│    └─ Options.tools = [...inlineTools]                           │
│                                                                  │
│  → SDK query 拿到完整 tool 列表                                    │
└──────────────────────────────────────────────────────────────────┘
```

**关键发现:** 这条流水线已经支持「skill 激活 → tool 入场」的语义,只是激活的触发是 keyword matcher。把 trigger 换成「模型主动 call Skill tool」就完成了从「框架猜」到「模型决策」的转换。

### 1.2 关键文件清单(已验证)

| 文件 | 行号 | 角色 |
|---|---|---|
| `electron/services/capabilityCenter/sessionInjector.ts` | 113-269 | `buildCapabilityPlan` 主流程 |
| 同上 | 356-382 | `collectNativeRequirementsFromSkills` — 把 metadata.nativeRequirements 聚合 |
| 同上 | 403-443 | `resolveImplicitNativeRequirements` — 用于消息间 reconfiguration |
| `electron/services/capabilityCenter/skillActivationEngine.ts` | 78-296 | **要删** — keyword matcher |
| `electron/services/capabilityCenter/promptSegmentBuilder.ts` | 25-99 | `<skill>` / `<evose-app>` 注入 system prompt(full vs catalog) |
| `electron/services/capabilityCenter/discoveryEngine.ts` | 70-92 | `buildSnapshot` — 6 category 文件系统发现 |
| `electron/services/capabilityCenter/index.ts` | 200-234 | `appendProjectedEvoseSkills` — Evose 投影 hook(要泛化) |
| `electron/services/capabilityCenter/evoseSkillProvider.ts` | 27-103 | EvoseSkillProvider 范本 |
| `electron/command/policy/sessionPolicyInputFactory.ts` | 68-74 | `GENERAL_PURPOSE_NATIVE_TOOLS` — **要删** |
| 同上 | 89-153 | `resolveDefaultPolicyByOrigin` — origin → 默认 allowlist |
| `electron/command/sessionOrchestrator.ts` | 519 | 每轮 `planSessionPolicy` 调用点 |
| 同上 | 772-780 | `nativeRequirements` 合并进 `sessionPolicy.tools.native.allow` |
| 同上 | 851-870 | `getInlineToolsForSession` 拼 inline tool 数组 |

### 1.3 当前 default allowlist(已纠正)

`GENERAL_PURPOSE_NATIVE_TOOLS`(`sessionPolicyInputFactory.ts:68-74`)实际包含 5 项:

```ts
[
  { capability: 'browser' },
  { capability: 'html' },
  { capability: 'interaction', tool: 'ask_user_question' },
  { capability: 'issues',     tool: 'propose_issue_operation' },
  { capability: 'schedules',  tool: 'propose_schedule_operation' },
]
```

任何 origin 落到 `default` 分支(包括 `agent` / `chat` / `issue` / `schedule` / IM 平台)都拿这 5 项。

---

## 2. Case study — `ccb-XTyTIQFpUSI-` 事故的真正根因

### 2.1 现象
用户在 origin=`agent` 的 session 里输入「使用 list issues 查看改项目有多少 issue」,模型 fallback 到 `Bash: gh issue list`,没调用任何 OpenCow 原生 tool。

### 2.2 多层归因
| 层 | 原因 |
|---|---|
| L0 表象 | 模型没调 `list_issues` |
| L1 | `list_issues` 不在 session tool list 里 |
| L2 | session 默认 allowlist 只有 `propose_issue_operation`(write 工具),没有 `list_issues` 等 read 工具 |
| L3 | issue 类的 read 工具被设计成「需要按意图激活」 — 但激活通路只有 keyword matcher,没有 model-driven 通路 |
| L4 | OpenCow 把「可见性」和「治理」混在了 allowlist 一层。read 工具不需要治理,但因为治理需求被一并默认隐藏 |
| L5(本质) | **NativeCapabilityRegistry 和 CapabilityCenter 是两套独立机制**,native capability 没有经过 skill 投影 → 没法走 implicit matching → 永远不会被 keyword 命中 → 永远拿不到工具。EvoseSkillProvider 是这条路的范本,但只 Evose 一家用 |

### 2.3 验证
```sql
-- managed_sessions 表中该 session 的 messages 字段
"使用 list issues 查看改项目有多少 issue"
↓
assistant thinking: "Let me search for available tools related to listing issues"
↓
ToolSearch("list_issues") → not found
↓
Bash: gh issue list
```

模型自己先尝试 `ToolSearch` — 这正是 progressive disclosure 的本能。**框架在阻止模型用它已经会的方式工作**。

---

## 3. 设计原则

| # | 原则 | 含义 |
|---|---|---|
| 1 | **Skill is the universal abstraction** | OpenCow 里所有可发现的能力(native / marketplace / project / global / 第三方)都是 `DocumentCapabilityEntry`。一套 schema,一套 API,一套 UI |
| 2 | **模型决策,框架不算分** | 删除 keyword matcher。框架职责收窄到「展示 catalog + 接收激活请求 + 重算 plan」。语义理解是模型的工作 |
| 3 | **可见性 ≠ 治理** | tool 的可见性由 skill 激活决定,治理由 `LifecycleOperationCoordinator` 在调用时决定。两层完全解耦 |
| 4 | **架构一致性 > 分层优化** | Native skill 和 marketplace skill 走完全同一条路径。不为「native 量少」搞特殊优化(等真量大了再说) |
| 5 | **YAGNI** | 不引入 Tier 1/Tier 2、不限制 catalog 大小、不做 LLM-driven matching、不预实现 vector embedding。先把最简版本跑起来,用真实数据驱动后续优化 |

---

## 4. 统一架构

### 4.1 端到端

```
┌──────────────────────────────────────────────────────────────────┐
│  数据模型层:DocumentCapabilityEntry (统一,无变化)                 │
└──────────────────────────────────────────────────────────────────┘
         ↑                ↑                ↑                ↑
         │                │                │                │
  ┌──────┴──────┐  ┌──────┴──────┐  ┌──────┴──────┐  ┌──────┴──────┐
  │ Filesystem  │  │ Native      │  │ Evose       │  │ Plugin /    │
  │ Provider    │  │ Provider    │  │ Provider    │  │ Marketplace │
  │ (existing)  │  │ (NEW × 7)   │  │ (existing)  │  │ (existing)  │
  │             │  │             │  │             │  │             │
  │ scans       │  │ projects    │  │ projects    │  │ mounts      │
  │ filesystem  │  │ 7 native    │  │ Evose apps  │  │ packages    │
  │ markdown    │  │ capabilities│  │             │  │             │
  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘
         ↓                ↓                ↓                ↓
┌──────────────────────────────────────────────────────────────────┐
│  CapabilityCenter.getSnapshot()                                  │
│  → 统一的 DocumentCapabilityEntry[] 数组                          │
│    每个 entry 都可携带 metadata.nativeRequirements                 │
└──────────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────────┐
│  发现层(NEW):                                                    │
│                                                                  │
│  System prompt 里注入完整 catalog:                                │
│    <available-skills>                                            │
│      <skill name="opencow:issues" status="inactive">             │
│        OpenCow issue tracking. List/search/read/create/update.   │
│        Activate when user asks about issues, bugs, tickets.      │
│      </skill>                                                    │
│      <skill name="opencow:browser" status="inactive">...</skill> │
│      <skill name="marketplace:git-workflow" status="inactive">   │
│        ...                                                       │
│      </skill>                                                    │
│      ...                                                         │
│    </available-skills>                                           │
│                                                                  │
│  Options.tools 包含 ONE meta-tool:                               │
│    Skill(name: enum) - 激活某个 skill,把它从 catalog 翻成 full     │
└──────────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────────┐
│  激活层:                                                          │
│                                                                  │
│  模型 call Skill('opencow:issues')                                │
│    ↓                                                             │
│  Framework:                                                      │
│    1. 把 'opencow:issues' 加入 session-scoped activeSkills set    │
│    2. 标记 session 状态为 dirty                                    │
│    3. 返回 tool result: "Activated. Tools available next turn: …"│
│    4. (可选 v2) 立刻 abort 当前 query,重启带新 tools 的 query        │
└──────────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────────┐
│  下一轮 user message → runSession 重新跑:                          │
│                                                                  │
│  planSessionPolicy 读 activeSkills set                            │
│    → buildCapabilityPlan 用 activeSkills 当作 explicitSkillNames  │
│    → 这些 skill 得到 mode='full' 决策                              │
│    → metadata.nativeRequirements 进入 CapabilityPlan              │
│    → sessionOrchestrator merge 进 sessionPolicy.tools.native.allow│
│    → getInlineToolsForSession 把对应 native tool 加进 Options.tools│
│                                                                  │
│  → 模型 next turn 看到完整 issue tool 集,可以直接 call list_issues  │
└──────────────────────────────────────────────────────────────────┘
```

### 4.2 关键改动

1. **`SkillProvider` 接口抽象化** — 把现在硬编码的 `appendProjectedEvoseSkills` 改成通用 provider 接口,native capability 可以注册。

2. **`OpenCowSessionContext.activeSkills: Set<string>`** — session-scoped 可变状态,记录哪些 skill 被激活。

3. **`Skill` meta-tool** — 内置 native capability,提供唯一一个工具:`Skill(name)`。它的 handler 修改 `activeSkills` 并返回确认。

4. **`buildCapabilityPlan` 读 activeSkills** — 把它合并进 `explicitSkillNames`,触发 skill 进入 `mode='full'`。

5. **删除 keyword matcher** — `scoreImplicitSkillMatch` / `resolveImplicitSkillActivationQuery` / `derivePromptPolicy` 整套删干净。

6. **Catalog 注入** — `buildCapabilityPlan` 在拼 `capabilityPrompt` 时,对所有 `mode='catalog'` 的 skill 输出更精简的 catalog 段(只 name + description,不要 frontmatter)。

7. **删 `GENERAL_PURPOSE_NATIVE_TOOLS`** — 默认 allowlist 改成空。所有 origin 默认 catalog 模式,模型自己激活。

8. **Origin 的角色:预激活 hint** — 某些 origin(`issue` / `browser-agent`)预激活对应 skill,等价于「framework 替模型省一次 Skill 调用」。

---

## 5. Skill Tool 的语义

### 5.1 Schema

```ts
// electron/nativeCapabilities/builtinSkillCapability.ts
export class BuiltinSkillCapability extends BaseNativeCapability {
  readonly meta = {
    category: 'meta',
    description: 'Built-in capability discovery and activation',
  }

  override getToolDescriptors(ctx) {
    // skill enum 在 build time 由 CapabilityCenter snapshot 收集
    const availableSkillNames = ctx.sessionContext.availableSkillNames

    return [this.tool({
      name: 'Skill',
      description:
        'Activate a skill so its tools and instructions become available. ' +
        'Read the <available-skills> catalog in your system prompt to discover ' +
        'what skills exist. Activate a skill BEFORE attempting to use its ' +
        'capabilities — once activated, the skill\'s tools appear in your tool ' +
        'list on the next user message.',
      schema: {
        name: z.enum(availableSkillNames as [string, ...string[]])
          .describe('The skill name to activate (must match a name in <available-skills>)'),
      },
      execute: async ({ args, sessionContext }) => {
        sessionContext.activeSkills.add(args.name)
        return this.textResult(
          `Activated skill "${args.name}". Its tools and instructions will be ` +
          `available starting from your next response. If the user has already ` +
          `asked a question that needs this skill, briefly acknowledge the ` +
          `activation and ask them to confirm or repeat — you cannot use the ` +
          `new tools in the current turn.`
        )
      },
    })]
  }
}
```

### 5.2 Catalog 注入格式

Catalog 段插入到 system prompt 的固定位置(在 capabilityPrompt 之前或之后),格式:

```xml
<available-skills>
  Each skill below is INACTIVE by default. To use a skill, call the Skill tool
  with its name. After activation, the skill's tools and instructions become
  available on your next response.

  <skill name="opencow:issues">
    OpenCow issue tracking. List, search, read, create, update issues and
    propose lifecycle changes. Activate when the user asks about issues,
    bugs, tasks, tickets, or feature requests.
  </skill>

  <skill name="opencow:browser">
    Embedded browser control. Navigate, click, type, extract page content,
    take screenshots, accessibility snapshots. Activate when the user asks
    to interact with web pages.
  </skill>

  ...

  <skill name="marketplace:git-workflow">
    Git workflow assistant. Helps with branch management, commit message
    composition, PR descriptions. Activate when the user asks about git
    operations beyond basic commit.
  </skill>
</available-skills>
```

每个 skill 一段,包含 `name`(模型用它 call Skill)+ 一行描述(包含「何时激活」的 hint)。

**激活后**,该 skill 改在 system prompt 的「Active Skills」段落以 `<skill mode="full">` 形式出现,带完整 markdown body。这跟现有 `promptSegmentBuilder.ts` 的产出格式兼容,只是触发条件变了。

### 5.3 单 turn vs 跨 turn 激活(关键开放问题)

**最大设计风险:** 用户在 turn N 问「list issues」,模型 call `Skill('opencow:issues')`,但当前 turn 的 `Options.tools` 已经定型,模型这一轮**不能用** `list_issues`。

候选方案:

**方案 A — 跨 turn 激活(v1 推荐)**
- Skill tool 返回结果后,模型在当前 turn 只能口头响应:「我已激活 issues 能力,请重发您的请求」
- UX 略差,但实现极简
- 缓解策略:catalog 描述里强烈引导模型「在做任何事之前先激活相关 skill」,让模型在第一轮就 batch 激活
- 用预激活(origin 启发)进一步降低首次激活的概率

**方案 B — 单 turn 激活(v2 探索)**
- 框架拦截 Skill tool 的执行结果,立即 abort 当前 SDK query
- 用更新后的 `Options.tools` 重启一个 query,带上完整对话历史(包括 Skill activation)
- 模型继续从激活点往后,直接使用新 tool
- 用户看到的是一次更长的响应延迟,但回答连贯
- 需要验证 SDK 是否支持 abort + restart 这种语义,以及对话历史的连续性

**方案 C — 内联 tool 注入**
- 改 SDK 让 query() 中途也能更新 tool 集(类似 MCP `tools/list_changed`)
- 最优雅但侵入 SDK 内部
- v3 候选,需要 SDK 团队配合

**v1 推荐方案 A**,在 RFC 评审时讨论是否值得为更好 UX 直接上 B。下面是 v1 的 acceptance criteria,假设走 A。

### 5.4 预激活策略

某些 origin 预激活特定 skill(等价于 framework 替模型省第一次 Skill 调用):

| Origin | 预激活 skill |
|---|---|
| `agent` / `chat` / 默认 | (无,完全靠模型激活) |
| `issue` / `issue-creator` | `opencow:issues` |
| `schedule` / `schedule-creator` | `opencow:schedules` |
| `browser-agent` | `opencow:browser` |
| `telegram` / `feishu` / `discord` / `weixin` | (无) |
| `market-analyzer` | (无,继续走 sandboxed `repo-analyzer`) |

预激活通过在 `runSession` 第一次 call `planSessionPolicy` 时,根据 origin 把对应 skill name 注入 `activeSkills` set 实现。

---

## 6. 落地映射 — 文件级改动清单

### 6.1 新建文件

| 文件 | 行数估计 | 角色 |
|---|---|---|
| `electron/services/capabilityCenter/nativeCapabilitySkillProvider.ts` | 30 | `NativeCapabilitySkillProvider` 接口 |
| `electron/services/capabilityCenter/providers/issuesSkillProvider.ts` | 60 | Issue capability 投影 |
| `electron/services/capabilityCenter/providers/projectsSkillProvider.ts` | 50 | Project capability 投影 |
| `electron/services/capabilityCenter/providers/schedulesSkillProvider.ts` | 60 | Schedule capability 投影 |
| `electron/services/capabilityCenter/providers/browserSkillProvider.ts` | 60 | Browser capability 投影 |
| `electron/services/capabilityCenter/providers/htmlSkillProvider.ts` | 40 | HTML capability 投影 |
| `electron/services/capabilityCenter/providers/interactionSkillProvider.ts` | 40 | Interaction capability 投影(IM origin 跳过) |
| `electron/services/capabilityCenter/providers/repoAnalyzerSkillProvider.ts` | 40 | RepoAnalyzer 投影(仅 market-analyzer origin) |
| `electron/nativeCapabilities/builtinSkillCapability.ts` | 90 | 内置 `Skill` meta-tool |
| `electron/services/capabilityCenter/catalogPromptBuilder.ts` | 80 | 把 inactive skills 拼成 `<available-skills>` 段 |
| `tests/unit/capabilityCenter/skillProviders.test.ts` | 200 | 7 个 provider 的单测 |
| `tests/unit/nativeCapabilities/builtinSkillCapability.test.ts` | 100 | Skill tool 的单测 |
| `tests/integration/skillActivation.test.ts` | 150 | 端到端集成测试(`ccb-XTyTIQFpUSI-` 复跑) |

### 6.2 修改文件

| 文件 | 改动 |
|---|---|
| `electron/services/capabilityCenter/index.ts` | `appendProjectedEvoseSkills` → 泛化为 `appendProjectedSkills`,接受 `SkillProvider[]`;构造时注册 7 个 native provider + 现有 EvoseSkillProvider |
| `electron/services/capabilityCenter/sessionInjector.ts` | `buildCapabilityPlan` 接收 `activeSkills` 参数,当作 `explicitSkillNames` 的一部分;新增 catalog 段拼接(对所有 `mode='catalog'` 的 skill 调 catalogPromptBuilder) |
| `electron/command/sessionOrchestrator.ts` | `OpenCowSessionContext` 加 `activeSkills: Set<string>`,首次 `runSession` 用 origin 预激活;每次 `runSession` 把 `activeSkills` 透传给 `planSessionPolicy` → `buildCapabilityPlan` |
| `electron/nativeCapabilities/openCowSessionContext.ts` | 加 `activeSkills: Set<string>` + `availableSkillNames: string[]` 字段 |
| `electron/app/createServices.ts` | 在 NativeCapabilityRegistry 注册时加上 BuiltinSkillCapability |

### 6.3 删除文件 / 删除代码

| 路径 | 删除内容 |
|---|---|
| `electron/services/capabilityCenter/skillActivationEngine.ts` | 删除 `scoreImplicitSkillMatch` / `scoreNameCandidate` / `resolveImplicitMatches` / `prepareQuery` / `tokenize` / `normalizeMatchText` / `collectSkillHintTokens` / `ImplicitSkillMatchPolicy` 等全部 keyword matcher 相关代码。**保留** `resolveSkillActivationDecisions`(改为只处理 explicit / agent / always / catalog 4 种 source,删 implicit 分支) |
| `electron/command/policy/sessionPolicyInputFactory.ts` | 删除 `GENERAL_PURPOSE_NATIVE_TOOLS` 常量;删除 `derivePromptPolicy` / `applyPromptPolicyDerivation` / `extractNativeRequirementsFromContent` 调用;`resolveDefaultPolicyByOrigin` 改成只返回「预激活 skill 列表」+「mode: none」(allowlist 完全由动态 skill activation 决定) |
| `electron/command/skillActivationResolver.ts` | 检查是否还有用;`resolveActivatedSkillNames`(slash command 解析)保留,`resolveImplicitSkillActivationQuery` 删除 |
| `electron/services/capabilityCenter/sessionInjector.ts:403-443` | 删除 `resolveImplicitNativeRequirements` 函数(它只在 `sendMessage` 重配置时用,新架构里通过 activeSkills 持久化解决) |
| 各 capability 内部的「对应 skill 触发」相关 hint | 检查 evoseNativeCapability 是否有 implicit-matching 相关注释,清理 |

### 6.4 净改动量(估算)

| | 新增 | 删除 | 净 |
|---|---|---|---|
| Provider 文件 + tests | ~870 | 0 | +870 |
| BuiltinSkillCapability + tests | ~190 | 0 | +190 |
| catalogPromptBuilder | ~80 | 0 | +80 |
| sessionInjector / sessionOrchestrator 改动 | ~80 | ~150 | -70 |
| sessionPolicyInputFactory 改动 | ~30 | ~200 | -170 |
| skillActivationEngine 删除 | 0 | ~250 | -250 |
| skillActivationResolver / 其他 | ~10 | ~80 | -70 |
| **合计** | **~1260** | **~680** | **+580** |

(实际上是净增,因为补充了大量测试和 provider 模板代码;但生产代码层面 keyword matcher 的删除是质量提升,不能用纯行数衡量)

---

## 7. 落地步骤

### Step 0:RFC 评审 + 验证(0.5 天)
- 评审本 RFC,对单 turn vs 跨 turn 激活问题(§5.3)定方向
- 验证 SDK 是否支持「中途 abort + 用新 tools 重启 query」(决定 v1 走方案 A 还是 B)

### Step 1:核心改造(2 天)
- 抽 `NativeCapabilitySkillProvider` 接口,泛化 `appendProjectedSkills`
- 写 7 个 provider(参考 EvoseSkillProvider 模板)
- 写 `BuiltinSkillCapability` + `Skill` meta-tool
- `OpenCowSessionContext` 加 `activeSkills` 字段
- `sessionOrchestrator` 透传 activeSkills 给 plan
- `buildCapabilityPlan` 接收 activeSkills 并合并进 explicitSkillNames

### Step 2:Catalog 注入(0.5 天)
- 写 `catalogPromptBuilder.ts`,对 inactive skill 输出 `<available-skills>` 段
- 在 `buildCapabilityPlan` 拼接到 `capabilityPrompt`

### Step 3:删除旧机制(0.5 天)
- 删除 keyword matcher 相关代码(详见 §6.3)
- 删 `GENERAL_PURPOSE_NATIVE_TOOLS`
- `resolveDefaultPolicyByOrigin` 改成 origin → 预激活 skill 映射

### Step 4:Origin 预激活 + 测试(1 天)
- 实现 origin → 预激活 skill 的映射
- 单测覆盖 7 个 provider + Skill tool
- 集成测试:复跑 `ccb-XTyTIQFpUSI-` 的 prompt,断言模型最终 call 了 `list_issues`

### Step 5:Shim → Provider 清理(1 天)
- `NativeCapabilityRegistry` 这层薄 shim 现在变得多余 — 所有 native capability 都通过 `SkillProvider` 路径走
- 评估是否合并到 `CapabilityCenter`,或者保留作为「能力的执行实体」(skill 是「能力的元数据」,native capability 是「能力的代码实现」)
- 如果合并,大约 1 天;如果保留,只需简化接口

### Step 6:Codex 删除(1 天)
- 删 `codexNativeBridgeManager.ts`
- 删 `sessionOrchestrator` 里所有 `engineKind === 'codex'` 分支
- 删 `engineCapabilityRuntime.ts` 里 codex 路径
- 删相关 codex 测试
- 删 `package.json` 里 codex SDK 依赖

**总计 6 天**(原估 5 天,加了 0.5 RFC 验证 + 0.5 Step 5 弹性)。

---

## 8. 测试策略

### 8.1 单元测试

| Test | 覆盖 |
|---|---|
| `skillProviders.test.ts` × 7 | 每个 native provider 投影出的 DocumentCapabilityEntry 字段正确,`metadata.nativeRequirements` 指向对应 capability |
| `builtinSkillCapability.test.ts` | `Skill` tool 修改 `activeSkills` set;enum 验证拒绝未知 skill name |
| `catalogPromptBuilder.test.ts` | catalog 段格式正确,inactive skill 进 catalog,active skill 不进 |
| `sessionInjector.test.ts` 增量 | `buildCapabilityPlan` 读 `activeSkills` 时把对应 skill 翻成 `mode='full'` |

### 8.2 集成测试

**必跑场景:**

1. **`ccb-XTyTIQFpUSI-` 复现** — 用 origin=`agent`,prompt「list issues」,断言:
   - turn 1:模型 call `Skill('opencow:issues')`
   - turn 1 模型响应里包含「已激活,请确认」类引导
   - turn 2:`Options.tools` 包含 `list_issues` / `get_issue` / ...
   - turn 2:模型 call `list_issues` 而不是 `Bash gh issue list`

2. **预激活路径** — 用 origin=`issue`,prompt「list」(模糊指令),断言:
   - turn 1 即刻有 `list_issues` 在 `Options.tools` 里(因为 issue origin 预激活了 issues skill)
   - 模型直接 call `list_issues`,无需 Skill 中转

3. **Marketplace skill 等价** — 装一个含 `metadata.nativeRequirements` 的 marketplace skill,prompt 触发后断言其 native tool 进入 allowlist。证明 native 和 marketplace 走同一条路。

4. **Activation 持久** — 跨多 turn 验证:turn 1 激活,turn 5 仍然能用激活的 tool。

5. **删除验证** — 确保 keyword matcher 删除后没有运行时引用残留(grep `scoreImplicitSkillMatch` 应该返回 0)。

### 8.3 验收标准(Definition of Done)

- [ ] `ccb-XTyTIQFpUSI-` 复跑通过
- [ ] 7 个 native capability 全部经由 Skill 激活路径可达
- [ ] `skillActivationEngine.ts` 内 keyword matcher 函数全部删除
- [ ] `GENERAL_PURPOSE_NATIVE_TOOLS` 删除
- [ ] 全部 capability 单测 + 集成测试通过
- [ ] `pnpm typecheck:node` / `:web` 无新增 error
- [ ] `pnpm lint` 无新增 warning
- [ ] 默认 origin session 启动时 `Options.tools` 长度 = 1(只有 `Skill` 工具)+ 任何 origin 预激活带的工具

---

## 9. Open Questions

### 9.1 单 turn vs 跨 turn 激活(P0)
见 §5.3。需要在评审里定方向。倾向 v1 走方案 A(跨 turn),v2 探索方案 B(SDK abort+restart)。

### 9.2 Catalog 段在 system prompt 里的位置
- 选项 1:放在 `composeSystemPrompt` 拼接的最前面(模型最先读到)
- 选项 2:放在 `capabilityPrompt`(active skills)之后
- 选项 3:作为单独的 `<system>` 段插在所有内容前
**默认走 1** — 模型看到「我有什么能力」是上下文阅读的第一步。

### 9.3 Skill 激活的撤销
- 当前设计:激活只增不减(stateful set)
- 如果 session 长,早期激活的 skill 一直占 prompt token
- 需不需要 `unenable_skill(name)` 工具?或者 `Skill(name, action='deactivate')`?
**默认不需要**。先观察真实 token 占用,有问题再加。

### 9.4 Skill name 命名空间
- `opencow:issues` / `marketplace:git-workflow` / `evose:x-analyst-ja4t9n`?
- 还是 flat name `issues` / `git-workflow` / `x-analyst-ja4t9n`?
- 命名空间防冲突 + 让模型一眼看出来源
**推荐用前缀**(`opencow:` / `marketplace:` / `evose:` / `project:`)。

### 9.5 Catalog 是否也包含 active skill?
- 如果 active 的 skill 的 catalog entry 也保留,模型可能困惑
- 如果完全移除,模型不知道它已经激活了什么
- **推荐:active skill 在 catalog 段标 `status="active"`**,让模型有完整可见性

### 9.6 Marketplace skill 的 `nativeRequirements` 安全性
- 现在的设计允许第三方 marketplace skill 在 `metadata.nativeRequirements` 里声明任意 `{ capability: 'X' }`
- 恶意 skill 可能声明高敏 capability 来获取访问权
- 需要白名单:哪些 capability 允许被第三方 skill 引用
**短期方案:** 只允许 `opencow:*` 来源的 skill 声明 nativeRequirements,marketplace 来源的 skill `nativeRequirements` 字段被忽略。**长期方案:** capability 层加 `allowedFromSkillScopes: ['native', 'marketplace', 'project']` 元数据。

---

## 10. 与 Phase 1B 的关系

| Phase | 角色 |
|---|---|
| 1B.0–1B.10 | SDK Capability Provider 框架 + 双出口(MCP / inline) |
| 1B.11 / 1B.11b | OpenCow 切到 SDK 框架 + 切到 inline tool 出口 |
| 1B.11c | 删 TInput 死泛型 + 框架做 schema 校验 + 类型化 args |
| **1B.11d (本 RFC)** | **Skill-driven discovery,把 native capability 投影成 skill,删 keyword matcher** |
| 1B.11e(后续) | shim → provider 清理(`NativeCapabilityRegistry` 合并入 CapabilityCenter) |
| 1B.11f(后续) | Codex 删除 |

**1B.11d 是 Phase 1B 故事的高潮**:Phase 1B 一直在构建底层(框架 / 出口 / 类型),1B.11d 终于把这些底层组装成一个真正 agentic 的发现层。

---

## 11. 反对意见与回应(自我 review)

### Q: 删除 keyword matcher 是不是太激进?marketplace 的 implicit matching 用了好久。

A: keyword matcher 在中文 query 上的命中率几乎为零(token 切不开,详见上一段调研)。`ccb-XTyTIQFpUSI-` 事故证明它在英文 query 上也不可靠 — 模型本能地 fallback 到 `ToolSearch` 而不是依赖框架的猜测。删除是质量提升,不是退化。

### Q: 模型万一不主动 call Skill 怎么办?

A: 三层兜底:(1) catalog 描述里强引导「先激活再做事」(2) origin 预激活覆盖最常见场景(3) Claude 4 已经被训练得很懂 meta-tool 模式(它在 ccb-XTyTIQFpUSI- 已经主动尝试 ToolSearch)。如果实测发现命中率不够,可以加预激活的 origin 数,或者改进 catalog 描述。

### Q: 跨 turn 激活的 UX 太差了。

A: 同意,但 v1 优先架构正确性而不是首次激活的 UX。绝大多数 session 第一个 prompt 就能让模型激活正确 skill,后续 turn 都不用再激活。第一次激活时模型说一句「已激活,请重发」也可接受。v2 可以走 SDK abort+restart 解决这个 UX。

### Q: marketplace skill 上百个时,catalog 段会不会爆 token?

A: 100 个 skill × 80 tokens ≈ 8K tokens,占 200K context 4%。结合 prompt caching,稳态成本接近零。如果某个用户装 500+ skill,届时再考虑分层。**YAGNI**。

### Q: shim → provider 清理是不是应该一起做?

A: 可以一起做,也可以分两步。分两步更稳:1B.11d 先证明 Skill 机制 work,然后 1B.11e 才动 NativeCapabilityRegistry 这个跑了几个月的核心组件。**推荐分步**。

---

## 12. 决策矩阵(供评审者勾选)

| 决策点 | 选项 | 推荐 |
|---|---|---|
| Skill tool 名字 | `Skill` / `enable_skill` / `use_capability` | **`Skill`**(对齐 Claude Code) |
| 单 turn vs 跨 turn 激活 | A 跨 turn / B SDK abort+restart / C SDK 内联注入 | **A(v1)+ B(v2 探索)** |
| Catalog 段位置 | system prompt 顶部 / capabilityPrompt 后 / 独立 system 段 | **顶部** |
| Skill name 命名空间 | 带前缀 / flat | **带前缀** |
| Skill 激活撤销 | 支持 unenable / 只增不减 | **只增不减(v1)** |
| Marketplace skill nativeRequirements | 允许 / 忽略 / 白名单 | **v1 忽略,v2 加白名单** |
| Tier 1/Tier 2 catalog 分层 | 实现 / 不实现 | **不实现(v1)** |
| Codex 删除时机 | 1B.11d 一起删 / 独立 1B.11f | **独立 1B.11f** |
| Shim 清理时机 | 1B.11d 一起做 / 独立 1B.11e | **独立 1B.11e** |
| catalog 大小限制 | 设上限 / 不限 | **不限** |

---

## 13. 一句话总结

**把 `metadata.nativeRequirements` 这条已经在生产中跑通的桥连接到所有 7 个 native capability,删掉 keyword matcher,让模型用一个 `Skill` 工具从 catalog 里自己挑要激活的能力。架构变简单了,代码净减少了,事故根因消失了,而且跟 Anthropic 自己 Claude Code 的 Skill 机制思想同构。**
