/**
 * llama.cpp 引擎管理
 * 管理 llama-server 子进程的生命周期
 */
import { spawn, execSync, type ChildProcess } from 'child_process'
import { createServer, type Server } from 'net'
import { join } from 'path'
import { existsSync } from 'fs'
import { createServer as createHttpServer } from 'http'
import { app } from 'electron'
import { EventEmitter } from 'events'
import type { ModelInfo } from '../../shared/types'
import { parseParameterSizeToBillions } from '../corePolicy'

// ============================================================
// Events
// ============================================================
export const engineEvents = new EventEmitter()

interface EngineState {
  process: ChildProcess | null
  mockServer: Server | null
  currentModel: string | null
  currentModelInfo: ModelInfo | null
  baseUrl: string | null
  port: number | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  ctxSize: number
}

const state: EngineState = {
  process: null,
  mockServer: null,
  currentModel: null,
  currentModelInfo: null,
  baseUrl: null,
  port: null,
  status: 'idle',
  ctxSize: 2048,
}

let binaryPath = ''
let healthCheckTimer: ReturnType<typeof setInterval> | null = null
let restartCount = 0
const MAX_RESTARTS = 3

// OOM patterns to detect in stderr
const OOM_PATTERNS = [
  'out of memory',
  'failed to allocate',
  'mmap failed',
  'alloc_failed',
  'CUDA out of memory',
  'ggml_metal_graph_compute: command buffer',
]

export function initEngine(): void {
  const resourcesPath = app.isPackaged
    ? process.resourcesPath
    : join(__dirname, '..', '..', 'resources')

  const platform = process.platform
  const binName = platform === 'win32' ? 'llama-server.exe' : 'llama-server'
  binaryPath = join(resourcesPath, 'binaries', platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : 'linux', binName)
}

export function getLoadedEngine(): EngineState {
  return state
}

/**
 * 计算基于模型参数量的动态 ctx-size
 */
function computeCtxSize(model: ModelInfo): number {
  const billions = parseParameterSizeToBillions(model.parameterSize || '')
  if (billions === null) return 2048

  if (billions <= 0.5) return 4096
  if (billions <= 1) return 2048
  if (billions <= 3) return 1024
  return 512
}

/**
 * 加载模型到 llama.cpp 引擎
 */
