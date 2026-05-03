# PRD v1：Controlled Vibe Coding Platform

## 1. 产品名称

暂定名：**XieZhi**

一句话定位：

> 一个基于 OpenCode runtime 的 AI 软件开发控制平台，通过 DAG 管理功能设计与任务流程，通过 AST 管理代码结构与影响范围，让 AI 生成的软件变更可计划、可约束、可追溯、可验证。

### 1.1 Executive Summary

XieZhi 的核心不是提升 agent 的“写代码能力”，而是提升 AI 参与软件开发时的“工程可控性”。

它面向已经在使用 AI coding 工具的开发者和技术负责人，解决的是以下核心矛盾：

- 团队希望 AI 更快地产出代码；
- 但又不希望 agent 以不可审计、不可追责、不可验证的方式改坏代码库；
- 传统文本 diff 和聊天记录不足以支撑稳定的软件工程协作。

因此，v1 要验证一个足够清晰的产品主张：

- 用 Feature DAG 和 Task DAG 把自然语言需求结构化；
- 用 Intent IR 和 Policy 为单次执行建立明确边界；
- 用 AST Semantic Diff 和 Verifier 判断 patch 是否“做了该做的事”。

如果这个闭环成立，XieZhi 就不只是一个更会写代码的助手，而是一个让 AI 代码变更进入工程体系的控制层。

---

## 2. 背景与问题

### 2.1 背景

AI coding agent 正在从代码补全工具演化为可以读代码、改代码、跑命令、修复测试、生成 PR 的开发代理。OpenCode、Codex、Claude Code 等工具证明了 agent runtime 的价值：模型可以在终端、IDE 或云端环境中操作真实代码库。

但目前主流 AI coding 工具仍然偏向“让 agent 更会写代码”，而不是“让 agent 的软件工程变更更可控”。在真实团队开发中，代码生成本身不是最大问题，最大问题是：

- 需求意图不可追踪；
- 任务拆解不可审计；
- agent 容易越界修改；
- 代码变更和产品需求之间缺少绑定；
- 测试覆盖和验收标准不稳定；
- 多轮 vibe coding 后工程状态难以回放；
- 生成的 diff 缺少语义解释，只能做文本级 review。

### 2.2 当前 vibe coding 的失控点

传统 vibe coding 流程：

```text
用户自然语言需求
  → agent 读取代码
  → agent 修改文件
  → agent 跑测试
  → agent 总结修改
```

这个流程的问题是：

1. **缺少功能图**：用户意图没有被结构化为 requirement、design、task、test、acceptance。
2. **缺少授权边界**：agent 不清楚哪些代码可以改、哪些代码不能改。
3. **缺少语义 diff**：review 只能看文本 diff，无法直接看到新增 route、修改 service、公共 API 变化、测试覆盖变化。
4. **缺少双向追踪**：从需求不能稳定追踪到代码，从代码也不能追踪回需求。
5. **缺少一致性验证**：系统无法判断“这个 patch 是否真的服务于这个 task”。

---

## 3. 产品目标

### 3.1 v1 目标

v1 的目标不是重写一个 OpenCode/CodeX/Claude Code，而是在它们之上构建一个 **Semantic Harness Core**，让 AI coding agent 的执行过程变得可控。

v1 要打通的核心闭环：

```text
User Intent
  → Feature DAG
  → Task DAG
  → Intent IR
  → Policy
  → OpenCode Runtime
  → Patch
  → AST Semantic Diff
  → Consistency Verifier
  → Human Review
```

### 3.2 核心价值

v1 需要证明以下价值：

1. **AI 不是直接写代码，而是在任务图中执行。**
2. **每个代码修改都必须绑定到一个 task node。**
3. **每个 task 都有明确的 allowed scope 和 acceptance criteria。**
4. **每次 patch 后都能生成 AST-level semantic diff。**
5. **系统能检测 unauthorized change、missing test、public API change 等风险。**
6. **用户可以看到需求、任务、代码、测试之间的映射。**

### 3.3 非目标

v1 不做以下事情：

- 不做完整 IDE；
- 不做复杂云端多租户；
- 不做所有语言支持；
- 不做自己的 agent runtime；
- 不做自己的 foundation model gateway；
- 不做自动 merge 到 main；
- 不做完整项目管理系统；
- 不支持大规模企业权限体系；
- 不承诺完全替代人工 review。

### 3.4 v1 发行门槛

只有当以下条件同时满足时，v1 才算达到可演示、可内测的标准：

1. 用户可以从自然语言需求生成结构化 Task DAG。
2. 用户可以在单个 task 范围内调用 OpenCode 完成真实代码修改。
3. 系统可以稳定阻止或标记越界文件修改。
4. 系统可以为 patch 生成足够可读的 semantic diff。
5. 用户可以基于 review report 在几分钟内判断 patch 是否应该接受。

---

## 4. 目标用户

### 4.1 Primary Persona：AI-native 独立开发者 / 小团队技术负责人

特征：

- 已经在使用 OpenCode、Claude Code、Codex、Cursor 等 AI coding 工具；
- 喜欢 vibe coding，但担心代码库被 AI 改乱；
- 项目主要是 TypeScript / React / Node；
- 需要快速开发，但仍然希望保留工程控制感。

核心诉求：

- 让 AI 能更大胆地执行；
- 但每次执行都要有边界、有记录、有验证；
- 能知道 agent 到底改了什么、为什么改、是否越界。

### 4.2 Secondary Persona：团队中的 Tech Lead / Staff Engineer

特征：

- 负责代码质量、架构一致性和 review；
- 想让团队成员或 agent 更高效地实现功能；
- 担心 agent 生成的代码引入隐性架构债务。

核心诉求：

- 把 AI 生成的变更纳入工程流程；
- 让每个 AI patch 都能关联需求、设计、测试和验收；
- 提前发现越权修改、公共 API 变化、缺测试等风险。

### 4.3 Jobs To Be Done

当用户想让 AI 完成一个真实的软件开发任务时，他们希望：

