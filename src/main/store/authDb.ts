/**
 * 授权数据库 — 应用注册、授权关系、会话管理
 * 与 modelDb.ts 共享同一个 SQLite 文件（通过 getDb()）
 */
import { isAbsolute, relative, resolve } from 'path'
import { getDb, getDbPath } from './modelDb'
import { isFirstPartyAppName } from '../oauth/firstParty'

// ============================================================
// Schema types
// ============================================================

export interface RegisteredApp {
  app_id: string
  name: string
  vendor: string
  icon: string
  app_key_hash: string
  created_at: string
  last_seen_at: string
}

export type KbPermissionScope = 'read' | 'read_write'

export interface KnowledgeBaseGrant {
  path: string
  label?: string
  scope: KbPermissionScope
}

export interface KnowledgeBaseAuthRequest {
  path: string
  label?: string
  scope?: KbPermissionScope
}

export interface AppAuthorization {
  auth_id: string
  app_id: string
  model_id: string | null
  model_name: string | null
  kb_path: string | null
  kb_label: string | null
  scope: 'read' | 'read_write'
  granted_at: string
  revoked_at: string | null
}

export interface AppSession {
  session_token: string
  app_id: string
  pid: number | null
  created_at: string
  expires_at: string
  revoked_at: string | null
}

export interface PendingAuthRequest {
  request_id: string
  app_id: string
  app_name: string
  app_icon: string
  requested_models: string[]
  requested_kbs: KnowledgeBaseAuthRequest[]
  peer_pid: number | null
  created_at: string
}

// ============================================================
// Pending auth queue (in-memory — same pattern as privacyInterceptor)
// ============================================================

interface PendingEntry {
  request: PendingAuthRequest
  resolve: (result: AuthDecision) => void
  reject: (err: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

export interface AuthDecision {
  request_id: string
  granted: boolean
  granted_models: string[]
  granted_kbs: Array<string | KnowledgeBaseGrant>
  duration_hours: number // 0 = permanent
  session_token?: string
  expires_at?: string
  granted_knowledge_bases?: KnowledgeBaseGrant[]
}

const pendingRequests = new Map<string, PendingEntry>()
let requestCounter = 0

export function enqueueAuthRequest(
  app_id: string,
  app_name: string,
  app_icon: string,
  requested_models: string[],
  requested_kbs: KnowledgeBaseAuthRequest[],
  timeout_ms: number = 120_000,
  peer_pid: number | null = null
): Promise<AuthDecision> {
  // First-party auto-grant: Notes 不应走 legacy 弹窗流程
  if (isFirstPartyAppName(app_name)) {
    const request_id = `auto_${Date.now()}`
    const token = generateToken()
    for (const modelName of requested_models) {
      grantAuth(app_id, null, modelName, null, null, 'read_write')
    }
    for (const kb of requested_kbs) {
      grantAuth(app_id, null, null, kb.path, kb.label || kb.path, kb.scope || 'read')
    }
    if (token) {
      createSession(token, app_id, null, peer_pid ?? null)
    }
    auditLog('auth_auto_granted', app_id, JSON.stringify({
      models: requested_models,
      kbs: requested_kbs.map(k => k.path),
    }))
    return Promise.resolve({
      request_id,
      granted: true,
      granted_models: requested_models,
      granted_kbs: requested_kbs.map(kb => ({ path: kb.path, label: kb.label || kb.path, scope: kb.scope || 'read' })),
      duration_hours: 0,
      session_token: token,
      expires_at: undefined,
      granted_knowledge_bases: requested_kbs.map(kb => ({ path: kb.path, label: kb.label || kb.path, scope: kb.scope || 'read' as KnowledgeBaseGrant['scope'] })),
    })
  }

  const request_id = `auth_${++requestCounter}_${Date.now()}`

  return new Promise<AuthDecision>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(request_id)
      resolve({
        request_id,
        granted: false,
        granted_models: [],
        granted_kbs: [],
        duration_hours: 0,
      })
    }, timeout_ms)

    pendingRequests.set(request_id, {
      request: {
        request_id,
        app_id,
        app_name,
        app_icon,
        requested_models,
        requested_kbs,
        peer_pid,
        created_at: new Date().toISOString(),
      },
      resolve,
      reject,
      timeout,
    })
  })
}

