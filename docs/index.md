# Hexestra Documentation

*[English](index.md) · [简体中文](index.zh-CN.md)*

## User documentation

The [full user guide](user-guide.md) is the primary entry point. Hexestra currently connects to a locally installed Claude Code, so you can keep your Claude Code habits and issue short commands directly. The guide opens with a quick start, then covers projects, scope, and assets, and goes on to:

- installation, agent connection, projects, and workspaces;
- scope, assets, target views, and the network map;
- the ATT&CK task tree, and how restrictions, skills, tools, permissions, and workflows drive execution together;
- agent conversations, attachments, slash commands, permissions, queues, branching, subagents, scheduled wakeups, and the inbox;
- browser, traffic, interception, Repeater, and Burp;
- terminals and local / WSL / SSH / WebShell / reverse-shell sessions and remote files;
- project-level Mihomo nodes, multi-hop chains, fail-closed behavior, and the real routing scope;
- evidence, findings, vulnerabilities, and reports;
- knowledge refinery, skills, restrictions, the tool catalog, and MCP;
- ten common workflows, troubleshooting, safety boundaries, and legacy-compatibility entry points.

The [English README](../README.md) at the repo root is a quick way to understand the product's positioning, requirements, and how to run from source; treat the full user guide as authoritative for actual operation.

## Going deeper

| Document | Question it answers |
| --- | --- |
| [Architecture](architecture.md) | How do the renderer, preload layer, main process, project files, and external runtimes work together? |
| [Domain model](domain-model.md) | How do scope, the asset graph, tasks, evidence, findings, vulnerabilities, and reports relate? |
| [Agent runtime](agent-runtime.md) | How does the agent build context, apply task and permission gates, queue input, persist history, and branch conversations? |
| [Agent context maintenance](agent-context-maintenance.md) | How are restrictions, skills, and the tool catalog maintained? |

## Maintenance and contributing

- [Contributing guide](../CONTRIBUTING.md): development setup, quality checks, and submission requirements.
- [Chinese README](../README.zh-CN.md): the Chinese-language product entry point.
- [Burp Bridge notes](../resources/burp-bridge/README.md): building, loading, and the bridge boundary.
- [mitmproxy runtime notes](../resources/mitmproxy/README.md): bundled resources, versions, and license boundaries.

The user guide describes behavior reachable from the current UI; the technical docs describe authoritative state, cross-layer data flow, and implementation constraints. Neither replaces written authorization, a rules-of-engagement agreement, or the operator's professional judgment.

If a document disagrees with actual behavior, fix the implementation, the tests, and the document that owns that behavior in the same change — don't stand up a second, parallel description.
