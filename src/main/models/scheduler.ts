/**
 * Model Scheduler — 模型调度策略
 *
 * 管理 llama.cpp 引擎上模型的加载/卸载生命周期。
 *
 * 策略:
 *   1. 常驻模型池 — 用户可配置始终加载的模型
 *   2. 按需加载 — 请求到来时自动加载（LRU 淘汰）
 *   3. 空闲卸载 — 可配置的空闲超时自动卸载 (默认 5 分钟)
 *   4. 轻量模型预加载 — 启动时自动加载最优 ≤1B 模型
 *   5. 内存压力检测 — 在低内存时优先卸载大模型
 *
 * 与 corePolicy.ts 协作: corePolicy 处理 "能不能加载" ，scheduler 处理 "什么时候加载/卸载"。
 */
import { getLoadedEngine, loadModel, unloadModel, getEngineProcessRSS } from '../engine/llamaCpp'
import { listModels, getModel } from '../store/modelDb'
import { selectDefaultLightweightModel, ensureDefaultLightweightModelLoaded } from '../corePolicy'
import { totalmem } from 'os'
import type { ModelInfo } from '../../shared/types'
import type { ModelSourceType } from './registry'

export interface SchedulerConfig {
  /** 常驻模型 ID 列表（始终加载） */
  residentModels: string[]
  /** 最大同时加载模型数 (当前 llama.cpp 仅支持 1) */
  maxLoadedModels: number
  /** 空闲超时 (ms)，0 = 不禁用空闲卸载 */
  idleTimeoutMs: number
  /** 内存压力阈值 (0-1)，超过后卸载非驻留模型 */
  memoryPressureThreshold: number
}

export interface SchedulerState {
  config: SchedulerConfig
  lastActivityAt: number
  activeModelId: string | null
}

const DEFAULT_CONFIG: SchedulerConfig = {
  residentModels: [],
  maxLoadedModels: 1,       // llama.cpp 单实例限制
  idleTimeoutMs: 300_000,   // 5 分钟
  memoryPressureThreshold: 0.85, // 85%
}

const state: SchedulerState = {
  config: { ...DEFAULT_CONFIG },
  lastActivityAt: Date.now(),
  activeModelId: null,
}

let idleTimer: ReturnType<typeof setTimeout> | null = null
let memoryCheckTimer: ReturnType<typeof setInterval> | null = null

export function getSchedulerConfig(): SchedulerConfig {
  return { ...state.config }
}

export function updateSchedulerConfig(partial: Partial<SchedulerConfig>): void {
  state.config = { ...state.config, ...partial }
  // 重启空闲定时器
  resetIdleTimer()
}

export function getSchedulerState(): SchedulerState {
  return { ...state, config: { ...state.config } }
}

/**
 * 记录推理活动（更新 LRU）
 * 只在实际推理请求时更新 lastUsed，不在状态检查时更新
 */
export function recordActivity(modelId?: string): void {
  state.lastActivityAt = Date.now()
  if (modelId) state.activeModelId = modelId
  resetIdleTimer()
}

/**
 * 记录状态检查（不更新 LRU lastActivityAt）
 */
export function recordStatusCheck(): void {
  // Intentionally does NOT update lastActivityAt
  // This prevents status polling from keeping models loaded indefinitely
}

/**
 * 加载模型 — 按需路径
 *
 * 1. 如果模型已加载，记录活动并返回
 * 2. 如果引擎上有其他模型，先卸载（如果当前模型不是常驻）
 * 3. 加载请求的模型
 */
export async function loadModelOnDemand(modelId: string): Promise<void> {
  const engine = getLoadedEngine()

  if (engine?.currentModel === modelId) {
    recordActivity(modelId)
    return
  }

  // 卸载当前模型（如果不是常驻）
  if (engine?.currentModel) {
    if (!state.config.residentModels.includes(engine.currentModel)) {
      await unloadModel()
    } else {
      // 常驻模型不能卸载，拒绝加载
      throw new Error(`无法加载 ${modelId}: 常驻模型 ${engine.currentModel} 正在运行，请先手动卸载`)
    }
  }

  const model = getModel(modelId)
  if (!model) throw new Error(`模型不存在: ${modelId}`)

  await loadModel(model)
  recordActivity(modelId)
}

/**
 * 启动调度器
 */
export function startScheduler(): void {
  // 空闲卸载检查 (每 30 秒)
  idleTimer = setInterval(() => {
    if (state.config.idleTimeoutMs <= 0) return

    const engine = getLoadedEngine()
    if (!engine?.currentModel) return

    // 常驻模型不卸载
    if (state.config.residentModels.includes(engine.currentModel)) return

    const idle = Date.now() - state.lastActivityAt
    if (idle >= state.config.idleTimeoutMs) {
      console.log(`[Scheduler] 空闲 ${Math.round(idle / 1000)}s, 卸载模型 ${engine.currentModel}`)
      unloadModel().catch(err => console.warn('[Scheduler] 卸载失败:', err))
    }
  }, 30_000)

  // 内存压力检查 (每 60 秒)
  memoryCheckTimer = setInterval(() => {
    checkMemoryPressure()
  }, 60_000)
}