export function resolveAuthRequest(decision: AuthDecision): boolean {
  const entry = pendingRequests.get(decision.request_id)
  if (!entry) return false
  clearTimeout(entry.timeout)
  pendingRequests.delete(decision.request_id)

  if (decision.granted && (decision.granted_models.length > 0 || decision.granted_kbs.length > 0)) {
    // Persist the authorization and create a session token
    const token = generateToken()
    const expiresAt = decision.duration_hours > 0
      ? new Date(Date.now() + decision.duration_hours * 3600_000).toISOString()
      : null // null = permanent

    // Find app_id from the pending request
    const app_id = entry.request.app_id

    // Grant authorizations
    for (const modelName of decision.granted_models) {
      grantAuth(app_id, null, modelName, null, null, 'read_write')
    }
    const grantedKnowledgeBases = decision.granted_kbs.map(grant => normalizeKbGrant(grant, entry.request.requested_kbs))
    for (const kb of grantedKnowledgeBases) {
      grantAuth(app_id, null, null, kb.path, kb.label || kb.path, kb.scope)
    }

    // Create session
    if (token) {
      createSession(token, app_id, expiresAt, entry.request.peer_pid)
    }

    // Audit log
    auditLog('auth_granted', app_id, JSON.stringify({
      models: decision.granted_models,
      kbs: grantedKnowledgeBases,
      duration_hours: decision.duration_hours,
    }))

    decision.session_token = token
    decision.expires_at = expiresAt || undefined
    decision.granted_knowledge_bases = grantedKnowledgeBases
  } else {
    auditLog('auth_denied', entry.request.app_id, JSON.stringify({
      reason: 'user_denied',
    }))
  }

  entry.resolve(decision)
  return true
}

export function getPendingAuthRequests(): PendingAuthRequest[] {
  return Array.from(pendingRequests.values()).map(e => e.request)
}

export function getPendingAuthCount(): number {
  return pendingRequests.size
}

// ============================================================
// Database initialization
// ============================================================

export function initAuthDb(): void {
  const db = getDb()
  if (!db) return

  db.exec(`
    CREATE TABLE IF NOT EXISTS apps (
      app_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      vendor TEXT DEFAULT '',
      icon TEXT DEFAULT '',
      app_key_hash TEXT NOT NULL DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      last_seen_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS authorizations (
      auth_id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      model_id TEXT,
      model_name TEXT,
      kb_path TEXT,
      kb_label TEXT,
      scope TEXT DEFAULT 'read',
      granted_at TEXT DEFAULT (datetime('now')),
      revoked_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      session_token TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      pid INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT,
      revoked_at TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event TEXT NOT NULL,
      app_id TEXT,
      details TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_auth_app_id ON authorizations(app_id);
    CREATE INDEX IF NOT EXISTS idx_auth_active ON authorizations(app_id, revoked_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(session_token, revoked_at);
    CREATE INDEX IF NOT EXISTS idx_audit_app ON audit_log(app_id, created_at);
  `)

  console.log('[Auth DB] 授权数据库已初始化:', getDbPath())
}

// ============================================================
// App registration CRUD
// ============================================================

export function registerApp(
  name: string,
  vendor: string = '',
  icon: string = '',
  app_key_hash: string = ''
): RegisteredApp {
  const db = getDb()
  if (!db) throw new Error('数据库不可用')

  const app_id = generateAppId(name)
  db.prepare(`
    INSERT OR REPLACE INTO apps (app_id, name, vendor, icon, app_key_hash, created_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(app_id, name, vendor, icon, app_key_hash)

  return getApp(app_id)!
}

export function registerAppWithId(
  app_id: string,
  name: string,
  vendor: string = '',
  icon: string = '',
  app_key_hash: string = ''
): RegisteredApp {
  const db = getDb()
  if (!db) throw new Error('数据库不可用')

  db.prepare(`
    INSERT OR REPLACE INTO apps (app_id, name, vendor, icon, app_key_hash, created_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM apps WHERE app_id = ?), datetime('now')), datetime('now'))
  `).run(app_id, name, vendor, icon, app_key_hash, app_id)

  return getApp(app_id)!
}

export function getApp(app_id: string): RegisteredApp | null {
  const db = getDb()
  if (!db) return null
  const row = db.prepare('SELECT * FROM apps WHERE app_id = ?').get(app_id)
  return row ? row as RegisteredApp : null
}

export function listApps(): RegisteredApp[] {
  const db = getDb()
  if (!db) return []
  return db.prepare('SELECT * FROM apps ORDER BY last_seen_at DESC').all() as RegisteredApp[]
}

export function touchApp(app_id: string): void {
  const db = getDb()
  if (!db) return
  db.prepare("UPDATE apps SET last_seen_at = datetime('now') WHERE app_id = ?").run(app_id)
}

export function deleteApp(app_id: string): boolean {
  const db = getDb()
  if (!db) return false
  const result = db.prepare('DELETE FROM apps WHERE app_id = ?').run(app_id)
  return result.changes > 0
}

// ============================================================
// Authorization CRUD
// ============================================================

export function grantAuth(
  app_id: string,
  model_id: string | null,
  model_name: string | null,
  kb_path: string | null,
  kb_label: string | null,
  scope: 'read' | 'read_write' = 'read'
): AppAuthorization {
  const db = getDb()
  if (!db) throw new Error('数据库不可用')

  const auth_id = `auth_${crypto.randomUUID().slice(0, 8)}`
  db.prepare(`
    INSERT INTO authorizations (auth_id, app_id, model_id, model_name, kb_path, kb_label, scope, granted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(auth_id, app_id, model_id, model_name, kb_path, kb_label, scope)

  return getAuthorization(auth_id)!
}