1. 在开始前，先把需求拆成可以执行和审查的任务。
2. 在执行时，明确 AI 允许改哪里、不允许改哪里。
3. 在执行后，不只看到文本 diff，还能看到语义层面的影响。
4. 在 review 时，快速判断这次修改是否服务于原始需求，是否引入额外风险。
5. 在出错时，明确是规划问题、执行问题，还是验证规则问题。

---

## 5. 使用场景

### 5.1 场景一：新增功能

用户输入：

```text
给这个项目增加团队邀请功能，管理员可以通过邮箱邀请成员，邀请链接 24 小时过期。
```

系统流程：

1. 生成 Feature DAG；
2. 拆解 Task DAG；
3. 索引 repo AST；
4. 找到相关 API、service、DB、test 文件；
5. 为第一个 task 生成 Intent IR；
6. 编译 OpenCode execution policy；
7. 调用 OpenCode 执行；
8. 获取 patch；
9. 生成 semantic diff；
10. 执行 consistency verifier；
11. 输出 review report。

用户看到：

```text
Feature: Team Invitation

Tasks:
  ✓ task.add_invitation_schema
  ✓ task.add_create_invite_api
  ⏳ task.add_accept_invite_api
  ⏳ task.add_invitation_tests

Current Patch:
  + table invitations
  + function createInvitation
  + route POST /teams/:teamId/invitations
  + test non-admin cannot invite

Verification:
  ✓ allowed files only
  ✓ no unauthorized AST changes
  ✓ typecheck passed
  ⚠ missing test: invitation expiry
```

### 5.2 场景二：防止 agent 越界修改

用户运行：

```bash
xiezhi task run task.add_create_invite_api --runtime opencode
```

OpenCode 生成 patch 后，系统检测到：

```text
Unauthorized change detected:
  file: src/billing/subscription.ts
  symbol: calculateSeatLimit
  reason: billing module is outside task allowed scope
```

系统结果：

```text
Patch rejected.
Reason: unauthorized semantic impact.
Suggested action:
  - revert billing change
  - or create explicit design/task node for billing behavior change
```

### 5.3 场景三：语义化 review

传统 review 只能看到：

```text
5 files changed, 220 insertions, 30 deletions
```

v1 输出：

```text
Semantic Diff:
  Added:
    - route POST /teams/:teamId/invitations
    - function createInvitation
    - type InvitationStatus
    - test create invitation success

Modified:
    - service TeamService
    - public type TeamRole

Warnings:
    - Public type changed: TeamRole
    - No test mapped to requirement req.invite_expiry
```

---

## 6. 产品范围

### 6.1 v1 支持语言和项目类型

v1 优先支持：

- TypeScript；
- React；
- Node.js；
- Next.js / Express 风格项目；
- Vitest / Jest 测试；
- npm / pnpm / yarn 脚本。

### 6.2 v1 产品入口

v1 以 CLI 为主：

```bash
xiezhi init
xiezhi index
xiezhi plan "add team invitation feature"
xiezhi dag show
xiezhi task list
xiezhi task run <task-id> --runtime opencode
xiezhi verify <patch-id>
xiezhi review <patch-id>
```

Dashboard 可以作为 v1.1，不是 v1 必须项。

### 6.3 v1 Runtime Strategy

v1 不再绑定单一 runtime，而是采用 **multi-runtime adapter** 策略。

v1 支持的目标 runtime：

- OpenCode
- Codex
- Claude Code / Claude Agent SDK

使用方式：

- XieZhi 负责任务图、Intent IR、policy、AST diff、verifier；
- 各 runtime 负责 agent session、文件读写、命令执行、上下文管理和模型调用；
- XieZhi 通过统一的 `CodingRuntime` 接口接入不同 runtime；
- v1 优先支持“本地 / 近本地”的执行模式，不依赖单一厂商的云工作流。

接入优先级建议：

1. OpenCode：最适合作为第一批接入对象，因为它提供稳定的 JS/TS SDK、headless server 和结构化输出能力。
2. Claude Code：优先通过 TypeScript Agent SDK 接入，而不是仅包装 CLI。
3. Codex：v1 先通过 TypeScript SDK 和 `codex exec --json` 接入；更深的产品内嵌集成再补 `codex app-server`。

### 6.4 v1 MVP 闭环

v1 不要求覆盖所有软件开发场景，但必须打穿以下最小闭环：

1. 在一个真实的 TypeScript repo 中完成 `xiezhi init` 和 `xiezhi index`。
2. 用户输入一个新增功能型需求，系统生成 Feature DAG 和 Task DAG。
3. 用户运行一个 task，OpenCode 在独立 worktree 中生成 patch。
4. 系统输出 semantic diff、test 结果和 verifier 结果。
5. 用户可以接受一个合格 patch，也可以拒绝一个越界 patch。

如果上述 5 步无法在同一个 demo 中稳定完成，说明 v1 仍未形成真正的产品闭环。

---

## 7. 核心概念

### 7.1 Feature DAG

Feature DAG 用于表达产品需求、设计决策、任务、测试、约束和验收之间的关系。

节点类型：

```text
requirement
设计 design
任务 task
测试 test
约束 constraint
风险 risk
验收 acceptance
review gate
```

边类型：

```text
depends_on
implements
tests
constrains
blocks
verifies
```

示例：

```yaml
feature: team_invitation
nodes:
  - id: req.invite_member
    type: requirement
    title: Admin can invite member by email

  - id: design.invitation_token
    type: design
    title: Use one-time token with 24h expiry

  - id: task.add_invitation_schema
    type: task
    title: Add invitations table

  - id: task.add_create_invite_api
    type: task
    title: Add create invitation API

  - id: test.non_admin_cannot_invite
    type: test
    title: Non-admin cannot invite member
```

### 7.2 Task DAG

Task DAG 是 Feature DAG 的执行视图。

每个 task 包含：

- task id；
- status；
- dependencies；
- Intent IR；
- allowed scope；
- acceptance checks；
- linked patches；
- verification result。

状态：

```text
draft
approved
ready
running
patched
verified
rejected
failed
```

### 7.3 Intent IR

Intent IR 是从任务图到 agent runtime 的中间表示。

它描述：

