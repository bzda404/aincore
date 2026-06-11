/**
 * Privacy Sentinel — PII 检测，同意管理与审计
 *
 * 从 desktop 的 MCP 层迁移到 Core，作为 OAuth 授权网关的隐私层。
 *
 * 职责:
 *   1. PII 检测 — 正则 + 分级（high/medium/low）
 *   2. 同意闸门 — Promise-based 用户确认机制（根据敏感度分级处理）
 *   3. 审计日志 — SQLite 持久化隐私决策记录
 *   4. 可配置策略 — 白名单工具、自动拒绝超时
 */
import { BrowserWindow } from 'electron'
import { recordAuditEntry, queryAuditLog, clearAuditLog as clearDbAuditLog } from '../store/auditDb'
import type { PiiSensitivity, AuditDecision } from '../store/auditDb'

// ============================================================
// Types
// ============================================================

export type { PiiSensitivity } from '../store/auditDb'

export type PiiType =
  | 'phone'
  | 'id_number'
  | 'email'
  | 'name'
  | 'address'
  | 'bank_card'
  | 'passport'
  | 'ip_address'
  | 'other'

export interface PiiDetection {
  type: PiiType
  category: string
  sensitivity: PiiSensitivity
  value: string
  start: number
  end: number
}

export interface PIIEntity {
  type: PiiType
  value: string
  start: number
  end: number
  sensitivity?: PiiSensitivity
}

export interface DesensitizedPreview {
  original: string
  masked: string
  entitiesFound: PIIEntity[]
  maxSensitivity: PiiSensitivity | null
}

export interface PrivacyRequest {
  id: string
  tool: string
  args: Record<string, unknown>
  clientName: string
  clientPid?: number
  timestamp: number
}

export interface PrivacyDecision {
  allowed: boolean
  desensitize: boolean
}

export interface PrivacyAuditEntry {
  requestId: string
  tool: string
  clientName: string
  decision: AuditDecision
  piiCount: number
  piiTypes?: string[]
  sensitivity?: PiiSensitivity | null
  previewChars: number
  timestamp: string
}

export interface SentinelConfig {
  enabled: boolean
  timeoutSeconds: number
  autoRejectOnTimeout: boolean
  desensitizeEnabled: boolean
  allowedTools: string[]
  lowSensitivityAction: 'log' | 'popup' | 'block'
}

// ============================================================
// PII Sensitivity Classification
// ============================================================

const PII_SENSITIVITY: Record<PiiType, PiiSensitivity> = {
  id_number: 'high',
  bank_card: 'high',
  passport: 'high',
  phone: 'medium',
  email: 'medium',
  ip_address: 'medium',
  address: 'low',
  name: 'low',
  other: 'low',
}

const PII_CATEGORIES: Record<PiiType, string> = {
  id_number: '身份证件',
  bank_card: '金融信息',
  passport: '身份证件',
  phone: '联系方式',
  email: '联系方式',
  ip_address: '网络标识',
  address: '地理位置',
  name: '个人身份',
  other: '其他',
}

// ============================================================
// PII Detection Patterns
// ============================================================

const PII_PATTERNS: Array<{ type: PiiType; pattern: RegExp }> = [
  // High sensitivity
  { type: 'id_number', pattern: /(?<!\d)[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?!\d)/g },
  { type: 'bank_card', pattern: /(?<!\d)[36]\d{3}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}(?:[-\s]?\d{1,3})?(?!\d)/g },
  { type: 'passport', pattern: /(?<![A-Za-z0-9])[EeGg]\d{8}(?!\d)/g },

  // Medium sensitivity
  { type: 'email', pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
  { type: 'phone', pattern: /(?<!\d)1[3-9]\d{9}(?!\d)/g },
  { type: 'ip_address', pattern: /(?<!\d)(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)(?!\d)/g },

  // Low sensitivity
  { type: 'address', pattern: /[\u4e00-\u9fa5]{2,}(?:省|自治区)[\u4e00-\u9fa5]{2,}(?:市|州|盟)[\u4e00-\u9fa5]*(?:区|县|旗|市)?[\u4e00-\u9fa5]*(?:路|街|道|巷|弄)[\u4e00-\u9fa5]*(?:号|弄)?[\d\-]*号?/g },
]

