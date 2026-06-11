/**
 * Security test: JSON-RPC input validation
 *
 * Verifies that validateParams rejects malformed or malicious input
 * with proper error messages.
 */
import { describe, it, expect } from 'vitest'
import { validateParams } from '../../src/main/server/validation'

describe('Security: Input Validation', () => {
  describe('app.register validation', () => {
    it('should reject empty name', () => {
      expect(() => validateParams('app.register', { name: '' })).toThrow()
    })

    it('should reject non-string name', () => {
      expect(() => validateParams('app.register', { name: 123 })).toThrow()
    })

    it('should reject excessively long name (>500 chars)', () => {
      expect(() => validateParams('app.register', { name: 'x'.repeat(501) })).toThrow()
    })

    it('should accept valid registration', () => {
      const result = validateParams('app.register', { name: 'my-app' })
      expect(result).toMatchObject({ name: 'my-app' })
    })
  })

  describe('app.request_auth validation', () => {
    it('should reject missing app_id', () => {
      expect(() => validateParams('app.request_auth', {})).toThrow()
    })

    it('should reject negative timeout_ms', () => {
      expect(() =>
        validateParams('app.request_auth', { app_id: 'test-app', timeout_ms: -1 })
      ).toThrow()
    })

    it('should reject excessively large timeout_ms', () => {
      expect(() =>
        validateParams('app.request_auth', { app_id: 'test-app', timeout_ms: 999_999_999 })
      ).toThrow()
    })

    it('should accept valid auth request', () => {
      const result = validateParams('app.request_auth', { app_id: 'test-app' })
      expect(result).toMatchObject({ app_id: 'test-app' })
    })
  })

  describe('chat.completions validation', () => {
    it('should reject empty messages array', () => {
      expect(() =>
        validateParams('chat.completions', { messages: [], session_token: 'tok' })
      ).toThrow()
    })

    it('should reject messages without role', () => {
      expect(() =>
        validateParams('chat.completions', {
          messages: [{ content: 'hello' }],
          session_token: 'tok',
        })
      ).toThrow()
    })

    it('should reject temperature > 2', () => {
      expect(() =>
        validateParams('chat.completions', {
          messages: [{ role: 'user', content: 'hi' }],
          temperature: 5,
          session_token: 'tok',
        })
      ).toThrow()
    })

    it('should reject negative max_tokens', () => {
      expect(() =>
        validateParams('chat.completions', {
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: -100,
          session_token: 'tok',
        })
      ).toThrow()
    })

    it('should accept valid chat request', () => {
      const result = validateParams('chat.completions', {
        messages: [{ role: 'user', content: 'hello' }],
        session_token: 'tok',
      })
      expect(result).toBeDefined()
    })
  })

  describe('unknown methods passthrough', () => {
    it('should pass through unknown methods without validation', () => {
      const params = { foo: 'bar', baz: 123 }
      const result = validateParams('unknown.method', params)
      expect(result).toEqual(params)
    })
  })

  describe('oversized payloads', () => {
    it('should reject write_note with content > 10MB', () => {
      expect(() =>
        validateParams('write_note', {
          path: '/test.md',
          content: 'x'.repeat(10_000_001),
          session_token: 'tok',
        })
      ).toThrow()
    })
  })

  describe('search_notes validation', () => {
    it('should reject empty query', () => {
      expect(() =>
        validateParams('search_notes', { query: '', session_token: 'tok' })
      ).toThrow()
    })

    it('should accept valid search', () => {
      const result = validateParams('search_notes', {
        query: 'test',
        session_token: 'tok',
      })
      expect(result).toBeDefined()
    })
  })
})
