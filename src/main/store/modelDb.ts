/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * 模型数据库 — SQLite 存储模型元数据
 *
 * 当 SQLite (better-sqlite3) 不可用时 (例如 Electron 42 V8 API 不兼容),
 * 自动降级到内存 Map 存储, 保证开发环境可用。
 */
import { join } from 'path'
import { app } from 'electron'
import { existsSync, mkdirSync, readdirSync, statSync } from 'fs'
import type { ModelInfo } from '../../shared/types'
import { getModelDir } from '../models/downloader'

let db: any = null
let memDb: Map<string, any[]> | null = null

// ============================================================
// Memory fallback — simple in-memory table store
// ============================================================

function memTable(name: string): any[] {
  if (!memDb!.has(name)) memDb!.set(name, [])
  return memDb!.get(name)!
}

// Parse column names from an INSERT statement's column list:
// "INSERT INTO x (col1, col2) VALUES (?, ?)" → ["col1", "col2"]
function memParseInsertColumns(sql: string): string[] {
  const m = sql.match(/\(([^)]+)\)\s*VALUES/i)
  if (!m) return []
  return m[1].split(',').map(s => s.trim()).filter(s => s && !s.startsWith('('))
}

// Parse simple WHERE conditions: "WHERE col = ? AND col2 IS NULL"
// Returns array of { column, operator, paramIndex }
function memParseWhere(where: string): Array<{ column: string; op: '=' | 'IS NULL' | 'IS NOT NULL' | '<' | '>'; paramOffset: number }> {
  const conditions: Array<{ column: string; op: '=' | 'IS NULL' | 'IS NOT NULL' | '<' | '>'; paramOffset: number }> = []
  // Split by AND (ignore OR for simplicity — not used in critical paths)
  const parts = where.split(/\s+AND\s+/i)
  let paramIdx = 0
  for (const part of parts) {
    const trimPart = part.trim()
    const isNull = trimPart.match(/(\w+)\s+IS\s+NULL/i)
    if (isNull) {
      conditions.push({ column: isNull[1], op: 'IS NULL', paramOffset: -1 })
      continue
    }
    const notNull = trimPart.match(/(\w+)\s+IS\s+NOT\s+NULL/i)
    if (notNull) {
      conditions.push({ column: notNull[1], op: 'IS NOT NULL', paramOffset: -1 })
      continue
    }
    const eq = trimPart.match(/(\w+)\s*=\s*\?/)
    if (eq) {
      conditions.push({ column: eq[1], op: '=', paramOffset: paramIdx })
      paramIdx++
      continue
    }
    const lt = trimPart.match(/(\w+)\s*<\s*\?/)
    if (lt) {
      conditions.push({ column: lt[1], op: '<', paramOffset: paramIdx })
      paramIdx++
    }
    const gt = trimPart.match(/(\w+)\s*>\s*\?/)
    if (gt) {
      conditions.push({ column: gt[1], op: '>', paramOffset: paramIdx })
      paramIdx++
    }
  }
  return conditions
}

function memMatchRow(row: any, conditions: ReturnType<typeof memParseWhere>, whereArgs: any[]): boolean {
  for (const cond of conditions) {
    const val = row[cond.column]
    if (cond.op === 'IS NULL') {
      if (val !== null && val !== undefined) return false
    } else if (cond.op === 'IS NOT NULL') {
      if (val === null || val === undefined) return false
    } else if (cond.op === '=' || cond.op === '<' || cond.op === '>') {
      const param = whereArgs[cond.paramOffset]
      if (cond.op === '=' && val != param) return false
      if (cond.op === '<' && !(val < param)) return false
      if (cond.op === '>' && !(val > param)) return false
    }
  }
  return true
}

// Evaluate simple SQL expressions used in INSERT VALUES
function memEvalSqlExpr(expr: string): any {
  const trimExpr = expr.trim()
  // datetime('now') → current ISO timestamp
  if (/^datetime\s*\(\s*'now'\s*\)$/i.test(trimExpr)) {
    return new Date().toISOString()
  }
  // COALESCE((SELECT ...), datetime('now')) — for new rows, subquery returns null → use datetime
  if (/^COALESCE\s*\(\s*\(?\s*SELECT\s/i.test(trimExpr)) {
    return new Date().toISOString()
  }
  // String literal: 'some value'
  const strLit = trimExpr.match(/^'(.*)'$/)
  if (strLit) return strLit[1]
  // Numeric literal
  const num = Number(trimExpr)
  if (!isNaN(num) && trimExpr !== '') return num
  // NULL
  if (/^null$/i.test(trimExpr)) return null
  return undefined  // Cannot evaluate
}

// Parse INSERT VALUES clause to classify each position as ? or SQL expression
// Returns array of { isParam: boolean, expr?: string }
function memParseInsertValues(sql: string): Array<{ isParam: boolean; expr?: string }> {
  const valMatch = sql.match(/VALUES\s*\((.+)\)\s*$/i)
  if (!valMatch) return []
  const parts: Array<{ isParam: boolean; expr?: string }> = []
  // Split by comma but respect parentheses nesting (for COALESCE(...), datetime(...))
  let depth = 0
  let current = ''
  for (const ch of valMatch[1]) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      parts.push({ isParam: current.trim() === '?', expr: current.trim() })
      current = ''
    } else {
      current += ch
    }
  }
  if (current.trim()) {
    parts.push({ isParam: current.trim() === '?', expr: current.trim() })
  }
  return parts
}