- 目标；
- 允许修改的文件；
- 允许修改的 AST 节点；
- 允许的操作类型；
- 禁止的模块或行为；
- 验收标准；
- 推荐测试命令。

示例：

```yaml
intent_id: task.add_create_invite_api
goal: Add API endpoint for inviting team members

allowed_scope:
  files:
    - src/api/team/invitations.ts
    - src/services/invitation-service.ts
    - tests/team-invitations.test.ts

allowed_operations:
  - create_route
  - create_function
  - add_test
  - modify_service

forbidden_operations:
  - modify_billing_logic
  - change_session_semantics
  - delete_existing_tests

acceptance:
  - admin can invite member by email
  - non-admin receives 403
  - invitation token is created
  - tests are added
```

### 7.4 AST Code Graph

AST Code Graph 把代码库表示为结构化工程图。

Code node 类型：

```text
file
module
function
class
interface
type
route
component
hook
test
migration
```

Code edge 类型：

```text
imports
calls
references
implements
tests
renders
uses_type
writes_table
```

用途：

- 生成上下文；
- 判断影响范围；
- 生成 semantic diff；
- 验证 patch 是否越界；
- 追踪 requirement-code-test 映射。

### 7.5 Policy

Policy 是 Intent IR 的可执行约束。

分三层：

1. Runtime policy：允许/禁止的 shell command；
2. File policy：允许/禁止写入的文件；
3. Semantic policy：允许/禁止修改的 AST node 和 operation type。

### 7.6 Controlled Patch

每次 agent 修改都生成 Controlled Patch。

Controlled Patch 必须包含：

- task id；
- base commit；
- worktree path；
- textual diff；
- semantic diff；
- command logs；
- test result；
- verification result。

---

## 8. 核心用户流程

### 8.1 初始化

命令：

```bash
xiezhi init
```

结果：

- 创建 `.xiezhi/`；
- 初始化 SQLite 数据库；
- 生成默认配置；
- 检测 OpenCode 是否可用；
- 检测 package manager；
- 检测测试命令、lint 命令、typecheck 命令。

配置文件：

```yaml
project:
  name: my-app
  language: typescript

runtime:
  default: opencode

commands:
  test: npm test
  typecheck: npm run typecheck
  lint: npm run lint

policy:
  default_write_mode: task_scope_only
  deny_commands:
    - git push
    - git commit
    - rm -rf *
```

### 8.2 索引代码库

命令：

```bash
xiezhi index
```

系统执行：

1. 扫描 repo；
2. 使用 tree-sitter / ts-morph 解析代码；
3. 提取 file、function、class、type、route、test；
4. 建立 import/reference/call/test 关系；
5. 保存到 SQLite。

输出：

```text
Indexed repo:
  files: 184
  functions: 923
  types/interfaces: 211
  routes: 37
  components: 86
  tests: 142
```

### 8.3 生成计划

命令：

```bash
xiezhi plan "add team invitation feature"
```

系统执行：

1. 读取用户需求；
2. 使用 planner agent / LLM 生成 Feature DAG；
3. 使用 AST index 找相关代码；
4. 生成 Task DAG；
5. 为每个 task 生成 Intent IR 草案；
6. 用户确认或编辑。

输出：

```text
Feature DAG created: team_invitation

Tasks:
  1. task.add_invitation_schema
  2. task.add_create_invite_api
  3. task.add_accept_invite_api
  4. task.add_invitation_email
  5. task.add_tests

Next recommended task:
  xiezhi task run task.add_invitation_schema
```

### 8.4 执行任务

命令：

```bash
xiezhi task run task.add_create_invite_api --runtime opencode
```

系统执行：

1. 创建 git worktree；
2. 生成 task-specific ContextBundle；
3. 编译 OpenCode permission；
4. 启动 OpenCode session；
5. 注入 Intent IR；
6. OpenCode 执行代码修改；
7. 收集 diff 和 command logs；
8. 运行测试 / typecheck / lint；
9. 生成 semantic diff；
10. 运行 verifier。

### 8.5 验证 patch

命令：

```bash
xiezhi verify <patch-id>
```

检查项：

- patch 是否绑定 task；
- changed files 是否在 allowed scope；
- changed AST nodes 是否在 allowed scope；
- 是否修改 forbidden area；
- 是否新增未声明依赖；
- 是否修改 public API；
- 是否有测试覆盖；
- acceptance 是否被测试或人工验证覆盖。

输出示例：

```text
Verification result: rejected

Violations:
  - unauthorized_file_change
    src/billing/subscription.ts is outside allowed scope

Warnings:
  - public_type_changed
    TeamRole was modified

Passed:
  - typecheck
  - lint
  - 12 tests passed
```

### 8.6 Review

命令：

```bash
xiezhi review <patch-id>
```

输出：

```text
Review Summary

Task:
  task.add_create_invite_api

Goal:
  Add API endpoint for inviting team members.

Text Diff:
  4 files changed, 180 insertions, 12 deletions

Semantic Diff:
  Added:
    - route POST /teams/:teamId/invitations
    - function createInvitation
    - type InvitationStatus
    - test non-admin cannot invite

Modified:
    - service TeamService

Verification:
  ✓ no unauthorized file changes
  ✓ no forbidden AST changes
  ✓ typecheck passed
  ✓ tests passed
  ⚠ missing test for invitation expiry
```

### 8.7 异常与回退流程

当执行流程失败时，系统需要给出明确的失败归因，而不是只返回“agent failed”。

v1 至少要区分以下失败类型：

- `planning_failed`：需求无法稳定拆解为 Task DAG；
- `runtime_failed`：OpenCode 执行异常、中断或未产出有效 patch；
- `verification_failed`：patch 生成成功，但未通过 policy 或质量检查；
- `environment_failed`：测试命令、依赖、工作树或本地环境异常。

每种失败类型都需要有对应的 next action，例如：

- 重新生成 task；
- 收缩 allowed scope；
- 重新运行 task；
- 跳过当前 patch 并保留日志供人工分析。

---

## 9. Functional Requirements

### 9.0 优先级定义

为了避免 v1 范围失控，功能需求采用以下优先级：

