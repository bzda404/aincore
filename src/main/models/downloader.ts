/**
 * Model Downloader — 多源模型下载器
 *
 * 支持从以下来源下载 GGUF 模型:
 *   1. HuggingFace (hf-mirror.com)
 *   2. ModelScope (modelscope.cn)
 *
 * 支持:
 *   - 流式下载 + 进度回调
 *   - 断点续传 (通过 If-Range 头部)
 *   - 下载队列管理
 *   - 取消下载
 *   - SHA256 校验
 */
import { createWriteStream, existsSync, mkdirSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import { createHash } from 'crypto'

export type ModelSourceType = 'huggingface' | 'modelscope' | 'local'

export interface ModelDownloadOptions {
  /** 文件名 (含 .gguf 后缀) */
  filename: string
  /** 模型源类型 */
  sourceType: ModelSourceType
  /** 下载 URL 或 URI (hf://, modelscope://, https://) */
  sourceUrl: string
  /** 量化方法 */
  quantization: string
  /** 期望的 SHA256 (可选，用于校验) */
  expectedChecksum?: string
}

export interface DownloadProgress {
  filename: string
  percent: number
  downloadedBytes: number
  totalBytes: number
  speed: number           // bytes/sec
  status: 'downloading' | 'verifying' | 'done' | 'error'
  error?: string
}

export interface DownloadResult {
  filePath: string
  sizeBytes: number
  checksum: string | null
}

let activeAbortController: AbortController | null = null
let activeFilename: string | null = null

function getModelDir(): string {
  const dir = join(app.getPath('userData'), 'models')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * 解析源 URL 到实际 HTTPS 下载地址
 */
export function resolveDownloadUrl(sourceType: ModelSourceType, sourceUrl: string, filename: string): string {
  if (sourceType === 'huggingface') {
    if (sourceUrl.startsWith('hf://')) {
      const parts = sourceUrl.replace('hf://', '').split('/')
      const org = parts[0]
      const model = parts[1]
      return `https://hf-mirror.com/${org}/${model}/resolve/main/${filename}`
    }
    return sourceUrl
  }

  if (sourceType === 'modelscope') {
    if (sourceUrl.startsWith('modelscope://')) {
      const parts = sourceUrl.replace('modelscope://', '').split('/')
      const org = parts[0]
      const model = parts[1]
      return `https://modelscope.cn/models/${org}/${model}/resolve/master/${filename}`
    }
    return sourceUrl
  }

  // local — direct path or URL
  return sourceUrl
}

/**
 * 计算文件 SHA256
 */
export async function computeFileSHA256(filePath: string): Promise<string> {
  const { readFile } = await import('fs/promises')
  const buffer = await readFile(filePath)
  const hash = createHash('sha256')
  hash.update(buffer)
  return hash.digest('hex')
}

/**
 * 下载模型文件
 *
 * @returns 本地文件路径
 */
export async function downloadModelFile(
  options: ModelDownloadOptions,
  onProgress: (progress: DownloadProgress) => void
): Promise<DownloadResult> {
  const destPath = join(getModelDir(), options.filename)
  const downloadUrl = resolveDownloadUrl(options.sourceType, options.sourceUrl, options.filename)

  // 断点续传: 检查已有文件
  let resumeFrom = 0
  if (existsSync(destPath)) {
    const existingStat = statSync(destPath)

    // If checksum available, verify whether existing file is complete
    if (options.expectedChecksum) {
      onProgress({ filename: options.filename, percent: 99, downloadedBytes: existingStat.size, totalBytes: existingStat.size, speed: 0, status: 'verifying' })
      const actual = await computeFileSHA256(destPath)
      if (actual === options.expectedChecksum.toLowerCase()) {
        // File is complete and verified
        onProgress({ filename: options.filename, percent: 100, downloadedBytes: existingStat.size, totalBytes: existingStat.size, speed: 0, status: 'done' })
        return { filePath: destPath, sizeBytes: existingStat.size, checksum: actual }
      }
      // Checksum mismatch — resume download from current file size
      resumeFrom = existingStat.size
    } else {
      // No checksum — use HTTP HEAD to check expected size
      try {
        const headRes = await fetch(downloadUrl, {
          method: 'HEAD',
          redirect: 'follow',
          signal: AbortSignal.timeout(10000),
        })
        const expectedSize = headRes.headers.get('content-length')
        if (expectedSize && existingStat.size >= parseInt(expectedSize, 10)) {
          // File size matches or exceeds expected — assume complete
          onProgress({ filename: options.filename, percent: 100, downloadedBytes: existingStat.size, totalBytes: existingStat.size, speed: 0, status: 'done' })
          return { filePath: destPath, sizeBytes: existingStat.size, checksum: null }
        }
      } catch { /* HEAD request failed, proceed with resume */ }
      resumeFrom = existingStat.size
    }
  }

  // 发起下载
  activeAbortController = new AbortController()
  activeFilename = options.filename

  const headers: Record<string, string> = {}
  if (resumeFrom > 0) {
    headers['Range'] = `bytes=${resumeFrom}-`
  }

  const response = await fetch(downloadUrl, {
    signal: activeAbortController.signal,
    redirect: 'follow',
    headers,
  })

  if (!response.ok && response.status !== 206) {
    throw new Error(`下载失败: HTTP ${response.status}`)
  }

  const contentLength = response.headers.get('content-length')
  const totalBytes = contentLength ? (resumeFrom + parseInt(contentLength, 10)) : 0
  let downloadedBytes = resumeFrom
  let lastTime = Date.now()
  let lastBytes = downloadedBytes

  const nodeStream = Readable.fromWeb(response.body as any)
  const writeStream = createWriteStream(destPath, resumeFrom > 0 ? { flags: 'a' } : {})

  const { Transform } = await import('stream')
  const progressStream = new Transform({
    transform(chunk: Buffer, _encoding: string, callback: (err?: Error | null, data?: Buffer) => void) {
      downloadedBytes += chunk.length

      const now = Date.now()
      if (now - lastTime >= 500) {
        const elapsed = (now - lastTime) / 1000
        const speed = (downloadedBytes - lastBytes) / elapsed
        lastTime = now
        lastBytes = downloadedBytes

        onProgress({
          filename: options.filename,
          percent: totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : 0,
          downloadedBytes,
          totalBytes,
          speed,
          status: 'downloading',
        })
      }

      callback(null, chunk)
    },
  })

  try {
    await pipeline(nodeStream, progressStream, writeStream)
  } catch (err) {
    activeAbortController = null
    activeFilename = null
    onProgress({
      filename: options.filename,
      percent: 0, downloadedBytes: 0, totalBytes: 0, speed: 0,
      status: 'error',
      error: String(err),
    })
    throw err
  }

  // SHA256 校验
  if (options.expectedChecksum) {
    onProgress({ filename: options.filename, percent: 100, downloadedBytes, totalBytes, speed: 0, status: 'verifying' })
    const actual = await computeFileSHA256(destPath)
    if (actual !== options.expectedChecksum.toLowerCase()) {
      // 校验失败，删除文件
      try { unlinkSync(destPath) } catch { /* ignore */ }
      activeAbortController = null
      activeFilename = null
      throw new Error(`SHA256 校验失败: 期望 ${options.expectedChecksum}, 实际 ${actual}`)
    }
  }

  const finalStat = statSync(destPath)
  const checksum = options.expectedChecksum || await computeFileSHA256(destPath)

  onProgress({
    filename: options.filename,
    percent: 100,
    downloadedBytes: finalStat.size,
    totalBytes: finalStat.size,
    speed: 0,
    status: 'done',
  })

  activeAbortController = null
  activeFilename = null

  return { filePath: destPath, sizeBytes: finalStat.size, checksum }
}

/** 取消当前下载 */
export function cancelDownload(): void {
  if (activeAbortController) {
    activeAbortController.abort()
    activeAbortController = null
    activeFilename = null
  }
}

/** 是否正在下载 */
export function isDownloading(): boolean {
  return activeAbortController !== null
}

/** 当前下载的文件名 */
export function getCurrentDownloadFilename(): string | null {
  return activeFilename
}

/** 删除模型文件 */
export function deleteModelFile(filePath: string): boolean {
  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath)
      return true
    }
    return false
  } catch {
    return false
  }
}
