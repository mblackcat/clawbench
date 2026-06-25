<p align="center">
  <img src="frontend/resources/icon.png" alt="ClawBench" width="120" />
</p>

<h1 align="center">ClawBench</h1>

<p align="center">
  <strong>专为桌面打造的集成式 AI 开发助理</strong>
</p>

<p align="center">
  <a href="#安装">安装</a> ·
  <a href="#核心功能">功能</a> ·
  <a href="#使用场景">使用场景</a> ·
  <a href="#本地开发">本地开发</a> ·
  <a href="#参与贡献">贡献</a>
</p>

<p align="center">
  <a href="./README.md">English</a>
</p>

---

ClawBench 是一款跨平台桌面应用（macOS & Windows），将 AI 编码助手、智能终端、智能代理和迷你应用市场整合到一个统一的工作台中。开发者既可以利用内置 AI 模块加速日常工作流，也可以创建和分享自定义迷你应用来自动化重复任务，端到端优化整个开发流程。

## 核心功能

### 工作台 — 团队协作中心

统一的工作区，用于创建、管理和分享开发资源，支持团队协同：

- **四种资源类型**：自动化小程序（Python 子应用）、AI 技能（可部署到 Claude/Codex/Gemini 工作区）、提示词、链接（收藏的 URL）
- **创建与发布** — 各资源类型专属编辑器（应用编辑器、技能编辑器、提示词编辑器），一键发布到市场
- **发现与安装** — 浏览、搜索、安装和更新社区贡献的资源
- **收藏栏** — 置顶和拖拽排序常用资源，快速访问；按类型执行不同操作（运行小程序、激活技能、复制提示词、打开链接）

### AI 工具模块

- **AI Chat** — 多模型对话（OpenAI / Claude / Gemini），支持流式输出、本地工具调用（文件系统、Shell 命令）、联网搜索、MCP 集成、图片生成
- **AI Coding** — 统一管理 Claude Code、Codex、Gemini CLI 编码会话的可视化环境，支持飞书 IM 远程控制
- **AI Terminal** — AI 辅助双模式终端：本地/SSH 终端（AI 命令建议）+ 多数据库 GUI（MySQL、PostgreSQL、MongoDB、SQLite），AI 辅助查询
- **AI Agents** — 轻量级智能代理管理，支持 OpenClaw（可视化多节点场景编排）和 Hermes（消息网关，连接 AI 到 Telegram/Discord/Slack/Signal）

### 平台特性

- 跨平台：macOS（Intel + Apple Silicon）和 Windows
- 本地环境检测与配置（Python、Node.js、Git、Docker、AI CLI 工具）
- 基于 Monaco 的代码编辑器，集成在应用创建流程中
- 自动更新，自托管发布服务器
- 支持 SQLite / MySQL / PostgreSQL 后端
- JWT 认证，完整中英文界面

## 安装

下载适合你平台的最新版本：

