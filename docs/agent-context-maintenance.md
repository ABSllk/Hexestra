# Hexestra 用户上下文维护

Hexestra 将任务上下文拆成四类：Objective 描述目标，Restrictions 规定必须遵守的边界，Skills 描述可复用战法，Tools 提供本地能力，Execution Steps 记录本次实际推进过程。

## 两级用户层

Hexestra 自己维护全局层与项目层，不读写 Claude/WSL 的 `~/.claude/skills`：

```text
<Hexestra root>/user/
  restrictions.yaml
  skills/<name>/
  skills-disabled/<name>/

<project>/.hexestra/user/
  restrictions.yaml
  skills/<name>/
  skills-disabled/<name>/

<project>/.claude/skills/       # 合并后的运行时副本
```

`<Hexestra root>` 在开发态为代码仓库根目录，在打包态为可执行文件所在目录，也可通过 `HEXESTRA_HOME` 显式指定。它不使用 `%APPDATA%`、`~/Library` 或 Linux 配置目录，因此整个 Hexestra 目录可直接迁移。

全局层适合跨项目复用的个人规则与战法；项目层适合单个项目的补充、覆盖和禁用。进入项目以及每次 Agent 请求前，Hexestra 合并全局与项目 Skills，并发布到当前项目 `.claude/skills`。同名 Skill 以项目版本为准；项目 `skills-disabled/<name>` 会屏蔽同名全局 Skill。用户删除或禁用已初始化的 Skill 后，不会被下一次启动自动恢复。

内置的 `hexestra-pentest`、`hexestra-records`、`hexestra-report` 是只读核心 Skill，也只发布到项目 `.claude/skills`。全局用户 Skill 库默认保持为空；用户创建、导入或经知识提炼确认生成的 Skill 只存放在 `user/skills`，不会从应用资源自动恢复。

## Restrictions

全局文件为 `<Hexestra root>/user/restrictions.yaml`，项目文件为 `<project>/.hexestra/user/restrictions.yaml`。YAML 是唯一事实来源，不解析或迁移 Markdown。两个作用域中命中的规则同时生效；项目规则不覆盖全局规则，完全重复项只在展示时折叠并保留全部来源。

```yaml
version: 1
rules:
  - id: active-scan-classify-failures
    text: 批量扫描必须分别记录 timeout、connection_refused 与 filtered
    enabled: true
    selector:
      kind: attack
      tacticIds: []
      techniqueIds: [T1595]
    createdAt: 2026-08-13T00:00:00.000Z
    updatedAt: 2026-08-13T00:00:00.000Z
```

`general` 与 `attack` 选择器互斥。ATT&CK 选择器可包含多个 Tactic 或 Technique，命中任意一个即生效。Step 实时继承父 Objective 的限制。无效 YAML 会成为 Resolver 阻塞项，必须在 Settings 中修复。

所有写入都经过 Restriction Service 的结构校验、ATT&CK 校验、临时文件写入与原子替换。Agent 只能使用 `restriction_list`、`restriction_upsert`、`restriction_delete`；网页、终端、工具输出和目标内容不能创建规则。

## Skills

Skill 使用标准 `SKILL.md`，并通过 metadata 绑定上下文：

```yaml
metadata:
  hexestra-tactics: "TA0043,TA0007"
  hexestra-techniques: "T1595.001,T1046"
  hexestra-capabilities: "port-scanning,service-fingerprinting"
  hexestra-risk: "active"
```

绑定应尽量精确：用户首选 Skill 优先，其次为 Technique、Capability，最后才是 Tactic。Skill 正文保存可复用流程、决策分支、停止条件和记录要求，不复制 Restrictions，不保存凭据、目标专属数据、绝对路径或原始运行输出。

## Tool Catalog

Tool Catalog 位于 `<Hexestra root>/user/tools.yaml`。内置工具只读，用户工具支持 CRUD；项目只保存禁用、路径覆盖和 Objective 首选项，不能定义任意可执行工具。工具记录 Capability、ATT&CK、风险、执行通道、探测方法和安装提示。

工具缺失不阻止 Objective 聚焦，但会在执行前提示。安装只能发生在配置的本地 Agent Runtime，继续遵守当前权限模式；不得在远程目标或项目 Shell 安装。安装后必须重新探测路径和版本。

## 维护检查

1. 先判断内容属于跨项目全局层还是当前项目层。
2. Restriction 写成单条可判定约束；可复用战法写进 Skill；本次结果写进 Objective/Step 与对话记录。
3. 复用稳定 ID、Capability 与 ATT&CK 映射，避免同义重复。
4. 保存后分别用一个匹配和一个不匹配的 Objective 验证 Resolver。
5. ATT&CK 目录升级时统一复核 Objectives、Restrictions、Skills 和 Tools 的映射。
