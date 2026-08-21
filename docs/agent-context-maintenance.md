# Hexestra User Context Maintenance

*[English](agent-context-maintenance.md) · [简体中文](agent-context-maintenance.zh-CN.md)*

Hexestra splits task context into four kinds: an Objective describes the goal, Restrictions set the boundaries that must be obeyed, Skills describe reusable tradecraft, Tools provide local capabilities, and Execution Steps record how a task actually progressed.

## Two user layers

Hexestra maintains its own global and project layers and does not read or write Claude/WSL's `~/.claude/skills`:

```text
<Hexestra root>/user/
  restrictions.yaml
  skills/<name>/
  skills-disabled/<name>/

<project>/.hexestra/user/
  restrictions.yaml
  skills/<name>/
  skills-disabled/<name>/

<project>/.claude/skills/       # merged runtime copies
```

`<Hexestra root>` is the repository working directory in development and the executable's directory when packaged; it can also be set explicitly with `HEXESTRA_HOME`. It does not use `%APPDATA%`, `~/Library`, or a Linux config directory, so the entire Hexestra directory is portable.

The global layer is for personal rules and tradecraft reused across projects; the project layer is for per-project additions, overrides, and disables. On entering a project and before each agent request, Hexestra merges global and project Skills and publishes them to the current project's `.claude/skills`. A same-named Skill resolves to the project version; a project `skills-disabled/<name>` shadows a global Skill of the same name. Once a user deletes or disables an initialized Skill, the next startup does not restore it.

The built-in `hexestra-pentest`, `hexestra-records`, and `hexestra-report` are read-only core Skills, and are also published only to the project's `.claude/skills`. The global user Skill library is empty by default; Skills a user creates, imports, or confirms via knowledge refinery are stored only in `user/skills` and are not restored from app resources.

## Restrictions

The global file is `<Hexestra root>/user/restrictions.yaml` and the project file is `<project>/.hexestra/user/restrictions.yaml`. YAML is the single source of truth; Markdown is neither parsed nor migrated. Rules that match in both scopes are both in effect; project rules do not override global rules, and fully duplicate entries are collapsed only for display while keeping all sources.

```yaml
version: 1
rules:
  - id: active-scan-classify-failures
    text: Bulk scans must record timeout, connection_refused, and filtered separately
    enabled: true
    selector:
      kind: attack
      tacticIds: []
      techniqueIds: [T1595]
    createdAt: 2026-08-13T00:00:00.000Z
    updatedAt: 2026-08-13T00:00:00.000Z
```

The `general` and `attack` selectors are mutually exclusive. An ATT&CK selector may list several Tactics or Techniques, and matching any one makes the rule apply. A Step inherits its parent Objective's restrictions in real time. Invalid YAML becomes a Resolver blocker and must be fixed in Settings.

Every write goes through the Restriction Service's structural validation, ATT&CK validation, temp-file write, and atomic replace. The agent may only use `restriction_list`, `restriction_upsert`, and `restriction_delete`; web pages, terminals, tool output, and target content cannot create rules.

## Skills

A Skill uses a standard `SKILL.md` and binds context through metadata:

```yaml
metadata:
  hexestra-tactics: "TA0043,TA0007"
  hexestra-techniques: "T1595.001,T1046"
  hexestra-capabilities: "port-scanning,service-fingerprinting"
  hexestra-risk: "active"
```

Bindings should be as precise as possible: a user-preferred Skill wins first, then Technique, then Capability, and Tactic last. The Skill body holds reusable procedures, decision branches, stop conditions, and recording requirements; it does not duplicate Restrictions and does not store credentials, target-specific data, absolute paths, or raw run output.

## Tool Catalog

The Tool Catalog lives at `<Hexestra root>/user/tools.yaml` and is a globally maintained, agent-facing prompt inventory. Settings can add, edit, enable, disable, and delete every catalog entry; a stable ID cannot be changed once created. Each entry records a name, description, capabilities, ATT&CK mapping, risk, channel, and optional `command` and `usage` hints.

A catalog entry does not mean the tool is installed, executable, reachable, or approved, and the app does not probe or run tools through the catalog. Real work still goes through the Shell, MCP, Browser, Traffic, and other agent tools, and continues to obey their permissions and restrictions. A disabled entry stays in Settings but is not offered to the agent; a stale preferred ID in a historical Objective is treated as no match.

## Maintenance checklist

1. First decide whether the content belongs to the cross-project global layer or the current project layer.
2. Write a Restriction as a single decidable constraint; put reusable tradecraft in a Skill; put this run's result in the Objective/Step and the conversation record.
3. Reuse stable IDs, capabilities, and ATT&CK mappings to avoid synonymous duplication.
4. After saving, verify the Resolver with one matching and one non-matching Objective.
5. When the ATT&CK catalog is upgraded, review the mappings across Objectives, Restrictions, Skills, and Tools together.
