<div align="center">

# HEXESTRA

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
- Claude Code installed and authenticated
- mitmproxy `12.2.3` installed separately for Traffic Capture
- Optional Burp Suite and JDK 17 for the Bridge

Native Claude Code works on every supported source-run platform. WSL Claude Code and WSL Shell profiles are Windows-only. This release is intended to run from source; signed installers, automatic mitmproxy installation, and bundled mitmproxy binaries are not included.

### Run from source

```bash
npm ci
npm run electron:dev
```

`npm ci` installs and verifies the platform-specific prebuilt `node-pty` package. Hexestra does not fall back to a local `node-gyp` build.

### Configure Claude Code

Install and authenticate Claude Code first, then open **Settings > Connection**. Choose **Native** to use the bundled Agent SDK executable, a command name, or an absolute path. On Windows, choose **WSL** to run inside a selected distribution and provide its exact distribution name and Claude executable path, normally `/usr/bin/claude`. Save the settings and use **Test connection** to verify the runtime, version, authentication, and network. Hexestra reuses your existing Claude Code authentication, model settings, Skills, MCP servers, and provider configuration.

### Configure Traffic Capture and mitmproxy

Install the required mitmproxy version and confirm that `mitmdump` is available:

```bash
uv tool install mitmproxy==12.2.3
mitmdump --version
```

Keep `mitmdump` on `PATH`, then open **Settings > Traffic Runtime**. Hexestra detects it automatically and accepts only version `12.2.3` in this release. If a macOS app launched from Finder does not inherit your shell `PATH`, use **Choose executable** or set `HEXESTRA_MITMDUMP_PATH` before launching Hexestra. Use **Re-detect** after changing the installation or **Use automatic detection** to clear a manual path. See the [official mitmproxy installation guide](https://docs.mitmproxy.org/stable/overview/installation/) for other installation methods.

When Capture starts, Hexestra allocates loopback ports, creates a project-scoped CA, loads its addon, configures the integrated browser, and stops the sidecar with the project. A missing or incompatible runtime prevents Capture from starting and is reported in the Traffic Runtime page.

### Configure the Burp Suite Bridge

Burp integration is optional. Hexestra captures traffic through mitmproxy and mirrors completed exchanges to Burp through an authenticated loopback Bridge; Burp is not silently inserted into the browser's live network path.

Build the Bridge on Windows, Linux, or macOS with JDK 17:

```bash
npm run build:burp-bridge
```

1. In Burp, open **Extensions > Installed > Add**, choose **Java**, and load `resources/burp-bridge/hexestra-burp-bridge.jar`.
2. Open **Hexestra Bridge**, note the loopback port, and copy the pairing token.
3. In Hexestra, open **Settings > Burp**, enter the port and token, save, and choose **Connect Bridge**.
4. If Burp MCP is enabled, use its SSE endpoint; the default is `http://127.0.0.1:9876/sse`.

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
