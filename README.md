# AinCore

> 本地 AI 计算平台核心枢纽

AinCore 是一个运行在本地的 AI 计算平台核心，通过 Electron 桌面应用为本地大语言模型（LLM）提供完整的生命周期管理。它作为 Hub-and-Spoke 架构的中枢节点，通过 UDS JSON-RPC 协议向上层应用（如 [AinCore Notes](https://github.com/bzda404/aincore-notes)）提供模型调度、OAuth 2.0 授权、隐私审计和用户画像注入等服务。

**状态：Release Candidate (v1.0.0-rc.3)**

## 核心特性

### 模型推理引擎

- **llama.cpp 进程管理** — 自动管理 `llama-server` 子进程的完整生命周期（加载 / 卸载 / 健康检查 / OOM 恢复）
- **动态上下文窗口** — 根据模型参数规模自动计算 ctx-size（0.5B→4096, 1B→2048, 3B→1024），OOM 时自动减半重试
- **RAM 安全守卫** — 基于系统内存动态限制最大模型参数（32GB→7B, 16GB→3B, 8GB→1B），防止内存溢出
- **多源模型下载** — 支持 HuggingFace / ModelScope 双源下载，断点续传、SHA256 校验和进度流式推送
- **智能模型调度器** — 常驻模型池 + 按需加载 + LRU 淘汰 + 5 分钟空闲卸载 + 85% 内存压力自动卸载

### OAuth 2.0 + PKCE 授权服务器

- **完整授权码流程** — 客户端注册、S256 PKCE 授权码、Token 交换 / 刷新 / 撤销 / 内省
- **同意门控** — 每次授权请求弹出用户确认对话框，支持作用域粒度控制
- **一方应用快通道** — 内置应用（如 AinCore Notes）自动同意，无需用户交互
- **暴力破解防护** — Token 端点 5 次失败后锁定 30 秒
- **7 种授权作用域** — `inference:read`, `models:read`, `models:manage`, `knowledge:read`, `knowledge:write`, `system:status`, `offline_access`

### UDS JSON-RPC 服务

- **高性能 IPC** — 基于 `net.createServer()` 的 Unix Domain Socket 服务（macOS/Linux: `/tmp/aincore.sock`，Windows: `\\.\pipe\aincore`），换行分隔的 JSON-RPC 2.0 协议
- **约 55 个路由端点** — 覆盖健康检查、OpenAI 兼容 API、模型管理、知识库操作、授权管理和用户画像
- **双认证上下文** — 同时支持 OAuth Bearer Token 和传统 Session Token，自动识别认证模式
- **令牌桶限流** — 每客户端 100 RPM（可配置），突发 20，5 分钟不活跃自动清理
- **Zod 输入验证** — 15+ 方法的参数 Schema 校验，标准化 `INVALID_PARAMS (-32602)` 错误响应

### 隐私哨兵 (Privacy Sentinel)

- **PII 检测** — 9 种敏感信息类型（身份证号、银行卡、护照、手机号、邮箱、IP 地址、地址、姓名），分高 / 中 / 低三级敏感度
- **分级响应策略** — 高敏感自动脱敏、中敏感弹出确认、低敏感仅记录审计日志
- **同意超时** — 可配置超时（默认 60 秒）后自动拒绝，防止授权挂起
- **审计追溯** — 所有隐私决策写入 `privacy_audit_log` 表，包含 PII 类型、数量、敏感度和决策结果
- **工具白名单** — 配置信任工具绕过隐私检查

### AI 记忆 (User Profile)

- **用户画像存储** — SQLite 单行表存储用户偏好（显示名、语言、沟通风格、自定义指令、扩展偏好）
- **透明系统提示注入** — 在所有 `chat.completions` 请求（JSON-RPC 和 HTTP 双路由）中自动注入用户画像为系统提示
- **注入可控** — 支持 `_skip_profile_injection` 标志选择性跳过注入，不影响高级客户端
- **14 种语言支持** — 覆盖中文、英文、日文、韩文、法文、德文、西班牙文等

### 应用市场

- **GitHub 驱动** — 通过 GitHub Search API 发现标记 `aincore-app` topic 的仓库，通过 Releases API 分发 `.aincore` 包
- **5 阶段安装流程** — 下载 → SHA256 校验 → tar.gz 解压 → manifest 验证 → 注册到 SQLite
- **版本检查与更新** — 对比本地版本与 GitHub 最新发布版本，支持自动更新
- **GitHub 令牌管理** — 支持配置 `GITHUB_TOKEN` 避免 API 限流，令牌持久化到本地文件

### 管理界面

- **Vue 3 Dashboard** — 7 个功能模块：状态面板、模型管理、应用市场、已安装应用、隐私中心、设置、引导页
- **OAuth 同意弹窗** — 应用授权时弹出粒度化的作用域确认对话框
- **隐私审计面板** — 支持筛选、统计、导出审计日志
- **多语言** — 中英文双语 i18n

## 技术栈

| 组件 | 技术 |
|---|---|
| 运行时 | Electron 38 + Node.js 22 |
| 前端 | Vue 3.5 + Element Plus + Pinia + vue-i18n |
| AI 引擎 | llama.cpp (llama-server) — 子进程管理 + 健康监控 |
| 数据库 | better-sqlite3（11 张表，含 in-memory Map 降级方案） |
| IPC 传输 | Unix Domain Socket JSON-RPC 2.0（换行分隔） |
| 输入验证 | Zod Schema |
| 构建 | electron-vite 5 + electron-builder 26 |
| 测试 | Vitest（171 个单元测试） |
| 语言 | TypeScript 5.9 (strict) |

## 安装

### 系统要求

- Node.js >= 20.19
- pnpm >= 10
- macOS 10.15+ / Ubuntu 20.04+ / Windows 10+

### 从源码构建

```bash
git clone https://github.com/bzda404/aincore.git
cd aincore
pnpm install
pnpm dev          # 开发模式
pnpm build:mac    # 构建 macOS 安装包
pnpm build:linux  # 构建 Linux 安装包
pnpm build:win    # 构建 Windows 安装包
```

### 使用预构建包

前往 [Releases](https://github.com/bzda404/aincore/releases) 页面下载对应平台的安装包。

## 开发

```bash
pnpm dev          # 启动开发服务器
pnpm test         # 运行单元测试 (Vitest)
pnpm typecheck    # TypeScript 类型检查
pnpm lint         # ESLint 代码检查
```

## 架构概览

```
AinCore (Electron Main Process)
├── engine/         llama.cpp 子进程生命周期（加载/卸载/OOM 恢复/健康检查）
├── models/         模型注册表、下载器（HF/ModelScope）、调度器（LRU/内存压力）
├── server/         UDS JSON-RPC 服务 + OpenAI 兼容 API + Zod 验证
│   ├── profileInjector  AI 记忆系统提示注入（双路由覆盖）
│   ├── openai           POST:/v1/chat/completions, GET:/v1/models
│   ├── models           chat.completions, models.* 系列
│   ├── auth             app.register, app.request_auth, auth.* 系列
│   ├── knowledge        search_notes, read_note, write_note 系列
│   ├── oauth/server     oauth.register, oauth.authorize, oauth.token 系列
│   └── profile          profile.get, profile.update
├── oauth/          OAuth 2.0 + PKCE 完整实现（同意门控/暴力防护/Token 轮换）
├── privacy/        PII 检测（9 类型 × 3 级）、同意弹窗、审计记录
├── apps/           应用市场（GitHub API）、包安装器（tar.gz + SHA256）
├── store/          SQLite 持久化（11 表 + in-memory 降级）
├── corePolicy      RAM 模型尺寸守卫 + 推理遥测
└── peerAuth        UDS 对端凭证解析（Linux /proc + ss, macOS lsof）
```

## 环境变量

| 变量 | 说明 |
|---|---|
| `AINCORE_BACKGROUND=1` | 以无界面模式运行（后台服务） |
| `AINCORE_CORE_HOME` | 覆盖默认数据目录路径 |
| `AINCORE_CORE_MOCK_ENGINE=1` | 启动 Mock 引擎（开发/测试用） |
| `AINCORE_RATE_LIMIT_RPM` | 覆盖默认速率限制（100 RPM） |

## 许可证

[MIT](LICENSE)

## 生态

| 项目 | 说明 |
|---|---|
| [AinCore Notes](https://github.com/bzda404/aincore-notes) | 基于 AinCore 的 AI 知识管理应用（Markdown 编辑器 + MCP 协议） |
| [@aincore/sdk](https://github.com/bzda404/aincore-cdk) | 接入 AinCore 的 TypeScript SDK（OAuth 2.0 PKCE + UDS JSON-RPC） |
