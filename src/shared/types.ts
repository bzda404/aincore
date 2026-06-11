// AinCore 共享类型

export interface ModelInfo {
  id: string
  name: string
  family: string
  parameterSize: string
  quantization: string
  format: 'gguf'
  capabilities: string[]
  sizeBytes: number
  source: string
  sourceUrl: string
  filePath: string
  digest: string
  createdAt: string
  status: 'installed' | 'loading' | 'loaded' | 'error'
}

export interface HubStatus {
  status: 'ok' | 'error'
  version: string
  transport: 'uds'
  socketPath: string
  /** UDS transport does not use a TCP port. Kept nullable for old UI code. */
  port: number | null
  /** llama.cpp engine port, when a model is loaded. */
  enginePort?: number | null
  defaultModel?: {
    loaded: boolean
    modelId: string | null
    reason: string | null
  } | null
  telemetry?: {
    lastLatencyMs: number | null
    lastTokensPerSecond: number | null
    lastPromptTokens: number | null
    lastCompletionTokens: number | null
    lastTotalTokens: number | null
    updatedAt: string | null
  }
  runningModels: string[]
  gpuInfo: GpuInfo | null
  memoryUsage: MemoryUsage
}

export interface GpuInfo {
  name: string
  vramTotal: number
  vramUsed: number
  vendor: string
}

export interface MemoryUsage {
  total: number
  used: number
  free: number
}

export interface DownloadRequest {
  name: string
  source: 'modelscope' | 'huggingface'
  sourceUrl: string
  quantization: string
}

export interface DownloadProgress {
  modelId: string
  percent: number
  downloadedBytes: number
  totalBytes: number
  speed: number
  status: 'downloading' | 'extracting' | 'done' | 'error'
  error?: string
}

export interface LoadModelRequest {
  keepAlive?: number // seconds, default 300
}

export interface ChatCompletionRequest {
  model: string
  messages: Array<{ role: string; content: string }>
  max_tokens?: number
  temperature?: number
  stream?: boolean
  top_p?: number
  stop?: string | string[]
}
