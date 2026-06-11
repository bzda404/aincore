/**
 * System Prompt 注入器 — 将用户画像注入 chat.completions 的 messages 数组
 *
 * 在请求转发给 llama.cpp 之前调用 maybeInjectProfile()，
 * 自动在 messages 中插入/合并 system message。
 */
import { getUserProfile, type UserProfile } from '../store/profileDb'

// ============================================================
// Language display names (for prompt building)
// ============================================================

const LANGUAGE_NAMES: Record<string, string> = {
  'zh-CN': '中文 (Chinese)',
  'zh-TW': '繁體中文 (Traditional Chinese)',
  en: 'English',
  ja: '日本語 (Japanese)',
  ko: '한국어 (Korean)',
  fr: 'Français (French)',
  de: 'Deutsch (German)',
  es: 'Español (Spanish)',
  pt: 'Português (Portuguese)',
  ru: 'Русский (Russian)',
  ar: 'العربية (Arabic)',
  it: 'Italiano (Italian)',
  nl: 'Nederlands (Dutch)',
  vi: 'Tiếng Việt (Vietnamese)',
  th: 'ไทย (Thai)',
}

// ============================================================
// Public API
// ============================================================

/**
 * Build a system prompt string from a user profile.
 * Returns null if the profile is effectively empty.
 */
export function buildProfilePrompt(profile: UserProfile): string | null {
  const parts: string[] = []

  if (
    !profile.display_name &&
    !profile.language &&
    !profile.communication_style &&
    !profile.custom_instructions
  ) {
    return null
  }

  parts.push('You are a helpful AI assistant.')

  if (profile.display_name) {
    parts.push(`The user's name is ${profile.display_name}.`)
  }

  if (profile.language) {
    const langName = LANGUAGE_NAMES[profile.language] || profile.language
    parts.push(`Always respond in ${langName}.`)
  }

  if (profile.communication_style) {
    parts.push(`Use a ${profile.communication_style} communication style.`)
  }

  if (profile.custom_instructions) {
    parts.push(`\n${profile.custom_instructions}`)
  }

  return parts.join('\n')
}

/**
 * Inject a profile system prompt into a messages array.
 * Returns a NEW array — never mutates the original.
 *
 * - If messages[0] has role "system", prepend profile prompt with separator.
 * - Otherwise insert a new system message at index 0.
 */
export function injectProfileIntoMessages(
  messages: Array<{ role: string; content: string }>,
  prompt: string,
): Array<{ role: string; content: string }> {
  const result = [...messages]

  if (result.length > 0 && result[0].role === 'system') {
    result[0] = {
      ...result[0],
      content: `${prompt}\n\n---\n\n${result[0].content}`,
    }
  } else {
    result.unshift({ role: 'system', content: prompt })
  }

  return result
}

/**
 * Main entry point — called before forwarding to llama.cpp.
 *
 * Reads the user profile, builds a system prompt, and injects it
 * into the messages array. If the profile is empty or the caller
 * passes _skip_profile_injection=true, returns params unchanged
 * (with the flag stripped).
 */
export function maybeInjectProfile(params: Record<string, unknown>): Record<string, unknown> {
  // Opt-out support
  if (params._skip_profile_injection === true) {
    const { _skip_profile_injection: _, ...rest } = params
    return rest
  }

  const profile = getUserProfile()
  const prompt = buildProfilePrompt(profile)
  if (!prompt) return params

  const messages = params.messages as Array<{ role: string; content: string }> | undefined
  if (!Array.isArray(messages)) return params

  return {
    ...params,
    messages: injectProfileIntoMessages(messages, prompt),
  }
}