- `P0`：没有它就无法完成受控 patch 的核心闭环；
- `P1`：显著提升可用性和解释性，但可以在闭环跑通后补齐；
- `P2`：增强项，v1 不阻塞。

### FR-1：项目初始化 `P0`

系统必须支持在已有 repo 中初始化：

```bash
xiezhi init
```

要求：

- 创建本地配置；
- 初始化本地数据库；
- 检测项目语言；
- 检测包管理器；
- 检测测试、lint、typecheck 命令；
- 检测 OpenCode runtime 是否可用。

### FR-2：代码库索引 `P0`

系统必须支持对 TypeScript repo 建立 AST index。

v1 必须识别：

- file；
- function；
- class；
- interface；
- type；
- import/export；
- React component；
- test file；
- route heuristic。

v1 可选识别：

- hook；
- DB migration；
- API handler；
- service class。

### FR-3：Feature DAG 生成 `P0`

系统必须支持从自然语言需求生成 Feature DAG。

Feature DAG 必须包含：

- requirement；
- task；
- acceptance；
- test；
- dependency edge。

Design / risk / constraint 节点 v1 可以支持但不是硬性要求。

### FR-4：Task DAG 生成 `P0`

系统必须根据 Feature DAG 生成可执行 Task DAG。

Task DAG 必须支持：

- task id；
- status；
- dependencies；
- Intent IR；
- allowed scope；
- linked patch。

### FR-5：Intent IR 生成 `P0`

系统必须为每个 task 生成 Intent IR。

Intent IR 必须包含：

- goal；
- allowed files；
- forbidden files / modules；
- acceptance；
- recommended test commands。

v1 可选包含：

- allowed AST nodes；
- allowed operation types；
- risk notes。

### FR-6：OpenCode Runtime Adapter `P0`

系统必须支持通过 OpenCode 执行单个 task。

要求：

- 创建独立 worktree；
- 向 OpenCode 注入 task prompt / Intent IR；
- 注入 permission config；
- 收集生成的 diff；
- 收集 command logs；
- 返回 patch result。

### FR-7：Worktree Isolation `P0`

每个 task 必须在独立 git worktree 中执行。

要求：

- 不允许直接修改 main working tree；
- 每个 worktree 对应一个 task；
- patch 可以被丢弃、重试、合并；
- base commit 必须被记录。

### FR-8：Semantic Diff `P1`

系统必须支持 patch 前后 AST snapshot 对比。

v1 必须输出：

- added code nodes；
- removed code nodes；
- modified code nodes；
- changed imports；
- changed exports；
- added/modified tests。

v1 可选输出：

- changed routes；
- changed React components；
- changed public API；
- dependency impact。

### FR-9：Consistency Verifier `P0`

系统必须对 patch 进行一致性验证。

v1 必须检查：

- 是否绑定 task；
- 是否修改 allowed files 之外的文件；
- 是否修改 forbidden files；
- 是否新增测试或关联已有测试；
- typecheck 是否通过；
- test 是否通过。

v1 应该检查：

- public API change warning；
- new dependency warning；
- modified exported symbol warning；
- missing acceptance coverage warning。

### FR-10：Review Report `P1`

系统必须生成 review report。

Report 必须包含：

- task goal；
- textual diff summary；
- semantic diff；
- test result；
- verifier result；
- violations；
- warnings；
- recommended next action。

### FR-11：Patch 生命周期管理 `P1`

系统应该显式管理 patch 生命周期，而不是把 patch 仅仅当作一次命令输出。

至少需要支持：

- patch 创建；
- patch 验证；
- patch 拒绝；
- patch 丢弃；
- patch 重试；
- patch 与 task 的一对多关联。

### FR-12：失败归因与恢复建议 `P1`

系统应该在 plan、run、verify 任一阶段失败时输出结构化失败原因。

输出至少包含：

- failure type；
- failure stage；
- 可读错误说明；
- 推荐恢复动作。

---

## 10. Non-functional Requirements

### NFR-1：安全性

v1 必须默认安全：

- 禁止 `git push`；
- 禁止 `git commit`，除非用户显式开启；
- 禁止直接修改 main working tree；
- 禁止访问未授权环境变量；
- 默认使用 task-scoped write policy；
- 所有 shell command 必须记录。

### NFR-2：可审计性

系统必须记录：

- 用户需求；
- Feature DAG；
- Task DAG；
- Intent IR；
- OpenCode session metadata；
- command logs；
- diff；
- semantic diff；
- verifier result。

### NFR-3：可替换性

OpenCode 必须通过 adapter 接入。

核心模块不能依赖 OpenCode 内部实现。

未来必须可以支持：

```text
CodexRuntime
ClaudeSDKRuntime
CustomRuntime
```

### NFR-4：性能

v1 目标：

- 中小型 TypeScript repo 初次 index < 60 秒；
- 增量 index < 10 秒；
- semantic diff < 20 秒；
- verifier < 20 秒。

### NFR-5：本地优先

v1 默认本地运行：

- repo 不上传；
- AST index 存本地；
- patch 存本地；
- OpenCode runtime 本地执行；
- 后续再支持 cloud dashboard。

### NFR-6：可理解性

v1 输出不能只对系统实现者友好，也必须对普通开发者可读。

要求：

- CLI 输出在 2 分钟内可被首次用户读懂；
- review report 需要优先展示结论，再展示证据；
- violation 和 warning 命名要稳定且可搜索；
- 同一个失败原因在不同命令下应尽量使用一致措辞。

---

## 11. 技术架构

### 11.1 总体架构

```text
┌────────────────────────────────────────────┐
│ CLI                                        │
│ xiezhi init / index / plan / task run / review │
└───────────────────┬────────────────────────┘
                    ↓
┌────────────────────────────────────────────┐
│ Semantic Harness Core                      │
│ Feature DAG / Task DAG / Intent IR         │
│ Policy / Verifier / Semantic Diff          │
└───────────────────┬────────────────────────┘
                    ↓
┌────────────────────────────────────────────┐
│ Runtime Adapter Layer                      │
│ OpenCodeRuntime / CodexRuntime / ClaudeRuntime │
└───────────────────┬────────────────────────┘
                    ↓
┌────────────────────────────────────────────┐
│ External Coding Runtime                    │
│ Agent / Tools / File Edit / Shell / LSP    │
└───────────────────┬────────────────────────┘
                    ↓
┌────────────────────────────────────────────┐
│ Worktree Execution Environment             │
│ Git worktree / Test Runner / Diff Capture  │
└────────────────────────────────────────────┘
```

