/**
 * UDS JSON-RPC 服务器 — AinCore 的核心通信层。
 * 外部应用和 AinCore Notes 都通过本地 socket 发送 JSON-RPC 消息。
 */
import { createServer, type Server, type Socket } from 'net'
import { unlinkSync, existsSync, chmodSync } from 'fs'
import { platform } from 'os'
import { isAbsolute } from 'path'
import { registerHealthRoutes } from './health'
import { registerOpenAIRoutes } from './openai'
import { registerModelRoutes } from './models'
import { registerAuthRoutes } from './auth'
import { registerKnowledgeRoutes } from './knowledge'
import { registerOAuthRoutes } from '../oauth/server'
import { registerProfileRoutes } from './profile'
import { getPeerCredentials, type PeerCredentials } from '../peerAuth'
import { SOCKET_PATH } from './transport'
import { logAccessDecision } from './access'
import {
  JsonRpcErrorCode,
  buildJsonRpcError,
  ErrorCode,
  AinCoreError,
} from '../../shared/errorCodes'
import { validateParams } from './validation'

// ============================================================
// Token Bucket Rate Limiter
// ============================================================

class TokenBucketRateLimiter {
  private buckets = new Map<string, { tokens: number; lastRefill: number }>()
  private maxTokens: number
  private refillRate: number // tokens per millisecond

  constructor(
    requestsPerMinute: number = Number(process.env.AINCORE_RATE_LIMIT_RPM) || 100,
    burstSize: number = Number(process.env.AINCORE_RATE_LIMIT_BURST) || 20
  ) {
    this.maxTokens = burstSize
    this.refillRate = requestsPerMinute / 60_000 // per ms
  }

  consume(clientId: string): boolean {
    const now = Date.now()
    let bucket = this.buckets.get(clientId)

    if (!bucket) {
      bucket = { tokens: this.maxTokens, lastRefill: now }
      this.buckets.set(clientId, bucket)
    }

    // Refill tokens based on elapsed time
    const elapsed = now - bucket.lastRefill
    bucket.tokens = Math.min(this.maxTokens, bucket.tokens + elapsed * this.refillRate)
    bucket.lastRefill = now

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1
      return true
    }

    return false
  }

  // Periodic cleanup of stale buckets (called every 5 minutes)
  cleanup(): void {
    const now = Date.now()
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.lastRefill > 300_000) {
        this.buckets.delete(key)
      }
    }
  }
}

const rateLimiter = new TokenBucketRateLimiter()
let rateLimiterCleanupTimer: ReturnType<typeof setInterval> | null = null

// Methods exempt from rate limiting
const RATE_LIMIT_EXEMPT = new Set(['GET:/health', 'app.ping'])

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number | string
  method: string
  params?: Record<string, unknown>
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number | string | null
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

let udsServer: Server | null = null
const connectedClients = new Set<Socket>()
const clientCredentials = new Map<Socket, PeerCredentials | null>()

// Route handlers stored as either JSON-RPC method or method:path.
type RouteHandler = (params: Record<string, unknown>) => Promise<unknown>
const routes = new Map<string, RouteHandler>()

const routeKey = (method: string, path: string): string => path ? `${method}:${path}` : method

/**
 * 注册路由（兼容原有 Express 路由风格）
 */
export function registerRoute(method: string, path: string, handler: RouteHandler): void {
  routes.set(routeKey(method, path), handler)
}

/**
 * 启动 UDS 服务器
 */