export function getAuthorization(auth_id: string): AppAuthorization | null {
  const db = getDb()
  if (!db) return null
  return db.prepare('SELECT * FROM authorizations WHERE auth_id = ?').get(auth_id) as AppAuthorization | null
}

export function listAuthorizations(app_id: string, active_only: boolean = true): AppAuthorization[] {
  const db = getDb()
  if (!db) return []
  if (active_only) {
    return db.prepare(
      'SELECT * FROM authorizations WHERE app_id = ? AND revoked_at IS NULL ORDER BY granted_at DESC'
    ).all(app_id) as AppAuthorization[]
  }
  return db.prepare(
    'SELECT * FROM authorizations WHERE app_id = ? ORDER BY granted_at DESC'
  ).all(app_id) as AppAuthorization[]
}

export function listActiveAuthorizationsForApp(app_id: string): {
  models: string[]
  kb_paths: string[]
  kb_grants: KnowledgeBaseGrant[]
} {
  const auths = listAuthorizations(app_id, true)
  const models = new Set<string>()
  const kbByPath = new Map<string, KnowledgeBaseGrant>()
  for (const a of auths) {
    if (a.model_name) models.add(a.model_name)
    // Backward compat: NULL model_name with NULL kb_path = general inference grant
    else if (a.model_name === null && a.kb_path === null) models.add('*')
    if (a.kb_path) {
      const existing = kbByPath.get(a.kb_path)
      const scope = a.scope || 'read'
      const strongestScope = existing?.scope === 'read_write' || scope === 'read_write' ? 'read_write' : 'read'
      kbByPath.set(a.kb_path, {
        path: a.kb_path,
        label: a.kb_label || a.kb_path,
        scope: strongestScope,
      })
    }
  }
  const kb_grants = Array.from(kbByPath.values())
  return { models: Array.from(models), kb_paths: kb_grants.map(grant => grant.path), kb_grants }
}

export function revokeAuth(auth_id: string): boolean {
  const db = getDb()
  if (!db) return false
  const result = db.prepare(
    "UPDATE authorizations SET revoked_at = datetime('now') WHERE auth_id = ? AND revoked_at IS NULL"
  ).run(auth_id)
  return result.changes > 0
}

export function revokeAllAuthForApp(app_id: string): number {
  const db = getDb()
  if (!db) return 0
  const result = db.prepare(
    "UPDATE authorizations SET revoked_at = datetime('now') WHERE app_id = ? AND revoked_at IS NULL"
  ).run(app_id)
  return result.changes
}

// ============================================================
// Session management
// ============================================================

export function createSession(
  token: string,
  app_id: string,
  expires_at: string | null,
  pid: number | null = null
): AppSession {
  const db = getDb()
  if (!db) throw new Error('数据库不可用')

  db.prepare(`
    INSERT INTO sessions (session_token, app_id, pid, created_at, expires_at)
    VALUES (?, ?, ?, datetime('now'), ?)
  `).run(token, app_id, pid, expires_at)

  return getSession(token)!
}

export function getSession(token: string): AppSession | null {
  const db = getDb()
  if (!db) return null
  return db.prepare('SELECT * FROM sessions WHERE session_token = ?').get(token) as AppSession | null
}

export function validateSession(token: string): { valid: boolean; app_id?: string; reason?: string } {
  const db = getDb()
  if (!db) return { valid: false, reason: '数据库不可用' }

  const session = db.prepare(
    'SELECT * FROM sessions WHERE session_token = ?'
  ).get(token) as AppSession | null

  if (!session) return { valid: false, reason: '无效的会话令牌' }
  if (session.revoked_at) return { valid: false, reason: '会话已被撤销' }

  if (session.expires_at) {
    const expires = new Date(session.expires_at).getTime()
    if (Date.now() > expires) return { valid: false, reason: '会话已过期' }
  }

  return { valid: true, app_id: session.app_id }
}

