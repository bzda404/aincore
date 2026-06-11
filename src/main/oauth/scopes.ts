/**
 * OAuth 2.0 Scopes — 作用域定义与校验
 *
 * AinCore OAuth 是本地 UDS-based 的 OAuth 2.0 实现。
 * 作用域用于限制第三方应用的权限范围。
 */

export type Scope =
  | 'inference:read'
  | 'models:read'
  | 'models:manage'
  | 'knowledge:read'
  | 'knowledge:write'
  | 'system:status'
  | 'offline_access'

/** 所有可用作用域及其中文描述 */
export const SCOPE_DEFINITIONS: Record<Scope, { description: string; category: 'inference' | 'models' | 'knowledge' | 'system' | 'special' }> = {
  'inference:read': {
    description: '调用模型推理（聊天/补全）',
    category: 'inference',
  },
  'models:read': {
    description: '列出已安装的模型',
    category: 'models',
  },
  'models:manage': {
    description: '加载/卸载模型',
    category: 'models',
  },
  'knowledge:read': {
    description: '读取知识库内容',
    category: 'knowledge',
  },
  'knowledge:write': {
    description: '写入知识库内容',
    category: 'knowledge',
  },
  'system:status': {
    description: '读取系统状态',
    category: 'system',
  },
  'offline_access': {
    description: '允许刷新令牌（长期访问）',
    category: 'special',
  },
}

/** 将空格分隔的作用域字符串解析为 Scope 数组 */
export function parseScopeString(scopeStr: string): Scope[] {
  return scopeStr
    .split(/\s+/)
    .filter((s): s is Scope => s in SCOPE_DEFINITIONS)
}

/** 将 Scope 数组序列化为空格分隔字符串 */
export function formatScope(scopes: Scope[]): string {
  return scopes.join(' ')
}

/** 校验请求的作用域是否合法（至少需要一个非 offline_access 作用域） */
export function validateScopes(scopes: Scope[]): { valid: boolean; reason?: string } {
  if (scopes.length === 0) {
    return { valid: false, reason: '至少需要请求一个作用域' }
  }

  const actionable = scopes.filter(s => s !== 'offline_access')
  if (actionable.length === 0) {
    return { valid: false, reason: 'offline_access 必须与其他作用域一起请求' }
  }

  for (const scope of scopes) {
    if (!(scope in SCOPE_DEFINITIONS)) {
      return { valid: false, reason: `未知作用域: ${scope}` }
    }
  }

  return { valid: true }
}

/** 检查 granted scopes 是否覆盖请求的 required scope */
export function scopeCovers(granted: Scope[], required: Scope): boolean {
  if (granted.includes(required)) return true
  // knowledge:write 隐含 knowledge:read
  if (required === 'knowledge:read' && granted.includes('knowledge:write')) return true
  return false
}

/** 获取推荐的默认作用域（用于 Notes 这种第一方应用） */
export function getDefaultScopes(): Scope[] {
  return [
    'inference:read',
    'models:read',
    'knowledge:read',
    'knowledge:write',
    'system:status',
    'offline_access',
  ]
}

/** 获取只读作用域 */
export function getReadOnlyScopes(): Scope[] {
  return ['inference:read', 'models:read', 'knowledge:read', 'system:status']
}