// Parse SET clause from UPDATE: "SET col1 = ?, col2 = datetime('now')"
// Returns column names being set, with either ? param offset or SQL expression
function memParseSetColumns(sql: string): Array<{ column: string; paramOffset: number; expr?: string }> {
  const setMatch = sql.match(/SET\s+(.+?)\s+WHERE/i)
  if (!setMatch) return []
  const parts = setMatch[1].split(',')
  const cols: Array<{ column: string; paramOffset: number; expr?: string }> = []
  let paramIdx = 0
  for (const part of parts) {
    const trimPart = part.trim()
    const m = trimPart.match(/(\w+)\s*=\s*\?/)
    if (m) {
      cols.push({ column: m[1], paramOffset: paramIdx })
      paramIdx++
    } else {
      // Expression like col = datetime('now')
      const exprM = trimPart.match(/(\w+)\s*=\s*(.+)/)
      if (exprM) {
        cols.push({ column: exprM[1], paramOffset: -1, expr: exprM[2].trim() })
      }
    }
  }
  return cols
}

function memPrepare(sql: string, table: string) {
  const sqlUpper = sql.toUpperCase()

  // --- INSERT ---
  if (sqlUpper.includes('INSERT')) {
    const columns = memParseInsertColumns(sql)
    // For INSERT OR REPLACE, handle upsert
    const isReplace = sqlUpper.includes('OR REPLACE')

    return {
      get: () => null,
      all: () => [],
      run: (...args: any[]) => {
        const rows = memTable(table)
        if (columns.length > 0) {
          const values = memParseInsertValues(sql)
          const row: any = {}
          let argIdx = 0
          for (let i = 0; i < columns.length; i++) {
            if (i < values.length) {
              if (values[i].isParam) {
                // ? placeholder — consume next arg
                row[columns[i]] = argIdx < args.length ? args[argIdx] : null
                argIdx++
              } else {
                // SQL expression — evaluate it
                const evaluated = memEvalSqlExpr(values[i].expr || '')
                row[columns[i]] = evaluated !== undefined ? evaluated : null
              }
            } else {
              row[columns[i]] = null
            }
          }

          if (isReplace) {
            // Find primary key (first column) and replace if exists
            const pk = columns[0]
            const existing = rows.findIndex((r: any) => r[pk] === row[pk])
            if (existing >= 0) {
              // Merge: keep old values for columns not in the INSERT
              rows[existing] = { ...rows[existing], ...row }
            } else {
              rows.push(row)
            }
          } else {
            const pk = columns[0]
            const existing = rows.findIndex((r: any) => r[pk] === row[pk])
            if (existing >= 0) rows[existing] = row
            else rows.push(row)
          }
        } else if (table === 'models') {
          // Legacy fallback for models table without parsed columns
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
        return { changes: 1, lastInsertRowid: rows.length }
      },
    }
  }

  // --- SELECT ---
  if (sqlUpper.includes('SELECT')) {
    const whereMatch = sql.match(/WHERE\s+(.+?)(?:\s+ORDER|\s+LIMIT|\s+GROUP|$)/i)
    const whereConditions = whereMatch ? memParseWhere(whereMatch[1]) : []

    return {
      get: (...args: any[]) => {
        const rows = memTable(table)
        if (whereConditions.length > 0 && args.length > 0) {
          return rows.find((r: any) => memMatchRow(r, whereConditions, args)) || null
        }
        // Fallback: match first arg against any property
        if (args.length > 0) {
          const id = args[0]
          return rows.find((r: any) => r.id === id || r[Object.keys(r)[0]] === id) || null
        }
        return rows[0] || null
      },
      all: (...args: any[]) => {
        const rows = memTable(table)
        if (whereConditions.length > 0 && args.length > 0) {
          return rows.filter((r: any) => memMatchRow(r, whereConditions, args))
        }
        if (args.length > 0 && whereConditions.length === 0) {
          // Fallback: match first arg against any property
          const id = args[0]
          return rows.filter((r: any) => r.id === id || r[Object.keys(r)[0]] === id)
        }
        return rows
      },
      run: () => ({ changes: 0 }),
    }
  }

  // --- UPDATE ---
  if (sqlUpper.includes('UPDATE')) {
    const setCols = memParseSetColumns(sql)
    const whereMatch = sql.match(/WHERE\s+(.+?)(?:\s+ORDER|\s+LIMIT|$)/i)
    const whereConditions = whereMatch ? memParseWhere(whereMatch[1]) : []

    return {
      get: () => null,
      all: () => [],
      run: (...args: any[]) => {
        const rows = memTable(table)
        let changes = 0
        // Count only ? param SET columns to know WHERE arg offset
        const paramSetCols = setCols.filter(c => c.paramOffset >= 0)
        for (const row of rows) {
          const whereArgs = args.slice(paramSetCols.length)
          if (whereConditions.length > 0) {
            if (!memMatchRow(row, whereConditions, whereArgs)) continue
          }
          // Apply SET values
          for (const col of setCols) {
            if (col.paramOffset >= 0) {
              row[col.column] = args[col.paramOffset]
            } else if (col.expr) {
              const evaluated = memEvalSqlExpr(col.expr)
              row[col.column] = evaluated !== undefined ? evaluated : null
            }
          }
          changes++
        }
        return { changes }
      },
    }
  }

  // --- DELETE ---
  if (sqlUpper.includes('DELETE')) {
    const whereMatch = sql.match(/WHERE\s+(.+?)(?:\s+ORDER|\s+LIMIT|$)/i)
    const whereConditions = whereMatch ? memParseWhere(whereMatch[1]) : []

    return {
      get: () => null,
      all: () => [],
      run: (...args: any[]) => {
        const rows = memTable(table)
        const before = rows.length
        const filtered = whereConditions.length > 0
          ? rows.filter((r: any) => !memMatchRow(r, whereConditions, args))
          : []  // DELETE without WHERE removes all
        memDb!.set(table, filtered)
        return { changes: before - filtered.length }
      },
    }
  }

  // --- Fallback (COUNT, etc.) ---
  return {
    get: (...args: any[]) => {
      const rows = memTable(table)
      if (sqlUpper.includes('COUNT')) return { count: rows.length }
      if (args.length > 0) {
        const id = args[0]
        return rows.find((r: any) => r.id === id || r[Object.keys(r)[0]] === id) || null
      }
      return rows[0] || null
    },
    all: (...args: any[]) => {
      const rows = memTable(table)
      if (args.length > 0) {
        const id = args[0]
        return rows.filter((r: any) => r.id === id || r[Object.keys(r)[0]] === id)
      }
      return rows
    },
    run: () => ({ changes: 0 }),
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
        const match = sql.match(/FROM\s+(\w+)|INTO\s+(\w+)|UPDATE\s+(\w+)/i)
        const table = (match?.[1] || match?.[2] || match?.[3] || 'models').toLowerCase()
        return memPrepare(sql, table)
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
    // Scan disk for .gguf files not yet registered
    scanModelsOnDisk()
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
    // Scan disk for .gguf files even in memDb mode
    scanModelsOnDisk()
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
    memPrepare('INSERT INTO models (id, name, family, parameterSize, quantization, format, capabilities, sizeBytes, source, sourceUrl, filePath, digest) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', 'models').run(
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

// ============================================================
// Disk model scanning — safety net for memDb fallback
// ============================================================

// Inline inference helpers (avoid circular deps with models/defaultModel.ts)
function inferFamily(name: string): string {
  const lower = name.toLowerCase()
  if (lower.includes('qwen')) return 'qwen'
  if (lower.includes('llama')) return 'llama'
  if (lower.includes('gemma')) return 'gemma'
  if (lower.includes('phi')) return 'phi'
  return 'local'
}

function inferParameterSize(name: string): string {
  const match = name.match(/(\d+(?:\.\d+)?)\s*([bBmM])/)
  return match ? `${match[1]}${match[2].toUpperCase()}` : ''
}

function inferQuantization(name: string): string {
  const match = name.match(/(Q\d+_\w+|F16|F32|BF16)/i)
  return match ? match[1].toUpperCase() : 'Q4_K_M'
}

/**
 * Scan the models directory for .gguf files and register any that are
 * not already in the database. Called at the end of initModelDb() for
 * both SQLite and memDb paths.
 */
export function scanModelsOnDisk(): void {
  try {
    const dir: string = getModelDir()
    if (!existsSync(dir)) return

    const files = readdirSync(dir).filter((f: string) => f.endsWith('.gguf'))
    let scanned = 0

    for (const file of files) {
      const filePath = join(dir, file)
      // Skip already-registered models
      if (getModelByPath(filePath)) continue

      const name = file.replace(/\.gguf$/i, '')
      const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 120)
      const family = inferFamily(name)
      const parameterSize = inferParameterSize(name)
      const quantization = inferQuantization(name)
      const sizeBytes = statSync(filePath).size

      addModel({
        id,
        name,
        family,
        parameterSize,
        quantization,
        format: 'gguf',
        capabilities: ['chat', 'completion'],
        sizeBytes,
        source: 'local',
        sourceUrl: '',
        filePath,
        digest: '',
      } as any)

      scanned++
    }

    if (scanned > 0) {
      console.log(`[Model DB] 磁盘模型扫描: 发现并注册 ${scanned} 个 .gguf 文件`)
    }
  } catch (err) {
    console.warn('[Model DB] 磁盘模型扫描失败:', err)
  }
}
