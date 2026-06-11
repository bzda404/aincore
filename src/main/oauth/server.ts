/**
 * OAuth 2.0 Server — 本地 UDS JSON-RPC 上的 OAuth 端点
 *
 * 在 AinCore 的 UDS 服务器上挂载以下 JSON-RPC 方法:
 *
 *   oauth.register     — 注册 OAuth 客户端，返回 client_id + client_secret
 *   oauth.authorize    — 发起授权请求，返回 authorization_code（PKCE）
 *   oauth.token        — 用 authorization_code 换取 access_token
 *   oauth.refresh      — 用 refresh_token 刷新 access_token
 *   oauth.revoke       — 撤销 token
 *   oauth.introspect   — 校验 access_token 并返回元数据
 *
 * 所有端点遵循 OAuth 2.0 RFC 6749 + PKCE RFC 7636。
 */
import {
  registerOAuthClient,
  getOAuthClient,
  validateClientCredentials,
  createAuthorizationCode,
  useAuthorizationCode,
  issueToken,
  refreshAccessToken,
  revokeToken,
  revokeAllClientTokens,
  validateAccessToken,
} from './store'
import { revokeAllAuthForApp } from '../store/authDb'
import {
  parseScopeString,
  formatScope,
  validateScopes,
  type Scope,
} from './scopes'
import { enqueueOAuthConsent } from './consent'

type RegisterRoute = (
  method: string,
  path: string,
  handler: (params: Record<string, unknown>) => Promise<unknown>
) => void

// ============================================================
// Brute-force protection for token endpoint
// ============================================================
const tokenFailures = new Map<string, { count: number; cooldownUntil: number }>()
const MAX_TOKEN_FAILURES = 5
const COOLDOWN_MS = 30_000

function checkBruteForce(clientId: string): void {
  const record = tokenFailures.get(clientId)
  if (record && record.cooldownUntil > Date.now()) {
    const remainingSec = Math.ceil((record.cooldownUntil - Date.now()) / 1000)
    throw new Error(`客户端已被临时锁定，请 ${remainingSec} 秒后重试`)
  }
}

function recordTokenFailure(clientId: string): void {
  const record = tokenFailures.get(clientId) || { count: 0, cooldownUntil: 0 }
  record.count++
  if (record.count >= MAX_TOKEN_FAILURES) {
    record.cooldownUntil = Date.now() + COOLDOWN_MS
    record.count = 0 // Reset count after applying cooldown
  }
  tokenFailures.set(clientId, record)
}

function clearTokenFailures(clientId: string): void {
  tokenFailures.delete(clientId)
}

/**
 * 在 UDS 服务器上注册所有 OAuth 2.0 路由
 */
