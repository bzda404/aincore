import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock dependencies
vi.mock('../store', () => ({
  registerOAuthClient: vi.fn(),
  getOAuthClient: vi.fn(),
  validateClientCredentials: vi.fn(),
  createAuthorizationCode: vi.fn(),
  useAuthorizationCode: vi.fn(),
  issueToken: vi.fn(),
  refreshAccessToken: vi.fn(),
  revokeToken: vi.fn(),
  revokeAllClientTokens: vi.fn(),
  validateAccessToken: vi.fn(),
}))

vi.mock('../../store/authDb', () => ({
  revokeAllAuthForApp: vi.fn(() => 2),
}))

vi.mock('../scopes', () => ({
  parseScopeString: vi.fn((str: string) => str.split(/\s+/).filter(Boolean)),
  formatScope: vi.fn((scopes: string[]) => scopes.join(' ')),
  validateScopes: vi.fn(() => ({ valid: true })),
}))

vi.mock('../consent', () => ({
  enqueueOAuthConsent: vi.fn(),
}))

import { registerOAuthRoutes } from '../server'
import {
  registerOAuthClient,
  getOAuthClient,
  validateClientCredentials,
  useAuthorizationCode,
  issueToken,
  refreshAccessToken,
  revokeToken,
  revokeAllClientTokens,
  validateAccessToken,
} from '../store'
import { validateScopes } from '../scopes'
import { enqueueOAuthConsent } from '../consent'
import { revokeAllAuthForApp } from '../../store/authDb'

