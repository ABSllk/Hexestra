# Hexestra User Guide

*[English](user-guide.md) · [简体中文](user-guide.zh-CN.md)*

> [!WARNING]
> Hexestra is only for explicitly authorized security testing. Before you start, confirm the targets, time window, permitted methods, data-handling rules, and stop conditions.

## 1. Quick start

This section gets you through your first session. Full details on installation and each feature come in later chapters.

### 1.1 Open or create a project

After launching Hexestra, from the Project menu choose:

- **Open Project Folder**: open an existing folder;
- **Create Project Folder**: create and open a new folder.

A project usually maps to one client, one authorization, or one isolated lab. Don't put unrelated targets in the same project.

### 1.2 Connect the agent

Open **Settings > Connection**:

1. Choose the Native environment or Windows Subsystem for Linux (WSL).
2. Select or auto-detect the Claude Code executable.
3. Choose the model and config sources.
4. Click Test Connection, and save on success.

Claude Code must already be installed in the chosen environment. If the connection fails, first run `claude --version` in that same environment.

Hexestra connects to this local Claude Code. You can keep your usual Claude Code habits — there's no separate agent command language to learn.

### 1.3 Set the testing scope

Open **Assets > Scope** on the left:

1. Choose whitelist or blacklist mode.
2. In the allow rules, list testable objects, one per line.
3. In the exclude rules, list objects that must not be touched.
4. Save and review manually.

Example:

```text
Allow:
app.example.test
api.example.test
192.0.2.0/24

Exclude:
status.example.test
192.0.2.53
```

Scope is a semantic hint for the operator and the agent; it does not forcibly block commands or network requests.

### 1.4 Create initial assets and tasks

Tell the agent the domains, subnets, or apps you already know:

> Create the initial assets and a task plan.

Registered assets appear in the asset inventory and the network map. Tasks appear in the task tree on the left.

### 1.5 Send your first work request

Keep the permission mode on **ASK**, select a task or asset, then send:

> Analyze the current project and continue with the next step.

Hexestra automatically supplies the project, scope, selected objects, and built-in rules; ASK mode handles actions that need approval. The agent's replies, tool calls, and results appear in the timeline on the right.

### 1.6 A recommended first end-to-end run

1. Create a project and set the scope.
2. Register initial assets.
3. Have the agent build a task plan.
4. Run the first low-risk task in ASK mode.
5. Verify results with the browser, traffic, or a command session.
6. Save evidence, then organize findings, vulnerabilities, and a report.

## 2. Understanding Hexestra

Hexestra is a human-and-agent collaborative penetration-testing IDE built on a local Claude Code. The operator and the agent share the project, browser, terminals, HTTP traffic, asset graph, tasks, evidence, and reports.

You use the agent the same way you use Claude Code. Hexestra adds project context, a shared operating surface, permission controls, and persistent records on top. Other agent backends may be supported in the future, but this version only supports Claude Code.

Hexestra organizes a test as a project:

```text
Project
├─ Scope: which objects to focus on or exclude
├─ Assets: domains, addresses, services, apps, endpoints, identities, and other test objects
│  └─ Relations: belongs-to, exposure, and connection relations between assets
├─ Tasks: the objectives to complete and their execution steps
├─ Runtimes: browser, traffic, terminals, and command sessions
├─ Records: evidence, findings, vulnerabilities, and reports
└─ Conversations: agent conversations and their branches
```

### 2.1 What a project is

A Project is one independent testing workspace, backed by a real folder on disk. It stores assets, tasks, conversations, traffic, records, workspace layout, and permission preferences. Reopening the same folder restores the previous state.

Key project data:

| Location | Purpose |
| --- | --- |
| `.hexestra/project.json` | Project identity and basic info |
| `.hexestra/project-state.json` | Workspace and project preferences |
| `.hexestra/engagement.db` | Structured data: assets, traffic, records, conversations |
| `ptt.md` | The ATT&CK task tree |
| `targets.md` | Host-oriented compatible target view |

Don't hand-edit the database while Hexestra is running. A project may contain sensitive targets, traffic, and evidence, and should be covered by secure backups and access control.

### 2.2 What scope is

Scope describes which objects to focus on or exclude, and feeds asset filtering, task planning, and agent context construction.

- **Whitelist**: the allow rules are the primary focus area;
- **Blacklist**: the exclude rules are the primary boundary;
- **Allow rules**: one allowed object per line;
- **Exclude rules**: one excluded object per line.

Scope is not an enforcement engine. Real control comes from permission modes, approval cards, restrictions, network config, and operator judgment. Scope does not replace written authorization.

### 2.3 What an asset is

An Asset is a test object you can identify, relate, and track in a project. It's more than an IP or host; it also includes:

- domains and subnets;
- ports and services;
- web apps, APIs, endpoints, parameters;
- certificates and identities.

An asset can carry a type, address, status, source, and linked records. A string in terminal or scanner output is only a candidate discovery; it becomes an authoritative project asset only after registration and read-back confirmation.

Asset statuses:

| Status | Meaning |
| --- | --- |
| `untested` | Not started |
| `in_progress` | Being worked on |
| `scanned` | Relevant checks done |
| `vulnerable` | A confirmed issue exists |
| `compromised` | The corresponding access is confirmed |

### 2.4 Asset graph, target view, and network map

The Asset Graph is the authoritative model of assets and their relations. For example, a domain can resolve to an address, a web app can run on a service, and an endpoint can belong to an API.

The Targets view is a host-oriented compatibility view generated from the asset graph. It's handy for quickly scanning domains, addresses, and ports, but it can't express the full application, endpoint, certificate, and identity relations.

The Network Map (NetMap) is the visual entry point to the asset graph, showing nodes and relations from a domain, network, or application perspective. It is not a separate asset dataset.

### 2.5 What a task is

A task describes what to do next. Hexestra organizes plans in this hierarchy:

```text
ATT&CK Tactic
└─ Technique
   └─ Objective
      └─ Execution Step
```

An Objective records target assets, dependencies, tools, success criteria, and status; an Execution Step describes a concrete action. Focusing a task makes it the agent's current focus, and the task trace is for checking agent, subagent, and tool activity.

A task represents plan and progress, not a verified result. Marking a task complete does not substitute for evidence.

### 2.6 What a record is

| Record | Meaning |
| --- | --- |
| Evidence | Verifiable raw material — traffic, command output, or file content |
| Finding | An observation, lead, hypothesis, or behavior derived from evidence |
| Vulnerability | A verified security issue with impact, severity, and remediation |
| Report | Aggregated deliverable content linked to findings and vulnerabilities |

The recommended chain is Evidence → Finding → Vulnerability → Report. The agent generally will not treat unreviewed scanner output directly as a vulnerability.

### 2.7 The agent

The agent can read the current project, selected objects, and explicit context, and helps you plan, act, and organize records. The project files and database are the authoritative state; the UI and conversation are entry points or projections of that state.

The agent can read and **operate** almost everything in Hexestra, for example:

- Hexestra's browser — locate and click elements, and read credentials from the page (tokens, JWTs, etc.);
- Hexestra's traffic capture — toggle capture, and replay or intercept key requests;
- Hexestra's proxy — configure the proxy chain and turn enforcement on (for safety, the agent can enable the proxy but cannot turn it off; the operator does that).

Web pages, files, terminal output, and traffic are all untrusted data; entering the agent's context does not turn them into trusted instructions.

### 2.8 Project state and conversation branches

A conversation can branch to preserve different reasoning paths, but files, assets, tasks, traffic, command sessions, the browser, and records belong to the whole project. Switching or reverting a conversation branch does not undo commands, network requests, or project changes that already happened.

## 3. Installation, launch, and first-time setup

### 3.1 Requirements

- Windows x64, Linux x64 (Ubuntu 24.04 as the reference), or macOS;
- Claude Code installed in the Native or WSL environment the agent uses;
- mitmproxy/mitmdump for traffic capture when running from source; it's bundled in releases;
- Burp Suite, JDK 17, and Mihomo are all optional.

### 3.2 Install Claude Code

```bash
npm install -g @anthropic-ai/claude-code
claude --version
```

With an Anthropic account:

```bash
claude auth login
claude auth status
```

For an Anthropic-compatible provider, set the base URL, token, and model variables in the same environment you launch Hexestra from. Never put keys in a project or repository.

### 3.3 Run from source

```bash
npm ci
npm run electron:dev
```

### 3.4 Configure the agent connection

Open **Settings > Connection**:

1. Choose Native or WSL.
2. In WSL mode, pick the distribution; the Windows reference default is `Ubuntu-24.04`.
3. In Native mode, Claude can be auto-discovered or you can pick the path manually.
4. Choose the default model and Claude config sources (user, project, local).
5. Test the connection and save.

You can't switch connection or model while a request is running. Hexestra currently connects to a locally installed Claude Code; other agent backends may be added later.

### 3.5 Project menu

- **Open Project Folder**: open an existing project;
- **Create Project Folder**: create and open a project;
- **Open in File Manager**: view the project directory;
- Remove from Recent: only removes the Recent entry, not the data on disk.

## 4. Workspace and navigation

| Area | Main content |
| --- | --- |
| Left sidebar | Assets, Tasks, Records, Files, Traffic, Command sessions |
| Center tabs | Welcome, Terminal, Editor, Browser, Traffic, Replay, Records, Report, Workflow, Knowledge Refinery, Settings |
| Right agent panel | Conversation, context, approvals, questions, subagents, and the background inbox |
| Bottom network map | Asset graph, relations, perspectives, and the current selection |

Tabs, the active tab, and ordering are restored per project. Closing a tab usually just closes the view; it does not automatically delete the underlying data or stop background activity.

### 4.1 Files and the editor

**Files** on the left browses the project directory; selecting a file opens it in the center editor. The editor reads and writes UTF-8 text, with a 2 MiB limit for local project files.