const MASK_LABELS: Record<PiiType, string> = {
  phone: '[PHONE]',
  id_number: '[ID_CARD]',
  email: '[EMAIL]',
  name: '[NAME]',
  address: '[ADDRESS]',
  bank_card: '[BANK_CARD]',
  passport: '[PASSPORT]',
  ip_address: '[IP_ADDR]',
  other: '[PII]',
}

// ============================================================
// PII Detection Functions
// ============================================================

function detectPIIRegex(text: string): PiiDetection[] {
  const entities: PiiDetection[] = []

  for (const { type, pattern } of PII_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags)
    let match: RegExpExecArray | null
    while ((match = regex.exec(text)) !== null) {
      entities.push({
        type,
        category: PII_CATEGORIES[type],
        sensitivity: PII_SENSITIVITY[type],
        value: match[0],
        start: match.index,
        end: match.index + match[0].length,
      })
    }
  }

  // 排序 + 去重叠（先匹配优先）
  entities.sort((a, b) => a.start - b.start)
  const filtered: PiiDetection[] = []
  let lastEnd = -1
  for (const entity of entities) {
    if (entity.start >= lastEnd) {
      filtered.push(entity)
      lastEnd = entity.end
    }
  }

  return filtered
}

function getMaxSensitivity(detections: PiiDetection[]): PiiSensitivity | null {
  if (detections.length === 0) return null
  const order: PiiSensitivity[] = ['low', 'medium', 'high']
  let max: PiiSensitivity = 'low'
  for (const d of detections) {
    if (order.indexOf(d.sensitivity) > order.indexOf(max)) {
      max = d.sensitivity
    }
  }
  return max
}

function maskEntities(text: string, entities: PiiDetection[]): string {
  const sorted = [...entities].sort((a, b) => b.start - a.start)
  let masked = text
  for (const entity of sorted) {
    const label = MASK_LABELS[entity.type] || '[PII]'
    masked = masked.slice(0, entity.start) + label + masked.slice(entity.end)
  }
  return masked
}

/**
 * 对文本进行 PII 检测与脱敏
 */
export function desensitizeText(text: string): DesensitizedPreview {
  const detections = detectPIIRegex(text)
  const masked = maskEntities(text, detections)
  const entitiesFound: PIIEntity[] = detections.map(d => ({
    type: d.type,
    value: d.value,
    start: d.start,
    end: d.end,
    sensitivity: d.sensitivity,
  }))
  return { original: text, masked, entitiesFound, maxSensitivity: getMaxSensitivity(detections) }
}

/**
 * 仅检测 PII，不脱敏
 */
export function detectPII(text: string): PiiDetection[] {
  return detectPIIRegex(text)
}

// ============================================================
// Consent Gate
// ============================================================

const DEFAULT_CONFIG: SentinelConfig = {
  enabled: true,
  timeoutSeconds: 60,
  autoRejectOnTimeout: true,
  desensitizeEnabled: true,
  allowedTools: [],
  lowSensitivityAction: 'log',
}

let config: SentinelConfig = { ...DEFAULT_CONFIG }
const pendingRequests = new Map<string, {
  resolve: (result: PrivacyDecision) => void
  reject: (err: Error) => void
  timeout: ReturnType<typeof setTimeout>
  context: { tool: string; args: Record<string, unknown>; clientName: string; piiCount: number; previewChars: number; piiTypes: string[]; sensitivity: PiiSensitivity | null }
}>()
let requestCounter = 0

export function configureSentinel(partial: Partial<SentinelConfig>): void {
  config = { ...config, ...partial }
}

export function getSentinelConfig(): SentinelConfig {
  return { ...config }
}