### 11.2 v1 定稿技术栈

```text
Primary Language:
  TypeScript

JavaScript Runtime:
  Node.js 22 LTS

Package Manager:
  pnpm

CLI Framework:
  commander
  @clack/prompts
  picocolors

Build / Dev Tooling:
  tsx
  tsup

Schema / Validation:
  zod

Runtime Integration:
  OpenCode:
    @opencode-ai/sdk
  Claude Code:
    @anthropic-ai/claude-agent-sdk
  Codex:
    @openai/codex-sdk
  Optional lower-level transport:
    vscode-jsonrpc

AST / Code Intelligence:
  ts-morph as primary
  TypeScript Compiler API under the hood
  tree-sitter later for multi-language expansion

Storage:
  SQLite
  better-sqlite3
  drizzle-orm + drizzle-kit

Shell / Process Execution:
  execa
  native git CLI

Config Parsing:
  yaml
  toml
  jsonc-parser

Config:
  YAML

Logging:
  pino

Testing:
  Vitest
  fixture repos
  snapshot tests for semantic diff / review output

Execution Isolation:
  git worktree
  local shell
  Docker optional later

Lightweight HTML Report Later:
  React
  Vite

Dashboard Later:
  Next.js
  React Flow
```

### 11.3 关键选型理由

#### Node.js 22 LTS，而不是 Bun

选择 Node.js 的原因：

- 与 TypeScript ecosystem、CLI 包、SQLite 原生依赖和各类 SDK 兼容性更稳；
- v1 的核心风险不在运行时性能，而在 AST、runtime adapter 和 verifier 的正确性；
- 更适合做一个需要长期维护、插件化和企业可接入的基础设施项目。

Bun 可以在未来作为兼容运行环境评估，但不作为 v1 默认运行时。

#### TypeScript + Node.js 22 仍然成立，而且更适合多 runtime

调研后三家的官方接入面，反而更强化了 TypeScript / Node 的选择：

- OpenCode 官方提供 JS/TS SDK；
- Claude Agent SDK 官方提供 TypeScript SDK，并且直接复用 Claude Code 的 agent harness；
- Codex 官方提供 TypeScript SDK，且 app-server 示例也基于 Node.js。

因此，从“同时接多个 coding runtime”的角度看，TypeScript 不是保守选项，而是兼容性最强的默认选项。

#### commander，而不是 oclif

选择 `commander` 的原因：

- 更轻；
- 更适合当前 repo 这种从 0 到 1 的 CLI-first 产品；
- 命令结构清晰，便于快速打通 `init / index / plan / run / verify / review` 主链路。

如果未来需要更复杂的 plugin system，再评估是否引入更重的 CLI 框架。

#### 运行时接入层必须是 adapter-first，而不是 vendor-first

调研后的关键结论不是“选哪一家”，而是“必须允许三家并存”。

因此技术架构上必须明确：

- 不把 OpenCode SDK、Claude SDK 或 Codex SDK 直接散落到业务代码里；
- 所有 runtime 只通过 `runtime/*` 目录下的 adapter 暴露能力；
- 上层只依赖统一的线程、事件、工具调用、patch、approval、verification 语义。

建议内部统一接口至少覆盖：

- `runTask`
- `resumeTask`
- `streamEvents`
- `interruptTask`
- `collectPatch`
- `collectUsage`
- `compilePermissions`

#### Claude Code 优先用 SDK，不优先包 CLI

Anthropic 官方目前同时支持 CLI 和 TypeScript SDK。

对 XieZhi 来说，优先用 SDK 的原因是：

- 更适合把 Claude 作为库嵌入；
- 更容易做流式事件消费；
- 更容易把权限、结构化输出和 session 控制纳入统一 adapter；
- 官方明确支持 TypeScript，并允许直接声明 `allowed_tools` 等执行边界。

CLI 仍可作为 fallback 或调试路径保留。

#### Codex 采用双层策略：v1 先 SDK / exec，后续补 app-server

OpenAI 官方目前同时提供：

- `codex exec --json` 这种适合脚本和 CI 的非交互模式；
- `@openai/codex-sdk`，用于程序化控制本地 Codex agent；
- `codex app-server`，用于更深的产品集成，支持 JSON-RPC、thread/turn、approval 和 streamed events。

因此更合理的实现顺序是：

- v1：先接 `@openai/codex-sdk`，必要时用 `codex exec --json` 兜底；
- v1.1+：如果需要更深的嵌入式交互，再引入 `codex app-server` 的 JSON-RPC adapter。

这能显著降低 v1 的复杂度，同时不给后续 richer integration 封路。

#### OpenCode 是最适合作为第一批深接入对象的 runtime

OpenCode 官方提供：

- JS/TS SDK；
- headless server；
- `opencode run --format json` 非交互模式；
- 结构化输出；
- 细粒度 permission config。

这意味着它很适合作为 XieZhi 第一个“深接入并验证控制层能力”的 runtime。

#### ts-morph 优先，而不是 tree-sitter 优先

v1 只支持 TypeScript，因此 AST 层优先使用 `ts-morph`。

原因：

- 直接复用 TypeScript 语义信息，做 symbol-level 分析更自然；
- 更适合识别 import/export、public API、type/interface、component、test 等 v1 重点对象；
- 更适合做 semantic diff 和 scope verifier 的第一版。

`tree-sitter` 更适合作为未来多语言扩展的基础层，而不是 v1 的主索引引擎。

#### SQLite + better-sqlite3 + drizzle

选择这组搭配的原因：

- 本地优先、单机使用场景非常适合 SQLite；
- `better-sqlite3` 简单、稳定、同步 API 适合 CLI；
- `drizzle` 能提供 schema、migration 和类型约束，又不会像重型 ORM 那样带来过高抽象成本。

