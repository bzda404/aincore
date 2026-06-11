/**
 * 模型管理路由（通过 UDS JSON-RPC）。
 * public 方法供第三方 SDK 使用并由 server/index.ts 校验 session_token；
 * internal.* 方法供 MindVault 桌面主进程使用，不暴露给 SDK。
 */
import { statSync } from 'fs'
import { listModels, getModel, deleteModel, addModel } from '../store/modelDb'
import { getLoadedEngine, loadModel, unloadModel } from '../engine/llamaCpp'
import { SOCKET_PATH, TRANSPORT } from './transport'
import { ensureDefaultLightweightModelLoaded, getDefaultLightweightModelStatus, getInferenceTelemetry, getModelLoadGuard, parseParameterSizeToBillions, recordInferenceTelemetry } from '../corePolicy'
import { maybeInjectProfile } from './profileInjector'
import type { ModelInfo } from '../../shared/types'

type RegisterRoute = (method: string, path: string, handler: (params: Record<string, unknown>) => Promise<unknown>) => void

export { getModelLoadGuard, parseParameterSizeToBillions }

export function registerModelRoutes(registerRoute: RegisterRoute): void {
  const getStatus = () => {
    const engine = getLoadedEngine()
    return {
      status: 'ok',
      version: '1.0.0',
      transport: TRANSPORT,
      socketPath: SOCKET_PATH,
      port: null,
      runningModels: engine?.currentModel ? [engine.currentModel] : [],
      enginePort: engine?.port ?? null,
      defaultModel: getDefaultLightweightModelStatus(),
      telemetry: getInferenceTelemetry(),
      memoryUsage: process.memoryUsage(),
    }
  }

  const getModels = () => {
    const models = listModels()
    const engine = getLoadedEngine()
    return models.map(m => ({
      ...m,
      status: engine?.currentModel === m.id ? 'loaded' : 'installed',
      loadable: getModelLoadGuard(m).loadable,
      loadBlockReason: getModelLoadGuard(m).reason,
    }))
  }

  const loadModelById = async(params: Record<string, unknown>) => {
    const model = getModel(String(params.id || ''))
    if (!model) throw new Error('模型不存在')
    const guard = getModelLoadGuard(model)
    if (!guard.loadable) throw new Error(guard.reason || '模型不符合 Core 轻量加载策略')
    await loadModel(model)
    return { success: true, message: `模型 ${model.name} 已加载` }
  }

  const unloadCurrentModel = async() => {
    await unloadModel()
    return { success: true }
  }

  const deleteModelById = async(params: Record<string, unknown>) => {
    const id = String(params.id || '')
    const engine = getLoadedEngine()
    if (engine?.currentModel === id) await unloadModel()
    const success = deleteModel(id)
    if (!success) throw new Error('模型不存在')
    return { success: true }
  }

  const registerLocalModel = async(params: Record<string, unknown>) => {
    const filePath = String(params.filePath || '')
    if (!filePath) throw new Error('缺少模型文件路径')

    const name = String(params.name || filePath.split(/[\\/]/).pop() || 'Local GGUF Model').replace(/\.gguf$/i, '')
    const model: Omit<ModelInfo, 'status' | 'createdAt'> = {
      id: String(params.id || buildModelId(name, filePath)),
      name,
      family: String(params.family || inferFamily(name)),
      parameterSize: String(params.parameterSize || ''),
      quantization: String(params.quantization || 'Q4_K_M'),
      format: 'gguf',
      capabilities: Array.isArray(params.capabilities) ? params.capabilities.map(String) : ['chat', 'completion'],
      sizeBytes: typeof params.sizeBytes === 'number' ? params.sizeBytes : getFileSize(filePath),
      source: String(params.source || 'local'),
      sourceUrl: String(params.sourceUrl || ''),
      filePath,
      digest: String(params.digest || ''),
    }

    addModel(model)
    const guard = getModelLoadGuard(model)
    const autoLoad = await ensureDefaultLightweightModelLoaded()

    return {
      model: {
        ...model,
        status: getLoadedEngine()?.currentModel === model.id ? 'loaded' : 'installed',
        loadable: guard.loadable,
        loadBlockReason: guard.reason,
      },
      autoLoad,
    }
  }

  const chatCompletions = async(params: Record<string, unknown>) => {
    const injected = maybeInjectProfile(params)
    return forwardInferenceRequest('/v1/chat/completions', injected, '推理请求失败')
  }

  const completions = async(params: Record<string, unknown>) => {
    return forwardInferenceRequest('/v1/completions', params, '补全请求失败')
  }

  // 服务状态
  registerRoute('GET', '/api/status', async() => getStatus())

  // 已安装模型列表
  registerRoute('GET', '/api/models', async() => getModels())

  // 运行中模型
  registerRoute('GET', '/api/models/running', async() => {
    const engine = getLoadedEngine()
    return engine?.currentModel ? [{ id: engine.currentModel, baseUrl: engine.baseUrl }] : []
  })

  // 加载模型
  registerRoute('POST', '/api/models/load', loadModelById)

  // 卸载模型
  registerRoute('POST', '/api/models/unload', unloadCurrentModel)

  // 删除模型
  registerRoute('DELETE', '/api/models/delete', deleteModelById)

  // JSON-RPC 兼容的短方法名
  registerRoute('status', '', async() => getStatus())

  registerRoute('models.list', '', async() => getModels())

  registerRoute('models.load', '', loadModelById)

  registerRoute('models.unload', '', unloadCurrentModel)

  registerRoute('models.delete', '', deleteModelById)

  registerRoute('chat.completions', '', chatCompletions)

  registerRoute('completions', '', completions)

  // Built-in MindVault desktop client methods. These bypass session_token
  // checks in server/index.ts and are intentionally not exported by the SDK.
  registerRoute('internal.status', '', async() => getStatus())
  registerRoute('internal.models.list', '', async() => getModels())
  registerRoute('internal.models.load', '', loadModelById)
  registerRoute('internal.models.unload', '', unloadCurrentModel)
  registerRoute('internal.models.delete', '', deleteModelById)
  registerRoute('internal.models.register', '', registerLocalModel)
  registerRoute('internal.chat.completions', '', chatCompletions)
  registerRoute('internal.completions', '', completions)
}

async function forwardInferenceRequest(path: string, params: Record<string, unknown>, errorPrefix: string): Promise<unknown> {
  const engine = getLoadedEngine()
  if (!engine || !engine.baseUrl) throw new Error('没有已加载的模型')

  const startedAt = performance.now()
  const response = await fetch(`${engine.baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  if (!response.ok) throw new Error(`${errorPrefix}: ${response.status}`)

  const result = await response.json()
  recordInferenceTelemetry(result, performance.now() - startedAt)
  return result
}

function buildModelId(name: string, filePath: string): string {
  const base = `${name}-${filePath}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return base.slice(0, 120) || 'local-gguf-model'
}

function inferFamily(name: string): string {
  const lower = name.toLowerCase()
  if (lower.includes('qwen')) return 'qwen'
  if (lower.includes('llama')) return 'llama'
  if (lower.includes('gemma')) return 'gemma'
  if (lower.includes('phi')) return 'phi'
  return 'local'
}

function getFileSize(filePath: string): number {
  try {
    return statSync(filePath).size
  } catch {
    return 0
  }
}
