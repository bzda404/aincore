/* eslint-disable @typescript-eslint/no-require-imports */
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * OAuth 2.0 Store — SQLite 持久化层
 *
 * 新增表:
 *   oauth_clients   — 注册的 OAuth 客户端（client_id / client_secret / redirect_uri）
 *   oauth_codes     — 授权码（authorization_code + PKCE code_challenge）
 *   oauth_tokens    — access_token / refresh_token 存储
 *
 * 与 authDb.ts 共享同一个 SQLite 文件（通过 getDb()），
 * 保持向后兼容: apps / authorizations / sessions / audit_log 表不变。
 */
import { getDb } from '../store/modelDb'
import { registerAppWithId } from '../store/authDb'
import { isFirstPartyAppName } from './firstParty'

// ============================================================
// Types
// ============================================================

export interface OAuthClient {
  client_id: string
  client_secret: string
  app_name: string
  app_icon: string
  app_vendor: string
  redirect_uri: string       // 本地 OAuth 中通常为空
  grant_types: string        // JSON array: ["authorization_code","refresh_token"]
  created_at: string
}

export interface OAuthCode {
  code: string
  client_id: string
  scopes: string             // 空格分隔
  code_challenge: string     // S256 PKCE challenge (base64url)
  code_challenge_method: 'S256'
  redirect_uri: string
  expires_at: string         // 授权码 10 分钟有效
  used: number               // 0 = 未使用, 1 = 已使用
}

export interface OAuthToken {
  access_token: string
  refresh_token: string | null
  client_id: string
  scopes: string             // 空格分隔
  token_type: 'Bearer'
  created_at: string
  access_expires_at: string  // 1 小时
  refresh_expires_at: string | null  // 30 天 (如果有 refresh)
  revoked_at: string | null
}

// ============================================================
// Database initialization
// ============================================================

export function initOAuthDb(): void {
  const db = getDb()
  if (!db) return

  db.exec(`
    CREATE TABLE IF NOT EXISTS oauth_clients (
      client_id     TEXT PRIMARY KEY,
      client_secret TEXT NOT NULL,
      app_name      TEXT NOT NULL,
      app_icon      TEXT DEFAULT '',
      app_vendor    TEXT DEFAULT '',
      redirect_uri  TEXT DEFAULT '',
      grant_types   TEXT DEFAULT '["authorization_code","refresh_token"]',
      created_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS oauth_codes (
      code                  TEXT PRIMARY KEY,
      client_id             TEXT NOT NULL,
      scopes                TEXT NOT NULL,
      code_challenge        TEXT NOT NULL,
      code_challenge_method TEXT NOT NULL DEFAULT 'S256',
      redirect_uri          TEXT DEFAULT '',
      expires_at            TEXT NOT NULL,
      used                  INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS oauth_tokens (
      access_token        TEXT PRIMARY KEY,
      refresh_token       TEXT,
      client_id           TEXT NOT NULL,
      scopes              TEXT NOT NULL,
      token_type          TEXT NOT NULL DEFAULT 'Bearer',
      created_at          TEXT DEFAULT (datetime('now')),
      access_expires_at   TEXT NOT NULL,
      refresh_expires_at  TEXT,
      revoked_at          TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_oauth_codes_code ON oauth_codes(code, used);
    CREATE INDEX IF NOT EXISTS idx_oauth_tokens_access ON oauth_tokens(access_token, revoked_at);
    CREATE INDEX IF NOT EXISTS idx_oauth_tokens_refresh ON oauth_tokens(refresh_token, revoked_at);
    CREATE INDEX IF NOT EXISTS idx_oauth_tokens_client ON oauth_tokens(client_id, revoked_at);
  `)

  console.log('[OAuth DB] OAuth 数据表已初始化')
}

// ============================================================
// Client registration
// ============================================================