export function revokeSession(token: string): boolean {
  const db = getDb()
  if (!db) return false
  const result = db.prepare(
    "UPDATE sessions SET revoked_at = datetime('now') WHERE session_token = ? AND revoked_at IS NULL"
  ).run(token)
  return result.changes > 0
}

export function revokeAllSessionsForApp(app_id: string): number {
  const db = getDb()
  if (!db) return 0
  const result = db.prepare(
    "UPDATE sessions SET revoked_at = datetime('now') WHERE app_id = ? AND revoked_at IS NULL"
  ).run(app_id)
  return result.changes
}

// ============================================================
// Permission check
// ============================================================

export interface PermissionCheck {
  allowed: boolean
  reason?: string
}

function scopeAllows(actual: KbPermissionScope | null | undefined, required: KbPermissionScope): boolean {
  const normalized = actual || 'read'
  if (required === 'read') return normalized === 'read' || normalized === 'read_write'
  return normalized === 'read_write'
}

function normalizeKbGrant(
  grant: string | KnowledgeBaseGrant,
  requestedKbs: KnowledgeBaseAuthRequest[]
): KnowledgeBaseGrant {
  const path = typeof grant === 'string' ? grant : grant.path
  const requested = requestedKbs.find(kb => kb.path === path)
  const requestedScope = requested?.scope || 'read_write'
  const scope = typeof grant === 'string' ? requestedScope : grant.scope || requestedScope
  return {
    path,
    label: (typeof grant === 'string' ? requested?.label : grant.label) || requested?.label || path,
    scope: scope === 'read' ? 'read' : 'read_write',
  }
}

export function checkModelPermission(token: string, model_name: string): PermissionCheck {
  const session = validateSession(token)
  if (!session.valid || !session.app_id) {
    return { allowed: false, reason: session.reason }
  }

  const auths = listAuthorizations(session.app_id, true)
  const hasModelAuth = auths.some(a => !a.model_name || a.model_name === model_name)

  if (!hasModelAuth) {
    return { allowed: false, reason: `应用未授权使用模型 ${model_name}` }
  }

  return { allowed: true }
}

export function checkKbPermission(
  token: string,
  kb_path: string,
  requiredScope: KbPermissionScope = 'read'
): PermissionCheck {
  const session = validateSession(token)
  if (!session.valid || !session.app_id) {
    return { allowed: false, reason: session.reason }
  }

  const auths = listAuthorizations(session.app_id, true)
  const hasKbAuth = auths.some(a => {
    if (!a.kb_path) return false
    if (!scopeAllows(a.scope, requiredScope)) return false
    const grantedRoot = resolve(a.kb_path)
    const requestedPath = resolve(kb_path)
    const rel = relative(grantedRoot, requestedPath)
    return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel))
  })

  if (!hasKbAuth) {
    return {
      allowed: false,
      reason: requiredScope === 'read_write'
        ? `应用未授权写入知识库 ${kb_path}`
        : `应用未授权访问知识库 ${kb_path}`,
    }
  }

  return { allowed: true }
}

// ============================================================
// Internal helpers
// ============================================================

function generateAppId(name: string): string {
  const sanitized = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const suffix = crypto.randomUUID().slice(0, 8)
  return `app_${sanitized}_${suffix}`
}

function generateToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = new Uint8Array(48)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map(b => chars[b % chars.length]).join('')
}

// ============================================================
// Audit logging
// ============================================================

function auditLog(event: string, app_id: string, details: string): void {
  const db = getDb()
  if (!db) return
  try {
    db.prepare(
      'INSERT INTO audit_log (event, app_id, details) VALUES (?, ?, ?)'
    ).run(event, app_id, details)
  } catch {
    // Audit log is best-effort; don't fail the operation
  }
}

export interface AuditEvent {
  id: number
  event: string
  app_id: string
  details: string
  created_at: string
}

export function getAuditLog(app_id?: string, limit: number = 100): AuditEvent[] {
  const db = getDb()
  if (!db) return []
  if (app_id) {
    return db.prepare(
      'SELECT * FROM audit_log WHERE app_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(app_id, limit) as AuditEvent[]
  }
  return db.prepare(
    'SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?'
  ).all(limit) as AuditEvent[]
}

export function getAuditCount(app_id?: string): number {
  const db = getDb()
  if (!db) return 0
  const row = app_id
    ? db.prepare('SELECT COUNT(*) as count FROM audit_log WHERE app_id = ?').get(app_id) as { count: number }
    : db.prepare('SELECT COUNT(*) as count FROM audit_log').get() as { count: number }
  return row?.count ?? 0
}