/**
 * 核心拦截函数 — 根据敏感度分级处理
 *
 * - high: 强制脱敏，始终审计
 * - medium: 弹出同意框，审计决策
 * - low: 仅记录日志，不弹窗（可配置）
 */
export function interceptPrivacyRequest(
  tool: string,
  args: Record<string, unknown>,
  clientName: string,
  clientPid?: number,
  previewData?: string
): Promise<PrivacyDecision> {
  if (!config.enabled) return Promise.resolve({ allowed: true, desensitize: false })
  if (config.allowedTools.includes(tool)) return Promise.resolve({ allowed: true, desensitize: false })

  const requestId = `privacy_${++requestCounter}_${Date.now()}`

  // Detect PII in preview data
  const detections = previewData ? detectPIIRegex(previewData) : []
  const maxSensitivity = getMaxSensitivity(detections)
  const piiTypes = [...new Set(detections.map(d => d.type))]

  // No PII detected — allow immediately
  if (detections.length === 0) {
    return Promise.resolve({ allowed: true, desensitize: false })
  }

  // High sensitivity — force desensitization, always audit
  if (maxSensitivity === 'high') {
    const entry: PrivacyAuditEntry = {
      requestId,
      tool,
      clientName,
      decision: 'desensitized',
      piiCount: detections.length,
      piiTypes,
      sensitivity: 'high',
      previewChars: previewData?.length || 0,
      timestamp: new Date().toISOString(),
    }
    writeAuditEntry(entry)
    return Promise.resolve({ allowed: true, desensitize: true })
  }

  // Low sensitivity — log only (configurable)
  if (maxSensitivity === 'low' && config.lowSensitivityAction === 'log') {
    const entry: PrivacyAuditEntry = {
      requestId,
      tool,
      clientName,
      decision: 'allowed',
      piiCount: detections.length,
      piiTypes,
      sensitivity: 'low',
      previewChars: previewData?.length || 0,
      timestamp: new Date().toISOString(),
    }
    writeAuditEntry(entry)
    return Promise.resolve({ allowed: true, desensitize: false })
  }

  // Medium sensitivity (or low with popup config) — show consent popup
  return new Promise<PrivacyDecision>((resolve, reject) => {
    const preview = config.desensitizeEnabled && previewData
      ? desensitizeText(previewData)
      : { original: previewData || '', masked: previewData || '', entitiesFound: [], maxSensitivity: null }

    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId)
      const entry: PrivacyAuditEntry = {
        requestId,
        tool,
        clientName,
        decision: 'timeout',
        piiCount: detections.length,
        piiTypes,
        sensitivity: maxSensitivity,
        previewChars: preview.masked.length,
        timestamp: new Date().toISOString(),
      }
      writeAuditEntry(entry)
      if (config.autoRejectOnTimeout) {
        resolve({ allowed: false, desensitize: false })
      } else {
        reject(new Error('Privacy decision timeout'))
      }
    }, config.timeoutSeconds * 1000)

    pendingRequests.set(requestId, {
      resolve, reject, timeout,
      context: {
        tool, args, clientName,
        piiCount: detections.length,
        previewChars: preview.masked.length,
        piiTypes,
        sensitivity: maxSensitivity,
      },
    })

    // 发送弹窗到所有渲染窗口
    const popup = {
      request: { id: requestId, tool, args, clientName, clientPid, timestamp: Date.now() },
      preview,
      sensitivity: maxSensitivity,
      piiTypes,
      expiresIn: config.timeoutSeconds,
    }

    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('mt::core::privacy-popup', popup)
      }
    }
  })
}

/**
 * 处理用户隐私决策
 */