| 平台 | 下载 |
|---|---|
| macOS (Universal) | [ClawBench.dmg](https://github.com/mblackcat/clawbench/releases/latest) |
| Windows | [ClawBench-Setup.exe](https://github.com/mblackcat/clawbench/releases/latest) |

> 下载后，打开 `.dmg`（macOS）或运行 `.exe` 安装程序（Windows），按提示完成安装。

## 使用场景

**团队知识共享** — 将常用工作流封装为 AI 技能、提示词或链接集合，发布到市场，团队成员一键安装即可复用。

**自定义自动化** — 编写 Python 小程序自动化重复任务（CI 触发、代码分析、数据处理），发布为市场资源供所有人使用。

**AI 技能部署** — 创建 AI 技能（SKILL.md 文件），自动检测并一键部署到 Claude Code、Codex 或 Gemini CLI 工作区。

**多模型 AI 辅助** — 使用 AI Chat 对接多种 AI 模型，进行代码生成、调试和知识检索，支持本地工具调用和联网搜索。

**数据库管理** — 通过 AI Terminal 的 DB 模式连接 MySQL、PostgreSQL、MongoDB 或 SQLite，获取 AI 辅助 SQL 建议，浏览表结构并执行查询。

**远程服务器运维** — 在 ClawBench 中打开 SSH 终端，借助 AI 助手进行服务器管理、日志分析和问题排查。

**智能代理编排** — 使用 OpenClaw 编排可视化多节点场景，或通过 Hermes 连接 Telegram/Discord/Slack 实现消息驱动的 AI 自动化。

## 本地开发

### 环境要求

- Node.js 18+
- Python 3.8+（用于子应用开发）
- Git

### 安装依赖

```bash
# 克隆仓库
git clone https://github.com/mblackcat/clawbench.git
cd clawbench

# 安装前端依赖
cd frontend && npm install

# 安装后端依赖
cd ../backend && npm install
```

### 配置

```bash
# 配置后端环境变量
cd backend
cp .env.example .env
# 编辑 .env — 生产环境请修改 JWT_SECRET
```

### 运行

在两个终端中分别启动后端和前端：

```bash
# 终端 1 — 后端 API 服务（端口 3001）
cd backend
npm run dev

# 终端 2 — Electron 应用（热重载）
cd frontend
npm run dev
```

### 构建

```bash
# macOS（.dmg，通用二进制）
cd frontend && npm run build:mac

# Windows（.exe 安装程序）
cd frontend && npm run build:win
```

### 测试

```bash
# 后端测试（200+ 测试用例，默认 SQLite）
cd backend && npm test

# 使用 MySQL 或 PostgreSQL 运行测试
npm run docker:up        # 启动 MySQL + PostgreSQL 容器
npm run test:mysql
npm run test:postgres
```

## 项目结构

```
clawbench/
├── frontend/                 # Electron + React 桌面应用
│   ├── src/
│   │   ├── main/            # 主进程（Node.js 服务、IPC）
│   │   ├── preload/         # 上下文桥接（类型化 window.api）
│   │   └── renderer/        # 渲染进程（React SPA、Zustand 状态管理）
│   ├── python-sdk/          # Python SDK（子应用开发）
│   └── resources/           # 应用图标
├── backend/                  # API 服务（Express + TypeScript）
│   ├── src/
│   │   ├── controllers/     # 路由处理
│   │   ├── services/        # 业务逻辑
│   │   ├── repositories/    # 数据访问层
│   │   └── database/        # 多数据库适配（SQLite/MySQL/PG）
│   └── tests/
└── docs/                     # 文档
```

## 技术栈

| 层级 | 技术 |
|---|---|
| 桌面外壳 | Electron、electron-vite |
| 前端 | React 18、TypeScript、Ant Design v5、Zustand |
| 后端 | Node.js、Express、TypeScript |
| 数据库 | SQLite（默认）、MySQL、PostgreSQL |
| AI 服务商 | OpenAI、Anthropic Claude、Google Gemini |
| 子应用 | Python 3、自定义 JSON-line 协议 |

## 编写迷你应用

使用内置 SDK 创建 Python 子应用：

```python
from clawbench_sdk import ClawBenchApp

class MyApp(ClawBenchApp):
    def run(self) -> None:
        self.emit_output("开始分析...", "info")
        self.emit_progress(50.0, "处理中")
        # ... 你的逻辑
        self.emit_result(True, "完成！")

if __name__ == "__main__":
    MyApp.execute()
```

在 `manifest.json` 中定义参数：

```json
{
  "id": "com.example.my-app",
  "name": "我的应用",
  "version": "1.0.0",
  "type": "app",
  "entry": "main.py",
  "params": [
    { "name": "target", "type": "path", "label": "目标目录", "required": true }
  ]
}
```

完整 API 参考请查看 [Python SDK 文档](frontend/python-sdk/)。

## 参与贡献

欢迎贡献代码！参与步骤：

1. Fork 本仓库
2. 创建特性分支（`git checkout -b feature/my-feature`）
3. 提交更改（`git commit -m 'feat: add my feature'`）
4. 推送分支（`git push origin feature/my-feature`）
5. 创建 Pull Request

请使用 [Conventional Commits](https://www.conventionalcommits.org/) 规范编写提交信息。

## 许可证

[MIT License with Commons Clause](LICENSE) — 可自由使用、修改和分发，但不得将本软件包装出售或作为付费服务提供。

## 致谢

基于 [Electron](https://www.electronjs.org/)、[React](https://react.dev/)、[Ant Design](https://ant.design/) 构建，由 [OpenAI](https://openai.com/)、[Anthropic](https://www.anthropic.com/)、[Google](https://ai.google/) 的 AI 模型驱动。
