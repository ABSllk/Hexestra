<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="src/assets/branding/hexestra-logo-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="src/assets/branding/hexestra-logo-light.svg">
  <img alt="Hexestra" src="src/assets/branding/hexestra-logo-light.svg" width="720">
</picture>

## Orchestrate your pentest.

An AI-native penetration testing workbench where you and AI agents work together to accelerate your pentest workflow.

[Download](https://github.com/ABSllk/Hexestra/releases/latest) · [Watch the demo](docs/images/hexestra-tour.mp4) · [Get started](docs/user-guide.md#1-quick-start)

[English](README.md) · [简体中文](README.zh-CN.md)

</div>

## Why Hexestra?

Hexestra aims to make penetration testing smoother for you and your agent. To do that, we've built a harness designed for penetration testing:

- **Integrated tools.** Connect Claude Code or Codex CLI to the browser, terminals, managed shells, HTTP/HTTPS capture, interception and replay, payload generation, and Burp Suite. The agent can operate them directly.

<p align="center"><img src="docs/images/kanxue/01-overview.png" alt="Hexestra workbench showing assets, actions, agent chat, and NetMap" width="960"><br><em>Workbench overview: assets, actions, agent chat, and NetMap together.</em></p>

<p align="center"><img src="docs/images/kanxue/02-tools.png" alt="Traffic tools showing an order request, response, and agent activity" width="960"><br><em>Inspect requests and responses, then replay them, save evidence, or ask the agent.</em></p>

- **Task-aware memory.** Hexestra records the target, assets, scope, rules, available tools, and earlier results for the current task. The agent can keep track of progress through long sessions and across conversations.

<p align="center"><img src="docs/images/kanxue/03-memory.png" alt="Record view retaining findings, evidence, and vulnerabilities across conversations" width="960"><br><em>Record keeps findings, evidence, and vulnerabilities available in a new conversation.</em></p>

- **Task tree.** The agent plans before acting, breaks goals into steps, and updates their status as work progresses. See what's done, what's blocked, and what comes next without digging through chat history.

<p align="center"><img src="docs/images/kanxue/04-task-tree.png" alt="Task tree showing goals, completed steps, and the active task" width="960"><br><em>See completed steps, current progress, and what's next in the task tree.</em></p>

- **NetMap.** As the agent discovers assets, it builds a map of their relationships. Switch between network, domain, and application views to inspect hosts, services, endpoints, and identities.

<p align="center"><img src="docs/images/kanxue/05-netmap.png" alt="NetMap linking the application, order endpoints, and identity" width="960"><br><em>NetMap links the application, endpoints, and identity.</em></p>

- **Rules and workflows.** Match testing rules and methods to the project and current task. Import PDF, DOCX, or Markdown documents and have the agent distill them into reusable rules, skills, and workflows.

<p align="center"><img src="docs/images/kanxue/06-rules.png" alt="Project rules matched to ATT&CK tasks" width="960"><br><em>Bind project rules to the relevant ATT&CK tasks.</em></p>

<p align="center"><img src="docs/images/kanxue/07-document-workflow.png" alt="Example document refinery candidates for rules, skills, and workflows" width="960"><br><em>Document refinery example: rules, skills, and workflows ready for review.</em></p>

*These screenshots are from the app using a fictional local lab. Some chat and record content is demo data.*

Hexestra is designed to fit your existing workflow, with lightweight and flexible customization. We're also considering a plugin system for the future.

## Get started

1. [Download the desktop app](https://github.com/ABSllk/Hexestra/releases/latest) for Windows x64, Linux x64, macOS Intel, or macOS Apple Silicon.
2. Install and sign in to [Claude Code](https://docs.anthropic.com/en/docs/claude-code/setup) or [Codex CLI](https://developers.openai.com/codex/cli) in the Native or WSL environment you will use.
3. In **Settings → Connection**, select that CLI and check the connection. Create a project, define its Scope, and begin in **ASK** mode.

The [user guide](docs/user-guide.md) walks you through your first assessment.

## Build from source

Requires Node.js 24 and npm. Traffic capture in source runs also needs `mitmdump`; see the [user guide](docs/user-guide.md).

```bash
npm ci
npm run electron:dev
```

## Go further

[User guide](docs/user-guide.md) · [Architecture](docs/architecture.md) · [Agent runtime](docs/agent-runtime.md) · [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md)

Not sure which document to read? See the [documentation index](docs/index.md).

Have a feature in mind? [Open an issue](https://github.com/ABSllk/Hexestra/issues/new).

Hexestra is licensed under [Apache 2.0](LICENSE). If it makes your pentest workflow more efficient, consider starring the repository.

## Star History

<a href="https://www.star-history.com/?repos=ABSllk%2FHexestra&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=ABSllk/Hexestra&type=date&theme=dark&legend=top-left&sealed_token=As1qwyGyOE55UWpzJHHMIVahBRilgsQzeBlmLm_0sQmR5EPTI8Doco_U3bBFMtZrATePk2t7EU-3ZbXvhrVt7xmlImm88-SYpF43T3bHSyR73VuwfhNLPh8k4hPq99KfzSgXTMUmcWSqOJLeM1k1n7hR9ZNPt4KG2utW3ZMznkNFU0ZlUOFSiXYpnwP2" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=ABSllk/Hexestra&type=date&legend=top-left&sealed_token=As1qwyGyOE55UWpzJHHMIVahBRilgsQzeBlmLm_0sQmR5EPTI8Doco_U3bBFMtZrATePk2t7EU-3ZbXvhrVt7xmlImm88-SYpF43T3bHSyR73VuwfhNLPh8k4hPq99KfzSgXTMUmcWSqOJLeM1k1n7hR9ZNPt4KG2utW3ZMznkNFU0ZlUOFSiXYpnwP2" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=ABSllk/Hexestra&type=date&legend=top-left&sealed_token=As1qwyGyOE55UWpzJHHMIVahBRilgsQzeBlmLm_0sQmR5EPTI8Doco_U3bBFMtZrATePk2t7EU-3ZbXvhrVt7xmlImm88-SYpF43T3bHSyR73VuwfhNLPh8k4hPq99KfzSgXTMUmcWSqOJLeM1k1n7hR9ZNPt4KG2utW3ZMznkNFU0ZlUOFSiXYpnwP2" />
 </picture>
</a>