- After saving, other project features and the agent see the new content;
- use external tools for binary or oversized files;
- a file edit is a project side effect and does not roll back with a conversation branch;
- see "Remote file management" for how remote files are saved.

### 4.2 Shared context

Open Terminal, Editor, Browser, Traffic, and Report tabs can form a shared-context preview for the agent. Selected managed records, browser pages, traffic, and connection-builder results can also be explicitly added to the next message.

## 5. Scope, assets, and the network map

### 5.1 Asset workspace

**Assets** on the left contains:

- **Inventory**: search assets and filter by type or status;
- **Changes**: review asset changes;
- **Scope**: maintain the allow and exclude rules.

Right-clicking an asset lets you:

- view it in the network map;
- open it in the browser;
- copy the address;
- copy JSON;
- ask the agent to rescan or verify it.

### 5.2 Registering discoveries

Scanner and terminal output don't write to the asset graph automatically. When reconciling discoveries, the agent registers confirmed assets, reads them back with `asset_get` to confirm identity, and then adds relationships separately. For bulk machine-readable output (for example `nmap -oX -` or `httpx -json`), it can use `asset_import` to import many assets at once.

### 5.3 Using the network map

The bottom network map supports:

- domain, network, and application perspectives;
- selecting a node and syncing the current asset;
- dragging nodes and adjusting the layout;
- focusing an asset;
- viewing adjacency under different projections.

**PREVIEW TOPOLOGY** in an empty project is a synthetic example and is not written to the project.

## 6. How the task tree organizes and drives work

Hexestra's task tree is not a to-do list only humans read. It is at once the project plan, the agent's current context, the precondition for execution, and the skeleton for tracking results. Restrictions, skills, the tool catalog, and workflows all cooperate around the task tree, so you usually only need a short instruction, such as:

> Continue the current task.

Based on the currently focused task, Hexestra automatically fills in the relevant objectives, assets, restrictions, skills, candidate tools, dependencies, and existing records for this work.

### 6.1 Task tree structure

The task tree uses this hierarchy:

```text
ATT&CK Tactic
└─ ATT&CK Technique
   └─ Objective
      ├─ Execution Step 1
      ├─ Execution Step 2
      └─ Execution Step 3
```

- A **Tactic** says which high-level goal the current work serves.
- A **Technique** says which identifiable, countable class of test method is used. A new Objective must be bound to exactly one Technique.
- An **Objective** defines what to accomplish, against which assets, and what counts as success.
- An **Execution Step** is the smallest unit of work that can actually be run and accepted.

Task statuses are `pending`, `in_progress`, `completed`, `blocked`, `skipped`, and `failed`.

### 6.2 Objectives

An Objective can record:

- its Tactic and single ATT&CK Technique;
- target assets;
- required capabilities;
- preferred tools and preferred skills;
- prerequisite tasks;
- one or more success criteria;
- current status, diagnostics, and update time.

These fields aren't just labels. Hexestra uses them to resolve the restrictions, skills, tools, and dependencies this work needs. An Objective needs at least one success criterion; prerequisites must exist and be completed or skipped, and dependencies must not form a cycle. Otherwise the task shows a blocking reason and execution won't start.

Scope and a task's target are two different things: a task can name target assets explicitly; if it doesn't, the currently selected asset can serve as a context hint. When an asset is unlisted or excluded, Hexestra warns, but the scope mechanism itself is advisory and does not equal hard isolation or a network sandbox.

### 6.3 Execution steps

Focusing an Objective only loads context; it does not start testing. Before a real action, the agent breaks the objective into 3–7 short, result-oriented steps and focuses one runnable step.

Each Execution Step records:

- order and status;
- its own success criteria;
- a result summary;
- a blocked reason;
- the Tactic, Technique, assets, capabilities, tools, skills, and dependency context resolved from the parent Objective.

When the first real tool action happens, the current step and its parent Objective automatically move to `in_progress`. On completion, write a concise result summary; when blocked or failed, record the reason. A started step can no longer be renamed, reordered, or deleted; a step with recorded activity can't be deleted either. An Objective with execution activity can't be casually moved to another Tactic or Technique. These constraints keep the plan, actual execution, and audit trail consistent.

### 6.4 Focusing a task and dynamic context

In the task details, choose **Focus for Agent** to tell the current agent branch which Objective or Execution Step to work on next.

The task tree is shared by the whole project, but focus belongs to the current conversation branch. So different branches can view the same task tree and focus on different work; switching branches restores that branch's own task focus. A task currently focused by any active branch cannot be deleted.

On each normal turn, Hexestra generates app-managed dynamic context from the current focus, including:

- the project, OPSEC, autonomy mode, and scope summary;
- the current Objective and active step;
- pinned-version ATT&CK Tactics and Techniques;
- target assets and scope warnings;
- the currently effective restrictions;
- matched skills and candidate tools;
- prerequisites, blocking reasons, and other notices;
- IDs of related evidence, findings, and vulnerability records.

To avoid stuffing in too much at once, related records usually inject only IDs and summaries. The agent reads details on demand through tools when needed. **This is also why short instructions work: you don't have to repeat the project background and operating conventions in your prompt.**

