/**
 * MindVault Core runtime policy.
 *
 * Core is optimized for one always-on, lightweight local model. On startup we
 * auto-load the best installed <=1B candidate so Note can use completion and
 * RAG reranking without a manual trip through the model manager.
 */
import { listModels } from './store/modelDb'
import { getLoadedEngine, loadModel } from './engine/llamaCpp'
import { totalmem } from 'os'
import type { ModelInfo } from '../shared/types'

/**
 * Dynamic model size limit based on system RAM
 *
 * totalRAM >= 32GB → max 7B
 * totalRAM >= 16GB → max 3B
 * totalRAM >= 8GB  → max 1B
 * totalRAM <  8GB  → max 0.5B
 */
function computeMaxModelBillions(): number {
  const totalBytes = totalmem()
  const totalGB = totalBytes / (1024 * 1024 * 1024)

  if (totalGB >= 32) return 7
  if (totalGB >= 16) return 3
  if (totalGB >= 8) return 1
  return 0.5
}

export const MAX_CORE_MODEL_BILLIONS = computeMaxModelBillions()

/**
 * Get the computed max model size for UI display
 */
export function getMaxModelSizeInfo(): { maxBillions: number; totalRAMGB: number } {
  const totalGB = Math.round(totalmem() / (1024 * 1024 * 1024) * 10) / 10
  return { maxBillions: MAX_CORE_MODEL_BILLIONS, totalRAMGB: totalGB }
}

export interface RecommendedModelsInfo {
  maxBillions: number
  totalRAMGB: number
  tierLabel: string
  description: string
}

/**
 * Return system-aware recommendation info for the model market UI.
 */
export function getRecommendedModels(): RecommendedModelsInfo {
  const { maxBillions, totalRAMGB } = getMaxModelSizeInfo()
  let tierLabel: string
  let description: string

  if (maxBillions >= 7) {
    tierLabel = '≤7B'
    description = 'Your machine has ample memory — models up to 7B parameters run smoothly.'
  } else if (maxBillions >= 3) {
    tierLabel = '≤3B'
    description = 'Your machine supports models up to 3B parameters.'
  } else if (maxBillions >= 1) {
    tierLabel = '≤1B'
    description = 'Your machine is best suited for lightweight models up to 1B.'
  } else {
    tierLabel = '≤0.5B'
    description = 'Limited memory detected — stick to the smallest models (≤0.5B).'
  }

  return { maxBillions, totalRAMGB, tierLabel, description }
}

export interface AutoLoadResult {
  loaded: boolean
  modelId: string | null
  reason: string | null
}

export interface InferenceTelemetry {
  lastLatencyMs: number | null
  lastTokensPerSecond: number | null
  lastPromptTokens: number | null
  lastCompletionTokens: number | null
  lastTotalTokens: number | null
  updatedAt: string | null
}

let lastAutoLoadResult: AutoLoadResult | null = null
let inferenceTelemetry: InferenceTelemetry = {
  lastLatencyMs: null,
  lastTokensPerSecond: null,
  lastPromptTokens: null,
  lastCompletionTokens: null,
  lastTotalTokens: null,
  updatedAt: null,
}

export async function ensureDefaultLightweightModelLoaded(): Promise<AutoLoadResult> {
  const engine = getLoadedEngine()
  if (engine?.currentModel) {
    return setLastAutoLoadResult({ loaded: true, modelId: engine.currentModel, reason: '已有模型正在运行' })
  }

  const candidate = selectDefaultLightweightModel(listModels())
  if (!candidate) {
    return setLastAutoLoadResult({ loaded: false, modelId: null, reason: '没有可自动加载的 ≤1B 本地模型' })
  }

  await loadModel(candidate)
  return setLastAutoLoadResult({ loaded: true, modelId: candidate.id, reason: null })
}

export function getDefaultLightweightModelStatus(): AutoLoadResult | null {
  return lastAutoLoadResult
}