export function registerOAuthClient(
  app_name: string,
  app_icon: string = '',
  app_vendor: string = '',
  redirect_uri: string = ''
): OAuthClient {
  const db = getDb()
  if (!db) throw new Error('数据库不可用')

  const client_id = generateClientId(app_name)
  const client_secret = generateSecret()

  db.prepare(`
    INSERT INTO oauth_clients (client_id, client_secret, app_name, app_icon, app_vendor, redirect_uri)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(client_id, client_secret, app_name, app_icon, app_vendor, redirect_uri)

  registerAppWithId(client_id, app_name, app_vendor, app_icon, client_id)

  if (isFirstPartyAppName(app_name)) {
    markClientFirstParty(client_id)
  }

  const client = getOAuthClient(client_id)
  if (!client) {
    throw new Error(`OAuth 客户端注册失败: 无法查询已注册的客户端 (client_id=${client_id})`)
  }
  return client
}

export function getOAuthClient(client_id: string): OAuthClient | null {
  const db = getDb()
  if (!db) return null
  const row = db.prepare('SELECT * FROM oauth_clients WHERE client_id = ?').get(client_id)
  return row ? (row as OAuthClient) : null
}

export function validateClientCredentials(client_id: string, client_secret: string): boolean {
  const client = getOAuthClient(client_id)
  return client !== null && client.client_secret === client_secret
}

// ============================================================
// Authorization code
// ============================================================

export function createAuthorizationCode(
  client_id: string,
  scopes: string,
  code_challenge: string,
  code_challenge_method: 'S256' = 'S256',
  redirect_uri: string = ''
): OAuthCode {
  const db = getDb()
  if (!db) throw new Error('数据库不可用')

  const code = generateCode()

  // 10 分钟有效期
  const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString()

  db.prepare(`
    INSERT INTO oauth_codes (code, client_id, scopes, code_challenge, code_challenge_method, redirect_uri, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(code, client_id, scopes, code_challenge, code_challenge_method, redirect_uri, expires_at)

  return getAuthorizationCode(code)!
}

export function getAuthorizationCode(code: string): OAuthCode | null {
  const db = getDb()
  if (!db) return null
  return db.prepare('SELECT * FROM oauth_codes WHERE code = ?').get(code) as OAuthCode | null
}

export function useAuthorizationCode(code: string, code_verifier: string): { valid: boolean; client_id?: string; scopes?: string; reason?: string } {
  const db = getDb()
  if (!db) return { valid: false, reason: '数据库不可用' }

  const authCode = db.prepare('SELECT * FROM oauth_codes WHERE code = ? AND used = 0').get(code) as OAuthCode | null

  if (!authCode) return { valid: false, reason: '无效或已使用的授权码' }

  // 检查过期
  if (new Date(authCode.expires_at).getTime() < Date.now()) {
    // 清理过期码
    db.prepare('UPDATE oauth_codes SET used = 2 WHERE code = ?').run(code)
    return { valid: false, reason: '授权码已过期' }
  }

  // 验证 PKCE code_verifier
  if (authCode.code_challenge_method === 'S256') {
    const challenge = computeS256Challenge(code_verifier)
    if (challenge !== authCode.code_challenge) {
      return { valid: false, reason: 'PKCE code_verifier 不匹配' }
    }
  }

  // 标记为已使用
  db.prepare('UPDATE oauth_codes SET used = 1 WHERE code = ?').run(code)

  return {
    valid: true,
    client_id: authCode.client_id,
    scopes: authCode.scopes,
  }
}

// ============================================================
// Token management
// ============================================================

export function issueToken(
  client_id: string,
  scopes: string,
  includeRefreshToken: boolean = false
): { access_token: string; refresh_token: string | null; expires_in: number } {
  const db = getDb()
  if (!db) throw new Error('数据库不可用')

  const access_token = generateToken(48)
  const refresh_token = includeRefreshToken ? generateToken(64) : null

  // access_token 1 小时, refresh_token 30 天
  const accessExpiresAt = new Date(Date.now() + 3600_000).toISOString()
  const refreshExpiresAt = includeRefreshToken
    ? new Date(Date.now() + 30 * 24 * 3600_000).toISOString()
    : null

  db.prepare(`
    INSERT INTO oauth_tokens (access_token, refresh_token, client_id, scopes, token_type, access_expires_at, refresh_expires_at)
    VALUES (?, ?, ?, ?, 'Bearer', ?, ?)
  `).run(access_token, refresh_token, client_id, scopes, accessExpiresAt, refreshExpiresAt)

  return { access_token, refresh_token, expires_in: 3600 }
}

export function validateAccessToken(token: string): { valid: boolean; client_id?: string; scopes?: string; reason?: string } {
  const db = getDb()
  if (!db) return { valid: false, reason: '数据库不可用' }

  const record = db.prepare(
    'SELECT * FROM oauth_tokens WHERE access_token = ? AND revoked_at IS NULL'
  ).get(token) as OAuthToken | null

  if (!record) return { valid: false, reason: '无效的 access_token' }
  if (new Date(record.access_expires_at).getTime() < Date.now()) {
    return { valid: false, reason: 'access_token 已过期' }
  }

  return { valid: true, client_id: record.client_id, scopes: record.scopes }
}

export function refreshAccessToken(refresh_token: string): { valid: boolean; access_token?: string; refresh_token?: string; expires_in?: number; reason?: string } {
  const db = getDb()
  if (!db) return { valid: false, reason: '数据库不可用' }

  const record = db.prepare(
    'SELECT * FROM oauth_tokens WHERE refresh_token = ? AND revoked_at IS NULL'
  ).get(refresh_token) as OAuthToken | null

  if (!record) return { valid: false, reason: '无效的 refresh_token' }
  if (record.refresh_expires_at && new Date(record.refresh_expires_at).getTime() < Date.now()) {
    return { valid: false, reason: 'refresh_token 已过期' }
  }

  // 撤销旧 access_token
  db.prepare("UPDATE oauth_tokens SET revoked_at = datetime('now') WHERE access_token = ?")
    .run(record.access_token)

  // 签发新 token（rotation: 同时换 refresh_token）
  const new_access = generateToken(48)
  const new_refresh = generateToken(64)
  const accessExpiresAt = new Date(Date.now() + 3600_000).toISOString()
  const refreshExpiresAt = new Date(Date.now() + 30 * 24 * 3600_000).toISOString()

  db.prepare(`
    INSERT INTO oauth_tokens (access_token, refresh_token, client_id, scopes, token_type, access_expires_at, refresh_expires_at)
    VALUES (?, ?, ?, ?, 'Bearer', ?, ?)
  `).run(new_access, new_refresh, record.client_id, record.scopes, accessExpiresAt, refreshExpiresAt)

  return { valid: true, access_token: new_access, refresh_token: new_refresh, expires_in: 3600 }
}

export function revokeToken(token: string): boolean {
  const db = getDb()
  if (!db) return false
  const result = db.prepare(
    "UPDATE oauth_tokens SET revoked_at = datetime('now') WHERE (access_token = ? OR refresh_token = ?) AND revoked_at IS NULL"
  ).run(token, token)
  return result.changes > 0
}

export function revokeAllClientTokens(client_id: string): number {
  const db = getDb()
  if (!db) return 0
  const result = db.prepare(
    "UPDATE oauth_tokens SET revoked_at = datetime('now') WHERE client_id = ? AND revoked_at IS NULL"
  ).run(client_id)
  return result.changes
}

// ============================================================
// Internal helpers
// ============================================================

function generateClientId(name: string): string {
  const sanitized = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const suffix = crypto.randomUUID().slice(0, 8)
  return `client_${sanitized}_${suffix}`
}

export { isFirstPartyAppName } from './firstParty'

function generateSecret(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map(b => chars[b % chars.length]).join('')
}

function generateCode(): string {
  return generateSecret() // 32-char random string
}

function generateToken(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map(b => chars[b % chars.length]).join('')
}

/**
 * SHA-256 + base64url 实现 PKCE S256 challenge
 *
 * 纯 JS 实现避免引入额外依赖。
 * 注意: Web Crypto API 在 Node.js 20+ 可用。
 */
function computeS256Challenge(verifier: string): string {
  const hash = require('crypto').createHash('sha256')
  hash.update(verifier)
  return hash.digest('base64url')
}

/** 清理过期数据（定期调用） */
export function cleanupExpired(): void {
  const db = getDb()
  if (!db) return

  const now = new Date().toISOString()

  db.prepare('UPDATE oauth_codes SET used = 2 WHERE used = 0 AND expires_at < ?').run(now)
  db.prepare("UPDATE oauth_tokens SET revoked_at = 'expired' WHERE revoked_at IS NULL AND access_expires_at < ? AND (refresh_expires_at IS NULL OR refresh_expires_at < ?)").run(now, now)
}

// ============================================================
// First-party client support
// ============================================================

export function markClientFirstParty(client_id: string): boolean {
  const db = getDb()
  if (!db) return false
  try {
    db.exec("ALTER TABLE oauth_clients ADD COLUMN first_party INTEGER DEFAULT 0")
  } catch { /* column exists */ }
  const result = db.prepare('UPDATE oauth_clients SET first_party = 1 WHERE client_id = ?').run(client_id)
  console.log(`[OAuth Store] markClientFirstParty: client_id=${client_id}, changes=${result.changes}`)
  return result.changes > 0
}

export function isClientFirstParty(client_id: string): boolean {
  const db = getDb()
  if (!db) return false
  try {
    const row = db.prepare('SELECT first_party FROM oauth_clients WHERE client_id = ?').get(client_id) as { first_party?: number } | undefined
    const isFirst = row?.first_party === 1
    console.log(`[OAuth Store] isClientFirstParty: client_id=${client_id}, row=${JSON.stringify(row)}, result=${isFirst}`)
    return isFirst
  } catch (err) {
    console.warn(`[OAuth Store] isClientFirstParty error: client_id=${client_id}`, err)
    return false
  }
}
