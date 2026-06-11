# Hearth

> 本地 AI 算力平台中枢

Hearth 是一个运行在本地的 AI 计算平台，通过 Electron 桌面应用为本地大语言模型提供完整的生命周期管理。它作为生态系统的核心枢纽，为上层应用（如 [Hearthnotes](https://github.com/bzda404/hearthnotes)）提供模型调度、授权服务和隐私控制。

**状态：Release Candidate (v1.0.0-rc.1)**

## 功能

- **模型管理** — 从 Hugging Face / ModelScope 下载 GGUF 模型，支持多源搜索、下载进度追踪和生命周期管理（加载/卸载/LRU 淘汰）
- **OAuth 2.0 授权服务器** — 基于 PKCE 的本地授权流程，允许第三方应用通过 UDS（Unix Domain Socket）安全接入
- **UDS JSON-RPC 服务** — 通过 `/tmp/mindvault.sock`（macOS/Linux）或命名管道（Windows）提供高性能 IPC
- **应用市场** — 浏览、安装和管理生态应用，支持版本检查和校验和验证
- **隐私控制** — PII 检测、同意门控和审计日志，数据完全存储在本地
- **管理界面** — Vue 3 构建的 Dashboard，涵盖模型管理、应用市场、隐私中心等模块

## 技术栈

| 组件 | 技术 |
|---|---|
| 运行时 | Electron 38 + Node.js 22 |
| 前端 | Vue 3 + Element Plus + Pinia |
| AI 引擎 | llama.cpp (llama-server) |
| 数据库 | better-sqlite3 (本地持久化) |
| 构建 | electron-vite 5 + electron-builder 26 |
| 语言 | TypeScript 5.9 (strict) |

## 安装

### 系统要求

- Node.js >= 20.19
- pnpm >= 10
- macOS 10.15+ / Ubuntu 20.04+ / Windows 10+

### 从源码构建

```bash
git clone https://github.com/bzda404/hearth.git
cd hearth
pnpm install
pnpm dev          # 开发模式
pnpm build:mac    # 构建 macOS 安装包
pnpm build:linux  # 构建 Linux 安装包
pnpm build:win    # 构建 Windows 安装包
```

### 使用预构建包

前往 [Releases](https://github.com/bzda404/hearth/releases) 页面下载对应平台的安装包。

## 开发

```bash
pnpm dev          # 启动开发服务器
pnpm test         # 运行单元测试 (Vitest)
pnpm typecheck    # TypeScript 类型检查
pnpm lint         # ESLint 代码检查
```

## 架构概览

```
Hearth (Electron Main)
├── oauth/          OAuth 2.0 + PKCE 授权服务器
├── models/         模型下载、调度、注册表
├── apps/           应用安装、卸载、市场同步
├── privacy/        PII 检测、同意门控、审计
├── server/         UDS JSON-RPC 服务 + OpenAI 兼容 API
├── engine/         llama.cpp 子进程管理
└── store/          SQLite 数据库初始化
```

## 环境变量

| 变量 | 说明 |
|---|---|
| `MINDVAULT_CORE_BACKGROUND=1` | 以无界面模式运行 |
| `MINDVAULT_CORE_HOME` | 覆盖默认数据目录 |

## 许可证

[MIT](LICENSE)

## 相关链接

- [Hearthnotes](https://github.com/bzda404/hearthnotes) — 基于 Hearth 的知识管理应用
- [@mindvault/sdk](https://github.com/bzda404/mindvault-sdk) — 接入 Hearth 的 TypeScript SDK