export function recordInferenceTelemetry(response: unknown, latencyMs: number): InferenceTelemetry {
  const usage = response && typeof response === 'object'
    ? (response as Record<string, unknown>).usage
    : null
  const usageRecord = usage && typeof usage === 'object' ? usage as Record<string, unknown> : {}
  const completionTokens = numberOrNull(usageRecord.completion_tokens)
  const promptTokens = numberOrNull(usageRecord.prompt_tokens)
  const totalTokens = numberOrNull(usageRecord.total_tokens)
  const tokensPerSecond = completionTokens && latencyMs > 0
    ? completionTokens / (latencyMs / 1000)
    : null

  inferenceTelemetry = {
    lastLatencyMs: Math.round(latencyMs),
    lastTokensPerSecond: tokensPerSecond === null ? null : Math.round(tokensPerSecond * 10) / 10,
    lastPromptTokens: promptTokens,
    lastCompletionTokens: completionTokens,
    lastTotalTokens: totalTokens,
    updatedAt: new Date().toISOString(),
  }
  return inferenceTelemetry
}

export function getInferenceTelemetry(): InferenceTelemetry {
  return inferenceTelemetry
}

export function parseParameterSizeToBillions(parameterSize: string): number | null {
  const normalized = parameterSize.trim().toLowerCase().replace(/\s+/g, '')
  const match = normalized.match(/^(\d+(?:\.\d+)?)([bmk])$/)
  if (!match) return null

  const value = Number(match[1])
  if (!Number.isFinite(value)) return null

  switch (match[2]) {
    case 'b':
      return value
    case 'm':
      return value / 1000
    case 'k':
      return value / 1_000_000
    default:
      return null
  }
}

export function getModelLoadGuard(model: Pick<ModelInfo, 'parameterSize' | 'name'>): {
  loadable: boolean
  reason: string | null
} {
  const parameterBillions = parseParameterSizeToBillions(model.parameterSize || '')
  if (parameterBillions === null) {
    return {
      loadable: false,
      reason: `无法识别模型参数规模：${model.parameterSize || '未知'}`,
    }
  }

  if (parameterBillions > MAX_CORE_MODEL_BILLIONS) {
    return {
      loadable: false,
      reason: `MindVault Core 当前仅允许加载 ≤${MAX_CORE_MODEL_BILLIONS}B 的轻量模型`,
    }
  }

  return { loadable: true, reason: null }
}

export function selectDefaultLightweightModel(models: ModelInfo[]): ModelInfo | null {
  const candidates = models
    .map(model => ({
      model,
      parameterBillions: parseParameterSizeToBillions(model.parameterSize || ''),
      guard: getModelLoadGuard(model),
    }))
    .filter(item => item.guard.loadable && item.parameterBillions !== null)

  candidates.sort((a, b) => {
    const aCoder = isCoderModel(a.model) ? 0 : 1
    const bCoder = isCoderModel(b.model) ? 0 : 1
    if (aCoder !== bCoder) return aCoder - bCoder

    const aQ4 = prefersQ4KM(a.model) ? 0 : 1
    const bQ4 = prefersQ4KM(b.model) ? 0 : 1
    if (aQ4 !== bQ4) return aQ4 - bQ4

    return (a.parameterBillions ?? Number.MAX_SAFE_INTEGER) - (b.parameterBillions ?? Number.MAX_SAFE_INTEGER)
  })

  return candidates[0]?.model ?? null
}

function isCoderModel(model: ModelInfo): boolean {
  return `${model.name} ${model.id} ${model.family}`.toLowerCase().includes('coder')
}

function prefersQ4KM(model: ModelInfo): boolean {
  return model.quantization.toLowerCase().replace(/-/g, '_') === 'q4_k_m'
}

function setLastAutoLoadResult(result: AutoLoadResult): AutoLoadResult {
  lastAutoLoadResult = result
  return result
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