describe('OAuth Server Routes', () => {
  const routes = new Map<string, (params: Record<string, unknown>) => Promise<unknown>>()

  beforeEach(() => {
    vi.clearAllMocks()
    routes.clear()
    const registerRoute = (method: string, _path: string, handler: any) => {
      routes.set(method, handler)
    }
    registerOAuthRoutes(registerRoute)
  })

  describe('oauth.register', () => {
    it('should return client_id and client_secret on success', async () => {
      const mockClient = {
        client_id: 'client_test-app_abc12345',
        client_secret: 'secret123',
        app_name: 'Test App',
        created_at: '2024-01-01T00:00:00.000Z',
      }
      vi.mocked(registerOAuthClient).mockReturnValue(mockClient as any)

      const handler = routes.get('oauth.register')!
      const result = await handler({ app_name: 'Test App', app_icon: '', app_vendor: 'Vendor' })

      expect(result).toEqual({
        client_id: mockClient.client_id,
        client_secret: mockClient.client_secret,
        app_name: mockClient.app_name,
        created_at: mockClient.created_at,
      })
      expect(registerOAuthClient).toHaveBeenCalledWith('Test App', '', 'Vendor', '')
    })

    it('should throw if app_name is missing', async () => {
      const handler = routes.get('oauth.register')!
      await expect(handler({})).rejects.toThrow('缺少必填参数: app_name')
    })

    it('should handle empty string app_name', async () => {
      const handler = routes.get('oauth.register')!
      await expect(handler({ app_name: '' })).rejects.toThrow('缺少必填参数: app_name')
    })
  })

  describe('oauth.authorize', () => {
    it('should validate client_id, scopes, and PKCE challenge', async () => {
      vi.mocked(getOAuthClient).mockReturnValue({
        client_id: 'client_test_123',
        app_name: 'Test App',
        app_icon: '',
      } as any)
      vi.mocked(validateScopes).mockReturnValue({ valid: true })
      vi.mocked(enqueueOAuthConsent).mockResolvedValue({
        code: 'auth_code_abc',
        state: 'csrf_state',
      })

      const handler = routes.get('oauth.authorize')!
      const result = await handler({
        client_id: 'client_test_123',
        scope: 'inference:read models:read',
        state: 'csrf_state',
        code_challenge: 'a'.repeat(43),
        code_challenge_method: 'S256',
      })

      expect(result).toEqual({
        authorization_code: 'auth_code_abc',
        expires_in: 600,
        state: 'csrf_state',
      })
    })

    it('should throw on invalid client_id', async () => {
      vi.mocked(getOAuthClient).mockReturnValue(null)

      const handler = routes.get('oauth.authorize')!
      await expect(
        handler({
          client_id: 'invalid',
          scope: 'inference:read',
          code_challenge: 'a'.repeat(43),
        }),
      ).rejects.toThrow('无效的 client_id')
    })

    it('should throw on invalid scopes', async () => {
      vi.mocked(getOAuthClient).mockReturnValue({ client_id: 'c' } as any)
      vi.mocked(validateScopes).mockReturnValue({ valid: false, reason: '未知作用域: bad' })

      const handler = routes.get('oauth.authorize')!
      await expect(
        handler({
          client_id: 'c',
          scope: 'bad',
          code_challenge: 'a'.repeat(43),
        }),
      ).rejects.toThrow('无效的作用域: 未知作用域: bad')
    })

    it('should throw on short code_challenge', async () => {
      vi.mocked(getOAuthClient).mockReturnValue({ client_id: 'c' } as any)
      vi.mocked(validateScopes).mockReturnValue({ valid: true })

      const handler = routes.get('oauth.authorize')!
      await expect(
        handler({
          client_id: 'c',
          scope: 'inference:read',
          code_challenge: 'short',
        }),
      ).rejects.toThrow('需要提供有效的 PKCE code_challenge')
    })

    it('should not include state in response if not provided', async () => {
      vi.mocked(getOAuthClient).mockReturnValue({ client_id: 'c', app_name: 'A', app_icon: '' } as any)
      vi.mocked(validateScopes).mockReturnValue({ valid: true })
      vi.mocked(enqueueOAuthConsent).mockResolvedValue({ code: 'code123' })

      const handler = routes.get('oauth.authorize')!
      const result = (await handler({
        client_id: 'c',
        scope: 'inference:read',
        code_challenge: 'a'.repeat(43),
      })) as Record<string, unknown>

      expect(result.authorization_code).toBe('code123')
      expect(result.state).toBeUndefined()
    })
  })

  describe('oauth.token', () => {
    it('should exchange authorization_code for tokens', async () => {
      vi.mocked(validateClientCredentials).mockReturnValue(true)
      vi.mocked(useAuthorizationCode).mockReturnValue({
        valid: true,
        client_id: 'client_1',
        scopes: 'inference:read offline_access',
      })
      vi.mocked(issueToken).mockReturnValue({
        access_token: 'at_123',
        refresh_token: 'rt_456',
        expires_in: 3600,
      })

      const handler = routes.get('oauth.token')!
      const result = await handler({
        grant_type: 'authorization_code',
        code: 'auth_code_1',
        code_verifier: 'verifier123',
        client_id: 'client_1',
        client_secret: 'secret_1',
      })

      expect(result).toEqual({
        access_token: 'at_123',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'rt_456',
        scope: 'inference:read offline_access',
      })
    })

    it('should throw on invalid client credentials', async () => {
      vi.mocked(validateClientCredentials).mockReturnValue(false)

      const handler = routes.get('oauth.token')!
      await expect(
        handler({
          grant_type: 'authorization_code',
          code: 'c',
          client_id: 'bad',
          client_secret: 'bad',
        }),
      ).rejects.toMatchObject({ error: 'invalid_client' })
    })

    it('should throw on invalid authorization code', async () => {
      vi.mocked(validateClientCredentials).mockReturnValue(true)
      vi.mocked(useAuthorizationCode).mockReturnValue({
        valid: false,
        reason: '无效或已使用的授权码',
      })

      const handler = routes.get('oauth.token')!
      await expect(
        handler({
          grant_type: 'authorization_code',
          code: 'expired',
          code_verifier: 'v',
          client_id: 'c',
          client_secret: 's',
        }),
      ).rejects.toThrow('无效的授权码')
    })

    it('should throw if code belongs to different client', async () => {
      vi.mocked(validateClientCredentials).mockReturnValue(true)
      vi.mocked(useAuthorizationCode).mockReturnValue({
        valid: true,
        client_id: 'other_client',
        scopes: 'inference:read',
      })

      const handler = routes.get('oauth.token')!
      await expect(
        handler({
          grant_type: 'authorization_code',
          code: 'code1',
          code_verifier: 'v',
          client_id: 'my_client',
          client_secret: 's',
        }),
      ).rejects.toThrow('授权码不属于此客户端')
    })

    it('should handle refresh_token grant type', async () => {
      vi.mocked(validateClientCredentials).mockReturnValue(true)
      vi.mocked(refreshAccessToken).mockReturnValue({
        valid: true,
        access_token: 'new_at',
        refresh_token: 'new_rt',
        expires_in: 3600,
      })

      const handler = routes.get('oauth.token')!
      const result = await handler({
        grant_type: 'refresh_token',
        refresh_token: 'old_rt',
        client_id: 'c',
        client_secret: 's',
      })

      expect(result).toEqual({
        access_token: 'new_at',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'new_rt',
      })
    })

    it('should throw on unsupported grant_type', async () => {
      vi.mocked(validateClientCredentials).mockReturnValue(true)

      const handler = routes.get('oauth.token')!
      await expect(
        handler({
          grant_type: 'client_credentials',
          client_id: 'c',
          client_secret: 's',
        }),
      ).rejects.toThrow('不支持的 grant_type: client_credentials')
    })
  })

  describe('oauth.revoke', () => {
    it('should revoke a token', async () => {
      vi.mocked(revokeToken).mockReturnValue(true)

      const handler = routes.get('oauth.revoke')!
      const result = await handler({ token: 'at_to_revoke' })

      expect(result).toEqual({ revoked: true })
      expect(revokeToken).toHaveBeenCalledWith('at_to_revoke')
    })

    it('should throw if token is missing', async () => {
      const handler = routes.get('oauth.revoke')!
      await expect(handler({})).rejects.toThrow('缺少必填参数: token')
    })

    it('should return false if token not found', async () => {
      vi.mocked(revokeToken).mockReturnValue(false)

      const handler = routes.get('oauth.revoke')!
      const result = await handler({ token: 'unknown_token' })

      expect(result).toEqual({ revoked: false })
    })
  })

  describe('oauth.revoke_client', () => {
    it('should revoke all client tokens and grants', async () => {
      vi.mocked(validateClientCredentials).mockReturnValue(true)
      vi.mocked(revokeAllClientTokens).mockReturnValue(5)
      vi.mocked(revokeAllAuthForApp).mockReturnValue(2)

      const handler = routes.get('oauth.revoke_client')!
      const result = await handler({ client_id: 'c1', client_secret: 'sec' })

      expect(result).toEqual({ success: true, revoked_tokens: 5, revoked_grants: 2 })
    })

    it('should throw on invalid credentials', async () => {
      vi.mocked(validateClientCredentials).mockReturnValue(false)

      const handler = routes.get('oauth.revoke_client')!
      await expect(handler({ client_id: 'bad', client_secret: 'bad' })).rejects.toThrow(
        '无效的客户端凭证',
      )
    })
  })

  describe('oauth.introspect', () => {
    it('should return active token info', async () => {
      vi.mocked(validateAccessToken).mockReturnValue({
        valid: true,
        client_id: 'client_x',
        scopes: 'inference:read models:read',
      })

      const handler = routes.get('oauth.introspect')!
      const result = await handler({ token: 'valid_at' })

      expect(result).toEqual({
        active: true,
        client_id: 'client_x',
        scope: 'inference:read models:read',
        token_type: 'Bearer',
      })
    })

    it('should return active: false for invalid token', async () => {
      vi.mocked(validateAccessToken).mockReturnValue({ valid: false, reason: 'expired' })

      const handler = routes.get('oauth.introspect')!
      const result = await handler({ token: 'expired_at' })

      expect(result).toEqual({ active: false })
    })

    it('should throw if token is missing', async () => {
      const handler = routes.get('oauth.introspect')!
      await expect(handler({})).rejects.toThrow('缺少必填参数: token')
    })
  })
})
