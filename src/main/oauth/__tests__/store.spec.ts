import { describe, it, expect, vi, beforeEach } from 'vitest'

// In-memory SQLite mock
const mockDb = {
  exec: vi.fn(),
  prepare: vi.fn(() => ({
    run: vi.fn(() => ({ changes: 1 })),
    get: vi.fn(),
    all: vi.fn(() => []),
  })),
}

vi.mock('../../store/modelDb', () => ({
  getDb: vi.fn(() => mockDb),
}))

vi.mock('../../store/authDb', () => ({
  registerAppWithId: vi.fn(),
}))

import {
  initOAuthDb,
  registerOAuthClient,
  getOAuthClient,
  validateClientCredentials,
  createAuthorizationCode,
  useAuthorizationCode,
  issueToken,
  validateAccessToken,
  refreshAccessToken,
  revokeToken,
  revokeAllClientTokens,
  cleanupExpired,
  markClientFirstParty,
  isClientFirstParty,
} from '../store'
import { getDb } from '../../store/modelDb'

describe('OAuth Store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('initOAuthDb', () => {
    it('should execute CREATE TABLE statements', () => {
      initOAuthDb()
      expect(mockDb.exec).toHaveBeenCalledTimes(1)
      const sql = mockDb.exec.mock.calls[0][0] as string
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS oauth_clients')
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS oauth_codes')
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS oauth_tokens')
    })

    it('should not throw if db is null', () => {
      vi.mocked(getDb).mockReturnValueOnce(null as any)
      expect(() => initOAuthDb()).not.toThrow()
    })
  })

  describe('registerOAuthClient', () => {
    it('should insert a client and return it', () => {
      const mockClient = {
        client_id: 'client_test-app_abc12345',
        client_secret: 'randomsecret',
        app_name: 'Test App',
        app_icon: '',
        app_vendor: 'Vendor',
        redirect_uri: '',
        grant_types: '["authorization_code","refresh_token"]',
        created_at: '2024-01-01',
      }

      const prepareRun = vi.fn(() => ({ changes: 1 }))
      const prepareGet = vi.fn(() => mockClient)
      mockDb.prepare.mockImplementation(((sql: string) => {
        if (sql.includes('INSERT INTO oauth_clients')) {
          return { run: prepareRun }
        }
        if (sql.includes('SELECT * FROM oauth_clients')) {
          return { get: prepareGet }
        }
        // For markClientFirstParty's UPDATE
        return { run: vi.fn(() => ({ changes: 0 })) }
      }) as any)

      const result = registerOAuthClient('Test App', '', 'Vendor', '')

      expect(result).toEqual(mockClient)
      expect(prepareRun).toHaveBeenCalled()
    })

    it('should throw if db is not available', () => {
      vi.mocked(getDb).mockReturnValueOnce(null as any)
      expect(() => registerOAuthClient('App')).toThrow('数据库不可用')
    })
  })

  describe('getOAuthClient', () => {
    it('should return client when found', () => {
      const mockClient = { client_id: 'c1', app_name: 'App' }
      mockDb.prepare.mockReturnValue({ get: vi.fn(() => mockClient) } as any)

      const result = getOAuthClient('c1')
      expect(result).toEqual(mockClient)
    })

    it('should return null when not found', () => {
      mockDb.prepare.mockReturnValue({ get: vi.fn(() => undefined) } as any)
      const result = getOAuthClient('unknown')
      expect(result).toBeNull()
    })

    it('should return null if db is null', () => {
      vi.mocked(getDb).mockReturnValueOnce(null as any)
      expect(getOAuthClient('c1')).toBeNull()
    })
  })

  describe('validateClientCredentials', () => {
    it('should return true for matching credentials', () => {
      mockDb.prepare.mockReturnValue({
        get: vi.fn(() => ({ client_id: 'c1', client_secret: 'sec123' })),
      } as any)

      expect(validateClientCredentials('c1', 'sec123')).toBe(true)
    })

    it('should return false for wrong secret', () => {
      mockDb.prepare.mockReturnValue({
        get: vi.fn(() => ({ client_id: 'c1', client_secret: 'sec123' })),
      } as any)

      expect(validateClientCredentials('c1', 'wrong')).toBe(false)
    })

    it('should return false for non-existent client', () => {
      mockDb.prepare.mockReturnValue({ get: vi.fn(() => undefined) } as any)
      expect(validateClientCredentials('unknown', 'sec')).toBe(false)
    })
  })

  describe('createAuthorizationCode', () => {
    it('should create and return a code record', () => {
      const mockCode = {
        code: 'code123',
        client_id: 'c1',
        scopes: 'inference:read',
        code_challenge: 'challenge',
        code_challenge_method: 'S256',
        redirect_uri: '',
        expires_at: '2024-01-01T00:10:00.000Z',
        used: 0,
      }

      mockDb.prepare.mockImplementation(((sql: string) => {
        if (sql.includes('INSERT INTO oauth_codes')) {
          return { run: vi.fn() }
        }
        return { get: vi.fn(() => mockCode) }
      }) as any)

      const result = createAuthorizationCode('c1', 'inference:read', 'challenge', 'S256', '')
      expect(result).toEqual(mockCode)
    })

    it('should throw if db is not available', () => {
      vi.mocked(getDb).mockReturnValueOnce(null as any)
      expect(() => createAuthorizationCode('c1', 'scope', 'ch')).toThrow('数据库不可用')
    })
  })

  describe('useAuthorizationCode', () => {
    it('should return valid result with correct verifier', () => {
      const futureDate = new Date(Date.now() + 600_000).toISOString()
      const mockCode = {
        code: 'code1',
        client_id: 'c1',
        scopes: 'inference:read',
        code_challenge: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk', // SHA256('test_verifier') base64url
        code_challenge_method: 'S256',
        expires_at: futureDate,
        used: 0,
      }

      const crypto = require('crypto')
      const expectedChallenge = crypto.createHash('sha256').update('test_verifier').digest('base64url')
      mockCode.code_challenge = expectedChallenge

      const runFn = vi.fn()
      mockDb.prepare.mockImplementation(((sql: string) => {
        if (sql.includes('SELECT') && sql.includes('used = 0')) {
          return { get: vi.fn(() => mockCode) }
        }
        return { run: runFn }
      }) as any)

      const result = useAuthorizationCode('code1', 'test_verifier')
      expect(result.valid).toBe(true)
      expect(result.client_id).toBe('c1')
      expect(result.scopes).toBe('inference:read')
    })

    it('should return invalid for expired code', () => {
      const pastDate = new Date(Date.now() - 600_000).toISOString()
      const mockCode = {
        code: 'code1',
        client_id: 'c1',
        scopes: 'inference:read',
        code_challenge: 'ch',
        code_challenge_method: 'S256',
        expires_at: pastDate,
        used: 0,
      }

      mockDb.prepare.mockImplementation(((sql: string) => {
        if (sql.includes('SELECT') && sql.includes('used = 0')) {
          return { get: vi.fn(() => mockCode) }
        }
        return { run: vi.fn() }
      }) as any)

      const result = useAuthorizationCode('code1', 'v')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('已过期')
    })

    it('should return invalid for already used code', () => {
      mockDb.prepare.mockReturnValue({ get: vi.fn(() => null) } as any)

      const result = useAuthorizationCode('used_code', 'v')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('无效或已使用')
    })

    it('should return invalid for wrong PKCE verifier', () => {
      const futureDate = new Date(Date.now() + 600_000).toISOString()
      const mockCode = {
        code: 'code1',
        client_id: 'c1',
        scopes: 'inference:read',
        code_challenge: 'expected_challenge_that_wont_match',
        code_challenge_method: 'S256',
        expires_at: futureDate,
        used: 0,
      }

      mockDb.prepare.mockImplementation(((sql: string) => {
        if (sql.includes('SELECT') && sql.includes('used = 0')) {
          return { get: vi.fn(() => mockCode) }
        }
        return { run: vi.fn() }
      }) as any)

      const result = useAuthorizationCode('code1', 'wrong_verifier')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('PKCE')
    })

    it('should return invalid if db is null', () => {
      vi.mocked(getDb).mockReturnValueOnce(null as any)
      const result = useAuthorizationCode('code', 'v')
      expect(result.valid).toBe(false)
    })
  })

  describe('issueToken', () => {
    it('should issue access token without refresh', () => {
      mockDb.prepare.mockReturnValue({ run: vi.fn() } as any)

      const result = issueToken('c1', 'inference:read', false)
      expect(result.access_token).toBeDefined()
      expect(result.access_token.length).toBe(48)
      expect(result.refresh_token).toBeNull()
      expect(result.expires_in).toBe(3600)
    })

    it('should issue access token with refresh', () => {
      mockDb.prepare.mockReturnValue({ run: vi.fn() } as any)

      const result = issueToken('c1', 'inference:read offline_access', true)
      expect(result.access_token).toBeDefined()
      expect(result.refresh_token).toBeDefined()
      expect(result.refresh_token!.length).toBe(64)
      expect(result.expires_in).toBe(3600)
    })

    it('should throw if db is null', () => {
      vi.mocked(getDb).mockReturnValueOnce(null as any)
      expect(() => issueToken('c1', 'scope')).toThrow('数据库不可用')
    })
  })

  describe('validateAccessToken', () => {
    it('should return valid for non-expired, non-revoked token', () => {
      const futureDate = new Date(Date.now() + 3600_000).toISOString()
      mockDb.prepare.mockReturnValue({
        get: vi.fn(() => ({
          access_token: 'at1',
          client_id: 'c1',
          scopes: 'inference:read',
          access_expires_at: futureDate,
          revoked_at: null,
        })),
      } as any)

      const result = validateAccessToken('at1')
      expect(result.valid).toBe(true)
      expect(result.client_id).toBe('c1')
      expect(result.scopes).toBe('inference:read')
    })

    it('should return invalid for expired token', () => {
      const pastDate = new Date(Date.now() - 3600_000).toISOString()
      mockDb.prepare.mockReturnValue({
        get: vi.fn(() => ({
          access_token: 'at1',
          client_id: 'c1',
          scopes: 'inference:read',
          access_expires_at: pastDate,
        })),
      } as any)

      const result = validateAccessToken('at1')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('已过期')
    })

    it('should return invalid for non-existent token', () => {
      mockDb.prepare.mockReturnValue({ get: vi.fn(() => null) } as any)

      const result = validateAccessToken('unknown')
      expect(result.valid).toBe(false)
    })
  })

  describe('revokeToken', () => {
    it('should return true when token is revoked', () => {
      mockDb.prepare.mockReturnValue({ run: vi.fn(() => ({ changes: 1 })) } as any)
      expect(revokeToken('at1')).toBe(true)
    })

    it('should return false when token not found', () => {
      mockDb.prepare.mockReturnValue({ run: vi.fn(() => ({ changes: 0 })) } as any)
      expect(revokeToken('unknown')).toBe(false)
    })

    it('should return false if db is null', () => {
      vi.mocked(getDb).mockReturnValueOnce(null as any)
      expect(revokeToken('at1')).toBe(false)
    })
  })

  describe('revokeAllClientTokens', () => {
    it('should return number of revoked tokens', () => {
      mockDb.prepare.mockReturnValue({ run: vi.fn(() => ({ changes: 3 })) } as any)
      expect(revokeAllClientTokens('c1')).toBe(3)
    })

    it('should return 0 if db is null', () => {
      vi.mocked(getDb).mockReturnValueOnce(null as any)
      expect(revokeAllClientTokens('c1')).toBe(0)
    })
  })

  describe('cleanupExpired', () => {
    it('should run cleanup queries', () => {
      const runFn = vi.fn()
      mockDb.prepare.mockReturnValue({ run: runFn } as any)

      cleanupExpired()
      expect(mockDb.prepare).toHaveBeenCalled()
      expect(runFn).toHaveBeenCalled()
    })

    it('should not throw if db is null', () => {
      vi.mocked(getDb).mockReturnValueOnce(null as any)
      expect(() => cleanupExpired()).not.toThrow()
    })
  })

  describe('markClientFirstParty / isClientFirstParty', () => {
    it('markClientFirstParty should return true on success', () => {
      mockDb.exec = vi.fn()
      mockDb.prepare.mockReturnValue({ run: vi.fn(() => ({ changes: 1 })) } as any)
      expect(markClientFirstParty('c1')).toBe(true)
    })

    it('isClientFirstParty should return true for first-party client', () => {
      mockDb.prepare.mockReturnValue({
        get: vi.fn(() => ({ first_party: 1 })),
      } as any)
      expect(isClientFirstParty('c1')).toBe(true)
    })

    it('isClientFirstParty should return false for non-first-party', () => {
      mockDb.prepare.mockReturnValue({
        get: vi.fn(() => ({ first_party: 0 })),
      } as any)
      expect(isClientFirstParty('c1')).toBe(false)
    })

    it('isClientFirstParty should return false if db is null', () => {
      vi.mocked(getDb).mockReturnValueOnce(null as any)
      expect(isClientFirstParty('c1')).toBe(false)
    })
  })
})
