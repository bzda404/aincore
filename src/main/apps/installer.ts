/**
 * AinCore Package Installer — `.aincore` 应用包安装
 *
 * 处理 .aincore 包的下载、校验、解压、manifest 验证和安装注册。
 *
 * .aincore = gzip 压缩的 tar 归档，包含:
 *   manifest.json   — 应用元数据 (必需)
 *   icon.png        — 应用图标 (可选)
 *   bundle/         — 应用代码
 */
import { createWriteStream, existsSync, mkdirSync, rmSync, readFileSync, createReadStream } from 'fs'
import { join, basename } from 'path'
import { app } from 'electron'
import { createHash } from 'crypto'
import { installApplication, uninstallApplication } from '../apps/manager'
import type { InstalledApp } from '../apps/store'

// ============================================================
// Types
// ============================================================

export interface AppManifest {
  app_id: string
  name: string
  version: string
  vendor?: string
  description?: string
  icon?: string
  category?: string
  entry_point: string
  min_core_version: string
  required_scopes: string[]
  permissions?: {
    network?: boolean
    filesystem?: boolean
    gpu?: boolean
  }
  homepage?: string
  repository?: string
  license?: string
  sandbox?: boolean
}

export interface InstallResult {
  success: boolean
  app?: InstalledApp
  error?: string
  manifest?: AppManifest
}

export interface InstallProgress {
  phase: 'downloading' | 'verifying' | 'extracting' | 'validating' | 'installing' | 'done' | 'error'
  percent: number
  detail?: string
}

// ============================================================
// Known valid OAuth scopes
// ============================================================

const KNOWN_SCOPES = new Set([
  'inference:read',
  'models:read',
  'models:manage',
  'knowledge:read',
  'knowledge:write',
  'system:status',
  'offline_access',
])

// ============================================================
// Manifest validation
// ============================================================

export function validateManifest(manifest: unknown): { valid: boolean; error?: string; manifest?: AppManifest } {
  if (!manifest || typeof manifest !== 'object') {
    return { valid: false, error: 'manifest.json 不是有效的 JSON 对象' }
  }

  const m = manifest as Record<string, unknown>

  // Required string fields
  for (const field of ['app_id', 'name', 'version', 'entry_point', 'min_core_version']) {
    if (typeof m[field] !== 'string' || !(m[field] as string).trim()) {
      return { valid: false, error: `缺少必填字段: ${field}` }
    }
  }

  // version must be semver
  if (!/^\d+\.\d+\.\d+/.test(m.version as string)) {
    return { valid: false, error: `版本号格式无效: ${m.version}` }
  }

  // required_scopes must be array of valid scopes
  if (!Array.isArray(m.required_scopes)) {
    return { valid: false, error: 'required_scopes 必须是字符串数组' }
  }

  for (const scope of m.required_scopes) {
    if (typeof scope !== 'string' || !KNOWN_SCOPES.has(scope)) {
      return { valid: false, error: `未知的 OAuth 作用域: ${scope}` }
    }
  }

  return {
    valid: true,
    manifest: {
      app_id: m.app_id as string,
      name: m.name as string,
      version: m.version as string,
      vendor: typeof m.vendor === 'string' ? m.vendor : undefined,
      description: typeof m.description === 'string' ? m.description : undefined,
      icon: typeof m.icon === 'string' ? m.icon : undefined,
      category: typeof m.category === 'string' ? m.category : undefined,
      entry_point: m.entry_point as string,
      min_core_version: m.min_core_version as string,
      required_scopes: m.required_scopes as string[],
      permissions: m.permissions as AppManifest['permissions'],
      homepage: typeof m.homepage === 'string' ? m.homepage : undefined,
      repository: typeof m.repository === 'string' ? m.repository : undefined,
      license: typeof m.license === 'string' ? m.license : undefined,
      sandbox: m.sandbox !== false,
    },
  }
}

// ============================================================
// File operations
// ============================================================

function getAppsDir(): string {
  const dir = join(app.getPath('userData'), 'apps')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function getTempDir(): string {
  const dir = join(app.getPath('userData'), 'tmp')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * 计算文件 SHA256（流式，避免将整个大文件读入内存）
 */
export async function computeSHA256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

/**
 * 解压 tar.gz 归档
 *
 * 使用 Node.js 内置 zlib + tar 处理。
 * 如果 tar 模块不可用，回退到使用系统 tar 命令。
 */
async function extractTarGz(archivePath: string, destDir: string): Promise<void> {
  try {
    // 尝试使用内置模块
    const { createGunzip } = await import('zlib')
    const { createReadStream } = await import('fs')
    const { pipeline } = await import('stream/promises')
    const { spawn } = await import('child_process')

    // 使用系统 tar 命令 (最可靠)
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('tar', ['-xzf', archivePath, '-C', destDir], {
        stdio: 'ignore',
      })
      proc.on('close', (code: number) => {
        if (code === 0) resolve()
        else reject(new Error(`tar 解压失败 (exit ${code})`))
      })
      proc.on('error', reject)
    })
  } catch {
    throw new Error('无法解压 .aincore 包 (需要 tar 命令)')
  }
}

// ============================================================
// Main install flow
// ============================================================

/**
 * 从本地文件安装 .aincore 包
 */
