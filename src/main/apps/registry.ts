import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs'

/**
 * App Marketplace Client — GitHub 驱动的应用市场
 *
 * 通过 GitHub Search API 发现带有 `aincore-app` topic 的开源应用仓库，
 * 并通过 GitHub Releases API 获取版本信息和下载链接。
 *
 * 支持:
 *   - 浏览应用市场（搜索 GitHub topic）
 *   - 应用详情（仓库信息 + README）
 *   - 下载应用包（Release assets 中的 .aincore 文件）
 *   - 检查更新（对比本地版本与最新 Release）
 *
 * 速率限制:
 *   - 未认证: 60 req/h (Search: 10 req/min)
 *   - 配置 GITHUB_TOKEN 环境变量: 5000 req/h
 */

// ============================================================
// Types
// ============================================================

export interface MarketplaceApp {
  id: string
  name: string
  slug: string
  description: string
  icon_url: string
  category: string
  developer: string
  rating: number
  downloads: number
  latest_version: string
  status: 'approved' | 'pending'
  /** GitHub-specific fields */
  html_url: string
  stars: number
  topics: string[]
}

export interface MarketplaceAppVersion {
  id: string
  version: string
  changelog: string
  package_url: string
  checksum: string
  min_core_version: string
  published_at: string
}

// ============================================================
// Configuration
// ============================================================

/** The GitHub topic used to discover AinCore apps */
const APP_TOPIC = 'aincore-app'

/** File extension for AinCore app packages in release assets */
const APP_PACKAGE_EXT = '.aincore'

/** Optional GitHub token for higher rate limits (env var or runtime config) */
let githubToken: string | null = process.env.GITHUB_TOKEN || null

export function setGithubToken(token: string | null): void {
  githubToken = token
}

export function getGithubToken(): string | null {
  return githubToken
}

// ============================================================
// Token Persistence
// ============================================================

let tokenFilePath: string | null = null

export function initTokenPersistence(filePath: string): void {
  tokenFilePath = filePath
  try {
    if (existsSync(filePath)) {
      const token = readFileSync(filePath, 'utf-8').trim()
      if (token) setGithubToken(token)
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[Registry] Failed to load GitHub token:', err)
    }
  }
}

export function persistGithubToken(token: string | null): void {
  if (!tokenFilePath) return
  try {
    if (token) {
      writeFileSync(tokenFilePath, token, 'utf-8')
    } else {
      if (existsSync(tokenFilePath)) unlinkSync(tokenFilePath)
    }
  } catch (err) {
    console.warn('[Registry] Failed to persist GitHub token:', err)
  }
}

// ============================================================
// Simple cache to minimize API calls
// ============================================================

interface CacheEntry<T> {
  data: T
  expiresAt: number
}

const cache = new Map<string, CacheEntry<unknown>>()

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

function getCached<T>(key: string): T | null {
  const entry = cache.get(key)
  if (entry && entry.expiresAt > Date.now()) return entry.data as T
  cache.delete(key)
  return null
}

function setCache<T>(key: string, data: T): void {
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS })
}

export function clearMarketplaceCache(): void {
  cache.clear()
}

// ============================================================
// GitHub API helpers
// ============================================================

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (githubToken) {
    headers['Authorization'] = `Bearer ${githubToken}`
  }
  return headers
}

export class GitHubRateLimitError extends Error {
  readonly retryAfterSeconds: number
  constructor(retryAfterSeconds: number) {
    super(`GitHub API rate limit exceeded. Retry after ${retryAfterSeconds}s.`)
    this.name = 'GitHubRateLimitError'
    this.retryAfterSeconds = retryAfterSeconds
  }
}

async function githubFetch<T>(url: string, timeoutMs = 10000): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: githubHeaders(),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) {
      // Rate limit detection: 403 with X-RateLimit-Remaining: 0, or 429
      const remaining = res.headers.get('X-RateLimit-Remaining')
      if (res.status === 403 && remaining === '0') {
        const resetAt = Number(res.headers.get('X-RateLimit-Reset') || '0')
        const retryAfter = Math.max(resetAt - Math.floor(Date.now() / 1000), 60)
        console.warn(`[Marketplace] GitHub API rate limit exceeded. Retry after ${retryAfter}s.`)
        throw new GitHubRateLimitError(retryAfter)
      }
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('Retry-After') || '60')
        console.warn(`[Marketplace] GitHub API 429. Retry after ${retryAfter}s.`)
        throw new GitHubRateLimitError(retryAfter)
      }
      console.warn(`[Marketplace] GitHub API 请求失败: ${res.status} ${url}`)
      return null
    }
    return (await res.json()) as T
  } catch (err) {
    if (err instanceof GitHubRateLimitError) throw err
    console.warn(`[Marketplace] GitHub API 请求出错:`, err)
    return null
  }
}

// ============================================================
// Public API
// ============================================================

/**
 * 浏览应用市场 — 搜索 GitHub topic
 */