### 6.5 Restrictions

Restrictions come in global and project rules. An enabled rule can be:

- **General**: applies to all tasks;
- **Tactic rule**: applies when the Objective belongs to the given Tactic;
- **Technique rule**: applies when the Objective is bound to the given Technique.

After you focus a task, Hexestra merges matching global and project rules into the "currently effective restrictions." Identical rules are de-duplicated while keeping their sources and match reasons; rules that may conflict show related info. When a restriction file is invalid, the diagnostics become a task blocker.

A restriction is a project constraint the agent must obey, but it cannot override system safety requirements, Rules of Engagement, or permission mechanisms, and it is not an OS-level or network-level sandbox. Editing restrictions requires explicit operator confirmation.

### 6.6 Skills

A Skill provides the "how" — methods, steps, and expertise. Hexestra first resolves same-name overrides between project and global skills, then matches from the available, enabled skills in this priority:

1. a preferred skill named explicitly by the Objective;
2. a skill declaring support for the current ATT&CK Technique;
3. a skill declaring the capability the task needs;
4. a skill declaring support for the current Tactic;
5. any other available skill.

A same-name project skill wins over a global one; even a disabled project skill shadows the same-name global skill. This lets a project pin its own way of working without silently falling back to a different same-name description.

A skill only provides knowledge and method; it does not grant permissions or change the actual execution path. For example, a skill can explain how to verify access control, but actually sending the request still depends on the agent tools, task execution conditions, permission mode, and restrictions.

### 6.7 Tool catalog, execution conditions, and permissions

The tool catalog answers "which tools the agent may consider." Every normal turn receives a compact index of all enabled entries; with a focused task, Hexestra expands the full prompt for these candidates:

- preferred tools named explicitly by the Objective;
- tools declaring support for the current Technique;
- tools declaring the capability the task needs.

Disabled entries don't enter the index or candidates. The catalog stores no runtime state and does not judge whether a tool can run; real capability is decided by the Shell, MCP, Browser, Traffic, and other agent tools. A skill or catalog match does not mean execution can begin immediately.

Before a real action starts, it passes these checks in order:

```text
Objective focused
    ↓
3–7 steps planned
    ↓
one runnable step focused
    ↓
dependencies, success criteria, and diagnostics all unblocked
    ↓
restrictions and Rules of Engagement allow it
    ↓
tool call handled per ASK / AUTO / BYPASS permission mode
    ↓
execute and write the task trace
```

Task management, restriction lookups, and tool-catalog lookups can be used even before execution conditions are met, because the agent needs them to complete the plan or repair context; actions with real impact must pass the checks above.

### 6.8 Workflows

A workflow is a reusable procedure, not an auto-matched field on an Objective. It does not run just because a task is focused; you select and run it from **Tasks > Workflows**.

When you run a workflow, Hexestra reads the exact saved version, records its name, version, and consistency fingerprint, and sends the workflow body plus this run's note as a normal agent request. The agent then:

1. inspects the existing task tree;
2. reuses or updates matching tasks;
3. creates only the missing Objectives and Execution Steps;
4. continues with the first runnable task once the tree is consistent.

Workflows provide reusable procedural structure; the task tree carries this project's actual state. The workflow body is user-authored operating text and cannot override system instructions, restrictions, Rules of Engagement, or permission modes. The version and fingerprint in the run record help confirm exactly which procedure a run used.

The workflow library supports:

- search, create, edit, preview, and save;
- copy, import, export;
- delete with confirmation;
- run from the preview page;
- add a note that applies only to this run.

On an import ID conflict, you can overwrite or cancel.

### 6.9 Summary

| Part | Question it answers | How it participates in execution |
| --- | --- | --- |
| Objective | What to accomplish, what counts as success | Provides Tactic, Technique, assets, capabilities, dependencies, and success criteria |
| Execution Step | What the next runnable work is | The smallest binding unit for real actions, results, and status |
| Scope | Which assets to prioritize or exclude | Provides advice and warnings, not hard isolation for now |
| Restriction | What must and must not be done | Auto-matched by general/tactic/technique, forming normative constraints |
| Skill | How this class of work should be done | Auto-ordered by preferred/technique/capability/tactic and provides method |
| Tool catalog | Which tools the agent may consider | Provides a prompt catalog and expands candidate details by preferred/technique/capability |
| Permission mode | Whether a tool call needs confirmation | Enforces approval control before a real action |
| Workflow | How a procedure is reused | After a user runs it, reuses, updates, or completes the task tree |
| Project records | What execution produced | Save evidence, findings, vulnerabilities, and reports, linked to tasks |

### 6.10 A complete example

Suppose the Objective is "verify access control on the login API," naming the login-API asset, one ATT&CK Technique, the `HTTP replay` capability, a preferred skill, and success criteria. The project also has a technique restriction "do not modify real account data."

After you focus this Objective, Hexestra auto-matches restrictions and skills, lists candidate tools with the HTTP-replay capability, and checks prerequisites. The agent first creates 3–7 steps, then focuses the first one. After that you only need:

> Continue the current task.

If the permission mode requires ASK, confirmation still appears before the real request is sent; if a needed tool is missing or a prerequisite isn't done, the step is blocked with a reason. When you run the "login-API verification" workflow, the agent reuses this task first rather than mechanically creating a duplicate plan.

### 6.11 Task trace and completion judgment

The Task Trace shows the agents, subagents, tool calls, branches, timing, and status changes related to an Objective or Execution Step. When an activity first appears, it binds to the task focused at that moment; even if you switch focus later, the historical binding is not rewritten.

Task details support:

- viewing and editing unlocked Objectives or Execution Steps;
- Focus for Agent;
- updating status, result summary, and blocked reason;
- viewing the task trace;
- viewing overall progress, ATT&CK coverage, and success criteria.

To judge whether work is done, look at step status, result summary, success criteria, and linked records together — not just whether the agent stopped producing output.

## 7. The agent

### 7.1 Conversation

Use the agent panel on the right like Claude Code inside the project — just say what you want. For example:

- `Analyze this request.`
- `Continue the current task.`
- `Organize these findings.`
- `Save the result as evidence.`
- `Update the report from the existing records.`

You usually don't need to repeat the current project, scope, selection, available tools, or record process; Hexestra already supplies these via project context and built-in prompts. Add detail only when the goal, boundaries, or expected result change.

The agent panel on the right supports:

- selecting or creating a conversation;
- viewing shared context;
- entering normal messages or slash commands;
- adding attachments;
- viewing the timeline, tool calls, and results;
- handling approval requests and questions;
- viewing subagents;
- viewing the background inbox.

### 7.2 Attachments

Text, code, PDF, local file paths, and PNG/JPEG/GIF/WebP images are supported:

- up to 8 attachments per message;
- up to 10 MiB per attachment;
- attachments and staged context can't be sent together with a native command.

### 7.3 Commands

| Command | Purpose |
| --- | --- |
| `/distill` | Distill from a source and create or update restrictions, skills, and workflows |
| `/compact` | Compact the current context |
| `/context` | View context info |
| `/cost` | View usage info |
| `/help` | View runtime help |
| `/status` | View runtime status |

The UI also shows commands discovered from Claude Code and enabled-skill commands. A native slash command is passed to Claude Code as-is and does not automatically get the normal project context and attachments attached.

### 7.4 Permission modes and autonomy level

| Mode | Behavior | Recommendation |
| --- | --- | --- |
| **ASK** | Asks before risky tool calls | Use by default |
| **AUTO** | Backend policy classifies and reviews actions | Well-defined routine flows |
| **BYPASS** | Turns off software permission checks | Only in isolated, recoverable environments where you fully understand the risk |

Switching modes doesn't change a running request; the new mode takes effect from the next request. Low/medium/high autonomy level is only a work preference — it differs from permission mode and does not widen the authorization.

### 7.5 Approvals and questions

When a tool needs permission, the timeline shows an approval card. Check the tool, target, parameters, and impact, then allow or deny.

When the agent needs a business judgment, it shows a question card; pick an existing option or type a custom answer. When denying an action, it's best to suggest an alternative direction.

### 7.6 In-flight input, stop, and queue

You can still send messages while the agent is working. A new message first shows as queued; once Claude Code consumes it, the queued marker disappears.

- multiple inputs may be merged;
- one input is not guaranteed to map to one reply;
- **Stop** interrupts the current request;
- a consumed input can't be recalled;
- an unconsumed input may be kept.

### 7.7 Conversation branches

Editing a completed user message branches from that point, keeping the original branch. You can't edit a message or switch branches during an active request.

A branch only separates the conversation history; files, network requests, the browser, command sessions, traffic, assets, and records are not rolled back.

### 7.8 Subagents

Subagent cards and details show:

- the subtask and type;
- progress, tool, or waiting status;
- live or final duration;
- tool-call count and token info;
- the activity timeline and final output.

Subagent results should be checked against project evidence before being registered as authoritative assets or records.

### 7.9 Scheduled wakeups and the inbox

The agent can create a one-shot scheduled wakeup:

> Check this command again in three minutes.

Limits:

- Hexestra and Claude Code must stay running;
- it's a one-shot session reminder, not a recurring task or system alarm;
- follow-up work returns to the original project and branch;
- recovery after app exit, sleep, or a runtime crash is not guaranteed.

When something completes, fails, or awaits approval or an answer in the background, it enters the **Agent Inbox**. Clicking an item returns you to the corresponding project and branch.

## 8. Browser

The built-in Browser requires an open project and supports:

- back, forward, reload;
- new tabs;
- address-bar navigation;
- copy address;
- **Ask Agent**;
- viewing load status;
- turning a popup or new window into a Hexestra browser tab.

Only HTTP(S) is supported. Browser sessions are managed per project and tab; with traffic capture or a project proxy enabled, the corresponding network path is used.

Pages, selected text, and links can be added to the agent context. Page content is always untrusted data.

## 9. Traffic, interception, and replay

### 9.1 Capturing traffic