export function registerOAuthRoutes(registerRoute: RegisterRoute): void {
  // ==================================================================
  // oauth.register — 注册 OAuth 客户端
  // ==================================================================
  registerRoute('oauth.register', '', async(params) => {
    const appName = typeof params.app_name === 'string' ? params.app_name : ''
    const appIcon = typeof params.app_icon === 'string' ? params.app_icon : ''
    const appVendor = typeof params.app_vendor === 'string' ? params.app_vendor : ''
    const redirectUri = typeof params.redirect_uri === 'string' ? params.redirect_uri : ''

    if (!appName) {
      throw new Error('缺少必填参数: app_name')
    }

    const client = registerOAuthClient(appName, appIcon, appVendor, redirectUri)

    return {
      client_id: client.client_id,
      client_secret: client.client_secret,
      app_name: client.app_name,
      created_at: client.created_at,
    }
  })

  // ==================================================================
  // oauth.authorize — 授权端点（发起授权码流程）
  //
  // 参数:
  //   client_id           - 客户端ID
  //   scope               - 请求的作用域（空格分隔）
  //   state               - 防 CSRF 状态值（可选，原样返回）
  //   code_challenge      - PKCE S256 code challenge（base64url）
  //   code_challenge_method - "S256"（默认）
  //   redirect_uri        - 重定向 URI（可选）
  //
  // 返回:
  //   authorization_code  - 授权码（一次性，10 分钟有效）
  //   state               - 回显 state
  // ==================================================================
  registerRoute('oauth.authorize', '', async(params) => {
    const clientId = typeof params.client_id === 'string' ? params.client_id : ''
    const scopeStr = typeof params.scope === 'string' ? params.scope : ''
    const state = typeof params.state === 'string' ? params.state : undefined
    const codeChallenge = typeof params.code_challenge === 'string' ? params.code_challenge : ''
    const codeChallengeMethod = (typeof params.code_challenge_method === 'string' && params.code_challenge_method === 'S256')
      ? 'S256' as const
      : 'S256' as const
    const redirectUri = typeof params.redirect_uri === 'string' ? params.redirect_uri : ''

    // 1. 校验 client_id
    const client = getOAuthClient(clientId)
    if (!client) {
      throw new Error('无效的 client_id')
    }

    // 2. 校验作用域
    const scopes = parseScopeString(scopeStr)
    const scopeValidation = validateScopes(scopes)
    if (!scopeValidation.valid) {
      throw new Error(`无效的作用域: ${scopeValidation.reason}`)
    }

    // 3. 校验 PKCE challenge
    if (!codeChallenge || codeChallenge.length < 43) {
      throw new Error('需要提供有效的 PKCE code_challenge (S256, min 43 chars)')
    }

    // 4. 用户批准 — 通过 consent queue 弹出授权窗口
    // 用户在 Core 管理界面中看到作用域列表，确认/拒绝后才继续
    const result = await enqueueOAuthConsent(
      clientId,
      client.app_name,
      client.app_icon,
      formatScope(scopes),
      codeChallenge,
      codeChallengeMethod,
      state,
    )

    const response: Record<string, unknown> = {
      authorization_code: result.code,
      expires_in: 600,
    }

    if (result.state !== undefined) {
      response.state = result.state
    }

    return response
  })

  // ==================================================================
  // oauth.token — 令牌端点（用授权码换取 access_token）
  //
  // 参数:
  //   grant_type     - "authorization_code" | "refresh_token"
  //   code           - 授权码（grant_type=authorization_code 时需要）
  //   code_verifier  - PKCE code verifier
  //   client_id      - 客户端ID
  //   client_secret  - 客户端密钥
  //   refresh_token  - 刷新令牌（grant_type=refresh_token 时需要）
  // ==================================================================
  registerRoute('oauth.token', '', async(params) => {
    const grantType = typeof params.grant_type === 'string' ? params.grant_type : ''
    const clientId = typeof params.client_id === 'string' ? params.client_id : ''
    const clientSecret = typeof params.client_secret === 'string' ? params.client_secret : ''

    // Brute-force protection: check cooldown before validating credentials
    checkBruteForce(clientId)

    // 校验 client credentials
    if (!validateClientCredentials(clientId, clientSecret)) {
      recordTokenFailure(clientId)
      // eslint-disable-next-line no-throw-literal
      throw { error: 'invalid_client', error_description: '无效的客户端凭证' }
    }

    if (grantType === 'authorization_code') {
      const code = typeof params.code === 'string' ? params.code : ''
      const codeVerifier = typeof params.code_verifier === 'string' ? params.code_verifier : ''

      if (!code) {
        recordTokenFailure(clientId)
        throw new Error('缺少必填参数: code')
      }

      const result = useAuthorizationCode(code, codeVerifier)
      if (!result.valid || !result.client_id || !result.scopes) {
        recordTokenFailure(clientId)
        throw new Error(`无效的授权码: ${result.reason}`)
      }

      if (result.client_id !== clientId) {
        recordTokenFailure(clientId)
        throw new Error('授权码不属于此客户端')
      }

      // Clear failure record on success
      clearTokenFailures(clientId)

      // 包含 offline_access 作用域才签发 refresh_token
      const scopes = parseScopeString(result.scopes)
      const includeRefresh = scopes.includes('offline_access')

      const token = issueToken(clientId, result.scopes, includeRefresh)

      return {
        access_token: token.access_token,
        token_type: 'Bearer',
        expires_in: token.expires_in,
        refresh_token: token.refresh_token || undefined,
        scope: result.scopes,
      }
    }

    if (grantType === 'refresh_token') {
      const refreshToken = typeof params.refresh_token === 'string' ? params.refresh_token : ''

      if (!refreshToken) {
        recordTokenFailure(clientId)
        throw new Error('缺少必填参数: refresh_token')
      }

      const result = refreshAccessToken(refreshToken)
      if (!result.valid) {
        recordTokenFailure(clientId)
        throw new Error(`无效的 refresh_token: ${result.reason}`)
      }

      // Clear failure record on success
      clearTokenFailures(clientId)

      return {
        access_token: result.access_token,
        token_type: 'Bearer',
        expires_in: result.expires_in,
        refresh_token: result.refresh_token,
      }
    }

    throw new Error(`不支持的 grant_type: ${grantType}`)
  })

  // ==================================================================
  // oauth.revoke — 撤销令牌
  // ==================================================================
  registerRoute('oauth.revoke', '', async(params) => {
    const token = typeof params.token === 'string' ? params.token : ''

    if (!token) {
      throw new Error('缺少必填参数: token')
    }

    const revoked = revokeToken(token)

    return { revoked }
  })

  registerRoute('oauth.revoke_client', '', async(params) => {
    const clientId = typeof params.client_id === 'string' ? params.client_id : ''
    const clientSecret = typeof params.client_secret === 'string' ? params.client_secret : ''

    if (!validateClientCredentials(clientId, clientSecret)) {
      throw new Error('无效的客户端凭证')
    }

    const revokedTokens = revokeAllClientTokens(clientId)
    const revokedGrants = revokeAllAuthForApp(clientId)
    return { success: true, revoked_tokens: revokedTokens, revoked_grants: revokedGrants }
  })

  // ==================================================================
  // oauth.introspect — 令牌内省（验证 token 并返回元数据）
  //
  // 参数:
  //   token — access_token
  //
  // 返回:
  //   active: boolean     — token 是否有效
  //   client_id?: string  — 所属客户端
  //   scope?: string      — 作用域
  // ==================================================================
  registerRoute('oauth.introspect', '', async(params) => {
    const token = typeof params.token === 'string' ? params.token : ''

    if (!token) {
      throw new Error('缺少必填参数: token')
    }

    const result = validateAccessToken(token)

    if (!result.valid) {
      return { active: false }
    }

    return {
      active: true,
      client_id: result.client_id,
      scope: result.scopes,
      token_type: 'Bearer',
    }
  })
}