export async function fetchMarketplaceApps(
  options: {
    category?: string
    search?: string
    page?: number
    limit?: number
  } = {}
): Promise<{ apps: MarketplaceApp[]; total: number }> {
  const page = options.page || 1
  const perPage = options.limit || 20

  // Build search query
  let query = `topic:${APP_TOPIC}`
  if (options.search) {
    query += ` ${options.search}`
  }
  if (options.category) {
    query += ` topic:${options.category}`
  }

  const cacheKey = `search:${query}:${page}:${perPage}`
  const cached = getCached<{ apps: MarketplaceApp[]; total: number }>(cacheKey)
  if (cached) return cached

  const params = new URLSearchParams({
    q: query,
    sort: 'stars',
    order: 'desc',
    per_page: String(perPage),
    page: String(page),
  })

  const data = await githubFetch<{
    total_count: number
    items: Array<{
      id: number
      full_name: string
      name: string
      description: string | null
      html_url: string
      owner: { login: string; avatar_url: string }
      stargazers_count: number
      topics: string[]
    }>
  }>(`https://api.github.com/search/repositories?${params.toString()}`)

  if (!data) {
    return { apps: [], total: 0 }
  }

  // Fetch latest release for each repo (in parallel, best-effort)
  const releasePromises = data.items.map(repo =>
    githubFetch<{ tag_name: string }>(
      `https://api.github.com/repos/${repo.full_name}/releases/latest`,
      5000,
    ).then(release => release?.tag_name || '')
  )
  const versions = await Promise.all(releasePromises)

  const apps: MarketplaceApp[] = data.items.map((repo, i) => ({
    id: repo.full_name,
    name: repo.name,
    slug: repo.name,
    description: repo.description || '',
    icon_url: repo.owner.avatar_url,
    category: repo.topics.find(t => t !== APP_TOPIC) || 'general',
    developer: repo.owner.login,
    rating: 0,
    downloads: repo.stargazers_count,
    latest_version: versions[i],
    status: 'approved' as const,
    html_url: repo.html_url,
    stars: repo.stargazers_count,
    topics: repo.topics,
  }))

  const result = { apps, total: data.total_count }
  setCache(cacheKey, result)
  return result
}

/**
 * 获取应用详情 — 仓库信息 + 最新 Release
 */
export async function fetchAppDetail(appId: string): Promise<MarketplaceApp | null> {
  const cacheKey = `detail:${appId}`
  const cached = getCached<MarketplaceApp>(cacheKey)
  if (cached) return cached

  const repo = await githubFetch<{
    id: number
    full_name: string
    name: string
    description: string | null
    html_url: string
    owner: { login: string; avatar_url: string }
    stargazers_count: number
    topics: string[]
  }>(`https://api.github.com/repos/${encodeURIComponent(appId.replace('/', '%2F'))}`)

  if (!repo) return null

  const release = await githubFetch<{ tag_name: string }>(
    `https://api.github.com/repos/${repo.full_name}/releases/latest`,
    5000,
  )

  const app: MarketplaceApp = {
    id: repo.full_name,
    name: repo.name,
    slug: repo.name,
    description: repo.description || '',
    icon_url: repo.owner.avatar_url,
    category: repo.topics.find(t => t !== APP_TOPIC) || 'general',
    developer: repo.owner.login,
    rating: 0,
    downloads: repo.stargazers_count,
    latest_version: release?.tag_name || '',
    status: 'approved',
    html_url: repo.html_url,
    stars: repo.stargazers_count,
    topics: repo.topics,
  }

  setCache(cacheKey, app)
  return app
}

/**
 * 获取应用版本列表 — GitHub Releases
 */
export async function fetchAppVersions(appId: string): Promise<MarketplaceAppVersion[]> {
  const cacheKey = `versions:${appId}`
  const cached = getCached<MarketplaceAppVersion[]>(cacheKey)
  if (cached) return cached

  const releases = await githubFetch<Array<{
    id: number
    tag_name: string
    body: string | null
    published_at: string
    assets: Array<{ name: string; browser_download_url: string }>
  }>>(`https://api.github.com/repos/${encodeURIComponent(appId.replace('/', '%2F'))}/releases?per_page=10`)

  if (!releases) return []

  const versions: MarketplaceAppVersion[] = releases
    .filter(r => r.assets.some(a => a.name.endsWith(APP_PACKAGE_EXT)))
    .map(r => {
      const pkg = r.assets.find(a => a.name.endsWith(APP_PACKAGE_EXT))!
      return {
        id: String(r.id),
        version: r.tag_name,
        changelog: r.body || '',
        package_url: pkg.browser_download_url,
        checksum: '', // GitHub doesn't provide checksums natively; could parse from a .sha256 asset
        min_core_version: '',
        published_at: r.published_at,
      }
    })

  setCache(cacheKey, versions)
  return versions
}

/**
 * 获取应用下载 URL — 从 GitHub Release assets 中查找 .aincore 文件
 */
export async function fetchAppDownloadUrl(appId: string, version: string): Promise<string | null> {
  const cacheKey = `download:${appId}:${version}`
  const cached = getCached<string>(cacheKey)
  if (cached) return cached

  // Find release by tag
  const release = await githubFetch<{
    assets: Array<{ name: string; browser_download_url: string }>
  }>(`https://api.github.com/repos/${encodeURIComponent(appId.replace('/', '%2F'))}/releases/tags/${encodeURIComponent(version)}`)

  if (!release) return null

  const pkg = release.assets.find(a => a.name.endsWith(APP_PACKAGE_EXT))
  if (!pkg) return null

  setCache(cacheKey, pkg.browser_download_url)
  return pkg.browser_download_url
}

/**
 * 检查已安装应用的更新
 */
export async function checkAppUpdates(installedApps: Array<{ marketplace_id: string; version: string }>): Promise<Array<{ marketplace_id: string; latest_version: string; has_update: boolean }>> {
  const results: Array<{ marketplace_id: string; latest_version: string; has_update: boolean }> = []

  for (const app of installedApps) {
    if (!app.marketplace_id) continue
    try {
      const detail = await fetchAppDetail(app.marketplace_id)
      if (detail) {
        results.push({
          marketplace_id: app.marketplace_id,
          latest_version: detail.latest_version,
          has_update: detail.latest_version !== '' && detail.latest_version !== app.version,
        })
      }
    } catch {
      // Skip update check failures
    }
  }

  return results
}