Start or stop capture in **Traffic** on the left. The list supports:

- search;
- filter by status such as paused, complete, failed;
- filter by browser or replay source;
- filter by host;
- view replays related to a raw flow;
- load more;
- clean up deletable history.

Traffic is stored in the project database, but response bodies and history have capacity limits. Save important results as evidence promptly.

### 9.2 Traffic menu

Right-click a flow to:

- open details;
- open in the Hexestra Repeater;
- copy URL, raw request, raw response, or cURL;
- ask the agent;
- save as evidence;
- filter by host;
- view related replays;
- send to the Burp Repeater or Intruder when the Burp MCP provides the tool;
- forward or drop a paused message;
- delete the local flow record.

Deleting a flow does not delete Burp history, saved evidence, or replay attempts. If the flow owns a Hexestra replay session, that session is deleted with it.

### 9.3 Request and response breakpoints

After capture starts, you can enable:

- **Request Break**: pause before sending;
- **Response Break**: pause before returning to the browser.

While paused you can view and edit the raw content of the current side, then choose:

- **Forward**;
- **Drop**.

Turning off a breakpoint releases the corresponding paused messages. Edited content goes through parsing and revision validation; on conflict, re-read the latest record.

### 9.4 The Hexestra Repeater

The Repeater supports:

- editing and sending a raw request;
- viewing each attempt;
- switching between historical attempts;
- restoring the source request;
- copying request or response;
- clearing the replay session;
- comparing status code, response-byte delta, and duration delta.

You currently can't edit replayed WebSocket traffic. **Cancel wait** only stops the UI wait; it does not guarantee cancelling a request already sent, and the result may still appear in the traffic list.

### 9.5 Saving evidence

Choose **Save as Evidence** in the details or context menu to create a managed evidence record while preserving asset and traffic links.

## 10. Burp Suite integration

Burp integration has two independent capabilities:

1. **Bridge mirroring**: mirror completed exchanges captured by Hexestra to a local Burp;
2. **Burp MCP**: once its tools are discovered, send traffic to the Burp Repeater or Intruder.

### 10.1 Configure the Bridge

1. Build and load `resources/burp-bridge/hexestra-burp-bridge.jar` with JDK 17.
2. Get the loopback port and pairing token from Burp's Hexestra Bridge page.
3. Open **Settings > Burp** and enter the port and token.
4. Save and connect.

Mirrored results appear in Burp's **Target > Site map**, and in the Organizer where supported; they do not appear in **Proxy > HTTP history**.

A Bridge or MCP failure does not stop Hexestra's own traffic capture.

## 11. Terminals, command sessions, and remote files

### 11.1 Local terminal

The center Terminal is a basic local pseudo-terminal, launched from the project root by default, with copy, paste, select-all, and common terminal interaction.

When the agent uses the same terminal it may hold an execution lock. The operator can interrupt or take over. Terminal output is not auto-registered as assets.

### 11.2 Command-session configuration

**Shells** on the left manages reusable connections:

| Type | Purpose |
| --- | --- |
| Local | Local command environment |
| WSL | A specified Windows Subsystem for Linux distribution |
| SSH | SSH, private keys, jump hosts, and SFTP |
| WebShell | Run controlled commands over HTTP(S) requests |

Command flavor can be auto, POSIX, PowerShell, or CMD. An asset role can be target or infrastructure; infrastructure / jump-only configs are not offered to the agent for running target commands.

Session states include connecting, awaiting host key, verifying, quarantined, ready, agent-locked, disconnected, failed, and closed.

### 11.3 SSH

SSH configuration supports:

- host, port, username;
- password, private key, keyboard-interactive;
- saving credentials;
- jump-host configuration;
- host-key fingerprint verification.

On first connect you must explicitly review and accept the host key; Hexestra does not trust it automatically. If a key changes, investigate the cause first.

### 11.4 Shared sessions and human takeover

A managed command session supports connect, attach, read, write, resize, interrupt, take over, and disconnect.

While the agent runs a command it holds an exclusive lease, so both sides don't type at once. The operator can choose **Take over** or interrupt. A command audit can be saved as evidence.

### 11.5 Reverse shell

You can save, start, and stop listener configs. A listener must bind an explicit network interface or address and cannot use an arbitrary wildcard address.

A new connection first enters quarantine:

- bound to an existing asset after you verify its source;
- rejected when it isn't an authorized target;
- moved into a shared session after binding.

The payload / connection builder supports a callback address, public-IP detection, templates, and no-encoding/Base64, and can be copied or handed to the agent. Templates include PowerShell TCP, Bash TCP, Python 3, Netcat, BusyBox Netcat, and PHP CLI.

Use it only in an isolated lab or against targets where a callback is explicitly permitted.

### 11.6 WebShell

WebShell session configuration supports:

