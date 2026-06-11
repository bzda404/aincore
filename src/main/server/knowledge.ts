/**
 * Knowledge-base JSON-RPC routes for third-party SDK callers.
 * These handlers are mounted behind server/index.ts session checks and
 * additionally constrain all filesystem access to the app's granted KB roots.
 *
 * Privacy interceptor: All read/write operations pass through the Privacy
 * Sentinel for PII detection. High-sensitivity PII is auto-desensitized,
 * medium triggers user consent, low is logged only.
 */
import { mkdir, readdir, readFile, stat, writeFile } from 'fs/promises'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'path'
import type { KbPermissionScope } from '../store/authDb'
import { getGrantedKbRoots, isPathInside, resolveAuthContext } from './access'
import { desensitizeText, detectPII, interceptPrivacyRequest } from '../privacy/sentinel'
import type { PiiSensitivity } from '../privacy/sentinel'

type RegisterRoute = (method: string, path: string, handler: (params: Record<string, unknown>) => Promise<unknown>) => void

interface SearchResult {
  path: string
  title: string
  snippet: string
  score: number
}

interface NoteListItem {
  path: string
  title: string
  size: number
  lastModified: string
  isDirectory: boolean
}

function resolveGrantedPath(params: Record<string, unknown>, requestedPath?: string, requiredScope: KbPermissionScope = 'read'): string {
  const ctx = resolveAuthContext(params)
  const grantedRoots = getGrantedKbRoots(ctx, requiredScope)
  if (grantedRoots.length === 0) {
    throw new Error(requiredScope === 'read_write'
      ? '未授权：此应用没有任何知识库写入权限'
      : '未授权：此应用没有任何知识库访问权限')
  }

  if (!requestedPath) return grantedRoots[0]

  const candidate = isAbsolute(requestedPath)
    ? resolve(requestedPath)
    : resolve(grantedRoots[0], requestedPath)

  if (!grantedRoots.some(root => isPathInside(root, candidate))) {
    throw new Error(requiredScope === 'read_write' ? '未授权写入该知识库' : '未授权访问该知识库')
  }

  return candidate
}

function normalizeSnippet(content: string, query: string): string {
  const queryLower = query.toLowerCase()
  const contentLower = content.toLowerCase()
  const index = contentLower.indexOf(queryLower)
  if (index === -1) return content.slice(0, 160)

  const start = Math.max(0, index - 60)
  const end = Math.min(content.length, index + query.length + 100)
  return content.slice(start, end).replace(/\s+/g, ' ').trim()
}

function countOccurrences(content: string, query: string): number {
  if (!query) return 0
  let count = 0
  let index = 0
  while (true) {
    const found = content.indexOf(query, index)
    if (found === -1) break
    count++
    index = found + query.length
  }
  return count
}

async function searchMarkdown(root: string, query: string, limit: number): Promise<SearchResult[]> {
  const results: SearchResult[] = []
  const queryLower = query.toLowerCase()

  async function walk(dir: string): Promise<void> {
    if (results.length >= limit) return

    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (results.length >= limit) return
      if (entry.name.startsWith('.')) continue

      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath)
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const content = await readFile(fullPath, 'utf-8')
        const contentLower = content.toLowerCase()
        const matchCount = countOccurrences(contentLower, queryLower)
        if (matchCount > 0) {
          results.push({
            path: fullPath,
            title: basename(entry.name, '.md'),
            snippet: normalizeSnippet(content, query),
            score: matchCount / Math.max(1, content.length / 1000),
          })
        }
      }
    }
  }

  await walk(root)
  return results.sort((a, b) => b.score - a.score).slice(0, limit)
}

async function listMarkdownNotes(root: string, recursive: boolean): Promise<NoteListItem[]> {
  const notes: NoteListItem[] = []

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue

      const fullPath = join(dir, entry.name)
      const info = await stat(fullPath)
      if (entry.isDirectory()) {
        notes.push({
          path: fullPath,
          title: entry.name,
          size: 0,
          lastModified: info.mtime.toISOString(),
          isDirectory: true,
        })
        if (recursive) await walk(fullPath)
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        notes.push({
          path: fullPath,
          title: basename(entry.name, '.md'),
          size: info.size,
          lastModified: info.mtime.toISOString(),
          isDirectory: false,
        })
      }
    }
  }

  await walk(root)
  return notes
}

