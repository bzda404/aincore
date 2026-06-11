/**
 * OpenAI 兼容 API 路由（通过 UDS JSON-RPC）
 */
import { getLoadedEngine } from '../engine/llamaCpp'
import { recordInferenceTelemetry } from '../corePolicy'
import { maybeInjectProfile } from './profileInjector'

type RegisterRoute = (method: string, path: string, handler: (params: Record<string, unknown>) => Promise<unknown>) => void

export function registerOpenAIRoutes(registerRoute: RegisterRoute): void {
  // 模型列表
  registerRoute('GET', '/v1/models', async() => {
    const engine = getLoadedEngine()
    if (!engine || !engine.currentModel) return { data: [] }
    return {
      data: [{
        id: engine.currentModel,
        object: 'model',
        created: Date.now(),
        owned_by: 'aincore',
      }],
    }
  })

  // 聊天补全
  registerRoute('POST', '/v1/chat/completions', async(params) => {
    const injected = maybeInjectProfile(params)
    return forwardInferenceRequest('/v1/chat/completions', injected, '推理请求失败')
  })

  // 文本补全
  registerRoute('POST', '/v1/completions', async(params) => {
    return forwardInferenceRequest('/v1/completions', params, '补全请求失败')
  })
}

async function forwardInferenceRequest(path: string, params: Record<string, unknown>, errorPrefix: string): Promise<unknown> {
  const engine = getLoadedEngine()
  if (!engine || !engine.baseUrl) {
    throw new Error('没有已加载的模型')
  }

  const startedAt = performance.now()
  const response = await fetch(`${engine.baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })

  if (!response.ok) {
    throw new Error(`${errorPrefix}: ${response.status}`)
  }

  const result = await response.json()
  recordInferenceTelemetry(result, performance.now() - startedAt)
  return result
}
