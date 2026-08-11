# Changelog / 更新日志

## Unreleased / 未发布

## [0.4.0] - 2026-08-12

### Added / 新增

- 新增项目级 Mihomo 多跳出口代理、safeStorage 加密节点库、可视化链编辑器、状态栏与 Agent 编排工具；v1.19.29 为已测试推荐版本而非版本限制，代理故障时保持 fail-closed。
  Added project-scoped Mihomo multi-hop egress, a safeStorage-encrypted node vault, visual chain editor, status bar, and Agent orchestration tools. v1.19.29 is tested and recommended rather than enforced, while proxy failures remain fail-closed.
- Browser、Traffic/Replay、SSH、WebShell 与 Local/WSL Terminal 现可共享项目 mixed 入口；不修改系统代理或启用 TUN。
  Browser, Traffic/Replay, SSH, WebShell, and Local/WSL Terminal can now share the project mixed ingress without changing the system proxy or enabling TUN.
- 新增 Claude 命令目录、MCP 服务健康状态，以及 Agent 命令与附件能力协商。
  Added the Claude command catalog, MCP server health status, and capability negotiation for Agent commands and attachments.
- 新增细粒度资产图，将目标、服务、端点与发现关系同步到 NetMap，并支持 Agent 查询项目资产关系。
  Added a fine-grained asset graph that synchronizes targets, services, endpoints, and discovery relationships into NetMap and exposes project asset relationships to the Agent.

### Changed / 变更

- 将节点库与多跳链整合为可调比例工作台；节点库可折叠为状态窄栏，并支持鼠标拖动和键盘调整宽度。
  Consolidated the node library and multi-hop chain editor into a resizable workspace with a collapsible status rail and pointer or keyboard resizing.

### Fixed / 修复

- 修复窄聊天面板中用户消息不换行，以及生成回复时视图不持续跟随最新内容的问题。
  Fixed user messages overflowing narrow chat panels and live responses failing to remain in view while being generated.

## [0.3.0] - 2026-08-09

### Added / 新增

- 新增基于适配器的 WebShell Profile 管理，首批支持 Generic 与 AntSword 兼容的 PHP 适配器。  
  Added adapter-based WebShell profile management with Generic and AntSword-compatible PHP adapters.
- 新增操作系统与 PHP Eval 能力自动探测，以及持久化连接健康状态、验证历史、延迟、失败详情和远程系统信息。  
  Added automatic OS and PHP-eval capability detection, persisted connection health, verification history, latency, failure details, and remote system information.
- 新增 Agent 创建、检查和显式验证 WebShell Profile 的工具，并保留适配器专属配置。  
  Added Agent tools for creating, inspecting, and explicitly verifying WebShell profiles while preserving adapter-specific configuration.

### Changed / 变更

- 重构 Shell Manager Profile 卡片，将 Verify、Edit 和 Delete 操作紧凑地右侧对齐，并改进健康诊断展示。  
  Reworked Shell Manager profile cards with compact, right-aligned Verify, Edit, and Delete actions plus clearer health diagnostics.
- 使用每次请求新生成的不透明 128 位令牌和数字协议字段替代可识别产品的连接器标记。  
  Replaced product-identifying connector markers with fresh opaque 128-bit request tokens and numeric protocol fields.
- 柔化浅色主题配色，并更新公开 README 的截图和文案。  
  Softened the light theme palette and refreshed public README screenshots and copy.

### Fixed / 修复

- 通过仅针对 xterm 显示层规范化换行符，修复中央托管 WebShell 终端的多行输出阶梯错位。  
  Fixed stair-step multiline output in the central managed WebShell terminal by normalizing display-only line endings for xterm.
- 修复受限布局中的 Tab 与聊天区域滚动行为。  
  Fixed tab and chat scrolling behavior in constrained layouts.
- 修复 Profile 编辑和验证失败时持久化健康状态及临时会话未一致清理的问题。  
  Fixed profile edits and failed verifications so durable health and temporary sessions are cleaned up consistently.

## [0.2.1] - 2026-08-08

### Changed / 变更

- 重构整体 UI 配色，采用深石墨色表面、蓝色操作色、青色拓扑强调色，并统一各面板的语义严重等级颜色。  
  Rebuilt the UI color scheme with dark graphite surfaces, blue actions, teal topology accents, and consistent semantic severity colors across all panels.

### Fixed / 修复