- generic mode or AntSword v2 PHP;
- auto, PHP, JSP, JSPX, ASPX runtimes;
- GET/POST;
- no body, form, JSON, or raw body;
- a `{{command}}` or `{{command_base64}}` placeholder;
- custom headers;
- optional ignore of invalid TLS;
- full response, between-delimiters, or regex extraction;
- auto, UTF-8, GB18030 encoding;
- OS command, PHP eval, or auto mode;
- AntSword password parameter and raw/base64/hex encoding.

Verify status and system info with the health check before saving.

### 11.7 Remote file management

A ready, SFTP-capable SSH session can serve as a file source. It supports:

- going to the home directory, parent, or a specified absolute path;
- refresh;
- create a file or directory;
- open and edit text;
- upload, download, and cancel a transfer;
- rename;
- delete a file or directory.

## 12. Project-level Mihomo proxy

### 12.1 Nodes and chains

**Settings > Proxy** configures a user-provided Mihomo. Supported protocols:

`http`, `https`, `socks5`, `ss`, `vmess`, `vless`, `trojan`, `hysteria2`, `tuic`.

It supports:

- auto-detecting or selecting the runtime binary;
- start and stop;
- turn project egress enforcement on or off;
- refresh the egress IP;
- import nodes via URI, form, or YAML;
- bulk import, test, edit, and delete nodes;
- create chains of up to 8 hops;
- reorder nodes and remove hops;
- save, activate, test, or delete chains;
- view closed, starting, ready, degraded, blocked, and error states;
- view TCP/UDP readiness, egress IP, and latency.

Node credentials are encrypted in a global vault; a project stores only chain identifiers.

### 12.2 Proxy scope

Controlled paths:

- the browser;
- traffic and replay;
- the outermost SSH or jump-host connection;
- WebShell requests.

Local and WSL terminals get proxy environment variables injected, but a program can ignore them and connect directly.

Not controlled by the current proxy:

- Claude API traffic;
- secondary egress spawned by remote commands;
- other apps on the system.

Hexestra does not enable TUN and does not modify the system proxy. With egress enforcement on, it is **fail-closed**: when the runtime is missing, the chain is invalid, or the run fails, the controlled paths are blocked and do not fall back to direct.

## 13. Records and reports

### 13.1 The four records

| Type | Key fields |
| --- | --- |
| Evidence | Asset, tool, type, content, source, and links |
| Finding | Type, confidence, status, description, and evidence |
| Vulnerability | Severity, status, impact, remediation, CVE/CWE/CVSS |
| Report | Status, summary, Markdown body, and linked records |

Finding types are observation, lead, hypothesis, behavior, access, note; confidence is low, medium, high; status is active, used, archived.

Vulnerability severity is critical, high, medium, low, info; status is confirmed, remediation, resolved, accepted. Report status is draft or final.

### 13.2 Browsing and editing

**Records** on the left switches between Evidence, Finding, Vulnerability, and Report:

- click to open details;
- right-click to open details, copy JSON, export Markdown, or delete;
- deleting a record cleans up other records' links to it, without cascading deletion of referenced records;
- evidence raw content is read-only;
- the business fields of findings, vulnerabilities, and reports are editable;
- report bodies render as Markdown;
- a finding can link an asset or be a project-level record.

### 13.3 From evidence to report

```text
Raw output or traffic
       ↓
    Evidence
       ↓
    Finding
       ↓ verify
  Vulnerability
       ↓
     Report
```

Before a report goes to final, make sure key conclusions have reliable reproduction steps and results.

The report preview supports AI generation:

> Update the report from the linked records.

Records are project-level state and do not roll back with a conversation branch.

## 14. Knowledge refinery and agent context

### 14.1 Knowledge refinery

**Tasks > Refinery** turns external material into reusable rules and procedures:

1. import text, Markdown, code, PDF, DOCX, or a skill export;
2. preview the normalized source;
3. click Refine;
4. Hexestra opens a new agent conversation and sends `/distill source:<id>`;
5. the agent reads and updates existing restrictions, skills, and workflows;
6. review the summary and the actual artifacts;
7. delete the source when it's no longer needed.

Older projects may show run, job, and candidate pages with logs, retry/cancel, edit, and accept/reject. That is a compatibility entry for legacy offline-refinery records; use `/distill` for new material.

### 14.2 Skills

**Settings > Skills** supports:

- viewing global, project, and core skills;
- create, edit, enable, disable, and delete;
- editing Markdown content;
- maintaining ATT&CK tactic, technique, capability, and risk metadata;
- viewing read-only core skills.

Global skills apply to all projects; a same-name project skill overrides the global one; a disabled project skill suppresses the same-name global skill. Skills do not automatically grant tool permissions.

### 14.3 Restrictions

**Settings > Restrictions** supports:

- global and project rules;
- create, edit, enable, disable, and delete;
- general binding or ATT&CK tactic/technique binding;
- search and filter;
- YAML import preview, apply, and export.

The two enabled layers are merged. Invalid YAML blocks apply and shows diagnostics. Restrictions enter the agent context, but they are not network isolation.

### 14.4 Tool catalog

**Settings > Tool Catalog** manages the global `user/tools.yaml` prompt catalog. You can search, add, edit, enable, disable, and delete entries, and maintain description, risk, channel, capability, ATT&CK mapping, command hint, and usage hint. A saved entry's stable ID can't be changed.

