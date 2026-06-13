import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock electron
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/test-userdata'),
  },
}))

// Mock fs
vi.mock('fs', () => {
  const { Readable } = require('stream')
  return {
    createWriteStream: vi.fn(),
    createReadStream: vi.fn(() => {
      const readable = new Readable({
        read() {
          this.push(Buffer.from('test'))
          this.push(null)
        },
      })
      return readable
    }),
    existsSync: vi.fn(() => false),
    mkdirSync: vi.fn(),
    rmSync: vi.fn(),
    readFileSync: vi.fn(() => Buffer.from('test')),
    renameSync: vi.fn(),
    cpSync: vi.fn(),
  }
})

// Mock crypto
vi.mock('crypto', () => ({
  createHash: vi.fn(() => ({
    update: vi.fn().mockReturnThis(),
    digest: vi.fn(() => 'abc123def456'),
  })),
}))

// Mock manager
vi.mock('../../apps/manager', () => ({
  installApplication: vi.fn(async (info: any) => ({
    ...info,
    installed_at: '2024-01-01',
    status: 'installed',
  })),
  uninstallApplication: vi.fn(async () => true),
}))

import { validateManifest, computeSHA256 } from '../installer'

describe('App Installer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('validateManifest', () => {
    const validManifest = {
      app_id: 'com.example.testapp',
      name: 'Test App',
      version: '1.0.0',
      entry_point: 'bundle/index.js',
      min_core_version: '1.0.0',
      required_scopes: ['inference:read', 'models:read'],
    }

    it('should accept a valid manifest', () => {
      const result = validateManifest(validManifest)
      expect(result.valid).toBe(true)
      expect(result.manifest).toBeDefined()
      expect(result.manifest!.app_id).toBe('com.example.testapp')
      expect(result.manifest!.name).toBe('Test App')
      expect(result.manifest!.version).toBe('1.0.0')
    })

    it('should reject null input', () => {
      const result = validateManifest(null)
      expect(result.valid).toBe(false)
      expect(result.error).toContain('不是有效的 JSON 对象')
    })

    it('should reject non-object input', () => {
      const result = validateManifest('string')
      expect(result.valid).toBe(false)
    })

    it('should reject missing app_id', () => {
      const { app_id, ...noAppId } = validManifest
      const result = validateManifest(noAppId)
      expect(result.valid).toBe(false)
      expect(result.error).toContain('app_id')
    })

    it('should reject missing name', () => {
      const { name, ...noName } = validManifest
      const result = validateManifest(noName)
      expect(result.valid).toBe(false)
      expect(result.error).toContain('name')
    })

    it('should reject missing version', () => {
      const { version, ...noVersion } = validManifest
      const result = validateManifest(noVersion)
      expect(result.valid).toBe(false)
      expect(result.error).toContain('version')
    })

    it('should reject missing entry_point', () => {
      const { entry_point, ...noEntry } = validManifest
      const result = validateManifest(noEntry)
      expect(result.valid).toBe(false)
      expect(result.error).toContain('entry_point')
    })

    it('should reject missing min_core_version', () => {
      const { min_core_version, ...noMinVersion } = validManifest
      const result = validateManifest(noMinVersion)
      expect(result.valid).toBe(false)
      expect(result.error).toContain('min_core_version')
    })

    it('should reject empty string for required fields', () => {
      const result = validateManifest({ ...validManifest, app_id: '' })
      expect(result.valid).toBe(false)
      expect(result.error).toContain('app_id')
    })

    it('should reject invalid semver version', () => {
      const result = validateManifest({ ...validManifest, version: 'invalid' })
      expect(result.valid).toBe(false)
      expect(result.error).toContain('版本号格式无效')
    })

    it('should accept pre-release semver', () => {
      const result = validateManifest({ ...validManifest, version: '1.0.0-beta.1' })
      expect(result.valid).toBe(true)
    })

    it('should reject when required_scopes is not an array', () => {
      const result = validateManifest({ ...validManifest, required_scopes: 'inference:read' })
      expect(result.valid).toBe(false)
      expect(result.error).toContain('required_scopes 必须是字符串数组')
    })

    it('should reject unknown scopes', () => {
      const result = validateManifest({
        ...validManifest,
        required_scopes: ['inference:read', 'unknown:scope'],
      })
      expect(result.valid).toBe(false)
      expect(result.error).toContain('未知的 OAuth 作用域: unknown:scope')
    })

    it('should accept all known scopes', () => {
      const result = validateManifest({
        ...validManifest,
        required_scopes: [
          'inference:read',
          'models:read',
          'models:manage',
          'knowledge:read',
          'knowledge:write',
          'system:status',
          'offline_access',
        ],
      })
      expect(result.valid).toBe(true)
    })

    it('should accept empty required_scopes array', () => {
      const result = validateManifest({ ...validManifest, required_scopes: [] })
      expect(result.valid).toBe(true)
    })

    it('should handle optional fields', () => {
      const result = validateManifest({
        ...validManifest,
        vendor: 'TestVendor',
        description: 'A test app',
        icon: 'icon.png',
        category: 'productivity',
        homepage: 'https://example.com',
        repository: 'https://github.com/test/app',
        license: 'MIT',
      })
      expect(result.valid).toBe(true)
      expect(result.manifest!.vendor).toBe('TestVendor')
      expect(result.manifest!.description).toBe('A test app')
      expect(result.manifest!.license).toBe('MIT')
    })

    it('should default sandbox to true', () => {
      const result = validateManifest(validManifest)
      expect(result.manifest!.sandbox).toBe(true)
    })

    it('should allow sandbox = false', () => {
      const result = validateManifest({ ...validManifest, sandbox: false })
      expect(result.manifest!.sandbox).toBe(false)
    })

    it('should set optional string fields to undefined when not strings', () => {
      const result = validateManifest({ ...validManifest, vendor: 123, description: null })
      expect(result.valid).toBe(true)
      expect(result.manifest!.vendor).toBeUndefined()
      expect(result.manifest!.description).toBeUndefined()
    })
  })

  describe('computeSHA256', () => {
    it('should compute hash from file content', async () => {
      const result = await computeSHA256('/tmp/testfile.aincore')
      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    })
  })

  describe('installFromFile flow', () => {
    // These tests validate the flow logic conceptually
    // Full integration testing would need real filesystem

    it('should reject if checksum mismatch', async () => {
      // Import dynamically to allow mock setup
      const { installFromFile } = await import('../installer')
      const { readFileSync } = await import('fs')

      vi.mocked(readFileSync).mockReturnValue(Buffer.from('file content'))

      const result = await installFromFile('/tmp/app.aincore', 'expected_hash_different')

      expect(result.success).toBe(false)
      expect(result.error).toContain('SHA256 校验失败')
    })
  })
})
