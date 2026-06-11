import { basename } from 'path'
import { addModel, getModelByPath } from '../store/modelDb'
import { ensureDefaultLightweightModelLoaded } from '../corePolicy'
import type { DownloadResult, ModelDownloadOptions } from './downloader'
import type { ModelInfo } from '../../shared/types'

export const DEFAULT_RECOMMENDED_MODEL = {
  id: 'qwen2-5-0-5b-instruct-q4-k-m',
  name: 'Qwen2.5 0.5B Instruct',
  family: 'qwen',
  parameterSize: '0.5B',
  quantization: 'Q4_K_M',
  filename: 'qwen2.5-0.5b-instruct-q4_k_m.gguf',
  sourceType: 'huggingface' as const,
  sourceUrl: 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf',
  homepage: 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF',
  license: 'Apache-2.0',
  description: '轻量、免费、适合首次体验的本地聊天模型。',
}

export async function registerDownloadedModel(
  options: ModelDownloadOptions,
  result: DownloadResult,
): Promise<{ model: ModelInfo; autoLoad: Awaited<ReturnType<typeof ensureDefaultLightweightModelLoaded>> }> {
  const existing = getModelByPath(result.filePath)
  if (existing) {
    const autoLoad = await ensureDefaultLightweightModelLoaded()
    return { model: existing, autoLoad }
  }

  const isDefault = options.filename === DEFAULT_RECOMMENDED_MODEL.filename
  const name = isDefault
    ? DEFAULT_RECOMMENDED_MODEL.name
    : basename(options.filename).replace(/\.gguf$/i, '')

  const model: Omit<ModelInfo, 'status' | 'createdAt'> = {
    id: isDefault ? DEFAULT_RECOMMENDED_MODEL.id : buildModelId(name, result.filePath),
    name,
    family: isDefault ? DEFAULT_RECOMMENDED_MODEL.family : inferFamily(name),
    parameterSize: isDefault ? DEFAULT_RECOMMENDED_MODEL.parameterSize : inferParameterSize(name),
    quantization: options.quantization || DEFAULT_RECOMMENDED_MODEL.quantization,
    format: 'gguf',
    capabilities: ['chat', 'completion'],
    sizeBytes: result.sizeBytes,
    source: options.sourceType,
    sourceUrl: options.sourceUrl,
    filePath: result.filePath,
    digest: result.checksum || '',
  }

  addModel(model)
  const autoLoad = await ensureDefaultLightweightModelLoaded()
  return { model: { ...model, status: 'installed', createdAt: new Date().toISOString() }, autoLoad }
}

function buildModelId(name: string, filePath: string): string {
  return `${name}-${filePath}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 120)
}

function inferFamily(name: string): string {
  const lower = name.toLowerCase()
  if (lower.includes('qwen')) return 'qwen'
  if (lower.includes('llama')) return 'llama'
  if (lower.includes('gemma')) return 'gemma'
  if (lower.includes('phi')) return 'phi'
  return 'local'
}

function inferParameterSize(name: string): string {
  const match = name.match(/(\d+(?:\.\d+)?)\s*([bBmM])/)
  return match ? `${match[1]}${match[2].toUpperCase()}` : ''
}
