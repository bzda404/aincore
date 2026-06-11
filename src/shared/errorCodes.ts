/**
 * MindVault 统一错误码体系
 *
 * 所有 JSON-RPC 错误和前端错误消息都使用此模块定义的结构化错误码，
 * 配合 i18n 的 `error.*` keys 实现多语言用户友好提示。
 */

// ============================================================
// Error Code Enum
// ============================================================

export const ErrorCode = {
  // Core 运行时
  CORE_NOT_RUNNING: 'CORE_NOT_RUNNING',
  CORE_INIT_FAILED: 'CORE_INIT_FAILED',

  // 模型相关
  MODEL_NOT_FOUND: 'MODEL_NOT_FOUND',
  MODEL_TOO_LARGE: 'MODEL_TOO_LARGE',
  MODEL_LOAD_FAILED: 'MODEL_LOAD_FAILED',
  MODEL_UNLOAD_FAILED: 'MODEL_UNLOAD_FAILED',

  // 下载相关
  DOWNLOAD_FAILED: 'DOWNLOAD_FAILED',
  DOWNLOAD_CANCELLED: 'DOWNLOAD_CANCELLED',

  // 存储相关
  DISK_FULL: 'DISK_FULL',

  // 权限 / 授权
  OAUTH_EXPIRED: 'OAUTH_EXPIRED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  MODEL_NOT_AUTHORIZED: 'MODEL_NOT_AUTHORIZED',
  KB_NOT_AUTHORIZED: 'KB_NOT_AUTHORIZED',

  // 网络
  NETWORK_ERROR: 'NETWORK_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',

  // JSON-RPC
  PARSE_ERROR: 'PARSE_ERROR',
  INVALID_PARAMS: 'INVALID_PARAMS',
  METHOD_NOT_FOUND: 'METHOD_NOT_FOUND',

  // 应用管理
  APP_OPEN_FAILED: 'APP_OPEN_FAILED',
  APP_INSTALL_FAILED: 'APP_INSTALL_FAILED',
  APP_UNINSTALL_FAILED: 'APP_UNINSTALL_FAILED',
  APP_REVOKE_FAILED: 'APP_REVOKE_FAILED',

  // 隐私 / 审计
  CONFIG_UPDATE_FAILED: 'CONFIG_UPDATE_FAILED',
  EXPORT_FAILED: 'EXPORT_FAILED',
  CLEAR_FAILED: 'CLEAR_FAILED',

  // AI (Notes)
  AI_NOT_READY: 'AI_NOT_READY',
  AI_CONNECTION_LOST: 'AI_CONNECTION_LOST',

  // 通用
  UNKNOWN: 'UNKNOWN',
} as const

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode]

// ============================================================
// MindVaultError class
// ============================================================

export class MindVaultError extends Error {
  public readonly code: ErrorCodeValue
  public readonly details?: Record<string, unknown>

  constructor(code: ErrorCodeValue, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'MindVaultError'
    this.code = code
    this.details = details
  }
}

// ============================================================
// i18n key mapping
// ============================================================

/**
 * 将 ErrorCode 映射到 i18n key。
 * 在 renderer 中使用：`t(errorI18nKey(errorCode))` 或 `t('error.' + errorCode)`
 */
export function errorI18nKey(code: ErrorCodeValue): string {
  return `error.${code}`
}

/**
 * 从服务端 JSON-RPC 错误中提取 ErrorCode。
 * 服务端在 error.data.code 中返回结构化错误码。
 */
export function extractErrorCode(err: unknown): ErrorCodeValue {
  if (err instanceof MindVaultError) return err.code
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>
    // JSON-RPC error with data.code
    if (e.data && typeof e.data === 'object') {
      const data = e.data as Record<string, unknown>
      if (typeof data.code === 'string') return data.code as ErrorCodeValue
    }
    // Direct code property
    if (typeof e.code === 'string') {
      const code = e.code as string
      if (Object.values(ErrorCode).includes(code as ErrorCodeValue)) {
        return code as ErrorCodeValue
      }
    }
    // Error message matching
    const msg = String(e.message || e)
    if (msg.includes('未授权') || msg.includes('Unauthorized')) return ErrorCode.PERMISSION_DENIED
    if (msg.includes('Model not found') || msg.includes('模型不存在')) return ErrorCode.MODEL_NOT_FOUND
    if (msg.includes('Core 未连接') || msg.includes('not running')) return ErrorCode.CORE_NOT_RUNNING
  }
  return ErrorCode.UNKNOWN
}

// ============================================================
// JSON-RPC error codes (standard + custom)
// ============================================================

export const JsonRpcErrorCode = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  // Custom application errors
  RATE_LIMITED: -32429,
  UNAUTHORIZED: -32001,
  MODEL_NOT_FOUND: -32010,
  MODEL_TOO_LARGE: -32011,
  DOWNLOAD_FAILED: -32020,
} as const

/**
 * 构建带结构化错误码的 JSON-RPC 错误响应
 */
export function buildJsonRpcError(
  jsonRpcCode: number,
  message: string,
  appCode?: ErrorCodeValue,
  id?: number | string | null,
): { jsonrpc: '2.0'; id: number | string | null; error: { code: number; message: string; data?: { code: string } } } {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: {
      code: jsonRpcCode,
      message,
      ...(appCode ? { data: { code: appCode } } : {}),
    },
  }
}
