# AinCore

> 本地 AI 算力平台 — 让大模型在桌面端安全、高效地运行

AinCore 是一个面向桌面端的本地 AI 算力平台，为 GGUF 格式大语言模型提供完整的生命周期管理。通过 Electron 桌面应用封装 llama.cpp 推理引擎，结合 UDS JSON-RPC 服务、OAuth 2.0 认证体系和隐私哨兵机制，向上层应用提供标准化的本地 AI 基础设施。

**状态：Release Candidate (v1.0.0-rc.3)**

## 架构定位

AinCore 采用 Hub-and-Spoke 架构，作为中枢节点承载所有本地 AI 能力：

```
第三方应用 ──OAuth 2.0 PKCE──► AinCore (Core Hub)
AinCore Notes ──────────────────►   ├── llama.cpp 推理引擎
外部 MCP 客户端 ────────────────►   ├── UDS JSON-RPC 服务
                                     ├── OAuth 2.0 授权中心
                                     ├── 隐私哨兵 + 审计
                                     └── SQLite 持久化
```

## 核心特性

### 模型推理引擎

基于 llama.cpp 的本地 GGUF 模型推理，完整的子进程生命周期管理：

- **子进程编排** — 自动管理 `llama-server` 进程的启动、加载、健康检查与优雅退出（SIGTERM → 5s 超时 → SIGKILL）
- **动态上下文窗口** — 根据模型参数规模自动计算 ctx-size：0.5B→4096 / 1B→2048 / 3B→1024 / >3B→512
- **OOM 自动恢复** — 6 种 OOM 模式检测（含 CUDA / Metal），触发后自动卸载并以半倍 ctx-size 重试（下限 256）
- **智能调度器** — 常驻模型池 + LRU 淘汰 + 5 分钟空闲卸载 + 85% 内存压力自动卸载
- **RAM 安全守卫** — 基于系统内存动态限制最大模型参数：32GB→7B / 16GB→3B / 8GB→1B
- **双源模型下载** — HuggingFace（hf-mirror.com）+ ModelScope，断点续传、SHA256 校验、进度流式推送
- **进程守护** — 30 秒健康检查轮询，最多 3 次自动重启，意外退出事件通知

### OAuth 2.0 + PKCE 授权体系

完整的 RFC 6749 + RFC 7636 实现，所有外部访问均须授权：

- **6 个 JSON-RPC 端点** — `oauth.register` / `authorize` / `token` / `revoke` / `revoke_client` / `introspect`
- **S256 PKCE** — 最小 43 字符 code_verifier，SHA-256 哈希校验
- **7 种授权作用域** — `inference:read` · `models:read` · `models:manage` · `knowledge:read` · `knowledge:write` · `system:status` · `offline_access`
- **同意门控** — Promise 挂起式弹窗，支持作用域粒度控制，120 秒超时自动拒绝
- **一方应用快通道** — 内置应用（AinCore Notes）自动同意，跳过用户交互
- **暴力破解防护** — 单客户端 Token 端点 5 次失败后锁定 30 秒
- **完整 Token 生命周期** — access_token（1h）· refresh_token（30d，需 `offline_access`）· 授权码（10min 一次性）

### UDS JSON-RPC 服务

高性能本地 IPC 通信层，零网络开销：

- **传输层** — Unix Domain Socket（macOS/Linux: `/tmp/aincore.sock`，Windows: `\\.\pipe\aincore`），`chmod 0o600` 权限隔离
- **协议** — JSON-RPC 2.0，换行分隔（`\n`），52 个路由端点覆盖 7 大模块
- **三层认证** — 18 个公开方法免认证 → Session Token 遗留兼容 → OAuth access_token + 作用域校验
- **令牌桶限流** — 每客户端 100 RPM（可配置），突发 20，5 分钟不活跃自动清理
- **Zod 输入验证** — 15+ 方法的参数 Schema 校验（`max_tokens` 1-32768, `temperature` 0-2, `messages` 1-100 条）
- **对端凭证验证** — Linux `/proc` + `ss` 解析，macOS `lsof` 匹配，确保 socket 调用方身份

### 隐私哨兵 (Privacy Sentinel)

PII 检测与分层脱敏，所有隐私决策可审计追溯：

- **8 种 PII 类型** — 身份证号 · 银行卡 · 护照 · 手机号 · 邮箱 · IP 地址 · 地址 · 姓名
- **三级敏感度分层** — 高敏感（身份证/银行卡/护照）自动脱敏 → 中敏感（手机/邮箱/IP）弹窗确认 → 低敏感仅记录
- **同意门控** — Promise 挂起式弹窗，默认 60 秒超时自动拒绝
- **SQLite 审计** — `privacy_audit_log` 表记录所有决策，支持时间范围 / 客户端 / 决策类型筛选与统计
- **审计导出** — CSV / JSON 格式（上限 10,000 条），7 天趋势统计，Top-10 客户端排行
- **工具白名单** — 配置信任工具名称绕过隐私检查

### AI 记忆系统 (User Profile)

透明的用户画像注入，无需应用侧改造：

- **SQLite 单行存储** — `user_profile` 表（id 约束为 1），存储显示名、语言、沟通风格、自定义指令、扩展偏好
- **双路由注入** — JSON-RPC `chat.completions` 和 HTTP `POST /v1/chat/completions` 均自动注入用户画像为系统提示
- **15 种语言** — zh-CN · zh-TW · en · ja · ko · fr · de · es · pt · ru · ar · it · nl · vi · th
- **可控注入** — 支持 `_skip_profile_injection` 标志选择性跳过，不影响高级客户端

