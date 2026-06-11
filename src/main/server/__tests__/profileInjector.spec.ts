import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildProfilePrompt, injectProfileIntoMessages, maybeInjectProfile } from '../profileInjector'
import type { UserProfile } from '../../store/profileDb'

// Mock the profileDb module
vi.mock('../../store/profileDb', () => ({
  getUserProfile: vi.fn(() => emptyProfile()),
}))

const { getUserProfile } = await import('../../store/profileDb')
const mockGetUserProfile = vi.mocked(getUserProfile)

function emptyProfile(): UserProfile {
  return {
    display_name: '',
    language: '',
    communication_style: '',
    custom_instructions: '',
    preferences: {},
    updated_at: '',
  }
}

function fullProfile(): UserProfile {
  return {
    display_name: '小明',
    language: 'zh-CN',
    communication_style: 'concise',
    custom_instructions: '请用代码示例回答',
    preferences: {},
    updated_at: '2026-06-11T00:00:00Z',
  }
}

describe('buildProfilePrompt', () => {
  it('returns null for empty profile', () => {
    expect(buildProfilePrompt(emptyProfile())).toBeNull()
  })

  it('builds prompt with display_name only', () => {
    const prompt = buildProfilePrompt({ ...emptyProfile(), display_name: 'Alex' })
    expect(prompt).toContain('The user\'s name is Alex')
    expect(prompt).toContain('You are a helpful AI assistant')
  })

  it('builds full prompt with all fields', () => {
    const prompt = buildProfilePrompt(fullProfile())
    expect(prompt).toContain('小明')
    expect(prompt).toContain('中文 (Chinese)')
    expect(prompt).toContain('concise')
    expect(prompt).toContain('请用代码示例回答')
  })
})

describe('injectProfileIntoMessages', () => {
  const prompt = 'You are a helpful AI assistant.\nThe user\'s name is Alex.'

  it('inserts new system message when none exists', () => {
    const messages = [{ role: 'user', content: 'Hello' }]
    const result = injectProfileIntoMessages(messages, prompt)

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ role: 'system', content: prompt })
    expect(result[1]).toEqual({ role: 'user', content: 'Hello' })
  })

  it('prepends to existing system message with separator', () => {
    const messages = [
      { role: 'system', content: 'You are a coding assistant.' },
      { role: 'user', content: 'Hello' },
    ]
    const result = injectProfileIntoMessages(messages, prompt)

    expect(result).toHaveLength(2)
    expect(result[0].role).toBe('system')
    expect(result[0].content).toBe(`${prompt}\n\n---\n\nYou are a coding assistant.`)
  })

  it('does not mutate the original array', () => {
    const messages = [{ role: 'user', content: 'Hello' }]
    const original = [...messages]
    injectProfileIntoMessages(messages, prompt)

    expect(messages).toEqual(original)
  })
})

describe('maybeInjectProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('skips injection when _skip_profile_injection is true', () => {
    mockGetUserProfile.mockReturnValue(fullProfile())

    const params = {
      messages: [{ role: 'user', content: 'Hi' }],
      _skip_profile_injection: true,
    }
    const result = maybeInjectProfile(params)

    expect(result).not.toHaveProperty('_skip_profile_injection')
    expect(result.messages).toEqual([{ role: 'user', content: 'Hi' }])
  })

  it('passes through when profile is empty', () => {
    mockGetUserProfile.mockReturnValue(emptyProfile())

    const params = { messages: [{ role: 'user', content: 'Hi' }] }
    const result = maybeInjectProfile(params)

    expect(result).toBe(params) // same reference — no modification
  })

  it('injects system message when profile has data', () => {
    mockGetUserProfile.mockReturnValue(fullProfile())

    const params = { messages: [{ role: 'user', content: 'Hi' }] }
    const result = maybeInjectProfile(params)

    const msgs = result.messages as Array<{ role: string; content: string }>
    expect(msgs).toHaveLength(2)
    expect(msgs[0].role).toBe('system')
    expect(msgs[0].content).toContain('小明')
  })

  it('passes through when messages is not an array', () => {
    mockGetUserProfile.mockReturnValue(fullProfile())

    const params = { model: 'test' }
    const result = maybeInjectProfile(params)

    expect(result).toBe(params)
  })
})