/**
 * 停止调度器
 */
export function stopScheduler(): void {
  if (idleTimer) { clearInterval(idleTimer); idleTimer = null }
  if (memoryCheckTimer) { clearInterval(memoryCheckTimer); memoryCheckTimer = null }
}

/**
 * 卸载所有模型（用于 graceful shutdown）
 */
export async function unloadAll(): Promise<void> {
  const engine = getLoadedEngine()
  if (engine?.currentModel) {
    await unloadModel()
  }
}

/**
 * 运行常驻模型预加载
 */
export async function preloadResidentModels(): Promise<string[]> {
  const loaded: string[] = []

  for (const modelId of state.config.residentModels) {
    try {
      await loadModelOnDemand(modelId)
      loaded.push(modelId)
    } catch (err) {
      console.warn(`[Scheduler] 常驻模型预加载失败 ${modelId}:`, err)
    }
  }

  // 如果没有常驻模型，尝试加载轻量默认模型
  if (loaded.length === 0 && state.config.residentModels.length === 0) {
    const result = await ensureDefaultLightweightModelLoaded()
    if (result.loaded && result.modelId) {
      loaded.push(result.modelId)
    }
  }

  return loaded
}

/**
 * 搜索可下载的模型 — HuggingFace + ModelScope
 *
 * 使用 hf-mirror.com API 搜索 GGUF 模型。
 * ModelScope 搜索可在此扩展。
 */
export async function searchModelsRemote(
  query: string,
  source: 'huggingface' | 'modelscope' | 'all' = 'all',
  limit: number = 20,
): Promise<Array<{
  name: string
  source: string
  sourceType: ModelSourceType
  desc: string
  downloads: number
  likes: number
}>> {
  const results: Array<{
    name: string; source: string; sourceType: ModelSourceType
    desc: string; downloads: number; likes: number
  }> = []

  if (source === 'huggingface' || source === 'all') {
    try {
      const q = encodeURIComponent(query + ' GGUF')
      const res = await fetch(`https://hf-mirror.com/api/models?search=${q}&limit=${Math.min(limit, 20)}&sort=likes&direction=-1`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      })
      if (res.ok) {
        const models = await res.json() as Array<{ id: string; tags?: string[]; downloads?: number; likes?: number }>
        for (const m of models) {
          if (m.tags?.some(t => t.toLowerCase().includes('gguf'))) {
            results.push({
              name: m.id.split('/').pop() || m.id,
              source: `hf://${m.id}`,
              sourceType: 'huggingface',
              desc: m.tags?.slice(0, 4).join(' · ') || '',
              downloads: m.downloads || 0,
              likes: m.likes || 0,
            })
          }
        }
      }
    } catch (err) {
      console.warn('[Scheduler] HuggingFace 搜索失败:', err)
    }
  }

  if (source === 'modelscope' || source === 'all') {
    try {
      const q = encodeURIComponent(query + ' GGUF')
      const res = await fetch(`https://modelscope.cn/api/v1/models?search=${q}&limit=${Math.min(limit, 20)}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      })
      if (res.ok) {
        const data = await res.json() as { Data?: { Models?: Array<{ Name: string; Description: string; Downloads?: number }> } }
        const models = data?.Data?.Models || []
        for (const m of models) {
          results.push({
            name: m.Name.split('/').pop() || m.Name,
            source: `modelscope://${m.Name}`,
            sourceType: 'modelscope',
            desc: m.Description || '',
            downloads: m.Downloads || 0,
            likes: 0,
          })
        }
      }
    } catch (err) {
      console.warn('[Scheduler] ModelScope 搜索失败:', err)
    }
  }

  return results.sort((a, b) => b.downloads - a.downloads).slice(0, limit)
}

// ============================================================
// Internal helpers
// ============================================================

function resetIdleTimer(): void {
  // Timer is periodic; just record timestamp
}

async function checkMemoryPressure(): Promise<void> {
  const engine = getLoadedEngine()
  if (!engine?.currentModel) return

  // Node.js heap usage
  const nodeMemory = process.memoryUsage()
  const nodeHeapUsed = nodeMemory.heapUsed

  // llama-server process RSS
  const llamaRSS = getEngineProcessRSS()

  // Total memory used by Core
  const totalUsed = nodeHeapUsed + llamaRSS
  const systemTotal = totalmem()
  const usageRatio = totalUsed / systemTotal

  if (usageRatio > state.config.memoryPressureThreshold) {
    // 常驻模型在压力下也不卸载
    if (state.config.residentModels.includes(engine.currentModel)) {
      console.warn('[Scheduler] 内存压力高，但常驻模型保留:', engine.currentModel)
      return
    }

    console.warn(`[Scheduler] 内存压力 (${Math.round(usageRatio * 100)}% of ${Math.round(systemTotal / 1024 / 1024 / 1024)}GB, node=${Math.round(nodeHeapUsed / 1024 / 1024)}MB + llama=${Math.round(llamaRSS / 1024 / 1024)}MB), 卸载模型 ${engine.currentModel}`)
    await unloadModel()
  }
}
