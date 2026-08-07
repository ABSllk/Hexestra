# Changelog

All notable changes to Hexestra will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project intends to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
after the first stable release.

## [0.2.0] - 2026-08-07

### Added

- Native Claude Subagent tracking with persisted lineage, status, permission
  provenance, realtime activity, and a dedicated right-panel detail view.
- Agent access to the integrated browser automation runtime with explicit tool policy
  and smoke coverage.
- System, dark, and light appearance preferences with immediate Electron, terminal,
  Monaco, NetMap, dialog, and application-shell synchronization.
- Theme-specific Hexestra wordmarks, a standalone application mark, and public demo
  screenshots based on fictional assessment data.
- Asset inventory actions for viewing assets in NetMap, opening browser targets,
  copying addresses or JSON, and requesting scoped Agent rescans.
- Four-platform desktop packaging in CI for Windows x64, Linux x64, macOS Intel, and
  macOS Apple Silicon.

### Changed

- Refined the NetMap, asset panels, status bar, and Agent interaction surfaces.
- Updated Electron to 43.2.0, `@xterm/addon-fit` to 0.11.0, and `tailwind-merge` to
  3.6.0.
- Strengthened platform-specific `node-pty` prebuild verification and startup checks.

### Security

- Tightened the public-source boundary to reject generated Python caches, copied
  runtimes, credentials, captures, local workflow state, and unknown root entries.

## [0.1.0] - 2026-08-05

### Added

- Shared human/AI operational surface for authorized penetration testing.
- Integrated project browser, terminals, Traffic workbench, Shell Manager, NetMap,
  task tree, evidence, findings, vulnerabilities, and reports.
- Controlled Claude Code execution with permission modes and Scope-aware operations.
- Native Windows and WSL-hosted Claude Code runtime support.
- Authenticated loopback bridge for importing completed exchanges into Burp Suite.
- Project-local engagement state and non-destructive conversation branching.