- 修复内置 mitmproxy 运行时在 macOS 代码签名和 Windows 安装包签名后受损的问题，使 Traffic Capture 在各平台开箱即用。  
  Bundled mitmproxy runtime now survives macOS code-signing and Windows installer signing so Traffic Capture works out of the box on all platforms.

## [0.2.0] - 2026-08-07

### Added / 新增

- 新增原生 Claude Subagent 跟踪，支持持久化来源、状态、权限来源、实时活动和专属右侧详情视图。  
  Added native Claude Subagent tracking with persisted lineage, status, permission provenance, realtime activity, and a dedicated right-panel detail view.
- Agent 可通过显式工具策略和冒烟测试覆盖访问集成浏览器自动化运行时。  
  Added Agent access to the integrated browser automation runtime with explicit tool policy and smoke coverage.
- 新增系统、深色和浅色外观偏好，并即时同步 Electron、终端、Monaco、NetMap、对话框和应用外壳。  
  Added system, dark, and light appearance preferences with immediate Electron, terminal, Monaco, NetMap, dialog, and application-shell synchronization.
- 新增主题专属 Hexestra 字标、独立应用标记和基于虚构评估数据的公开演示截图。  
  Added theme-specific Hexestra wordmarks, a standalone application mark, and public demo screenshots based on fictional assessment data.
- 新增资产清单操作，可在 NetMap 查看资产、打开浏览器目标、复制地址或 JSON，以及请求 Agent 执行限定范围的重新扫描。  
  Added asset inventory actions for viewing assets in NetMap, opening browser targets, copying addresses or JSON, and requesting scoped Agent rescans.
- CI 新增 Windows x64、Linux x64、macOS Intel 和 macOS Apple Silicon 四平台桌面打包。  
  Added four-platform desktop packaging in CI for Windows x64, Linux x64, macOS Intel, and macOS Apple Silicon.
- 新增打包后免安装使用的 mitmdump 12.2.3 运行时，并固定版本及校验 SHA-256。  
  Added a pinned, SHA-256-verified mitmdump 12.2.3 runtime in packaged builds for zero-install Traffic Capture.

### Changed / 变更

- 优化 NetMap、资产面板、状态栏和 Agent 交互界面。  
  Refined the NetMap, asset panels, status bar, and Agent interaction surfaces.
- 将 Electron 更新至 43.2.0、`@xterm/addon-fit` 更新至 0.11.0、`tailwind-merge` 更新至 3.6.0。  
  Updated Electron to 43.2.0, `@xterm/addon-fit` to 0.11.0, and `tailwind-merge` to 3.6.0.
- 加强平台专属 `node-pty` 预编译验证和启动检查。  
  Strengthened platform-specific `node-pty` prebuild verification and startup checks.
- 将 CI 桌面产物精简为最终可分发的 `.exe`、`.AppImage` 和 `.dmg` 文件。  
  Reduced CI desktop artifacts to final `.exe`, `.AppImage`, and `.dmg` distributables.

### Security / 安全

- 收紧公开源码边界，拒绝生成的 Python 缓存、复制的运行时、凭据、抓包数据、本地工作流状态和未知根目录条目。  
  Tightened the public-source boundary to reject generated Python caches, copied runtimes, credentials, captures, local workflow state, and unknown root entries.

## [0.1.0] - 2026-08-05

### Added / 新增

- 新增面向授权渗透测试的人机共享操作界面。  
  Added a shared human/AI operational surface for authorized penetration testing.
- 集成项目浏览器、终端、Traffic 工作台、Shell Manager、NetMap、任务树、证据、发现、漏洞和报告。  
  Integrated the project browser, terminals, Traffic workbench, Shell Manager, NetMap, task tree, evidence, findings, vulnerabilities, and reports.
- 新增具备权限模式和 Scope 感知操作的 Claude Code 受控执行能力。  
  Added controlled Claude Code execution with permission modes and Scope-aware operations.
- 新增 Windows 原生和 WSL 托管的 Claude Code 运行时支持。  
  Added native Windows and WSL-hosted Claude Code runtime support.
- 新增用于将完成的交互导入 Burp Suite 的认证回环桥接。  
  Added an authenticated loopback bridge for importing completed exchanges into Burp Suite.
- 新增项目本地参与状态和非破坏性对话分支。  
  Added project-local engagement state and non-destructive conversation branching.