export async function installFromFile(
  filePath: string,
  expectedChecksum?: string,
  onProgress?: (progress: InstallProgress) => void,
): Promise<InstallResult> {
  const report = (phase: InstallProgress['phase'], percent: number, detail?: string) => {
    onProgress?.({ phase, percent, detail })
  }

  report('verifying', 0, '校验文件完整性...')

  // 1. SHA256 校验
  if (expectedChecksum) {
    const actual = await computeSHA256(filePath)
    if (actual !== expectedChecksum.toLowerCase()) {
      return { success: false, error: `SHA256 校验失败: 期望 ${expectedChecksum}, 实际 ${actual}` }
    }
  }

  report('extracting', 20, '解压应用包...')

  // 2. 解压到临时目录
  const tempDir = join(getTempDir(), `install_${Date.now()}`)
  mkdirSync(tempDir, { recursive: true })

  try {
    await extractTarGz(filePath, tempDir)
  } catch (err) {
    rmSync(tempDir, { recursive: true, force: true })
    return { success: false, error: `解压失败: ${String(err)}` }
  }

  report('validating', 40, '验证应用清单...')

  // 3. 读取并验证 manifest.json
  let manifest: AppManifest
  try {
    const manifestPath = join(tempDir, 'manifest.json')
    if (!existsSync(manifestPath)) {
      throw new Error('archive 中未找到 manifest.json')
    }
    const raw = JSON.parse(readFileSync(manifestPath, 'utf-8'))
    const result = validateManifest(raw)
    if (!result.valid || !result.manifest) {
      throw new Error(result.error || 'manifest 验证失败')
    }
    manifest = result.manifest
  } catch (err) {
    rmSync(tempDir, { recursive: true, force: true })
    return { success: false, error: `manifest 无效: ${String(err)}` }
  }

  report('installing', 70, `安装 ${manifest.name} v${manifest.version}...`)

  // 4. 复制到 apps 目录
  const installDir = join(getAppsDir(), manifest.app_id)
  if (existsSync(installDir)) {
    rmSync(installDir, { recursive: true, force: true })
  }

  try {
    // 移动而非复制
    const { renameSync } = await import('fs')
    renameSync(tempDir, installDir)
  } catch {
    // 降级：手动复制
    const { cpSync } = await import('fs')
    cpSync(tempDir, installDir, { recursive: true })
    rmSync(tempDir, { recursive: true, force: true })
  }

  // 5. 在数据库中注册
  const installed = await installApplication({
    app_id: manifest.app_id,
    name: manifest.name,
    version: manifest.version,
    vendor: manifest.vendor || '',
    icon: manifest.icon || '',
    description: manifest.description || '',
    entry_point: manifest.entry_point || 'bundle/index.js',
  })

  report('done', 100, `${manifest.name} v${manifest.version} 安装完成`)

  return { success: true, app: installed, manifest }
}

/**
 * 从 URL 下载并安装 .aincore 包
 */
export async function installFromUrl(
  url: string,
  expectedChecksum?: string,
  onProgress?: (progress: InstallProgress) => void,
): Promise<InstallResult> {
  const report = (phase: InstallProgress['phase'], percent: number, detail?: string) => {
    onProgress?.({ phase, percent, detail })
  }

  report('downloading', 0, `下载 ${basename(url)}...`)

  // 1. 下载到临时文件
  const tempDir = getTempDir()
  const tempFile = join(tempDir, `download_${Date.now()}.aincore`)

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(300_000), // 5 min timeout
    })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const writeStream = createWriteStream(tempFile)
    const reader = response.body?.getReader()
    if (!reader) throw new Error('无法读取响应流')

    const contentLength = parseInt(response.headers.get('content-length') || '0', 10)
    let downloaded = 0

    // 流式写入
    const { Writable } = await import('stream')
    const progressStream = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        downloaded += chunk.length
        if (contentLength > 0) {
          const pct = Math.round((downloaded / contentLength) * 90) // 0-90% for download
          report('downloading', pct, `下载中 ${(downloaded / 1048576).toFixed(1)}MB`)
        }
        writeStream.write(chunk, callback)
      },
    })

    // Pipe the web stream to Node stream
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      await new Promise<void>((resolve, reject) => {
        progressStream.write(Buffer.from(value!), (err?: Error | null) => {
          if (err) reject(err)
          else resolve()
        })
      })
    }

    progressStream.end()
    await new Promise<void>(resolve => writeStream.close(() => resolve()))
  } catch (err) {
    try { rmSync(tempFile, { force: true }) } catch { /* ignore */ }
    return { success: false, error: `下载失败: ${String(err)}` }
  }

  // 2. 从文件安装
  return installFromFile(tempFile, expectedChecksum, (progress) => {
    // 将内部进度映射到外层 (下载占 0-90%, 安装占 90-100%)
    const mappedPct = progress.phase === 'done' ? 100 : 90 + Math.round(progress.percent * 0.1)
    onProgress?.({ ...progress, percent: mappedPct })
  })
}

/**
 * 从安装目录加载已安装应用的 manifest
 */
export function loadInstalledManifest(appId: string): AppManifest | null {
  const installDir = join(getAppsDir(), appId)
  const manifestPath = join(installDir, 'manifest.json')

  if (!existsSync(manifestPath)) return null

  try {
    const raw = JSON.parse(readFileSync(manifestPath, 'utf-8'))
    const result = validateManifest(raw)
    return result.manifest || null
  } catch {
    return null
  }
}

/**
 * 卸载 .aincore 应用（删除文件 + 数据库记录）
 */
export async function uninstallAinCoreApp(appId: string): Promise<boolean> {
  return uninstallApplication(appId)
}