export async function loadModel(model: ModelInfo, ctxSizeOverride?: number): Promise<void> {
  // 如果已有模型在运行，先卸载
  if (state.process || state.mockServer) {
    await unloadModel()
  }

  state.status = 'loading'
  state.currentModelInfo = model
  restartCount = 0

  const port = await findAvailablePort()
  state.port = port

  const ctxSize = ctxSizeOverride || computeCtxSize(model)
  state.ctxSize = ctxSize

  const args = [
    '-m', model.filePath,
    '--host', '127.0.0.1',
    '--port', String(port),
    '--ctx-size', String(ctxSize),
    '--parallel', '1',
    '-ngl', '-1',
    '--jinja', // 启用 Jinja 模板（GBNF 约束需要）
  ]

  try {
    if (shouldUseMockEngine()) {
      await startMockEngine(port, model)
      state.currentModel = model.id
      state.baseUrl = `http://127.0.0.1:${port}`
      state.status = 'ready'
      console.log(`[Engine] Mock 模型 ${model.name} 已加载，端口: ${port}`)
      await warmupModel()
      return
    }

    state.process = spawn(binaryPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    // Monitor stderr for OOM
    state.process.stderr?.on('data', (data: Buffer) => {
      const output = data.toString().toLowerCase()
      const isOOM = OOM_PATTERNS.some(pattern => output.includes(pattern))
      if (isOOM) {
        console.error('[Engine] OOM 检测到:', data.toString().trim())
        engineEvents.emit('oom', { modelId: model.id, ctxSize })
        handleOOM(model, ctxSize)
      }
    })

    state.process.on('exit', (code) => {
      const wasReady = state.status === 'ready'
      state.process = null
      state.currentModel = null
      state.currentModelInfo = null
      state.baseUrl = null
      state.port = null
      state.status = 'idle'
      stopHealthCheck()

      // Unexpected exit while ready — attempt restart
      if (wasReady && code !== 0 && code !== null) {
        console.warn(`[Engine] llama-server 意外退出 (code=${code})`)
        engineEvents.emit('unexpected-exit', { modelId: model.id, code })
        attemptRestart(model, ctxSize)
      }
    })

    state.process.on('error', (err) => {
      console.error('[Engine] 进程错误:', err)
      state.status = 'error'
    })

    // 等待健康检查通过
    await waitForHealthy(port)
    state.currentModel = model.id
    state.baseUrl = `http://127.0.0.1:${port}`
    state.status = 'ready'
    console.log(`[Engine] 模型 ${model.name} 已加载，端口: ${port}, ctx-size: ${ctxSize}`)

    // Start periodic health monitoring
    startHealthCheck(model, ctxSize)

    // Warmup model
    await warmupModel()
  } catch (err) {
    state.status = 'error'
    throw err
  }
}

/**
 * 卸载当前模型
 */
export async function unloadModel(): Promise<void> {
  stopHealthCheck()

  if (state.mockServer) {
    const server = state.mockServer
    state.mockServer = null
    state.process = null
    state.currentModel = null
    state.currentModelInfo = null
    state.baseUrl = null
    state.port = null
    state.status = 'idle'
    return new Promise<void>(resolve => server.close(() => resolve()))
  }

  if (state.process) {
    const proc = state.process
    state.process = null
    state.currentModel = null
    state.currentModelInfo = null
    state.baseUrl = null
    state.port = null
    state.status = 'idle'

    return new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        proc.kill('SIGKILL')
        resolve()
      }, 5000)

      proc.on('exit', () => {
        clearTimeout(timeout)
        resolve()
      })

      proc.kill('SIGTERM')
    })
  }
}

/**
 * 强制终止引擎进程（用于 graceful shutdown）
 */
export function killEngineProcess(): void {
  stopHealthCheck()
  if (state.process) {
    try {
      state.process.kill('SIGKILL')
    } catch { /* ignore */ }
    state.process = null
    state.currentModel = null
    state.currentModelInfo = null
    state.baseUrl = null
    state.port = null
    state.status = 'idle'
  }
  if (state.mockServer) {
    state.mockServer.close()
    state.mockServer = null
    state.status = 'idle'
  }
}

/**
 * 获取 llama-server 进程的 RSS 内存 (bytes)
 */
export function getEngineProcessRSS(): number {
  if (!state.process || !state.process.pid) return 0
  try {
    if (process.platform === 'win32') {
      // Windows: use tasklist (approximate)
      return 0
    }
    const output = execSync(`ps -o rss= -p ${state.process.pid}`, {
      encoding: 'utf-8',
      timeout: 2000,
    }).trim()
    // ps reports RSS in KB
    const rssKb = parseInt(output, 10)
    return Number.isFinite(rssKb) ? rssKb * 1024 : 0
  } catch {
    return 0
  }
}

// ============================================================
// OOM handling
// ============================================================

async function handleOOM(model: ModelInfo, currentCtxSize: number): Promise<void> {
  console.warn(`[Engine] OOM detected, unloading model ${model.id}`)
  await unloadModel()

  // Attempt reload with halved ctx-size
  const newCtxSize = Math.max(256, Math.floor(currentCtxSize / 2))
  console.log(`[Engine] Attempting reload with reduced ctx-size: ${currentCtxSize} → ${newCtxSize}`)

  try {
    await loadModel(model, newCtxSize)
  } catch (err) {
    console.error('[Engine] Reload after OOM failed:', err)
    engineEvents.emit('oom-reload-failed', { modelId: model.id })
  }
}

// ============================================================
// Process health monitoring
// ============================================================

