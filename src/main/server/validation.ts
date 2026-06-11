/**
 * JSON-RPC input validation schemas using Zod.
 *
 * Each key maps to a JSON-RPC method name. When a schema is defined,
 * incoming params are validated before the route handler executes.
 * Validation failures return INVALID_PARAMS (-32602).
 */
import { z } from 'zod'

// ============================================================
// Common schemas
// ============================================================

const nonEmptyString = z.string().min(1).max(500)
const optionalString = z.string().max(500).optional().default('')

// ============================================================
// Method schemas
// ============================================================

export const methodSchemas: Record<string, z.ZodType<unknown>> = {
  // App registration
  'app.register': z.object({
    name: nonEmptyString,
    vendor: optionalString,
    icon: optionalString,
    app_key_hash: optionalString,
  }),

  // Auth request
  'app.request_auth': z.object({
    app_id: nonEmptyString,
    models: z.array(z.string()).optional().default([]),
    knowledge_bases: z.array(z.object({
      path: z.string(),
      label: z.string().optional(),
      scope: z.enum(['read', 'read_write']).optional(),
    })).optional().default([]),
    timeout_ms: z.number().int().min(1000).max(600_000).optional().default(120_000),
  }),

  // Session-token methods
  'app.list_grants': z.object({
    session_token: nonEmptyString,
  }).passthrough(),

  'app.revoke_auth': z.object({
    session_token: nonEmptyString,
  }).passthrough(),

  'app.list_models': z.object({
    session_token: nonEmptyString,
  }).passthrough(),

  // Chat completions
  'chat.completions': z.object({
    messages: z.array(z.object({
      role: z.string(),
      content: z.string(),
    })).min(1).max(100),
    model: z.string().optional(),
    max_tokens: z.number().int().min(1).max(32_768).optional(),
    temperature: z.number().min(0).max(2).optional(),
    top_p: z.number().min(0).max(1).optional(),
    stream: z.boolean().optional(),
    stop: z.union([z.string(), z.array(z.string())]).optional(),
  }).passthrough(),

  // Knowledge base
  'search_notes': z.object({
    query: nonEmptyString,
    kb: z.string().optional(),
    limit: z.number().int().min(1).max(100).optional(),
  }).passthrough(),

  'read_note': z.object({
    path: nonEmptyString,
  }).passthrough(),

  'list_notes': z.object({
    kb: nonEmptyString,
    recursive: z.boolean().optional(),
  }).passthrough(),

  'write_note': z.object({
    path: nonEmptyString,
    content: z.string().max(10_000_000),
  }).passthrough(),

  'get_context': z.object({
    path: nonEmptyString,
    range: z.tuple([z.number(), z.number()]).optional(),
  }).passthrough(),

  // Auth internal
  'auth.grant': z.object({
    request_id: nonEmptyString,
    granted: z.boolean(),
    granted_models: z.array(z.string()).optional(),
    granted_kbs: z.array(z.unknown()).optional(),
    duration_hours: z.number().optional(),
  }).passthrough(),

  'auth.revoke': z.object({
    auth_id: nonEmptyString,
  }).passthrough(),

  'auth.audit_log': z.object({
    app_id: z.string().optional(),
    limit: z.number().int().min(1).max(10000).optional(),
  }).passthrough(),

  // OpenAI-compatible routes
  'POST:/v1/chat/completions': z.object({
    messages: z.array(z.object({
      role: z.string(),
      content: z.string(),
    })).min(1).max(100),
    model: z.string().optional(),
    max_tokens: z.number().int().min(1).max(32_768).optional(),
    temperature: z.number().min(0).max(2).optional(),
  }).passthrough(),
}

/**
 * Validate params against the schema for a given method.
 * Returns the validated (and potentially coerced) params, or throws on failure.
 */
export function validateParams(method: string, params: Record<string, unknown>): Record<string, unknown> {
  const schema = methodSchemas[method]
  if (!schema) {
    // No schema defined — pass through
    return params
  }

  const result = schema.safeParse(params)
  if (!result.success) {
    const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')
    const err = new Error(`Invalid params: ${issues}`)
    ;(err as Record<string, unknown>)._isValidationError = true
    throw err
  }

  return result.data as Record<string, unknown>
}
