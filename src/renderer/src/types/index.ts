/**
 * Renderer shared type definitions
 * Extracted from App.vue inline interfaces for reuse across stores/views/components.
 */
import type { AuditStats, AuditQueryFilters, AuditDecision, PiiSensitivity, AuditEntry } from '../../../main/store/auditDb'

// ============================================================
// Model types
// ============================================================

export interface ModelItem {
  id: string
  name: string
  quantization: string
  sizeBytes: number
  status: string
}

export interface DefaultModel {
  id: string
  name: string
  filename: string
  sourceType: string
  sourceUrl: string
  quantization: string
  description: string
}

export interface RemoteModel {
  name: string
  source: string
  sourceType: string
  desc: string
  downloads: number
}

export interface RecommendedModelsInfo {
  maxBillions: number
  totalRAMGB: number
  tierLabel: string
  description: string
}

// ============================================================
// App types
// ============================================================

export interface AppItem {
  app_id: string
  name: string
  icon: string
  vendor: string
  last_seen_at?: string
  granted_models?: string[]
  granted_kbs?: string[]
  granted_knowledge_bases?: Array<{ path: string; label?: string; scope: 'read' | 'read_write' }>
  active_grants?: number
}

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
  marketplace_id: string | null
}

// ============================================================
// Auth / OAuth types
// ============================================================

export interface AuthRequest {
  request_id: string
  app_id: string
  app_name: string
  app_icon: string
  requested_models: string[]
  requested_kbs: Array<{ path: string; label?: string; scope?: 'read' | 'read_write' }>
  created_at: string
}

export interface OAuthConsentPopup {
  requestId: string
  clientId: string
  clientName: string
  clientIcon: string
  scopes: string[]
  scopeDescriptions: Array<{ scope: string; description: string }>
  state?: string
  timestamp: number
}

// ============================================================
// Privacy types
// ============================================================

export interface SentinelConfig {
  enabled: boolean
  timeoutSeconds: number
  autoRejectOnTimeout: boolean
  desensitizeEnabled: boolean
  allowedTools: string[]
}

/** Re-export audit types from main process for convenience */
export type { AuditStats, AuditQueryFilters, AuditDecision, PiiSensitivity, AuditEntry }

// ============================================================
// Download progress
// ============================================================

export interface DownloadProgress {
  filename: string
  percent: number
  status: string
  speed?: number
  error?: string
}

// ============================================================
// Hub status response
// ============================================================

export interface HubStatusResponse {
  running: boolean
  transport: string
  socketPath: string
  port: number | null
  loadedModel: string | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  scheduler?: {
    loadedModels?: string[]
    idleTimeoutMs?: number
    memoryUsage?: { rss: number }
  }
  memoryUsage?: { rss: number }
  privacy?: SentinelConfig
  version?: string
  memFallback?: boolean
  telemetry?: {
    lastLatencyMs: number | null
    lastTokensPerSecond: number | null
    lastPromptTokens: number | null
    lastCompletionTokens: number | null
    lastTotalTokens: number | null
    updatedAt: string | null
  }
}