### 跨平台应用市场

基于 GitHub 生态的开放应用分发：

- **GitHub 驱动** — Search API 发现 `aincore-app` topic 仓库，Releases API 分发 `.aincore` 包
- **6 阶段安装管线** — 下载 → SHA256 校验 → tar.gz 解压 → manifest 验证 → 注册到 SQLite → 完成
- **Manifest 规范** — 必填 `app_id` / `name` / `version` / `entry_point` / `min_core_version`，可选权限声明
- **版本管理** — 对比本地版本与 GitHub 最新 Release，支持自动更新
- **GitHub Token** — 持久化到本地文件，API 速率限制从 60 req/h 提升至 5,000 req/h

### 管理界面

Vue 3 桌面 Dashboard，7 个功能模块 + 中英双语 i18n：

- **状态面板** — 模型状态、Notes 连接、隐私概览
- **模型管理** — 已安装模型 + 远程搜索（HuggingFace / ModelScope 双源）
- **应用管理** — 已连接应用授权管理 + 应用市场浏览
- **隐私中心** — 审计日志筛选、统计、导出 + 哨兵配置
- **设置** — 用户画像编辑、GitHub Token 配置、系统信息
- **引导页** — 首次运行 3 步向导
- **OAuth 同意弹窗** — 应用授权时弹出粒度化的作用域确认对话框

## 技术栈

| 组件 | 技术 |
|---|---|
| 运行时 | Electron 38.4 + Node.js 22 |
| 前端 | Vue 3.5 + Element Plus + Pinia + vue-i18n + vue-router |
| AI 引擎 | llama.cpp (llama-server) — 子进程生命周期 + 6 种 OOM 恢复 |
| 数据库 | better-sqlite3（11 张表，WAL 模式，in-memory Map 降级） |
| IPC 传输 | Unix Domain Socket · JSON-RPC 2.0 · 换行分隔 · `chmod 0o600` |
| 输入验证 | Zod Schema（15+ 方法参数校验） |
| 构建 | electron-vite 5 + electron-builder 26 |
| 测试 | Vitest（171 个单元测试） |
| 语言 | TypeScript 5.9 (strict) |

## 安装

### 系统要求

- Node.js >= 20.19 · pnpm >= 10
- macOS 10.15+ / Ubuntu 20.04+ / Windows 10+

### 从源码构建

```bash
git clone https://github.com/bzda404/aincore.git
cd aincore
pnpm install
pnpm dev            # 开发模式
pnpm build:mac      # macOS（arm64 + x64）
pnpm build:linux    # Linux（AppImage + deb）
pnpm build:win      # Windows（nsis + zip）
```

### 使用预构建包

前往 [Releases](https://github.com/bzda404/aincore/releases) 下载对应平台安装包。

## 开发

```bash
pnpm dev            # 启动开发服务器
pnpm test           # 运行 171 个单元测试
pnpm typecheck      # TypeScript 类型检查
pnpm lint           # ESLint 代码检查
```

## 架构概览

```
AinCore (Electron Main Process)
├── engine/         llama.cpp 子进程编排（加载/卸载/6 种 OOM 恢复/健康检查）
├── models/         模型注册表、下载器（HF/ModelScope）、调度器（LRU/内存压力）
├── server/         UDS JSON-RPC 服务 + OpenAI 兼容 API + Zod 验证
│   ├── profileInjector  AI 记忆系统提示注入（双路由覆盖）
│   ├── openai           POST:/v1/chat/completions, GET:/v1/models
│   ├── models           chat.completions, models.* 系列
│   ├── auth             app.register, app.request_auth, auth.* 系列
│   ├── knowledge        search_notes, read_note, write_note 系列
│   ├── oauth/server     oauth.register, oauth.authorize, oauth.token 系列
│   └── profile          profile.get, profile.update
├── oauth/          OAuth 2.0 + PKCE（同意门控/暴力防护/Token 轮换）
├── privacy/        PII 检测（8 类型 × 3 级）、同意弹窗、SQLite 审计
├── apps/           应用市场（GitHub API）、包安装器（tar.gz + SHA256）
├── store/          SQLite 持久化（11 表 + in-memory 降级）
├── corePolicy      RAM 模型尺寸守卫 + 推理遥测
└── peerAuth        UDS 对端凭证解析（Linux /proc + ss, macOS lsof）
```

## 环境变量

| 变量 | 说明 | 默认值 |
|---|---|---|
| `AINCORE_BACKGROUND=1` | 无界面后台模式 | — |
| `AINCORE_CORE_HOME` | 覆盖默认数据目录 | `app.getPath('userData')` |
| `AINCORE_CORE_MOCK_ENGINE=1` | Mock 引擎（开发测试用） | — |
| `AINCORE_RATE_LIMIT_RPM` | 速率限制（请求/分钟） | `100` |
| `AINCORE_RATE_LIMIT_BURST` | 突发容量 | `20` |
| `AINCORE_NOTES_COMMAND` | 外部启动 Notes 的命令 | — |
| `GITHUB_TOKEN` | GitHub PAT（提升 API 限额） | — |

## 生态

| 项目 | 说明 |
|---|---|
| [AinCore Notes](https://github.com/bzda404/aincore-notes) | AI 知识管理应用（Markdown 编辑器 + MCP 协议 + 隐私拦截器） |
| [@aincore/sdk](https://github.com/bzda404/aincore-cdk) | 开发者客户端 SDK（OAuth 2.0 PKCE + UDS JSON-RPC 封装） |

## 许可证

[MIT](LICENSE)