export async function startServer(): Promise<void> {
  // 注册所有路由
  registerHealthRoutes(registerRoute)
  registerOpenAIRoutes(registerRoute)
  registerModelRoutes(registerRoute)
  registerAuthRoutes(registerRoute)
  registerKnowledgeRoutes(registerRoute)
  registerOAuthRoutes(registerRoute)
  registerProfileRoutes(registerRoute)

  return new Promise((resolve, reject) => {
    // 清理旧的 socket 文件
    if (platform() !== 'win32' && existsSync(SOCKET_PATH)) {
      unlinkSync(SOCKET_PATH)
    }

    // Start rate limiter cleanup timer
    rateLimiterCleanupTimer = setInterval(() => rateLimiter.cleanup(), 300_000)

    udsServer = createServer((socket) => {
      connectedClients.add(socket)

      // Resolve peer credentials on connection
      clientCredentials.set(socket, getPeerCredentials(socket as { _handle?: { fd?: number } }))

      let buffer = ''

      socket.on('data', async(data) => {
        buffer += data.toString()

        // 按换行符分割 JSON-RPC 消息
        const messages = buffer.split('\n')
        buffer = messages.pop() || ''

        for (const msg of messages) {
          if (!msg.trim()) continue

          let request: JsonRpcRequest
          try {
            request = JSON.parse(msg)
          } catch {
            socket.write(JSON.stringify({
              jsonrpc: '2.0',
              id: null,
              error: { code: -32700, message: 'Parse error' },
            } as JsonRpcResponse) + '\n')
            continue
          }

          // Rate limiting (exempt health checks)
          if (!RATE_LIMIT_EXEMPT.has(request.method)) {
            const clientId = (request.params as Record<string, unknown> | undefined)?.client_id as string
              || clientCredentials.get(socket)?.uid?.toString()
              || socket.remoteAddress
              || 'unknown'
            if (!rateLimiter.consume(clientId)) {
              const response = buildJsonRpcError(
                JsonRpcErrorCode.RATE_LIMITED,
                'Too Many Requests',
                ErrorCode.RATE_LIMITED,
                request.id,
              )
              socket.write(JSON.stringify(response) + '\n')
              logAccessDecision(clientId, request.method, 'rate-limited', 'token bucket exhausted')
              continue
            }
          }

          try {
            const result = await handleJsonRpcRequest(request)
            const response: JsonRpcResponse = {
              jsonrpc: '2.0',
              id: request.id,
              result,
            }
            socket.write(JSON.stringify(response) + '\n')
          } catch (err) {
            const errCode = err instanceof AinCoreError ? err.code : ErrorCode.UNKNOWN
            const errMsg = err instanceof Error ? err.message : String(err)
            const response = buildJsonRpcError(
              JsonRpcErrorCode.INTERNAL_ERROR,
              errMsg,
              errCode,
              request.id,
            )
            socket.write(JSON.stringify(response) + '\n')
          }
        }
      })

      socket.on('close', () => {
        connectedClients.delete(socket)
        clientCredentials.delete(socket)
      })

      socket.on('error', () => {
        connectedClients.delete(socket)
        clientCredentials.delete(socket)
      })
    })

    udsServer.listen(SOCKET_PATH, () => {
      // Restrict socket permissions to current user only
      if (platform() !== 'win32') {
        try { chmodSync(SOCKET_PATH, 0o600) } catch { /* best effort */ }
      }
      console.log(`[AinCore] UDS 服务器监听 ${SOCKET_PATH}`)
      resolve()
    })

    udsServer.on('error', reject)
  })
}

/**
 * 停止 UDS 服务器
 */
export async function stopServer(): Promise<void> {
  if (rateLimiterCleanupTimer) {
    clearInterval(rateLimiterCleanupTimer)
    rateLimiterCleanupTimer = null
  }

  return new Promise((resolve) => {
    if (udsServer) {
      for (const client of connectedClients) {
        client.destroy()
      }
      connectedClients.clear()
      udsServer.close(() => {
        if (platform() !== 'win32' && existsSync(SOCKET_PATH)) {
          unlinkSync(SOCKET_PATH)
        }
        udsServer = null
        resolve()
      })
    } else {
      resolve()
    }
  })
}

import { checkKbPermission, checkModelPermission, listActiveAuthorizationsForApp } from '../store/authDb'
import { hasModelGrant, requireScope, resolveAuthContext } from './access'

// Routes that require model permission
const MODEL_PROTECTED_METHODS = new Set([
  'chat.completions',
  'completions',
  'POST:/v1/chat/completions',
  'POST:/v1/completions',
  'models.list',
  'models.load',
  'models.unload',
])

const MODEL_READ_METHODS = new Set([
  'models.list',
])

const MODEL_MANAGE_METHODS = new Set([
  'models.load',
  'models.unload',
])

// Routes that require KB permission
const KB_PROTECTED_METHODS = new Set([
  'search_notes',
  'read_note',
  'list_notes',
  'write_note',
  'get_context',
])