function startHealthCheck(model: ModelInfo, ctxSize: number): void {
  stopHealthCheck()
  healthCheckTimer = setInterval(() => {
    checkProcessAlive(model, ctxSize)
  }, 30_000)
}

function stopHealthCheck(): void {
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer)
    healthCheckTimer = null
  }
}

function checkProcessAlive(model: ModelInfo, ctxSize: number): void {
  if (!state.process || state.status !== 'ready') return

  // Check if process is still alive
  try {
    // Sending signal 0 checks if process exists without killing it
    process.kill(state.process.pid!, 0)
  } catch {
    // Process is dead
    console.warn('[Engine] llama-server 进程已死亡，尝试重启')
    state.process = null
    state.currentModel = null
    state.currentModelInfo = null
    state.baseUrl = null
    state.port = null
    state.status = 'idle'
    attemptRestart(model, ctxSize)
  }
}

async function attemptRestart(model: ModelInfo, ctxSize: number): Promise<void> {
  if (restartCount >= MAX_RESTARTS) {
    console.error(`[Engine] 已达最大重启次数 (${MAX_RESTARTS}), 放弃重启`)
    engineEvents.emit('restart-exhausted', { modelId: model.id })
    return
  }
  restartCount++
  console.log(`[Engine] 尝试重启 (${restartCount}/${MAX_RESTARTS})...`)

  try {
    await loadModel(model, ctxSize)
    console.log(`[Engine] 重启成功`)
  } catch (err) {
    console.error(`[Engine] 重启失败:`, err)
  }
}

// ============================================================
// Model warmup
// ============================================================

async function warmupModel(): Promise<void> {
  if (!state.baseUrl || state.status !== 'ready') return

  try {
    await fetch(`${state.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: state.currentModel,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 1,
      }),
      signal: AbortSignal.timeout(10000),
    })
  } catch {
    // Warmup failure is non-critical
  }
}

// ============================================================
// Internal helpers
// ============================================================

function shouldUseMockEngine(): boolean {
  return process.env.AINCORE_CORE_MOCK_ENGINE === '1' || !binaryPath || !existsSync(binaryPath)
}

async function startMockEngine(port: number, model: ModelInfo): Promise<void> {
  const server = createHttpServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok' }))
      return
    }

    if (req.url === '/v1/chat/completions' || req.url === '/v1/completions') {
      let body = ''
      req.on('data', chunk => { body += chunk.toString() })
      req.on('end', () => {
        const prompt = extractPrompt(body)
        const content = `[Mock 模式] 已收到请求${prompt ? `：${prompt.slice(0, 100)}` : ''}。当前运行的是 Mock 引擎，请安装 llama-server 以获得真实 AI 推理能力。`
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          id: `mock-${Date.now()}`,
          object: 'chat.completion',
          model: model.id,
          choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
          usage: { prompt_tokens: Math.max(1, Math.round(prompt.length / 4)), completion_tokens: Math.max(1, Math.round(content.length / 4)), total_tokens: Math.max(2, Math.round((prompt.length + content.length) / 4)) },
        }))
      })
      return
    }

    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'not_found' }))
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  state.mockServer = server
}

function extractPrompt(body: string): string {
  try {
    const parsed = JSON.parse(body) as { messages?: Array<{ role?: string; content?: string }>; prompt?: string }
    if (typeof parsed.prompt === 'string') return parsed.prompt
    // Only extract user messages (skip system/assistant)
    return parsed.messages?.filter(m => m.role === 'user').map(m => m.content || '').filter(Boolean).join('\n') || ''
  } catch {
    return ''
  }
}

async function waitForHealthy(port: number, maxWait = 30000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < maxWait) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) })
      if (res.ok) return
    } catch { /* not ready yet */ }
    await new Promise(r => setTimeout(r, 500))
  }
  throw new Error('llama-server 启动超时')
}

async function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (typeof addr === 'object' && addr) {
        const port = addr.port
        server.close(() => resolve(port))
      } else {
        server.close()
        reject(new Error('无法分配端口'))
      }
    })
    server.on('error', reject)
  })
}
