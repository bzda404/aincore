/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * 模型数据库 — SQLite 存储模型元数据
 *
 * 当 SQLite (better-sqlite3) 不可用时 (例如 Electron 42 V8 API 不兼容),
 * 自动降级到内存 Map 存储, 保证开发环境可用。
 */
import { join } from 'path'
import { app } from 'electron'
import { existsSync, mkdirSync } from 'fs'
import type { ModelInfo } from '../../shared/types'

let db: any = null
let memDb: Map<string, any[]> | null = null

// ============================================================
// Memory fallback — simple in-memory table store
// ============================================================

function memTable(name: string): any[] {
  if (!memDb!.has(name)) memDb!.set(name, [])
  return memDb!.get(name)!
}

function memPrepare(table: string) {
  return {
    all: (...args: any[]) => {
      // Simple filter support
      const rows = memTable(table)
      if (args.length === 0) return rows
      // Very basic: if first arg is a string with WHERE, try simple match
      return rows
    },
    get: (...args: any[]) => {
      const rows = memTable(table)
      // args[0] could be a value to match against first column (id)
      const id = args[0]
      return rows.find((r: any) => r.id === id || r[Object.keys(r)[0]] === id) || null
    },
    run: (...args: any[]) => {
      const rows = memTable(table)
      // args are values to insert (the prepared statement params)
      // Build a row from the SQL column order
      // For models: id, name, family, parameterSize, quantization, format, capabilities, sizeBytes, source, sourceUrl, filePath, digest
      if (table === 'models') {
        const existing = rows.findIndex((r: any) => r.id === args[0])
        const row: any = {
          id: args[0], name: args[1], family: args[2], parameterSize: args[3],
          quantization: args[4], format: args[5], capabilities: args[6],
          sizeBytes: args[7], source: args[8], sourceUrl: args[9],
          filePath: args[10], digest: args[11] || '',
          source_type: args[12] || 'local', license: args[13] || '',
          download_url: args[14] || '',
          checksum: args[15] || '', createdAt: new Date().toISOString(),
        }
        if (existing >= 0) rows[existing] = row
        else rows.push(row)
      }
      return { changes: 1 }
    },
  }
}

export function isMemFallback(): boolean {
  return !db && !!memDb
}

function getDataDir(): string {
  const dir = process.env.AINCORE_CORE_HOME || join(app.getPath('userData'))
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function getDb(): any {
  if (db) return db
  if (memDb) {
    // Return a shim that looks like better-sqlite3
    return {
      prepare: (sql: string) => {
        // Determine table from SQL
        const match = sql.match(/FROM\s+(\w+)|INTO\s+(\w+)/i)
        const table = (match?.[1] || match?.[2] || 'models').toLowerCase()
        return memPrepare(table)
      },
      exec: (_sql: string) => {},
      pragma: (_s: string) => {},
      close: () => {},
    }
  }
  return null
}

export function getDbPath(): string {
  return join(getDataDir(), 'models.db')
}

export function initModelDb(): void {
  try {
    const Database = require('better-sqlite3')
    const dbPath = getDbPath()
    db = new Database(dbPath)
    memDb = null

    db.pragma('journal_mode = WAL')

    db.exec(`
      CREATE TABLE IF NOT EXISTS models (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        family TEXT DEFAULT '',
        parameterSize TEXT DEFAULT '',
        quantization TEXT DEFAULT '',
        format TEXT DEFAULT 'gguf',
        capabilities TEXT DEFAULT '[]',
        sizeBytes INTEGER DEFAULT 0,
        source TEXT DEFAULT '',
        sourceUrl TEXT DEFAULT '',
        filePath TEXT NOT NULL,
        digest TEXT DEFAULT '',
        createdAt TEXT DEFAULT (datetime('now'))
      )
    `)

    console.log('[Model DB] SQLite 数据库已初始化:', dbPath)
  } catch (err) {
    console.warn('[Model DB] SQLite 不可用，使用内存存储:', err)
    memDb = new Map()
    for (const t of ['models','apps','authorizations','sessions',
                     'audit_log','oauth_clients','oauth_codes',
                     'oauth_tokens','installed_apps','user_profile']) {
      memDb.set(t, [])
    }
    // Insert default user_profile row for memDb
    memDb.get('user_profile')!.push({
      id: 1, display_name: '', language: '', communication_style: '',
      custom_instructions: '', preferences: '{}', updated_at: new Date().toISOString(),
    })
    console.log('[Model DB] 内存 fallback 就绪 (10 个表)')
  }
}

export function listModels(): ModelInfo[] {
  if (!db && !memDb) return []
  if (memDb) return memTable('models') as ModelInfo[]
  const rows = db.prepare('SELECT * FROM models ORDER BY createdAt DESC').all()
  return rows.map((r: any) => ({
    ...r,
    capabilities: JSON.parse(r.capabilities || '[]'),
    status: 'installed' as const,
  }))
}

export function getModel(id: string): ModelInfo | null {
  if (!db && !memDb) return null
  if (memDb) {
    const rows = memTable('models')
    const r = rows.find((r: any) => r.id === id)
    return r ? ({ ...r, capabilities: JSON.parse(r.capabilities || '[]'), status: 'installed' as const }) as ModelInfo : null
  }
  const row = db.prepare('SELECT * FROM models WHERE id = ?').get(id)
  if (!row) return null
  return {
    ...row,
    capabilities: JSON.parse(row.capabilities || '[]'),
    status: 'installed' as const,
  }
}

export function addModel(model: Omit<ModelInfo, 'status' | 'createdAt'>): void {
  if (!db && !memDb) return
  if (memDb) {
    memPrepare('models').run(
      model.id, model.name, model.family, model.parameterSize,
      model.quantization, model.format, JSON.stringify(model.capabilities),
      model.sizeBytes, model.source, model.sourceUrl, model.filePath, model.digest,
      (model as any).source_type || 'local', (model as any).license || '',
      (model as any).download_url || '',
      (model as any).checksum || '',
    )
    return
  }
  db.prepare(`
    INSERT OR REPLACE INTO models (id, name, family, parameterSize, quantization, format, capabilities, sizeBytes, source, sourceUrl, filePath, digest)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    model.id, model.name, model.family, model.parameterSize,
    model.quantization, model.format, JSON.stringify(model.capabilities),
    model.sizeBytes, model.source, model.sourceUrl, model.filePath, model.digest
  )
}

export function deleteModel(id: string): boolean {
  if (!db && !memDb) return false
  if (memDb) {
    const rows = memTable('models')
    const idx = rows.findIndex((r: any) => r.id === id)
    if (idx >= 0) { rows.splice(idx, 1); return true }
    return false
  }
  const result = db.prepare('DELETE FROM models WHERE id = ?').run(id)
  return result.changes > 0
}

export function getModelByPath(filePath: string): ModelInfo | null {
  if (!db && !memDb) return null
  if (memDb) {
    const r = memTable('models').find((r: any) => r.filePath === filePath)
    return r ? ({ ...r, capabilities: JSON.parse(r.capabilities || '[]'), status: 'installed' as const }) as ModelInfo : null
  }
  const row = db.prepare('SELECT * FROM models WHERE filePath = ?').get(filePath)
  if (!row) return null
  return {
    ...row,
    capabilities: JSON.parse(row.capabilities || '[]'),
    status: 'installed' as const,
  }
}