export function registerKnowledgeRoutes(registerRoute: RegisterRoute): void {
  registerRoute('search_notes', '', async(params) => {
    const query = String(params.query || '').trim()
    const kb = params.kb ? String(params.kb) : undefined
    const limit = typeof params.limit === 'number' ? params.limit : 20
    if (!query) return []

    const root = resolveGrantedPath(params, kb)
    return searchMarkdown(root, query, limit)
  })

  registerRoute('read_note', '', async(params) => {
    const notePath = resolveGrantedPath(params, String(params.path || ''))
    const content = await readFile(notePath, 'utf-8')
    const info = await stat(notePath)

    // Privacy interceptor for read operations
    const clientName = resolveClientName(params)
    const processedContent = await applyPrivacyInterceptor(
      content, 'read_note', clientName, 'read'
    )

    return {
      content: processedContent,
      metadata: {
        title: basename(notePath, extname(notePath)),
        size: info.size,
        lastModified: info.mtime.toISOString(),
      },
    }
  })

  registerRoute('list_notes', '', async(params) => {
    const kb = params.kb ? String(params.kb) : undefined
    const recursive = typeof params.recursive === 'boolean' ? params.recursive : false
    const root = resolveGrantedPath(params, kb)
    return listMarkdownNotes(root, recursive)
  })

  registerRoute('write_note', '', async(params) => {
    const notePath = resolveGrantedPath(params, String(params.path || ''), 'read_write')
    const content = String(params.content || '')

    // Privacy interceptor for write operations
    const clientName = resolveClientName(params)
    const processedContent = await applyPrivacyInterceptor(
      content, 'write_note', clientName, 'write'
    )

    await mkdir(dirname(notePath), { recursive: true })
    await writeFile(notePath, processedContent, 'utf-8')
    return { success: true, path: notePath }
  })

  registerRoute('get_context', '', async(params) => {
    const notePath = resolveGrantedPath(params, String(params.path || ''))
    const range = Array.isArray(params.range) ? params.range as [number, number] : undefined
    const content = await readFile(notePath, 'utf-8')
    const lines = content.split('\n')

    const clientName = resolveClientName(params)

    if (!range) {
      const ctx = lines.slice(0, 50).join('\n')
      const processedCtx = await applyPrivacyInterceptor(ctx, 'get_context', clientName, 'read')
      return { path: notePath, context: processedCtx, start: 1, end: Math.min(50, lines.length) }
    }

    const start = Math.max(1, Number(range[0]) || 1)
    const end = Math.max(start, Number(range[1]) || start)
    const ctx = lines.slice(start - 1, end).join('\n')
    const processedCtx = await applyPrivacyInterceptor(ctx, 'get_context', clientName, 'read')
    return {
      path: notePath,
      context: processedCtx,
      start,
      end: Math.min(end, lines.length),
    }
  })
}

// ============================================================
// Privacy Interceptor Helpers
// ============================================================

function resolveClientName(params: Record<string, unknown>): string {
  try {
    const ctx = resolveAuthContext(params)
    return (ctx as { app_id?: string }).app_id || 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * Apply privacy checks to content based on operation type.
 * - For 'read': intercepts response content through PII detection
 * - For 'write': intercepts input content before writing
 *
 * Sensitivity-based rules:
 * - high: auto-desensitize (non-blocking)
 * - medium: prompt user via consent popup
 * - low: log only, pass through
 */
async function applyPrivacyInterceptor(
  content: string,
  tool: string,
  clientName: string,
  operation: 'read' | 'write'
): Promise<string> {
  if (!content) return content

  const detections = detectPII(content)
  if (detections.length === 0) return content

  // Determine max sensitivity
  const sensitivityOrder: PiiSensitivity[] = ['low', 'medium', 'high']
  let maxSensitivity: PiiSensitivity = 'low'
  for (const d of detections) {
    if (sensitivityOrder.indexOf(d.sensitivity) > sensitivityOrder.indexOf(maxSensitivity)) {
      maxSensitivity = d.sensitivity
    }
  }

  // Use the sentinel interceptor which handles tiered logic
  const decision = await interceptPrivacyRequest(
    tool,
    { operation },
    clientName,
    undefined,
    content
  )

  if (!decision.allowed) {
    throw new Error('隐私检查未通过：内容包含敏感信息且用户拒绝访问')
  }

  if (decision.desensitize) {
    const result = desensitizeText(content)
    return result.masked
  }

  return content
}
