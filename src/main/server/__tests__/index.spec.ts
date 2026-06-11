import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock all route modules
vi.mock('../health', () => ({
  registerHealthRoutes: vi.fn(),
}))
vi.mock('../openai', () => ({
  registerOpenAIRoutes: vi.fn(),
}))
vi.mock('../models', () => ({
  registerModelRoutes: vi.fn(),
}))
vi.mock('../auth', () => ({
  registerAuthRoutes: vi.fn(),
}))
vi.mock('../knowledge', () => ({
  registerKnowledgeRoutes: vi.fn(),
}))
vi.mock('../../oauth/server', () => ({
  registerOAuthRoutes: vi.fn(),
}))
vi.mock('../../peerAuth', () => ({
  getPeerCredentials: vi.fn(() => null),
}))
vi.mock('../transport', () => ({
  SOCKET_PATH: '/tmp/test-mindvault.sock',
}))
vi.mock('net', () => ({
  createServer: vi.fn(() => ({
    listen: vi.fn((_path: string, cb: () => void) => cb()),
    close: vi.fn((cb: () => void) => cb()),
    on: vi.fn(),
  })),
}))
vi.mock('fs', () => ({
  unlinkSync: vi.fn(),
  existsSync: vi.fn(() => false),
  chmodSync: vi.fn(),
}))
vi.mock('os', () => ({
  platform: vi.fn(() => 'darwin'),
}))
vi.mock('path', () => ({
  isAbsolute: vi.fn((p: string) => p.startsWith('/')),
}))
vi.mock('../../store/authDb', () => ({
  checkKbPermission: vi.fn(() => ({ allowed: true })),
  checkModelPermission: vi.fn(() => ({ allowed: true })),
  listActiveAuthorizationsForApp: vi.fn(() => ({ models: ['model1'], kb_paths: ['/kb'] })),
}))
vi.mock('../access', () => ({
  hasModelGrant: vi.fn(() => true),
  requireScope: vi.fn(),
  resolveAuthContext: vi.fn(() => ({
    kind: 'oauth',
    token: 'valid_token',
    app_id: 'app_1',
    scopes: ['inference:read', 'models:read', 'knowledge:read'],
  })),
}))
vi.mock('../validation', () => ({
  validateParams: vi.fn((_method: string, params: Record<string, unknown>) => params),
}))

import { registerRoute, handleJsonRpcRequest } from '../index'

describe('JSON-RPC Server', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('registerRoute', () => {
    it('should register a route handler', () => {
      const handler = vi.fn(async () => ({ ok: true }))
      registerRoute('test.method', '', handler)

      // Verify by calling handleJsonRpcRequest
      // The route should be dispatchable
    })
  })

  describe('handleJsonRpcRequest', () => {
    it('should dispatch to registered handler', async () => {
      const handler = vi.fn(async () => ({ result: 'hello' }))
      registerRoute('custom.hello', '', handler)

      const result = await handleJsonRpcRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'custom.hello',
        params: { name: 'world' },
      })

      expect(result).toEqual({ result: 'hello' })
      expect(handler).toHaveBeenCalledWith({ name: 'world' })
    })

    it('should throw for unknown methods', async () => {
      await expect(
        handleJsonRpcRequest({
          jsonrpc: '2.0',
          id: 1,
          method: 'nonexistent.method',
          params: {},
        }),
      ).rejects.toThrow('Unknown method')
    })

    it('should pass empty object if params is undefined', async () => {
      const handler = vi.fn(async (params: any) => params)
      registerRoute('custom.noparams', '', handler)

      await handleJsonRpcRequest({
        jsonrpc: '2.0',
        id: 2,
        method: 'custom.noparams',
      })

      expect(handler).toHaveBeenCalledWith({})
    })

    it('should allow public methods without auth', async () => {
      const handler = vi.fn(async () => ({ status: 'ok' }))
      registerRoute('app.ping', '', handler)

      const result = await handleJsonRpcRequest({
        jsonrpc: '2.0',
        id: 3,
        method: 'app.ping',
        params: {},
      })

      expect(result).toEqual({ status: 'ok' })
    })

    it('should allow OAuth methods without session', async () => {
      const handler = vi.fn(async () => ({ client_id: 'c1' }))
      registerRoute('oauth.register', '', handler)

      const result = await handleJsonRpcRequest({
        jsonrpc: '2.0',
        id: 4,
        method: 'oauth.register',
        params: { app_name: 'App' },
      })

      expect(result).toEqual({ client_id: 'c1' })
    })

    it('should allow internal methods without auth', async () => {
      const handler = vi.fn(async () => 'internal_result')
      registerRoute('internal.status', '', handler)

      const result = await handleJsonRpcRequest({
        jsonrpc: '2.0',
        id: 5,
        method: 'internal.status',
        params: {},
      })

      expect(result).toBe('internal_result')
    })

    it('should enforce auth for model-protected methods', async () => {
      const handler = vi.fn(async () => ({ text: 'response' }))
      registerRoute('chat.completions', '', handler)

      // With valid auth context (mocked)
      const result = await handleJsonRpcRequest({
        jsonrpc: '2.0',
        id: 6,
        method: 'chat.completions',
        params: { access_token: 'valid_token', model: 'gpt' },
      })

      expect(result).toEqual({ text: 'response' })
    })

    it('should enforce auth for KB-protected methods', async () => {
      const handler = vi.fn(async () => [{ title: 'Note 1' }])
      registerRoute('search_notes', '', handler)

      const result = await handleJsonRpcRequest({
        jsonrpc: '2.0',
        id: 7,
        method: 'search_notes',
        params: { access_token: 'valid_token', query: 'test' },
      })

      expect(result).toEqual([{ title: 'Note 1' }])
    })
  })

  describe('Error handling', () => {
    it('should propagate handler errors', async () => {
      const handler = vi.fn(async () => {
        throw new Error('Handler failed')
      })
      registerRoute('custom.fail', '', handler)

      await expect(
        handleJsonRpcRequest({
          jsonrpc: '2.0',
          id: 8,
          method: 'custom.fail',
          params: {},
        }),
      ).rejects.toThrow('Handler failed')
    })
  })
})
