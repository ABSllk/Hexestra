# Changelog

All notable changes to Hexestra will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project intends to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
after the first stable release.

## [0.2.1] - 2026-08-08

### Changed

- 全面重构 UI 色彩方案：深色石墨面板、蓝色操作区、青色拓扑高亮，四面板统一语义化严重等级配色。
- Rebuilt the entire UI color scheme: dark graphite surfaces, blue actions, teal
  topology accents, and consistent semantic severity colors across all panels.

### Fixed

- 修复内嵌 mitmproxy 运行时在 macOS 签名和 Windows 安装器签名后损坏的问题，Traffic Capture
  现在在所有平台上开箱即用。
- Bundled mitmproxy runtime now survives macOS code-signing and Windows
  installer signing so Traffic Capture works out of the box on all platforms.

## [0.2.0] - 2026-08-07

### Added

- 原生 Claude Subagent 跟踪：持久化溯源、状态、权限来源、实时活动以及专属右侧面板详情视图。
- Native Claude Subagent tracking with persisted lineage, status, permission
  provenance, realtime activity, and a dedicated right-panel detail view.
- Agent 可访问集成浏览器自动化运行时，具备显式工具策略和冒烟测试覆盖。
- Agent access to the integrated browser automation runtime with explicit tool policy
  and smoke coverage.
- 系统/深色/浅色外观偏好，Electron、终端、Monaco、NetMap、对话框和应用外壳即时同步。
- System, dark, and light appearance preferences with immediate Electron, terminal,
  Monaco, NetMap, dialog, and application-shell synchronization.
- 主题专属 Hexestra 字标、独立应用标记以及基于虚构评估数据的公开演示截图。
- Theme-specific Hexestra wordmarks, a standalone application mark, and public demo
  screenshots based on fictional assessment data.
- 资产清单操作：在 NetMap 中查看资产、打开浏览器目标、复制地址或 JSON、请求定向 Agent 重新扫描。
- Asset inventory actions for viewing assets in NetMap, opening browser targets,
  copying addresses or JSON, and requesting scoped Agent rescans.
- CI 四平台桌面打包：Windows x64、Linux x64、macOS Intel、macOS Apple Silicon。
- Four-platform desktop packaging in CI for Windows x64, Linux x64, macOS Intel, and
  macOS Apple Silicon.
- 内嵌 SHA-256 校验的 mitmdump 12.2.3 运行时，打包后无需安装即可使用 Traffic Capture。
- A pinned, SHA-256-verified mitmdump 12.2.3 runtime in packaged builds for
  zero-install Traffic Capture.

### Changed

- 优化 NetMap、资产面板、状态栏和 Agent 交互界面。
- Refined the NetMap, asset panels, status bar, and Agent interaction surfaces.
- 升级 Electron 至 43.2.0、`@xterm/addon-fit` 至 0.11.0、`tailwind-merge` 至 3.6.0。
- Updated Electron to 43.2.0, `@xterm/addon-fit` to 0.11.0, and `tailwind-merge` to
  3.6.0.
- 加强平台特定 `node-pty` 预编译验证和启动检查。
- Strengthened platform-specific `node-pty` prebuild verification and startup checks.
- CI 产物精简为最终 `.exe`、`.AppImage` 和 `.dmg` 可分发文件。
- Reduced CI desktop artifacts to final `.exe`, `.AppImage`, and `.dmg` distributables.

### Security

- 收紧公开源码边界，拒绝生成的 Python 缓存、复制的运行时、凭证、抓包数据、本地工作流状态和未分类根目录条目。
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