#### 需要额外支持 TOML / JSONC / YAML 三种配置生态

调研后三家的配置形态并不统一：

- OpenCode 主要使用 `opencode.json/jsonc`
- Claude Code 主要使用 `settings.json`
- Codex 主要使用 `config.toml`

因此 XieZhi 自己可以继续使用 YAML 作为主配置格式，但运行时适配层必须内建：

- TOML 解析与生成
- JSONC 解析
- runtime-specific config compiler

#### execa + 原生 git CLI

对于 `git worktree`、`diff`、`status`、`apply`、测试命令执行这类能力，优先直接调用系统 `git` 和 shell。

原因：

- git worktree 能力本身就是系统级能力；
- 比二次封装库更透明、更容易调试；
- 更符合 XieZhi 作为 orchestration / control layer 的定位。

#### 轻报告优先，不先做重 Dashboard

v1 的展示层以 CLI 输出为主，必要时补充轻量 HTML report。

原因：

- 最小化前端投入；
- 更适合快速 demo；
- 避免过早进入复杂的多页 Web UI 设计。

### 11.4 Runtime Adapter 实现建议

```text
runtime/
  shared/
    events.ts
    permissions.ts
    patch.ts
    usage.ts
    errors.ts
  opencode/
    adapter.ts
    config-compiler.ts
    event-normalizer.ts
  claude/
    adapter.ts
    options-compiler.ts
    event-normalizer.ts
  codex/
    adapter.ts
    sdk-adapter.ts
    exec-adapter.ts
    app-server-adapter.ts
    config-compiler.ts
    event-normalizer.ts
```

统一原则：

- 每个 runtime 都把原生事件映射成 XieZhi 自己的 `RuntimeEvent`；
- 每个 runtime 都把原生权限模型映射成 XieZhi 自己的 `ExecutionPolicy`；
- 所有 patch、日志、usage、approval decision 都先归一化，再进入 verifier 和 review 流程。

---

## 12. System Components

### 12.1 `core/feature-dag`

职责：

- Feature DAG 数据模型；
- node / edge CRUD；
- DAG validation；
- status transition。

### 12.2 `core/task-dag`

职责：

- task dependency；
- task status；
- next runnable task；
- task execution history。

### 12.3 `core/intent-ir`

职责：

- Intent IR schema；
- 从 task 生成 Intent IR；
- Intent IR validation；
- Intent IR → runtime prompt。

### 12.4 `core/policy`

职责：

- 从 Intent IR 编译 policy；
- 生成 runtime permission；
- 生成 file write allowlist；
- 生成 semantic allowlist。

### 12.5 `ast/indexer`

职责：

- 扫描代码库；
- 提取 CodeNode；
- 提取 CodeEdge；
- 生成 AST snapshot；
- 支持增量 index。

### 12.6 `ast/semantic-diff`

职责：

- 对比 patch 前后 AST snapshot；
- 输出 added / removed / modified code nodes；
- 识别 public API 变化；
- 识别新增测试；
- 识别 import/export 变化。

### 12.7 `runtime/opencode-adapter`

职责：

- 创建 OpenCode session；
- 注入 task prompt；
- 注入 OpenCode permission；
- 执行 task；
- 收集 diff 和 logs；
- 统一返回 `RunTaskResult`。

接口：

```ts
interface CodingRuntime {
  name: string
  runTask(input: RunTaskInput): Promise<RunTaskResult>
  reviewDiff(input: ReviewDiffInput): Promise<ReviewDiffResult>
  runReadOnlyAnalysis(input: AnalysisInput): Promise<AnalysisResult>
}
```

### 12.8 `execution/worktree`

职责：

- 创建 task worktree；
- 删除 worktree；
- 获取 diff；
- 应用 / 丢弃 patch；
- 记录 base commit。

### 12.9 `verifier`

职责：

- file scope check；
- semantic scope check；
- forbidden area check；
- test coverage heuristic；
- public API warning；
- dependency warning；
- acceptance coverage check。

---

## 13. 数据模型

### 13.1 Feature Node

```ts
type FeatureNode = {
  id: string
  featureId: string
  type:
    | "requirement"
    | "design"
    | "task"
    | "test"
    | "constraint"
    | "risk"
    | "acceptance"
    | "review_gate"
  title: string
  description?: string
  status: "draft" | "approved" | "in_progress" | "verified" | "rejected"
  metadata?: Record<string, unknown>
}
```

### 13.2 Code Node

```ts
type CodeNode = {
  id: string
  repoId: string
  kind:
    | "file"
    | "module"
    | "function"
    | "class"
    | "interface"
    | "type"
    | "route"
    | "component"
    | "hook"
    | "test"
    | "migration"
  path: string
  symbol?: string
  startLine: number
  endLine: number
  hash: string
  metadata?: Record<string, unknown>
}
```

### 13.3 Intent IR

```ts
type IntentIR = {
  id: string
  taskId: string
  goal: string
  allowedScope: {
    files: string[]
    codeNodes?: string[]
  }
  forbiddenScope: {
    files?: string[]
    modules?: string[]
    codeNodes?: string[]
  }
  allowedOperations: string[]
  forbiddenOperations: string[]
  acceptance: string[]
  recommendedCommands: string[]
}
```

### 13.4 Controlled Patch

```ts
type ControlledPatch = {
  id: string
  taskId: string
  baseCommit: string
  worktreePath: string
  changedFiles: string[]
  textualDiff: string
  semanticDiff: SemanticDiff
  commandLogs: CommandLog[]
  testResults: TestResult[]
  verification: VerificationResult
  status: "pending" | "verified" | "rejected" | "merged" | "discarded"
}
```

---

## 14. 数据库表设计 v1

