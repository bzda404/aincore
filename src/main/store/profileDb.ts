/**
 * 用户画像数据库 — SQLite 存储 AI 记忆偏好
 *
 * 单行表，id 固定为 1。所有字段均为空字符串时表示"未设置"，
 * System Prompt 注入逻辑会跳过空画像。
 */
import { getDb } from './modelDb'

// ============================================================
// Types
// ============================================================

export interface UserProfile {
  display_name: string
  language: string
  communication_style: string
  custom_instructions: string
  preferences: Record<string, unknown>
  updated_at: string
}

// ============================================================
// Database initialization
// ============================================================

let initialized = false

export function initProfileDb(): void {
  const db = getDb()
  if (!db) return

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      display_name TEXT NOT NULL DEFAULT '',
      language TEXT NOT NULL DEFAULT '',
      communication_style TEXT NOT NULL DEFAULT '',
      custom_instructions TEXT NOT NULL DEFAULT '',
      preferences TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    INSERT OR IGNORE INTO user_profile (id) VALUES (1);
  `)

  initialized = true
  console.log('[Profile DB] 用户画像数据库已初始化')
}

// ============================================================
// Read
// ============================================================

export function getUserProfile(): UserProfile {
  const db = getDb()
  if (!db) return emptyProfile()
  if (!initialized) initProfileDb()

  try {
    const row = db
      .prepare(
        'SELECT display_name, language, communication_style, custom_instructions, preferences, updated_at FROM user_profile WHERE id = 1',
      )
      .get() as Record<string, unknown> | undefined

    if (!row) return emptyProfile()

    return {
      display_name: String(row.display_name || ''),
      language: String(row.language || ''),
      communication_style: String(row.communication_style || ''),
      custom_instructions: String(row.custom_instructions || ''),
      preferences: safeParseJson(String(row.preferences || '{}')),
      updated_at: String(row.updated_at || ''),
    }
  } catch {
    return emptyProfile()
  }
}

// ============================================================
// Update (partial — only non-undefined fields)
// ============================================================

export function updateUserProfile(partial: Partial<UserProfile>): UserProfile {
  const db = getDb()
  if (!db) return emptyProfile()
  if (!initialized) initProfileDb()

  const sets: string[] = []
  const values: unknown[] = []

  if (partial.display_name !== undefined) {
    sets.push('display_name = ?')
    values.push(partial.display_name)
  }
  if (partial.language !== undefined) {
    sets.push('language = ?')
    values.push(partial.language)
  }
  if (partial.communication_style !== undefined) {
    sets.push('communication_style = ?')
    values.push(partial.communication_style)
  }
  if (partial.custom_instructions !== undefined) {
    sets.push('custom_instructions = ?')
    values.push(partial.custom_instructions)
  }
  if (partial.preferences !== undefined) {
    sets.push('preferences = ?')
    values.push(JSON.stringify(partial.preferences))
  }

  if (sets.length > 0) {
    sets.push("updated_at = datetime('now')")
    try {
      db.prepare(`UPDATE user_profile SET ${sets.join(', ')} WHERE id = 1`).run(...values)
    } catch (err) {
      console.warn('[Profile DB] 更新用户画像失败:', err)
    }
  }

  return getUserProfile()
}

// ============================================================
// Helpers
// ============================================================

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

function safeParseJson(str: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(str)
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}
