import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock electron
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
}))

// Mock auditDb
const recordedAuditEntries: any[] = []
vi.mock('../../store/auditDb', () => ({
  recordAuditEntry: vi.fn((entry: any) => { recordedAuditEntries.push(entry) }),
  queryAuditLog: vi.fn(() => recordedAuditEntries),
  clearAuditLog: vi.fn(() => { recordedAuditEntries.length = 0 }),
}))

import {
  desensitizeText,
  configureSentinel,
  getSentinelConfig,
  interceptPrivacyRequest,
  handlePrivacyDecision,
  getPendingPrivacyCount,
  getAuditEntries,
  clearAuditLog,
} from '../sentinel'
import { BrowserWindow } from 'electron'

describe('Privacy Sentinel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    // Reset config to defaults
    configureSentinel({
      enabled: true,
      timeoutSeconds: 60,
      autoRejectOnTimeout: true,
      desensitizeEnabled: true,
      allowedTools: [],
    })
    recordedAuditEntries.length = 0
    clearAuditLog()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('PII Detection - desensitizeText', () => {
    it('should detect email addresses', () => {
      const result = desensitizeText('Contact me at john@example.com for details')
      expect(result.entitiesFound.length).toBeGreaterThan(0)
      expect(result.entitiesFound[0].type).toBe('email')
      expect(result.entitiesFound[0].value).toBe('john@example.com')
      expect(result.masked).toContain('[EMAIL]')
      expect(result.masked).not.toContain('john@example.com')
    })

    it('should detect Chinese phone numbers', () => {
      const result = desensitizeText('我的手机号是13812345678请联系我')
      expect(result.entitiesFound.length).toBeGreaterThan(0)
      expect(result.entitiesFound[0].type).toBe('phone')
      expect(result.entitiesFound[0].value).toBe('13812345678')
      expect(result.masked).toContain('[PHONE]')
    })

    it('should detect Chinese ID card numbers', () => {
      const result = desensitizeText('身份证号: 110101199003071234')
      expect(result.entitiesFound.length).toBeGreaterThan(0)
      expect(result.entitiesFound[0].type).toBe('id_number')
      expect(result.masked).toContain('[ID_CARD]')
    })

    it('should detect bank card numbers', () => {
      const result = desensitizeText('卡号6222021234567890123')
      expect(result.entitiesFound.length).toBeGreaterThan(0)
      expect(result.entitiesFound[0].type).toBe('bank_card')
      expect(result.masked).toContain('[BANK_CARD]')
    })

    it('should detect multiple PII entities', () => {
      const result = desensitizeText('邮箱 test@mail.com 手机 13900001111')
      expect(result.entitiesFound.length).toBe(2)
      expect(result.masked).toContain('[EMAIL]')
      expect(result.masked).toContain('[PHONE]')
    })

    it('should return empty entities for clean text', () => {
      const result = desensitizeText('This is a normal text without PII')
      expect(result.entitiesFound).toEqual([])
      expect(result.masked).toBe(result.original)
    })

    it('should handle empty string', () => {
      const result = desensitizeText('')
      expect(result.entitiesFound).toEqual([])
      expect(result.masked).toBe('')
    })

    it('should not detect partial phone numbers', () => {
      const result = desensitizeText('订单号 2138123456781 是无效的')
      // 2138123456781 has extra digit prefix, phone pattern expects no preceding digit
      expect(result.entitiesFound.filter((e) => e.type === 'phone')).toEqual([])
    })
  })

  describe('Desensitization output format', () => {
    it('should preserve text around masked entities', () => {
      const result = desensitizeText('Hello john@test.com world')
      expect(result.masked).toBe('Hello [EMAIL] world')
    })

    it('should handle overlapping patterns (first match wins)', () => {
      // A string that could match multiple patterns
      const result = desensitizeText('13812345678')
      // Should only have one match, not duplicates
      expect(result.entitiesFound.length).toBe(1)
    })
  })

  describe('Sentinel Config', () => {
    it('should return default config', () => {
      const config = getSentinelConfig()
      expect(config.enabled).toBe(true)
      expect(config.timeoutSeconds).toBe(60)
      expect(config.autoRejectOnTimeout).toBe(true)
    })

    it('should update partial config', () => {
      configureSentinel({ timeoutSeconds: 120, allowedTools: ['read_file'] })
      const config = getSentinelConfig()
      expect(config.timeoutSeconds).toBe(120)
      expect(config.allowedTools).toEqual(['read_file'])
      expect(config.enabled).toBe(true) // unchanged
    })
  })

  describe('Consent Gateway - interceptPrivacyRequest', () => {
    it('should auto-allow when sentinel is disabled', async () => {
      configureSentinel({ enabled: false })

      const result = await interceptPrivacyRequest('write_file', { path: '/tmp' }, 'TestApp')
      expect(result.allowed).toBe(true)
      expect(result.desensitize).toBe(false)
    })

    it('should auto-allow for whitelisted tools', async () => {
      configureSentinel({ allowedTools: ['safe_tool'] })

      const result = await interceptPrivacyRequest('safe_tool', {}, 'TestApp')
      expect(result.allowed).toBe(true)
    })

    it('should create a pending request when PII is detected', () => {
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([])

      interceptPrivacyRequest('dangerous_tool', {}, 'BadApp', undefined, 'contact: user@test.com')

      expect(getPendingPrivacyCount()).toBe(1)
    })

    it('should send popup to browser windows when PII detected', () => {
      const mockSend = vi.fn()
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
        { isDestroyed: () => false, webContents: { send: mockSend } },
      ] as any)

      interceptPrivacyRequest('write_file', { path: '/etc' }, 'RemoteApp', undefined, 'email: admin@corp.com')

      expect(mockSend).toHaveBeenCalledWith(
        'mt::core::privacy-popup',
        expect.objectContaining({
          request: expect.objectContaining({ tool: 'write_file' }),
        }),
      )
    })
  })

  describe('handlePrivacyDecision', () => {
    it('should resolve pending request when allowed', async () => {
      const mockSend = vi.fn()
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
        { isDestroyed: () => false, webContents: { send: mockSend } },
      ] as any)

      const promise = interceptPrivacyRequest('tool_x', {}, 'App1', undefined, 'user@example.com')
      const popupArg = mockSend.mock.calls[0][1]
      const requestId = popupArg.request.id

      handlePrivacyDecision(requestId, true, false)

      const result = await promise
      expect(result.allowed).toBe(true)
      expect(result.desensitize).toBe(false)
    })

    it('should resolve pending request when rejected', async () => {
      const mockSend = vi.fn()
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
        { isDestroyed: () => false, webContents: { send: mockSend } },
      ] as any)

      const promise = interceptPrivacyRequest('tool_z', {}, 'App3', undefined, 'info@test.org')
      const popupArg = mockSend.mock.calls[0][1]
      const requestId = popupArg.request.id

      handlePrivacyDecision(requestId, false)

      const result = await promise
      expect(result.allowed).toBe(false)
    })

    it('should be no-op for unknown request IDs', () => {
      expect(() => handlePrivacyDecision('unknown_id', true)).not.toThrow()
    })
  })

  describe('Timeout behavior', () => {
    it('should auto-reject after timeout when autoRejectOnTimeout is true', async () => {
      configureSentinel({ timeoutSeconds: 60, autoRejectOnTimeout: true })
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([])

      const promise = interceptPrivacyRequest('tool_timeout', {}, 'App', undefined, 'hello@mail.com')

      // Advance past timeout
      vi.advanceTimersByTime(61_000)

      const result = await promise
      expect(result.allowed).toBe(false)
    })

    it('should reject promise after timeout when autoRejectOnTimeout is false', async () => {
      configureSentinel({ timeoutSeconds: 60, autoRejectOnTimeout: false })
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([])

      const promise = interceptPrivacyRequest('tool_timeout2', {}, 'App', undefined, 'hi@mail.com')

      vi.advanceTimersByTime(61_000)

      await expect(promise).rejects.toThrow('Privacy decision timeout')
    })
  })

  describe('Audit Log', () => {
    it('should record audit entry on timeout', async () => {
      configureSentinel({ timeoutSeconds: 1, autoRejectOnTimeout: true })
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([])

      const promise = interceptPrivacyRequest('audit_tool', {}, 'AuditApp', undefined, 'foo@bar.com')
      vi.advanceTimersByTime(2000)
      await promise

      const entries = getAuditEntries()
      expect(entries.length).toBeGreaterThan(0)
      expect(entries[0].tool).toBe('audit_tool')
      expect(entries[0].decision).toBe('timeout')
    })

    it('should record audit entry on user decision', async () => {
      const mockSend = vi.fn()
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
        { isDestroyed: () => false, webContents: { send: mockSend } },
      ] as any)

      const promise = interceptPrivacyRequest('log_tool', {}, 'LogApp', undefined, 'test@log.com')
      const requestId = mockSend.mock.calls[0][1].request.id

      handlePrivacyDecision(requestId, true, true)
      await promise

      const entries = getAuditEntries()
      expect(entries.length).toBeGreaterThan(0)
      expect(entries[0].decision).toBe('desensitized')
    })

    it('clearAuditLog should empty the log', () => {
      clearAuditLog()
      expect(getAuditEntries()).toEqual([])
    })
  })
})
