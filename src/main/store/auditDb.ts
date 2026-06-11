/**
 * 隐私审计数据库 — SQLite 存储隐私决策审计日志
 *
 * 职责:
 *   1. 结构化存储 PII 检测与隐私决策记录
 *   2. 按时间/客户端/决策类型/敏感度查询
 *   3. 聚合统计
 *   4. 导出为 CSV/JSON
 *   5. 清理旧记录
 */
import { getDb } from './modelDb'

// ============================================================
// Types
// ============================================================

export type AuditDecision = 'allowed' | 'rejected' | 'desensitized' | 'timeout'
export type PiiSensitivity = 'low' | 'medium' | 'high'

export interface AuditEntry {
  id?: number
  request_id: string
  timestamp?: string
  client_name: string
  tool: string
  decision: AuditDecision
  pii_types?: string // JSON array
  pii_count: number
  sensitivity?: PiiSensitivity | null
  details?: string // JSON blob
}

export interface AuditQueryFilters {
  startTime?: string
  endTime?: string
  clientName?: string
  decision?: AuditDecision
  sensitivity?: PiiSensitivity
  limit?: number
  offset?: number
}

export interface AuditStats {
  total: number
  byDecision: Record<AuditDecision, number>
  bySensitivity: Record<PiiSensitivity | 'none', number>
  byClient: Array<{ client_name: string; count: number }>
  recentDays: Array<{ date: string; count: number }>
}

// ============================================================
// Database initialization
// ============================================================

let initialized = false

export function initAuditDb(): void {
  const db = getDb()
  if (!db) return

  db.exec(`
    CREATE TABLE IF NOT EXISTS privacy_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT NOT NULL,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      client_name TEXT NOT NULL,
      tool TEXT NOT NULL,
      decision TEXT NOT NULL CHECK(decision IN ('allowed','rejected','desensitized','timeout')),
      pii_types TEXT,
      pii_count INTEGER DEFAULT 0,
      sensitivity TEXT CHECK(sensitivity IN ('low','medium','high') OR sensitivity IS NULL),
      details TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_privacy_audit_timestamp ON privacy_audit_log(timestamp);
    CREATE INDEX IF NOT EXISTS idx_privacy_audit_client ON privacy_audit_log(client_name);
    CREATE INDEX IF NOT EXISTS idx_privacy_audit_decision ON privacy_audit_log(decision);
    CREATE INDEX IF NOT EXISTS idx_privacy_audit_sensitivity ON privacy_audit_log(sensitivity);
  `)

  initialized = true
  console.log('[Audit DB] 隐私审计数据库已初始化')
}

// ============================================================
// CRUD operations
// ============================================================

export function recordAuditEntry(entry: AuditEntry): void {
  const db = getDb()
  if (!db) return
  if (!initialized) initAuditDb()

  try {
    db.prepare(`
      INSERT INTO privacy_audit_log (request_id, timestamp, client_name, tool, decision, pii_types, pii_count, sensitivity, details)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.request_id,
      entry.timestamp || new Date().toISOString(),
      entry.client_name,
      entry.tool,
      entry.decision,
      entry.pii_types || null,
      entry.pii_count || 0,
      entry.sensitivity || null,
      entry.details || null,
    )
  } catch {
    // 审计持久化失败不阻塞业务
  }
}

export function queryAuditLog(filters: AuditQueryFilters = {}): AuditEntry[] {
  const db = getDb()
  if (!db) return []
  if (!initialized) initAuditDb()

  const conditions: string[] = []
  const params: unknown[] = []

  if (filters.startTime) {
    conditions.push('timestamp >= ?')
    params.push(filters.startTime)
  }
  if (filters.endTime) {
    conditions.push('timestamp <= ?')
    params.push(filters.endTime)
  }
  if (filters.clientName) {
    conditions.push('client_name = ?')
    params.push(filters.clientName)
  }
  if (filters.decision) {
    conditions.push('decision = ?')
    params.push(filters.decision)
  }
  if (filters.sensitivity) {
    conditions.push('sensitivity = ?')
    params.push(filters.sensitivity)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const limit = filters.limit || 100
  const offset = filters.offset || 0

  try {
    return db.prepare(
      `SELECT * FROM privacy_audit_log ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset) as AuditEntry[]
  } catch {
    return []
  }
}