```sql
CREATE TABLE features (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE dag_nodes (
  id TEXT PRIMARY KEY,
  feature_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  status TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE dag_edges (
  id TEXT PRIMARY KEY,
  feature_id TEXT NOT NULL,
  from_node_id TEXT NOT NULL,
  to_node_id TEXT NOT NULL,
  edge_type TEXT NOT NULL
);

CREATE TABLE code_nodes (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  path TEXT NOT NULL,
  symbol TEXT,
  start_line INTEGER,
  end_line INTEGER,
  hash TEXT NOT NULL,
  metadata_json TEXT
);

CREATE TABLE code_edges (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  from_code_node_id TEXT NOT NULL,
  to_code_node_id TEXT NOT NULL,
  edge_type TEXT NOT NULL
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  feature_id TEXT NOT NULL,
  dag_node_id TEXT NOT NULL,
  status TEXT NOT NULL,
  intent_ir_json TEXT,
  policy_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE patches (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  base_commit TEXT NOT NULL,
  worktree_path TEXT NOT NULL,
  diff TEXT,
  semantic_diff_json TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE checks (
  id TEXT PRIMARY KEY,
  patch_id TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  output TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE violations (
  id TEXT PRIMARY KEY,
  patch_id TEXT NOT NULL,
  severity TEXT NOT NULL,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);
```

---

## 15. CLI Commands v1

### `xiezhi init`

初始化项目。

### `xiezhi index`

索引代码库。

参数：

```bash
xiezhi index --full
xiezhi index --incremental
```

### `xiezhi plan`

从自然语言生成 Feature DAG 和 Task DAG。

```bash
xiezhi plan "add GitHub OAuth login"
```

### `xiezhi dag show`

展示 Feature DAG。

```bash
xiezhi dag show <feature-id>
```

### `xiezhi task list`

展示 task 列表。

```bash
xiezhi task list <feature-id>
```

### `xiezhi task run`

执行单个 task。

```bash
xiezhi task run task.add_callback_route --runtime opencode
```

### `xiezhi verify`

验证 patch。

```bash
xiezhi verify <patch-id>
```

### `xiezhi review`

生成 review report。

```bash
xiezhi review <patch-id>
```

### `xiezhi patch discard`

丢弃 patch。

```bash
xiezhi patch discard <patch-id>
```

---

## 16. OpenCode Integration Design

### 16.1 OpenCode 的角色

OpenCode 在 v1 中只承担 runtime executor：

- 读取上下文；
- 调用模型；
- 修改文件；
- 执行 shell command；
- 使用 LSP 辅助理解代码；
- 返回结果。

XieZhi 负责：

- 生成 task；
- 限制上下文；
- 生成 policy；
- 约束可写范围；
- 分析 diff；
- 验证一致性。

### 16.2 OpenCode Prompt Template

```text
You are executing a controlled software engineering task.

Task ID:
{{taskId}}

Goal:
{{goal}}

Allowed files:
{{allowedFiles}}

Forbidden files/modules:
{{forbiddenScope}}

Acceptance criteria:
{{acceptance}}

Rules:
1. Only modify files explicitly listed in allowed files.
2. Do not modify billing, auth session, or unrelated modules unless explicitly allowed.
3. Add or update tests when required by acceptance criteria.
4. Do not commit or push changes.
5. After changes, run the recommended validation commands.
6. Summarize changes by semantic intent, not only by file name.
```

### 16.3 Runtime Adapter Output

```ts
type RunTaskResult = {
  taskId: string
  success: boolean
  changedFiles: string[]
  diff: string
  commandLogs: CommandLog[]
  modelMessages: AgentMessage[]
  error?: string
}
```

---

## 17. Verifier Rules v1

### Blocking violations

这些问题会导致 patch rejected：

1. 修改 forbidden file；
2. 修改 allowed files 之外的文件；
3. 删除已有测试；
4. typecheck failed；
5. test failed；
6. patch 没有关联 task；
7. worktree base commit 不一致。

### Warnings

这些问题不一定 reject，但必须提示：

1. public API changed；
2. exported type changed；
3. 新增 package dependency；
4. 没有新增测试；
5. acceptance 没有测试映射；
6. 修改了高风险模块；
7. 修改了过多文件；
8. semantic diff 与 task goal 匹配度低。

---

## 18. Success Metrics

### v1 Demo Success

一次成功 demo 必须展示：

1. 用户输入自然语言功能需求；
2. 系统生成 Feature DAG；
3. 系统生成 Task DAG；
4. 系统调用 OpenCode 执行单个 task；
5. 系统生成 patch；
6. 系统输出 semantic diff；
7. 系统检测至少一种风险或确认无风险；
8. 用户可以 review 并决定接受或拒绝。

### 产品指标

v1 内部验证指标：

```text
Plan success rate:
  > 70% 的需求能生成可执行 Task DAG

Patch containment rate:
  > 80% 的 patch 只修改 allowed scope

Verifier usefulness:
  每 5 次执行至少发现 1 个有价值 warning 或 violation

Review clarity:
  用户能在 2 分钟内理解 patch 的语义影响
```

### Alpha Release Criteria

进入 alpha 内测前，至少要满足：

1. 在 3 个不同的 TypeScript repo 上完成端到端 demo。
2. 至少 1 个 demo 展示 accepted patch，至少 1 个 demo 展示 rejected patch。
3. `xiezhi init`、`xiezhi index`、`xiezhi plan`、`xiezhi task run`、`xiezhi verify`、`xiezhi review` 六个主命令可连续运行。
4. verifier 的 blocking violation 与 warning 结果具有稳定命名，不依赖人工临时解释。
5. 发生失败时，用户可以看到下一步建议，而不是只能查看原始日志。

### 工程指标

```text
Initial index time:
  中小型 TS repo < 60s

Semantic diff time:
  < 20s

Verifier time:
  < 20s

Patch rollback:
  100% patch 可丢弃
```

---

## 19. Milestones

### Milestone 1：Repo Indexer

目标：

- 支持 TypeScript repo AST index；
- 生成 CodeNode / CodeEdge；
- CLI 可输出 index summary。

交付：

```bash
xiezhi init
xiezhi index
```

### Milestone 2：Feature DAG + Task DAG

目标：

- 从自然语言生成 Feature DAG；
- 生成 Task DAG；
- task 包含 Intent IR 草案。

交付：

```bash
xiezhi plan "add team invitation feature"
xiezhi dag show
xiezhi task list
```

### Milestone 3：OpenCode Adapter

目标：

