import { isAbsolute, relative, resolve } from 'path'
import { listAuthorizations, validateSession, type KbPermissionScope } from '../store/authDb'
import { validateAccessToken } from '../oauth/store'
import { parseScopeString, scopeCovers, type Scope } from '../oauth/scopes'

export type AuthKind = 'session' | 'oauth'

export type AccessDecision = 'grant' | 'deny' | 'rate-limited'

export interface AccessLogEntry {
  timestamp: string
  client_id: string
  method: string
  decision: AccessDecision
  reason: string
}

// Ring buffer for recent access decisions
const ACCESS_LOG_MAX = 500
const accessLog: AccessLogEntry[] = []

/**
 * Log a structured access decision
 */
export function logAccessDecision(
  clientId: string,
  method: string,
  decision: AccessDecision,
  reason: string = ''
): void {
  const entry: AccessLogEntry = {
    timestamp: new Date().toISOString(),
    client_id: clientId,
    method,
    decision,
    reason,
  }
  accessLog.push(entry)
  if (accessLog.length > ACCESS_LOG_MAX) {
    accessLog.shift()
  }
  // Console log for observability
  console.log(`[Access] ${decision.toUpperCase()} client=${clientId} method=${method}${reason ? ` reason=${reason}` : ''}`)
}

/**
 * Retrieve recent access log entries
 */
export function getAccessLog(limit: number = 50): AccessLogEntry[] {
  return accessLog.slice(-limit)
}

export interface AuthContext {
  kind: AuthKind
  token: string
  app_id: string
  scopes: Scope[]
}

export function getRequestToken(params?: Record<string, unknown>): string {
  return String(params?.access_token || params?.session_token || '')
}

export function resolveAuthContext(params?: Record<string, unknown>): AuthContext {
  const token = getRequestToken(params)
  if (!token) {
    throw new Error('未授权：需要 access_token。请先完成 OAuth 授权。')
  }

  const oauth = validateAccessToken(token)
  if (oauth.valid && oauth.client_id) {
    logAccessDecision(oauth.client_id, 'resolveAuth', 'grant', 'valid OAuth token')
    return {
      kind: 'oauth',
      token,
      app_id: oauth.client_id,
      scopes: parseScopeString(oauth.scopes || ''),
    }
  }

  const session = validateSession(token)
  if (session.valid && session.app_id) {
    logAccessDecision(session.app_id, 'resolveAuth', 'grant', 'valid session token')
    return {
      kind: 'session',
      token,
      app_id: session.app_id,
      scopes: [],
    }
  }

  const reason = oauth.reason || session.reason || '无效的访问令牌'
  logAccessDecision('unknown', 'resolveAuth', 'deny', reason)
  throw new Error(reason)
}

export function requireScope(ctx: AuthContext, required: Scope): void {
  if (ctx.kind === 'session') return
  if (!scopeCovers(ctx.scopes, required)) {
    logAccessDecision(ctx.app_id, `scope:${required}`, 'deny', `missing scope ${required}`)
    throw new Error(`未授权：缺少 OAuth 作用域 ${required}`)
  }
}

export function scopeAllows(actual: KbPermissionScope | null | undefined, required: KbPermissionScope): boolean {
  const normalized = actual || 'read'
  if (required === 'read') return normalized === 'read' || normalized === 'read_write'
  return normalized === 'read_write'
}

export function isPathInside(root: string, pathname: string): boolean {
  const resolvedRoot = resolve(root)
  const resolvedPath = resolve(pathname)
  const rel = relative(resolvedRoot, resolvedPath)
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel))
}

export function getGrantedKbRoots(ctx: AuthContext, requiredScope: KbPermissionScope = 'read'): string[] {
  const requiredOAuthScope: Scope = requiredScope === 'read_write' ? 'knowledge:write' : 'knowledge:read'
  requireScope(ctx, requiredOAuthScope)
  return listAuthorizations(ctx.app_id, true)
    .filter(auth => auth.kb_path && scopeAllows(auth.scope, requiredScope))
    .map(auth => resolve(auth.kb_path!))
}

export function hasModelGrant(ctx: AuthContext, modelName?: string): boolean {
  requireScope(ctx, 'inference:read')
  const auths = listAuthorizations(ctx.app_id, true)
  return auths.some(auth => {
    if (!auth.model_name) return true
    return !modelName || auth.model_name === modelName
  })
}