export function getAuditStats(): AuditStats {
  const db = getDb()
  const emptyStats: AuditStats = {
    total: 0,
    byDecision: { allowed: 0, rejected: 0, desensitized: 0, timeout: 0 },
    bySensitivity: { low: 0, medium: 0, high: 0, none: 0 },
    byClient: [],
    recentDays: [],
  }
  if (!db) return emptyStats
  if (!initialized) initAuditDb()

  try {
    // Total count
    const totalRow = db.prepare(
      'SELECT COUNT(*) as count FROM privacy_audit_log'
    ).get() as { count: number } | undefined
    const total = totalRow?.count ?? 0

    // By decision
    const decisionRows = db.prepare(
      'SELECT decision, COUNT(*) as count FROM privacy_audit_log GROUP BY decision'
    ).all() as Array<{ decision: AuditDecision; count: number }>

    const byDecision = { allowed: 0, rejected: 0, desensitized: 0, timeout: 0 }
    for (const row of decisionRows) {
      byDecision[row.decision] = row.count
    }

    // By sensitivity
    const sensitivityRows = db.prepare(
      `SELECT COALESCE(sensitivity, 'none') as sensitivity, COUNT(*) as count FROM privacy_audit_log GROUP BY sensitivity`
    ).all() as Array<{ sensitivity: PiiSensitivity | 'none'; count: number }>

    const bySensitivity: Record<PiiSensitivity | 'none', number> = { low: 0, medium: 0, high: 0, none: 0 }
    for (const row of sensitivityRows) {
      bySensitivity[row.sensitivity] = row.count
    }

    // By client (top 10)
    const byClient = db.prepare(
      'SELECT client_name, COUNT(*) as count FROM privacy_audit_log GROUP BY client_name ORDER BY count DESC LIMIT 10'
    ).all() as Array<{ client_name: string; count: number }>

    // Recent 7 days
    const recentDays = db.prepare(
      `SELECT date(timestamp) as date, COUNT(*) as count FROM privacy_audit_log
       WHERE timestamp >= datetime('now', '-7 days')
       GROUP BY date(timestamp) ORDER BY date DESC`
    ).all() as Array<{ date: string; count: number }>

    return { total, byDecision, bySensitivity, byClient, recentDays }
  } catch {
    return emptyStats
  }
}

export function exportAuditLog(format: 'csv' | 'json', filters?: AuditQueryFilters): string {
  const entries = queryAuditLog({ ...filters, limit: 10000 })

  if (format === 'json') {
    return JSON.stringify(entries, null, 2)
  }

  // CSV format
  const headers = ['id', 'request_id', 'timestamp', 'client_name', 'tool', 'decision', 'pii_types', 'pii_count', 'sensitivity', 'details']
  const csvLines = [headers.join(',')]

  for (const entry of entries) {
    const row = headers.map(h => {
      const val = (entry as unknown as Record<string, unknown>)[h]
      if (val === null || val === undefined) return ''
      const str = String(val)
      // Escape CSV fields containing commas or quotes
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`
      }
      return str
    })
    csvLines.push(row.join(','))
  }

  return csvLines.join('\n')
}

export function clearAuditLog(before?: Date): void {
  const db = getDb()
  if (!db) return
  if (!initialized) initAuditDb()

  try {
    if (before) {
      db.prepare(
        'DELETE FROM privacy_audit_log WHERE timestamp < ?'
      ).run(before.toISOString())
    } else {
      db.prepare('DELETE FROM privacy_audit_log').run()
    }
  } catch {
    // Best effort
  }
}

export function getDistinctClients(): string[] {
  const db = getDb()
  if (!db) return []
  if (!initialized) initAuditDb()

  try {
    const rows = db.prepare(
      'SELECT DISTINCT client_name FROM privacy_audit_log ORDER BY client_name'
    ).all() as Array<{ client_name: string }>
    return rows.map(r => r.client_name)
  } catch {
    return []
  }
}