The catalog only tells the agent which tools it may consider; it does not mean a tool is installed, executable, or approved, and it does not probe or run tools. Actual work still goes through the Shell, MCP, Browser, Traffic, and other agent tools. A disabled entry does not enter the agent context; deleting an entry does not rewrite the preferred-tool IDs in historical tasks.

### 14.5 Model Context Protocol (MCP)

**Settings > MCP** manages servers across the user, project, and local scopes:

- create, edit, and delete JSON definitions;
- refresh connection status;
- view connection, tool count, and errors.

A definition may contain environment variables, headers, and credentials. Avoid exposing these values in screenshots, screen sharing, or repositories.

## 15. Settings reference

| Page | Function |
| --- | --- |
| General | English/简体中文; system/dark/light theme |
| Connection | Native/WSL, distribution, Claude path, model, config sources, test/save/reset |
| Traffic Runtime | Detect mitmdump status, path, version, source; re-detect, select, or auto-reset |
| Proxy | Mihomo runtime, nodes, chains, egress enforcement, test, and status |
| Burp | Bridge port/token, MCP SSE, save, connect, and status |
| Skills | Global, project, and core skills |
| Restrictions | Global/project rules and YAML import/export |
| Tool Catalog | Agent tool prompts, capabilities, risk, channel, and ATT&CK mapping |
| MCP | user/project/local server definitions and connection status |

After changing Connection, Proxy, Burp, or MCP, confirm with the corresponding connection test before letting the agent rely on them. The tool catalog itself does not check runtime status.

## 16. Common workflows

### 16.1 New-project baseline

1. Create a project and record the authorization summary.
2. Configure allow and exclude rules.
3. Connect the agent in ASK mode.
4. Register known domains, subnets, and apps.
5. Have the agent build the ATT&CK task tree.
6. Confirm Objectives and success criteria one by one.

### 16.2 Browser with traffic analysis

1. Open a web app from the asset inventory.
2. Start traffic capture.
3. Perform authorized page actions.
4. Filter traffic by host.
5. Open key requests and ask the agent.
6. Save important traffic as evidence.

### 16.3 Intercept and modify a request

1. Start capture and the request breakpoint.
2. Trigger the request in the browser.
3. Open the paused flow.
4. Check target, cookies, headers, and body.
5. Modify the fields you're allowed to test.
6. Forward or drop.
7. Turn off the breakpoint to avoid piling up later requests.

### 16.4 Compare differences with the Repeater

1. Open the Repeater from a completed flow.
2. Keep the source request as a baseline.
3. Change one variable at a time.
4. Compare status code, byte delta, and duration delta.
5. Save valuable results as evidence.
6. Describe the observation in a finding — don't overstate it as a vulnerability.

### 16.5 Share a session over SSH

1. Create an SSH config.
2. Check host, account, and jump host.
3. Verify the host-key fingerprint.
4. Connect to the ready state.
5. Have the agent explain the command and expectation first.
6. Don't type while the agent runs; take over when you need to step in.
7. Save key command audits as evidence.

### 16.6 Reconcile a batch of discoveries

1. Save evidence from traffic, a command session, or files.
2. Create a finding with type, confidence, and description.
3. Keep verifying and link new evidence.
4. Create a vulnerability once it's reproducible and the impact is clear.
5. Fill in severity, impact, remediation, and standard identifiers.
6. Add verified records to a report.

### 16.7 Build a reusable workflow

1. Open Tasks > Workflows and create one.
2. Fill in name, version, description, and tags.
3. In the body, state the goal, inputs, steps, stop conditions, and output format.
4. Save and preview.
5. Add a note for this run.
6. Run it and check whether the agent follows the procedure.
7. Export the stable version.

### 16.8 Distill rules from material

1. Import a personal doc, test spec, or internal method.
2. Preview the source and exclude secrets that shouldn't be exposed.
3. Run refinement.
4. Review the updated restrictions, skills, and workflows.
5. Double-check the scope and risk metadata.
6. Validate with a low-risk task.

### 16.9 Configure multi-hop egress

1. Detect the Mihomo runtime.
2. Import and test nodes.
3. Create a chain of no more than 8 hops.
4. Test the whole chain and the egress IP.
5. Activate the chain and turn on egress enforcement.
6. Do a harmless connectivity check with the browser or Repeater.
7. Fix any block or error first — it won't fall back to direct.

### 16.10 Have the agent re-check later

> Check this task again in three minutes.

The result returns to the original project and branch and notifies you via the Agent Inbox.

## 17. Further reading

- [Docs index](index.md)
- [Architecture](architecture.md)
- [Domain model](domain-model.md)
- [Agent runtime](agent-runtime.md)
- [Agent context maintenance](agent-context-maintenance.md)
- [Contributing guide](../CONTRIBUTING.md)

If the guide disagrees with the current UI, treat reproducible actual behavior as the source of truth, and fix the document, tests, and implementation notes together rather than creating conflicting sources.
