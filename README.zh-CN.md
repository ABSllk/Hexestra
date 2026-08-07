<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="src/assets/branding/hexestra-logo-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="src/assets/branding/hexestra-logo-light.svg">
  <img alt="Hexestra" src="src/assets/branding/hexestra-logo-light.svg" width="720">
</picture>

## 协奏于攻守之间。

一款 AI 原生渗透测试 IDE，让人类操作员与 AI 共用浏览器、终端、流量、资产图、任务、证据和控制权。

[English](README.md) · [简体中文](README.zh-CN.md)

</div>

> [!WARNING]
> Hexestra 仅用于经过授权的安全测试。请勿将其用于您不拥有或未获得明确测试授权的系统。

## 为什么选择 Hexestra？

Hexestra 将分散的渗透测试环节整合进同一个项目。Agent 可以在 Scope 内自主执行，操作员也可以随时检查、引导、审批、中断或直接接管。

- **人与 AI 共用同一操作面：** 双方使用同一个浏览器、终端会话、捕获流量、任务、资产和证据。
- **可控的高自主执行：** 在 ASK、AUTO 和 BYPASS 之间选择，同时保留项目 Scope 和技术安全边界。
- **继续使用熟悉的工具：** 保留 Claude Code、Burp Suite、PowerShell、WSL、SSH 及其现有配置，不必重新适应一套封闭替代品。
- **持久化的项目状态：** 重新打开项目文件夹即可恢复 Scope、任务、NetMap、证据、Finding、报告、工作区、权限偏好和对话分支。

## 界面截图

以下截图均来自完全虚构的 Northstar Demo Lab，仅使用保留的 `example.test` 域名、文档专用 IP、合成身份和合成证据。

![Hexestra 共用工作区中的任务树、报告、Agent 活动和 NetMap](docs/images/hexestra-workspace-netmap.png)

*任务树、报告、Agent 活动、当前资产和包含 17 个节点的 NetMap 位于同一个可控操作面。*

![Hexestra Evidence 原始 HTTP 响应及关联记录](docs/images/hexestra-evidence.png)

*Evidence 保留原始输出，并与 Finding 和已验证的 Vulnerability 建立关联。*

![Hexestra Vulnerability 严重度、影响和修复建议](docs/images/hexestra-vulnerability.png)

*已验证的 Vulnerability 集中保存严重度、生命周期、影响、修复建议和关联上下文。*

![Hexestra 评估报告和操作员决策](docs/images/hexestra-report.png)

*报告直接使用同一份持久化项目状态，在 IDE 内形成可审阅的评估结果。*

## 核心能力

- 集成浏览器、HTTP/HTTPS 流量捕获、检查、拦截、Repeater 和证据保存
- 人类与 Agent 共享本地、WSL、SSH、跳板机和原始反向 Shell 会话，并支持人工接管与 Agent 命令审计
- 通过 NetMap 中的结构化资产、关系、来源和当前目标进行图驱动测试
- 将原始输出依次整理为 Evidence、Finding、Vulnerability 和 Report
- 使用非破坏性对话分支保留原始推理路径，同时共享项目的权威状态
- 可选接入 Burp Bridge 和 Burp MCP，不改变原有 Burp 工作流

## 快速开始

### 环境要求

- Node.js 24 和 npm
- Windows x64、Linux x64（以 Ubuntu 24.04 为基准）、macOS Intel 或 macOS Apple Silicon
- 当前平台的标准 Electron 桌面运行库；Ubuntu 需要常见的 X11/GTK 运行库
- 打包版已内置 mitmproxy；从源码运行时可单独提供
- 可选的 Burp Suite；构建 Bridge 需要 JDK 17

### 安装 Claude Code

在 **Settings > Connection（设置 > 连接）** 中选择的 Native 或 WSL 环境内执行：

```bash
npm install -g @anthropic-ai/claude-code
claude --version
```

使用 Anthropic 账号时执行：

```bash
claude auth login
claude auth status
```

### 配置第三方 API

请在随后用于启动 Hexestra 的同一个终端中设置服务商环境变量。以下命令来自 [DeepSeek 官方 Claude Code 接入指南](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/claude_code/)：

