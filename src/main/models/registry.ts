/**
 * Model Registry — 模型注册表
 *
 * 扩展 models 表，增加以下字段:
 *   source_type  — 'huggingface' | 'modelscope' | 'local'
 *   license      — 模型许可证 (Apache-2.0, MIT, Llama, etc.)
 *   download_url — 原始下载 URL
 *   checksum     — SHA256 校验和
 *
 * 通过 ALTER TABLE 进行向后兼容的 schema 迁移。
 */
import { getDb } from '../store/modelDb'

export type ModelSourceType = 'huggingface' | 'modelscope' | 'local'

export interface ModelRegistryEntry {
  id: string
  name: string
  family: string
  parameterSize: string
  quantization: string
  sourceType: ModelSourceType
  source: string
  sourceUrl: string
  license: string
  downloadUrl: string
  checksum: string
  filePath: string
  sizeBytes: number
  capabilities: string[]
}

/**
 * 扩展迁移 — 向后兼容地增加列
 */
export function migrateModelRegistry(): void {
  const db = getDb()
  if (!db) return

  try {
    db.exec(`
      ALTER TABLE models ADD COLUMN source_type TEXT DEFAULT 'local';
    `)
  } catch { /* 列已存在 */ }

  try {
    db.exec(`
      ALTER TABLE models ADD COLUMN license TEXT DEFAULT '';
    `)
  } catch { /* 列已存在 */ }

  try {
    db.exec(`
      ALTER TABLE models ADD COLUMN download_url TEXT DEFAULT '';
    `)
  } catch { /* 列已存在 */ }

  try {
    db.exec(`
      ALTER TABLE models ADD COLUMN checksum TEXT DEFAULT '';
    `)
  } catch { /* 列已存在 */ }

  console.log('[Model Registry] Schema 迁移完成')
}

/**
 * 注册一个模型（完整字段）
 */
export function registerModel(entry: ModelRegistryEntry): void {
  const db = getDb()
  if (!db) throw new Error('数据库不可用')

  db.prepare(`
    INSERT OR REPLACE INTO models
      (id, name, family, parameterSize, quantization, format, capabilities,
       sizeBytes, source, sourceUrl, source_type, license, download_url, checksum, filePath, digest)
    VALUES (?, ?, ?, ?, ?, 'gguf', ?, ?, ?, ?, ?, ?, ?, ?, ?, '')
  `).run(
    entry.id, entry.name, entry.family, entry.parameterSize, entry.quantization,
    JSON.stringify(entry.capabilities), entry.sizeBytes, entry.source, entry.sourceUrl,
    entry.sourceType, entry.license, entry.downloadUrl, entry.checksum, entry.filePath,
  )
}

/**
 * 按源类型列出模型
 */
export function listModelsBySource(sourceType?: ModelSourceType): ModelRegistryEntry[] {
  const db = getDb()
  if (!db) return []

  const sql = sourceType
    ? 'SELECT * FROM models WHERE source_type = ? ORDER BY createdAt DESC'
    : 'SELECT * FROM models ORDER BY createdAt DESC'

  const rows = sourceType
    ? db.prepare(sql).all(sourceType)
    : db.prepare(sql).all()

  return rows.map(normalizeEntry)
}

/**
 * 搜索已安装模型（本地）
 */
export function searchLocalModels(query: string): ModelRegistryEntry[] {
  const db = getDb()
  if (!db) return []

  const pattern = `%${query}%`
  const rows = db.prepare(
    'SELECT * FROM models WHERE name LIKE ? OR family LIKE ? ORDER BY createdAt DESC LIMIT 30'
  ).all(pattern, pattern)

  return rows.map(normalizeEntry)
}

// ============================================================
// Internal helpers
// ============================================================

function normalizeEntry(row: Record<string, unknown>): ModelRegistryEntry {
  return {
    id: String(row.id || ''),
    name: String(row.name || ''),
    family: String(row.family || ''),
    parameterSize: String(row.parameterSize || ''),
    quantization: String(row.quantization || ''),
    sourceType: (row.source_type as ModelSourceType) || 'local',
    source: String(row.source || ''),
    sourceUrl: String(row.sourceUrl || ''),
    license: String(row.license || ''),
    downloadUrl: String(row.download_url || ''),
    checksum: String(row.checksum || ''),
    filePath: String(row.filePath || ''),
    sizeBytes: typeof row.sizeBytes === 'number' ? row.sizeBytes : 0,
    capabilities: safeJsonParse(row.capabilities),
  }
}

function safeJsonParse(val: unknown): string[] {
  if (typeof val === 'string') {
    try { return JSON.parse(val) } catch { return [] }
  }
  if (Array.isArray(val)) return val
  return []
}
