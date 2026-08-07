<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="src/assets/branding/hexestra-logo-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="src/assets/branding/hexestra-logo-light.svg">
  <img alt="Hexestra" src="src/assets/branding/hexestra-logo-light.svg" width="720">
</picture>

## Orchestrate your pentest.

An AI-native penetration testing IDE where human operators and AI share the same browser, terminals, traffic, asset graph, tasks, evidence, and controls.

[English](README.md) · [简体中文](README.zh-CN.md)

</div>

> [!WARNING]
> Hexestra is intended exclusively for authorized security testing. Never use it against systems you do not own or have explicit permission to assess.

## Why Hexestra?

Hexestra brings the fragmented parts of a penetration test into one project. The Agent can work autonomously within scope, while the operator can inspect, guide, approve, interrupt, or take over at any time.

- **One shared operational surface:** human and AI work with the same browser, terminal sessions, captured traffic, tasks, assets, and evidence.
- **Controlled autonomy:** choose ASK, AUTO, or BYPASS without weakening project Scope or technical safety boundaries.
- **Keep the tools you know:** continue using Claude Code, Burp Suite, PowerShell, WSL, SSH, and their existing configurations instead of learning a closed replacement.
- **Durable engagement state:** reopen a project folder to restore Scope, tasks, NetMap, evidence, findings, reports, workspace tabs, permissions, and conversation branches.

## Screenshots

These screenshots use the fictional Northstar Demo Lab, reserved `example.test` domains, documentation-only IP addresses, synthetic identities, and synthetic evidence.

![Hexestra shared workspace with task tree, report, Agent activity, and NetMap](docs/images/hexestra-workspace-netmap.png)

*The shared workspace keeps the task tree, report, Agent activity, active asset, and 17-node NetMap in one controllable surface.*

![Hexestra Evidence record with raw HTTP response and linked records](docs/images/hexestra-evidence.png)

*Evidence preserves raw output and links it to the Finding and validated Vulnerability.*

![Hexestra Vulnerability record with severity, impact, and remediation](docs/images/hexestra-vulnerability.png)

*A validated Vulnerability keeps severity, lifecycle, impact, remediation, and linked context together.*

![Hexestra assessment report with operator decisions](docs/images/hexestra-report.png)

*The report turns the same durable project state into a reviewable assessment without leaving the IDE.*

## Core capabilities

- Integrated browser, HTTP/HTTPS capture, inspection, interception, Repeater, and evidence capture
- Shared local, WSL, SSH, jump-host, and raw reverse-shell sessions with human takeover and Agent command auditing
- Graph-guided testing through typed assets, relationships, provenance, and active objectives in NetMap
- Structured progression from raw output to Evidence, Finding, Vulnerability, and Report
- Non-destructive conversation branches that preserve the original reasoning path and canonical project state
- Optional Burp Bridge and Burp MCP integration without replacing the normal Burp workflow

## Quick start

### Requirements

- Node.js 24 and npm
- Windows x64, Linux x64 (Ubuntu 24.04 baseline), macOS Intel, or macOS Apple Silicon
- Standard Electron desktop libraries; Ubuntu needs the usual X11/GTK runtime libraries
- mitmproxy is bundled in packaged builds; source runs may provide it separately
- Optional Burp Suite and JDK 17 for the Bridge

### Install Claude Code

Run these commands in the Native or WSL environment selected under **Settings > Connection**:

```bash
npm install -g @anthropic-ai/claude-code
claude --version
```

To use an Anthropic account:

```bash
claude auth login
claude auth status
```

### Configure a third-party API

Set provider variables in the same terminal that will start Hexestra. DeepSeek example from its [official Claude Code integration guide](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/claude_code/):

Linux and macOS:

```bash
export ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic
export ANTHROPIC_AUTH_TOKEN="YOUR_DEEPSEEK_API_KEY"
export ANTHROPIC_MODEL='deepseek-v4-pro[1m]'
export ANTHROPIC_DEFAULT_OPUS_MODEL='deepseek-v4-pro[1m]'
export ANTHROPIC_DEFAULT_SONNET_MODEL='deepseek-v4-pro[1m]'
export ANTHROPIC_DEFAULT_HAIKU_MODEL=deepseek-v4-flash
export CLAUDE_CODE_SUBAGENT_MODEL=deepseek-v4-flash
export CLAUDE_CODE_EFFORT_LEVEL=max
```

Windows PowerShell:

```powershell
$env:ANTHROPIC_BASE_URL="https://api.deepseek.com/anthropic"
$env:ANTHROPIC_AUTH_TOKEN="YOUR_DEEPSEEK_API_KEY"
$env:ANTHROPIC_MODEL="deepseek-v4-pro[1m]"
$env:ANTHROPIC_DEFAULT_OPUS_MODEL="deepseek-v4-pro[1m]"
$env:ANTHROPIC_DEFAULT_SONNET_MODEL="deepseek-v4-pro[1m]"
$env:ANTHROPIC_DEFAULT_HAIKU_MODEL="deepseek-v4-flash"
$env:CLAUDE_CODE_SUBAGENT_MODEL="deepseek-v4-flash"
$env:CLAUDE_CODE_EFFORT_LEVEL="max"
```

Replace the endpoint, token, and model names for another Anthropic-compatible provider. Never commit an API key.

### Run from source

Run these commands in the Hexestra project root:

```bash
npm ci
npm run electron:dev
```

### Configure Traffic Capture and mitmproxy

When running Hexestra from source, install mitmproxy and confirm that
`mitmdump` is available:

```bash
uv tool install mitmproxy
mitmdump --version
```

Packaged builds include a mitmdump runtime, so Traffic Capture works without a separate mitmproxy installation.

### Configure the Burp Suite Bridge

Burp integration is optional. Hexestra captures traffic through mitmproxy and mirrors completed exchanges to Burp through an authenticated loopback Bridge; Burp is not silently inserted into the browser's live network path.

Build the Bridge on Windows, Linux, or macOS with JDK 17:

```bash
npm run build:burp-bridge
```

1. In Burp, open **Extensions > Installed > Add**, choose **Java**, and load `resources/burp-bridge/hexestra-burp-bridge.jar`.
2. Open **Hexestra Bridge**, note the loopback port, and copy the pairing token.
3. In Hexestra, open **Settings > Burp**, enter the port and token, save, and choose **Connect Bridge**.

Mirrored exchanges appear in **Target > Site map** and, when supported, **Organizer**. Burp's public extension API cannot create synthetic entries in **Proxy > HTTP history**.

### Build and verify

```bash
npm run electron:build
npm run audit:public
npm run check
```

## Responsible use

Use Hexestra only with explicit authorization and an accurate project Scope. Destructive, disruptive, or privacy-impacting actions require appropriate approval, and exported evidence or reports should be treated as sensitive data. ASK, AUTO, and BYPASS change approval behavior only; they do not disable Scope, rules of engagement, or technical safety boundaries. Hexestra does not replace professional judgment or accountability.

## Contributing

See the [contribution guide](CONTRIBUTING.md) and [changelog](CHANGELOG.md).

## License

Hexestra is licensed under the [Apache License 2.0](LICENSE). Third-party components remain subject to their own licenses and terms.

## Star History

<a href="https://www.star-history.com/?repos=ABSllk%2FHexestra&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=ABSllk/Hexestra&type=date&theme=dark&legend=top-left&sealed_token=As1qwyGyOE55UWpzJHHMIVahBRilgsQzeBlmLm_0sQmR5EPTI8Doco_U3bBFMtZrATePk2t7EU-3ZbXvhrVt7xmlImm88-SYpF43T3bHSyR73VuwfhNLPh8k4hPq99KfzSgXTMUmcWSqOJLeM1k1n7hR9ZNPt4KG2utW3ZMznkNFU0ZlUOFSiXYpnwP2" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=ABSllk/Hexestra&type=date&legend=top-left&sealed_token=As1qwyGyOE55UWpzJHHMIVahBRilgsQzeBlmLm_0sQmR5EPTI8Doco_U3bBFMtZrATePk2t7EU-3ZbXvhrVt7xmlImm88-SYpF43T3bHSyR73VuwfhNLPh8k4hPq99KfzSgXTMUmcWSqOJLeM1k1n7hR9ZNPt4KG2utW3ZMznkNFU0ZlUOFSiXYpnwP2" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=ABSllk/Hexestra&type=date&legend=top-left&sealed_token=As1qwyGyOE55UWpzJHHMIVahBRilgsQzeBlmLm_0sQmR5EPTI8Doco_U3bBFMtZrATePk2t7EU-3ZbXvhrVt7xmlImm88-SYpF43T3bHSyR73VuwfhNLPh8k4hPq99KfzSgXTMUmcWSqOJLeM1k1n7hR9ZNPt4KG2utW3ZMznkNFU0ZlUOFSiXYpnwP2" />
 </picture>
</a>