Linux 和 macOS：

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

Windows PowerShell：

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

使用其他兼容 Anthropic 接口的服务商时，按其文档替换接口地址、Token 和模型名称。不要把 API Key 提交到仓库。

### 从源码运行

在 Hexestra 项目根目录执行：

```bash
npm ci
npm run electron:dev
```

### 配置流量捕获与 mitmproxy

从源码运行 Hexestra 时，请安装 mitmproxy 并确认 `mitmdump` 可用：

```bash
uv tool install mitmproxy
mitmdump --version
```

Release 已内置 mitmdump 运行时，因此 Traffic Capture 无需单独安装 mitmproxy。

### 配置 Burp Suite Bridge

Burp 集成是可选的。Hexestra 通过 mitmproxy 捕获流量，再通过需要认证的本机回环 Bridge 将已完成的交换镜像到 Burp；Burp 不会被静默加入浏览器的实时网络路径。

在 Windows、Linux 或 macOS 上安装 JDK 17 后构建 Bridge：

```bash
npm run build:burp-bridge
```

1. 在 Burp 中打开 **Extensions > Installed > Add**，选择 **Java**，加载 `resources/burp-bridge/hexestra-burp-bridge.jar`。
2. 打开 **Hexestra Bridge**，记录本机回环端口并复制配对 token。
3. 在 Hexestra 中打开 **Settings > Burp（设置 > Burp）**，填写端口和 token，保存后点击 **Connect Bridge**。

镜像的交换会出现在 **Target > Site map**，在支持时也会出现在 **Organizer**。Burp 的公开扩展 API 无法把合成记录写入 **Proxy > HTTP history**。

### 构建与检查

```bash
npm run electron:build
npm run audit:public
npm run check
```

## 负责使用

只在获得明确授权并准确设置项目 Scope 后使用 Hexestra。破坏性、干扰性或影响隐私的操作应获得适当批准，导出的证据和报告应作为敏感数据处理。ASK、AUTO 和 BYPASS 只改变审批行为，不会关闭 Scope、Rules of Engagement 或技术安全边界。Hexestra 不能替代专业判断和责任承担。

## 参与贡献

请阅读[贡献指南](CONTRIBUTING.md)和[更新记录](CHANGELOG.md)。

## 开源许可证

Hexestra 采用 [Apache License 2.0](LICENSE) 开源。第三方组件仍受其各自许可证和条款约束。

## Star History

<a href="https://www.star-history.com/?repos=ABSllk%2FHexestra&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=ABSllk/Hexestra&type=date&theme=dark&legend=top-left&sealed_token=As1qwyGyOE55UWpzJHHMIVahBRilgsQzeBlmLm_0sQmR5EPTI8Doco_U3bBFMtZrATePk2t7EU-3ZbXvhrVt7xmlImm88-SYpF43T3bHSyR73VuwfhNLPh8k4hPq99KfzSgXTMUmcWSqOJLeM1k1n7hR9ZNPt4KG2utW3ZMznkNFU0ZlUOFSiXYpnwP2" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=ABSllk/Hexestra&type=date&legend=top-left&sealed_token=As1qwyGyOE55UWpzJHHMIVahBRilgsQzeBlmLm_0sQmR5EPTI8Doco_U3bBFMtZrATePk2t7EU-3ZbXvhrVt7xmlImm88-SYpF43T3bHSyR73VuwfhNLPh8k4hPq99KfzSgXTMUmcWSqOJLeM1k1n7hR9ZNPt4KG2utW3ZMznkNFU0ZlUOFSiXYpnwP2" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=ABSllk/Hexestra&type=date&legend=top-left&sealed_token=As1qwyGyOE55UWpzJHHMIVahBRilgsQzeBlmLm_0sQmR5EPTI8Doco_U3bBFMtZrATePk2t7EU-3ZbXvhrVt7xmlImm88-SYpF43T3bHSyR73VuwfhNLPh8k4hPq99KfzSgXTMUmcWSqOJLeM1k1n7hR9ZNPt4KG2utW3ZMznkNFU0ZlUOFSiXYpnwP2" />
 </picture>
</a>