// Routes that are always public (no session token needed)
// OAuth methods use their own client authentication
const PUBLIC_METHODS = new Set([
  'app.ping',
  'app.register',
  'app.request_auth',
  'oauth.register',
  'oauth.authorize',
  'oauth.token',
  'oauth.revoke',
  'oauth.revoke_client',
  'oauth.introspect',
  'profile.get',
  'profile.update',
  'GET:/health',
  'GET:/version',
  'status',
])

const isInternalMethod = (method: string): boolean => method.startsWith('internal.')

/**
 * 路由分发（带授权校验）
 */
export async function handleJsonRpcRequest(request: JsonRpcRequest): Promise<unknown> {
  const { method, params } = request

  // Validate input params against Zod schemas
  const validatedParams = validateParams(method, params || {})

  // 尝试匹配已注册的路由
  const handler = routes.get(method)
  const openaiHandler = routes.get(`POST:${method}`)
  const effectiveHandler = handler || openaiHandler

  if (!effectiveHandler) {
    throw new AinCoreError(
      ErrorCode.METHOD_NOT_FOUND,
      `Unknown method: ${method}`,
    )
  }

  // Public routes and built-in desktop-client routes do not use app sessions.
  // Third-party callers must keep using the public, token-protected methods.
  if (PUBLIC_METHODS.has(method) || isInternalMethod(method)) {
    return effectiveHandler(validatedParams)
  }

  // Auth-protected routes — prefer OAuth access_token, keep session_token for legacy clients.
  const token = String(validatedParams.access_token || validatedParams.session_token || '')

  // Only enforce if the route is listed as protected
  const needsModelAuth = MODEL_PROTECTED_METHODS.has(method)
  const needsKbAuth = KB_PROTECTED_METHODS.has(method)

  if (needsModelAuth || needsKbAuth) {
    const session = resolveAuthContext(validatedParams)

    // Check model permission
    if (needsModelAuth) {
      if (MODEL_READ_METHODS.has(method)) requireScope(session, 'models:read')
      else if (MODEL_MANAGE_METHODS.has(method)) requireScope(session, 'models:manage')
      else requireScope(session, 'inference:read')

      // Extract model name from params if specified
      const modelName = validatedParams['model'] as string | undefined
      if (session.kind === 'oauth') {
        if (!hasModelGrant(session, modelName)) {
          throw new AinCoreError(
            ErrorCode.MODEL_NOT_AUTHORIZED,
            modelName ? `应用未授权使用模型 ${modelName}` : '未授权：此应用没有任何模型使用权限',
          )
        }
      } else if (modelName) {
        const perm = checkModelPermission(token, modelName)
        if (!perm.allowed) throw new AinCoreError(
          ErrorCode.MODEL_NOT_AUTHORIZED,
          perm.reason || '未授权使用该模型',
        )
      } else {
        // If no specific model, just check they have some model auth
        const grants = listActiveAuthorizationsForApp(session.app_id)
        if (grants.models.length === 0) {
          throw new AinCoreError(
            ErrorCode.MODEL_NOT_AUTHORIZED,
            '未授权：此应用没有任何模型使用权限',
          )
        }
      }
    }

    // Check KB permission
    if (needsKbAuth) {
      requireScope(session, method === 'write_note' ? 'knowledge:write' : 'knowledge:read')
      const kbPath = validatedParams['path'] as string | undefined ||
        validatedParams['kb'] as string | undefined
      if (kbPath && isAbsolute(kbPath)) {
        const requiredScope = method === 'write_note' ? 'read_write' : 'read'
        const perm = session.kind === 'session' ? checkKbPermission(token, kbPath, requiredScope) : { allowed: true }
        if (!perm.allowed) throw new AinCoreError(
          ErrorCode.KB_NOT_AUTHORIZED,
          perm.reason || '未授权访问该知识库',
        )
      }
      // If no specific path, check they have some KB auth
      const grants = listActiveAuthorizationsForApp(session.app_id)
      if (grants.kb_paths.length === 0) {
        throw new AinCoreError(
          ErrorCode.KB_NOT_AUTHORIZED,
          '未授权：此应用没有任何知识库访问权限',
        )
      }
    }
  }

  return effectiveHandler(validatedParams)
}

export function getConnectedClientCount(): number {
  return connectedClients.size
}

export { SOCKET_PATH }