export function handlePrivacyDecision(requestId: string, allowed: boolean, desensitize: boolean = false): void {
  const pending = pendingRequests.get(requestId)
  if (!pending) return

  clearTimeout(pending.timeout)
  pendingRequests.delete(requestId)

  const decision: AuditDecision = allowed ? (desensitize ? 'desensitized' : 'allowed') : 'rejected'
  const entry: PrivacyAuditEntry = {
    requestId,
    tool: pending.context.tool,
    clientName: pending.context.clientName,
    decision,
    piiCount: pending.context.piiCount,
    piiTypes: pending.context.piiTypes,
    sensitivity: pending.context.sensitivity,
    previewChars: pending.context.previewChars,
    timestamp: new Date().toISOString(),
  }
  writeAuditEntry(entry)

  pending.resolve({ allowed, desensitize })
}

export function getPendingPrivacyCount(): number {
  return pendingRequests.size
}

// ============================================================
// Audit Log — SQLite backed
// ============================================================

function writeAuditEntry(entry: PrivacyAuditEntry): void {
  recordAuditEntry({
    request_id: entry.requestId,
    timestamp: entry.timestamp,
    client_name: entry.clientName,
    tool: entry.tool,
    decision: entry.decision,
    pii_types: entry.piiTypes ? JSON.stringify(entry.piiTypes) : undefined,
    pii_count: entry.piiCount,
    sensitivity: entry.sensitivity || null,
    details: JSON.stringify({ previewChars: entry.previewChars }),
  })
}

/**
 * 加载审计日志（兼容旧版接口）
 * 现在数据存在 SQLite 中，此函数仅触发迁移检查
 */
export function loadAuditLog(): PrivacyAuditEntry[] {
  migrateJsonlIfExists()
  return []
}

/**
 * 获取审计条目（兼容旧接口，现从 SQLite 读取）
 */
export function getAuditEntries(limit: number = 50): PrivacyAuditEntry[] {
  const entries = queryAuditLog({ limit }) as Array<{
    request_id: string
    tool: string
    client_name: string
    decision: AuditDecision
    pii_count: number
    pii_types: string | null
    sensitivity: PiiSensitivity | null
    details: string | null
    timestamp: string
  }>
  return entries.map(e => ({
    requestId: e.request_id,
    tool: e.tool,
    clientName: e.client_name,
    decision: e.decision,
    piiCount: e.pii_count,
    piiTypes: e.pii_types ? JSON.parse(e.pii_types) : undefined,
    sensitivity: e.sensitivity,
    previewChars: e.details ? (JSON.parse(e.details).previewChars || 0) : 0,
    timestamp: e.timestamp,
  }))
}

/**
 * 清除审计日志
 */
export function clearAuditLog(before?: Date): void {
  clearDbAuditLog(before)
}

// ============================================================
// JSONL Migration (backward compatibility)
// ============================================================

let migrationDone = false

function migrateJsonlIfExists(): void {
  if (migrationDone) return
  migrationDone = true

  try {
    const { join } = require('path')
    const { app: electronApp } = require('electron')
    const { readFileSync, existsSync, renameSync } = require('fs')
    const jsonlPath = join(electronApp.getPath('userData'), 'privacy-audit.jsonl')

    if (existsSync(jsonlPath)) {
      const content = readFileSync(jsonlPath, 'utf-8')
      const lines = content.split('\n').filter(Boolean)

      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as {
            requestId: string
            tool: string
            clientName: string
            decision: AuditDecision
            piiCount: number
            previewChars: number
            timestamp: string
          }
          recordAuditEntry({
            request_id: entry.requestId,
            timestamp: entry.timestamp,
            client_name: entry.clientName,
            tool: entry.tool,
            decision: entry.decision,
            pii_types: undefined,
            pii_count: entry.piiCount,
            sensitivity: null,
            details: JSON.stringify({ previewChars: entry.previewChars }),
          })
        } catch {
          // Skip malformed lines
        }
      }

      // Rename old file to indicate migration done
      renameSync(jsonlPath, jsonlPath + '.migrated')
      console.log('[Privacy Sentinel] JSONL 审计日志已迁移至 SQLite')
    }
  } catch {
    // Migration is best-effort
  }
}
