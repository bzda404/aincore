/**
 * App Store — SQLite 持久化层
 *
 * 本地应用注册表, 存储从应用市场安装的应用信息。
 */
import { getDb, getDbPath } from '../store/modelDb'

export interface InstalledApp {
  app_id: string
  name: string
  version: string
  vendor: string
  icon: string
  description: string
  install_path: string
  entry_point: string
  permissions: string[]
  installed_at: string
  updated_at: string
  auto_update: boolean
  marketplace_id: string | null    // 云端应用市场 ID
}

export function initAppStore(): void {
  const db = getDb()
  if (!db) return

  db.exec(`
    CREATE TABLE IF NOT EXISTS installed_apps (
      app_id          TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      version         TEXT NOT NULL,
      vendor          TEXT DEFAULT '',
      icon            TEXT DEFAULT '',
      description     TEXT DEFAULT '',
      install_path    TEXT NOT NULL,
      entry_point     TEXT DEFAULT '',
      permissions     TEXT DEFAULT '[]',
      installed_at    TEXT DEFAULT (datetime('now')),
      updated_at      TEXT DEFAULT (datetime('now')),
      auto_update     INTEGER DEFAULT 1,
      marketplace_id  TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_installed_apps_name ON installed_apps(name);
  `)

  console.log('[App Store] 应用数据库已初始化:', getDbPath())
}

export function installApp(app: Omit<InstalledApp, 'installed_at' | 'updated_at'>): InstalledApp {
  const db = getDb()
  if (!db) throw new Error('数据库不可用')

  db.prepare(`
    INSERT OR REPLACE INTO installed_apps
      (app_id, name, version, vendor, icon, description, install_path, entry_point, permissions, auto_update, marketplace_id, installed_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(
    app.app_id, app.name, app.version, app.vendor, app.icon,
    app.description, app.install_path, app.entry_point,
    JSON.stringify(app.permissions), app.auto_update ? 1 : 0,
    app.marketplace_id,
  )

  return getInstalledApp(app.app_id)!
}

export function getInstalledApp(app_id: string): InstalledApp | null {
  const db = getDb()
  if (!db) return null
  const row = db.prepare('SELECT * FROM installed_apps WHERE app_id = ?').get(app_id)
  return row ? normalizeEntry(row as Record<string, unknown>) : null
}

export function listInstalledApps(): InstalledApp[] {
  const db = getDb()
  if (!db) return []
  const rows = db.prepare('SELECT * FROM installed_apps ORDER BY installed_at DESC').all()
  return rows.map((r: Record<string, unknown>) => normalizeEntry(r))
}

export function uninstallApp(app_id: string): boolean {
  const db = getDb()
  if (!db) return false
  const result = db.prepare('DELETE FROM installed_apps WHERE app_id = ?').run(app_id)
  return result.changes > 0
}

export function updateAppVersion(app_id: string, version: string): boolean {
  const db = getDb()
  if (!db) return false
  const result = db.prepare(
    "UPDATE installed_apps SET version = ?, updated_at = datetime('now') WHERE app_id = ?"
  ).run(version, app_id)
  return result.changes > 0
}

function normalizeEntry(row: Record<string, unknown>): InstalledApp {
  return {
    app_id: String(row.app_id || ''),
    name: String(row.name || ''),
    version: String(row.version || ''),
    vendor: String(row.vendor || ''),
    icon: String(row.icon || ''),
    description: String(row.description || ''),
    install_path: String(row.install_path || ''),
    entry_point: String(row.entry_point || ''),
    permissions: safeJsonParse(row.permissions),
    installed_at: String(row.installed_at || ''),
    updated_at: String(row.updated_at || ''),
    auto_update: !!row.auto_update,
    marketplace_id: row.marketplace_id ? String(row.marketplace_id) : null,
  }
}

function safeJsonParse(val: unknown): string[] {
  if (typeof val === 'string') {
    try { return JSON.parse(val) } catch { return [] }
  }
  if (Array.isArray(val)) return val
  return []
}