- 创建 worktree；
- 调用 OpenCode 执行单个 task；
- 收集 diff；
- 保存 patch。

交付：

```bash
xiezhi task run <task-id> --runtime opencode
```

### Milestone 4：Semantic Diff

目标：

- patch 前后 AST snapshot 对比；
- 输出 added / modified / removed code nodes；
- 输出 changed import/export/test。

交付：

```bash
xiezhi review <patch-id>
```

### Milestone 5：Verifier

目标：

- file scope check；
- forbidden file check；
- test/typecheck/lint result；
- public API warning；
- missing test warning。

交付：

```bash
xiezhi verify <patch-id>
```

### Milestone 6：End-to-end Demo

目标：

- 在一个真实 TypeScript 项目中跑通完整流程；
- 展示一个 accepted patch；
- 展示一个 rejected patch。

---

## 20. Open Questions

1. v1 是否需要用户确认 Feature DAG 后再执行，还是默认自动执行第一个 task？
   建议默认值：必须先确认 DAG，再允许运行首个 task。
2. allowed scope 是完全由系统推断，还是用户必须确认？
   建议默认值：系统先推断，用户在首次执行前可确认或缩小范围。
3. Intent IR 是否允许用户手动编辑？
   建议默认值：允许编辑，但只开放高价值字段，如 goal、allowed files、acceptance。
4. OpenCode permission 是否足够约束文件写入，还是需要外层文件系统 guard？
   建议默认值：v1 先采用 runtime permission + post-patch verifier，v1.1 再考虑更强 guard。
5. Semantic verifier 的 blocking / warning 阈值如何配置？
   建议默认值：v1 内置固定规则，先不要开放过多用户自定义。
6. test coverage mapping v1 用 heuristic 还是引入更强的 coverage 工具？
   建议默认值：v1 使用 heuristic，确保速度和实现复杂度可控。
7. v1 是否需要 dashboard，还是 CLI report 足够？
   建议默认值：CLI 足够，dashboard 作为 v1.1 方向。
8. 是否支持 GitHub issue comment 触发，还是 v1.1 再做？
   建议默认值：v1 不做远程触发，先打通本地闭环。

---

## 21. 风险与缓解

### 风险一：OpenCode runtime 难以强约束文件修改

缓解：

- 使用 worktree isolation；
- 使用 OpenCode permission；
- 使用 patch 后 verifier；
- patch 违反 policy 直接 reject；
- v1 先不自动 merge。

### 风险二：AST index 不稳定

缓解：

- v1 只支持 TypeScript；
- 先做 file/function/type/import/export/test；
- route/component 使用 heuristic；
- 对 semantic diff 做 best-effort，不阻塞核心流程。

### 风险三：Feature DAG 生成质量不稳定

缓解：

- 允许用户编辑 DAG；
- v1 只要求 task / acceptance 基本可用；
- 提供 template；
- 每个 task 执行前生成 Intent IR 并确认。

### 风险四：用户觉得流程太重

缓解：

- 提供模式切换：
  - plan-only；
  - controlled patch；
  - strict mode；
- CLI 默认推荐下一步；
- 不强制用户理解所有图结构；
- review report 要足够简洁。

### 风险五：MVP 范围定义不清，导致实现分散

缓解：

- 明确区分 `P0`、`P1`、`P2`；
- 先围绕单仓库、本地运行、单 task 执行闭环实现；
- 所有新增需求都必须回答“是否直接提升受控 patch 闭环”；
- dashboard、多 runtime、多语言都放到 v1 之后评估。

---

## 22. v1 产品原则

1. **OpenCode 执行，XieZhi 控制。**
2. **No task, no patch.**
3. **默认不信任 agent 输出，patch 后必须验证。**
4. **文本 diff 不够，必须有 semantic diff。**
5. **能本地跑通，不依赖云端。**
6. **先支持 TypeScript 一个生态，打穿闭环。**
7. **核心能力可替换 runtime，不绑定 OpenCode。**
8. **让 AI 不能乱写，比让 AI 更会写更重要。**

---

## 23. v1 最小 Demo 脚本

### Step 1：初始化

```bash
xiezhi init
xiezhi index
```

### Step 2：生成计划

```bash
xiezhi plan "add team invitation feature with 24 hour expiry token"
```

输出：

```text
Feature DAG created.
5 tasks generated.
Next task: task.add_invitation_schema
```

### Step 3：执行任务

```bash
xiezhi task run task.add_invitation_schema --runtime opencode
```

输出：

```text
Worktree created.
OpenCode session started.
Patch generated.
Verifier passed.
```

### Step 4：执行第二个任务

```bash
xiezhi task run task.add_create_invite_api --runtime opencode
```

输出：

```text
Patch generated.
Semantic diff:
  + route POST /teams/:teamId/invitations
  + function createInvitation
  + test non-admin cannot invite

Verification:
  ✓ allowed files only
  ✓ typecheck passed
  ✓ tests passed
  ⚠ missing test for token expiry
```

### Step 5：展示越界拒绝

人为或 agent 产生越权修改：

```text
src/billing/subscription.ts changed
```

系统输出：

```text
Verification result: rejected

Violation:
  unauthorized_file_change
  src/billing/subscription.ts is outside task scope

Patch was not accepted.
```

---

## 24. 总结

v1 的核心不是做一个新的 coding agent，而是做一个 OpenCode-like runtime 之上的 **semantic control layer**。

产品闭环：

```text
自然语言需求
  → Feature DAG
  → Task DAG
  → Intent IR
  → OpenCode 执行
  → Patch
  → AST Semantic Diff
  → Consistency Verifier
  → Human Review
```

v1 成功的标志是：

> 用户能用 OpenCode 完成真实代码修改，但每一次修改都被 DAG 和 AST 控制，最终得到一个可解释、可审计、可拒绝、可回滚的软件工程变更。

下一步如果继续推进实现，最合理的工程顺序是：

1. 先完成 `xiezhi init`、`xiezhi index` 和本地 SQLite schema。
2. 再完成最小可用的 `plan -> task run -> verify -> review` 主链路。
3. 最后补 semantic diff 丰富度、warning 质量和更好的 CLI 体验。
