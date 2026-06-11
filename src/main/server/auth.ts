/**
 * 授权协议路由 — JSON-RPC 2.0
 *
 * 参照 models.ts 的模式，通过 registerRoute 注册。
 * 外部应用通过 UDS JSON-RPC 调用这些方法完成授权流程。
 */
import { randomUUID } from 'crypto'
import {
  registerApp,
  getApp,
  listApps as listAllApps,
  touchApp,
  grantAuth,
  listActiveAuthorizationsForApp,
  revokeAllAuthForApp,
  validateSession,
  enqueueAuthRequest,
  getPendingAuthRequests,
  resolveAuthRequest,
  getAuditLog,
  type AppAuthorization,
  type KnowledgeBaseGrant,
} from '../store/authDb'
import { listModels } from '../store/modelDb'
import { SOCKET_PATH, TRANSPORT } from './transport'

type RegisterRoute = (
  method: string,
  path: string,
  handler: (params: Record<string, unknown>) => Promise<unknown>
) => void

/**
 * Build a KB list from the local filesystem for the auth popup.
 * This is called by the Hub renderer via IPC — here we expose a
 * simple route that returns available KB paths from the OS.
 */
async function listAvailableKBs(): Promise<Array<{ path: string; label: string }>> {
  try {
    const { readdir, stat } = await import('fs/promises')
    const { homedir } = await import('os')
    const { join } = await import('path')

    // Default: scan ~/Documents for directories containing .md files
    const home = homedir()
    const docsDir = join(home, 'Documents')
    const kbs: Array<{ path: string; label: string }> = []

    try {
      const entries = await readdir(docsDir)
      for (const entry of entries) {
        if (entry.startsWith('.')) continue
        const fullPath = join(docsDir, entry)
        try {
          const s = await stat(fullPath)
          if (s.isDirectory()) {
            // Quick check if directory contains .md files (scan 1 level)
            try {
              const subEntries = await readdir(fullPath)
              if (subEntries.some(e => e.endsWith('.md'))) {
                kbs.push({ path: fullPath, label: entry })
              }
            } catch {
              // Skip
            }
          }
        } catch {
          // Skip
        }
      }
    } catch {
      // Documents dir may not exist
    }

    // Also add ~/Notes and ~/Desktop as candidates
    for (const dir of ['Notes', 'Desktop']) {
      const p = join(home, dir)
      try {
        const s = await stat(p)
        if (s.isDirectory()) {
          try {
            const e = await readdir(p)
            if (e.some(f => f.endsWith('.md'))) {
              kbs.push({ path: p, label: dir })
            }
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }

    return kbs
  } catch {
    return []
  }
}

export function registerAuthRoutes(registerRoute: RegisterRoute): void {
  // ==================================================================
  // External app-facing routes (called over UDS by third-party apps)
  // ==================================================================

  /**
   * app.ping — 检测 Hub 可用性，返回协议版本
   * 不需要 token
   */
  registerRoute('app.ping', '', async() => ({
    protocol_version: '1.0.0',
    name: 'AinCore',
    features: ['chat', 'completions', 'search', 'kb_access', 'oauth_like_auth'],
    requires_auth: true,
    transport: TRANSPORT,
    socketPath: SOCKET_PATH,
  }))

  /**
   * app.register — 应用注册，返回 app_id
   * 应用提供 name + 可选的 vendor/icon，Hub 分配 app_id
   * 不需要 token
   */
  registerRoute('app.register', '', async(params) => {
    const name = String(params.name || '')
    if (!name) throw new Error('应用名称不能为空')

    const vendor = String(params.vendor || '')
    const icon = String(params.icon || '')
    const app_key_hash = String(params.app_key_hash || '')

    const app = registerApp(name, vendor, icon, app_key_hash)
    return {
      app_id: app.app_id,
      name: app.name,
      created_at: app.created_at,
    }
  })

  /**
   * app.request_auth — 请求授权
   * 这是核心方法。调用后：
   * 1. 创建 Promise 存入挂起队列
   * 2. 在 Hub UI 中弹出授权弹窗（通过 IPC）
   * 3. 用户在弹窗中选择授权范围
   * 4. 返回 session_token 或 denied
   *
   * 不需要 token（这是获取 token 的方法）
   */
  registerRoute('app.request_auth', '', async(params) => {
    const app_id = String(params.app_id || '')
    if (!app_id) throw new Error('缺少 app_id')

    // Validate app exists
    const app = getApp(app_id)
    if (!app) throw new Error('应用未注册，请先调用 app.register')

    touchApp(app_id)

    const requested_models = Array.isArray(params.models)
      ? params.models.map(String)
      : []
    const requested_kbs: KnowledgeBaseGrant[] = Array.isArray(params.knowledge_bases)
      ? (params.knowledge_bases as Array<Record<string, unknown>>).map(kb => ({
        path: String(kb.path || ''),
        label: String(kb.label || kb.path || ''),
        scope: (kb.scope === 'read' ? 'read' : 'read_write') as KnowledgeBaseGrant['scope'],
      })).filter(kb => kb.path)
      : []

    // Timeout from params (default 120s)
    const timeout_ms = typeof params.timeout_ms === 'number' ? params.timeout_ms : 120_000

    // Enqueue the request — this creates a Promise that will be resolved
    // when the user clicks in the Hub UI
    const decision = await enqueueAuthRequest(
      app_id,
      app.name,
      app.icon,
      requested_models,
      requested_kbs,
      timeout_ms
    )

    if (!decision.granted) {
      return { granted: false, reason: '用户拒绝授权或超时' }
    }

    return {
      granted: true,
      session_token: decision.session_token,
      expires_at: decision.expires_at || null,
      granted_models: decision.granted_models,
      granted_kbs: (decision.granted_knowledge_bases || []).map(kb => kb.path),
      granted_knowledge_bases: decision.granted_knowledge_bases || [],
    }
  })

  /**
   * app.list_grants — 查询当前应用已被授予的权限
   * 需要 session_token
   */
  registerRoute('app.list_grants', '', async(params) => {
    const token = String(params.session_token || '')
    if (!token) throw new Error('缺少 session_token')

    const session = validateSession(token)
    if (!session.valid || !session.app_id) {
      throw new Error(session.reason || '无效的会话')
    }

    const grants = listActiveAuthorizationsForApp(session.app_id)
    return grants
  })

  /**
   * app.revoke_auth — 应用主动撤销自己的授权
   * 需要 session_token
   */
  registerRoute('app.revoke_auth', '', async(params) => {
    const token = String(params.session_token || '')
    if (!token) throw new Error('缺少 session_token')

    const session = validateSession(token)
    if (!session.valid || !session.app_id) {
      throw new Error(session.reason || '无效的会话')
    }

    const count = revokeAllAuthForApp(session.app_id)
    return { success: true, revoked_count: count }
  })

  /**
   * app.list_models — 列出 Hub 中已安装的模型
   * 需要 session_token
   */
  registerRoute('app.list_models', '', async(params) => {
    const token = String(params.session_token || '')
    if (!token) throw new Error('缺少 session_token')

    const session = validateSession(token)
    if (!session.valid || !session.app_id) {
      throw new Error(session.reason || '无效的会话')
    }

    const models = listModels()
    return models.map(m => ({
      id: m.id,
      name: m.name,
      family: m.family,
      parameterSize: m.parameterSize,
      quantization: m.quantization,
      sizeBytes: m.sizeBytes,
    }))
  })

  // ==================================================================
  // Internal routes (called by Hub renderer UI via IPC bridge)
  // ==================================================================

  /**
   * auth.grant — Hub UI 调用，用户确认授权后写入数据库并 resolve Promise
   */
  registerRoute('auth.grant', '', async(params) => {
    const decision = {
      request_id: String(params.request_id || ''),
      granted: Boolean(params.granted),
      granted_models: Array.isArray(params.granted_models) ? params.granted_models.map(String) : [],
      granted_kbs: Array.isArray(params.granted_kbs)
        ? (params.granted_kbs as Array<string | KnowledgeBaseGrant>)
        : [],
      duration_hours: typeof params.duration_hours === 'number' ? params.duration_hours : 0,
    }
    return resolveAuthRequest(decision)
  })

  /**
   * auth.list_pending — Hub UI 调用，查询待审批的授权请求
   */
  registerRoute('auth.list_pending', '', async() => {
    return getPendingAuthRequests()
  })

  /**
   * auth.list_available_kbs — 返回可授权知识库列表
   */
  registerRoute('auth.list_available_kbs', '', async() => {
    return listAvailableKBs()
  })

  /**
   * auth.list_available_models — 返回已安装模型列表
   */
  registerRoute('auth.list_available_models', '', async() => {
    const models = listModels()
    return models.map(m => ({
      id: m.id,
      name: m.name,
      parameterSize: m.parameterSize,
      quantization: m.quantization,
      sizeBytes: m.sizeBytes,
    }))
  })

  /**
   * auth.list_apps — Hub UI 调用，列出所有注册应用及其授权状态
   */
  registerRoute('auth.list_apps', '', async() => {
    const apps = listAllApps()
    return apps.map(app => {
      const grants = listActiveAuthorizationsForApp(app.app_id)
      return {
        ...app,
        active_grants: grants.models.length + grants.kb_paths.length,
        granted_models: grants.models,
        granted_kbs: grants.kb_paths,
        granted_knowledge_bases: grants.kb_grants,
      }
    })
  })

  /**
   * auth.revoke — Hub UI 调用，撤销某应用的某个授权
   */
  registerRoute('auth.revoke', '', async(params) => {
    const auth_id = String(params.auth_id || '')
    if (!auth_id) throw new Error('缺少 auth_id')

    const { revokeAuth } = await import('../store/authDb')
    const success = revokeAuth(auth_id)
    return { success }
  })

  /**
   * auth.audit_log — Hub UI 调用，查询审核日志
   */
  registerRoute('auth.audit_log', '', async(params) => {
    const app_id = typeof params.app_id === 'string' ? params.app_id : undefined
    const limit = typeof params.limit === 'number' ? params.limit : 100
    return getAuditLog(app_id, limit)
  })
}
