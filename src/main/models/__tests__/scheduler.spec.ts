import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock dependencies
vi.mock('../../engine/llamaCpp', () => ({
  getLoadedEngine: vi.fn(),
  loadModel: vi.fn(),
  unloadModel: vi.fn(),
  getEngineProcessRSS: vi.fn(() => 0),
}))

vi.mock('../../store/modelDb', () => ({
  listModels: vi.fn(() => []),
  getModel: vi.fn(),
}))

vi.mock('../../corePolicy', () => ({
  selectDefaultLightweightModel: vi.fn(),
  ensureDefaultLightweightModelLoaded: vi.fn(() => Promise.resolve({ loaded: false })),
}))

import {
  getSchedulerConfig,
  updateSchedulerConfig,
  getSchedulerState,
  recordActivity,
  loadModelOnDemand,
  startScheduler,
  stopScheduler,
  preloadResidentModels,
} from '../scheduler'
import { getLoadedEngine, loadModel, unloadModel } from '../../engine/llamaCpp'
import { getModel } from '../../store/modelDb'
import { ensureDefaultLightweightModelLoaded } from '../../corePolicy'

describe('Model Scheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    // Reset config to defaults
    updateSchedulerConfig({
      residentModels: [],
      maxLoadedModels: 1,
      idleTimeoutMs: 300_000,
      memoryPressureThreshold: 0.85,
    })
  })

  afterEach(() => {
    stopScheduler()
    vi.useRealTimers()
  })

  describe('getSchedulerConfig', () => {
    it('should return default config', () => {
      const config = getSchedulerConfig()
      expect(config.maxLoadedModels).toBe(1)
      expect(config.idleTimeoutMs).toBe(300_000)
      expect(config.memoryPressureThreshold).toBe(0.85)
      expect(config.residentModels).toEqual([])
    })
  })

  describe('updateSchedulerConfig', () => {
    it('should merge partial config', () => {
      updateSchedulerConfig({ idleTimeoutMs: 600_000 })
      const config = getSchedulerConfig()
      expect(config.idleTimeoutMs).toBe(600_000)
      expect(config.maxLoadedModels).toBe(1) // unchanged
    })

    it('should update resident models', () => {
      updateSchedulerConfig({ residentModels: ['model-a'] })
      expect(getSchedulerConfig().residentModels).toEqual(['model-a'])
    })
  })

  describe('getSchedulerState', () => {
    it('should return state with config copy', () => {
      const state = getSchedulerState()
      expect(state.config).toBeDefined()
      expect(state.activeModelId).toBeNull()
      expect(state.lastActivityAt).toBeGreaterThan(0)
    })
  })

  describe('recordActivity', () => {
    it('should update lastActivityAt', () => {
      const before = getSchedulerState().lastActivityAt
      vi.advanceTimersByTime(1000)
      recordActivity()
      const after = getSchedulerState().lastActivityAt
      expect(after).toBeGreaterThan(before)
    })

    it('should set activeModelId when provided', () => {
      recordActivity('model-x')
      expect(getSchedulerState().activeModelId).toBe('model-x')
    })

    it('should not clear activeModelId when not provided', () => {
      recordActivity('model-x')
      recordActivity()
      expect(getSchedulerState().activeModelId).toBe('model-x')
    })
  })

  describe('loadModelOnDemand', () => {
    it('should just record activity if model already loaded', async () => {
      vi.mocked(getLoadedEngine).mockReturnValue({ currentModel: 'model-a' } as any)

      await loadModelOnDemand('model-a')

      expect(loadModel).not.toHaveBeenCalled()
      expect(getSchedulerState().activeModelId).toBe('model-a')
    })

    it('should unload current non-resident model and load new one', async () => {
      vi.mocked(getLoadedEngine).mockReturnValue({ currentModel: 'model-old' } as any)
      vi.mocked(unloadModel).mockResolvedValue(undefined)
      vi.mocked(getModel).mockReturnValue({ id: 'model-new', path: '/path' } as any)
      vi.mocked(loadModel).mockResolvedValue(undefined)

      await loadModelOnDemand('model-new')

      expect(unloadModel).toHaveBeenCalled()
      expect(loadModel).toHaveBeenCalled()
    })

    it('should refuse to unload resident model', async () => {
      updateSchedulerConfig({ residentModels: ['model-resident'] })
      vi.mocked(getLoadedEngine).mockReturnValue({ currentModel: 'model-resident' } as any)

      await expect(loadModelOnDemand('model-new')).rejects.toThrow('常驻模型')
    })

    it('should throw if model does not exist', async () => {
      vi.mocked(getLoadedEngine).mockReturnValue(null as any)
      vi.mocked(getModel).mockReturnValue(null as any)

      await expect(loadModelOnDemand('non-existent')).rejects.toThrow('模型不存在')
    })

    it('should load model when nothing is currently loaded', async () => {
      vi.mocked(getLoadedEngine).mockReturnValue(null as any)
      vi.mocked(getModel).mockReturnValue({ id: 'model-a', path: '/path' } as any)
      vi.mocked(loadModel).mockResolvedValue(undefined)

      await loadModelOnDemand('model-a')

      expect(unloadModel).not.toHaveBeenCalled()
      expect(loadModel).toHaveBeenCalled()
    })
  })

  describe('startScheduler / stopScheduler', () => {
    it('should start and stop without errors', () => {
      expect(() => startScheduler()).not.toThrow()
      expect(() => stopScheduler()).not.toThrow()
    })

    it('should unload idle model after timeout', async () => {
      vi.mocked(getLoadedEngine).mockReturnValue({ currentModel: 'model-idle' } as any)
      vi.mocked(unloadModel).mockResolvedValue(undefined)

      updateSchedulerConfig({ idleTimeoutMs: 300_000 })
      startScheduler()

      // Simulate idle: advance time past 5 minutes + 30s check interval
      vi.advanceTimersByTime(330_000)

      expect(unloadModel).toHaveBeenCalled()
    })

    it('should NOT unload resident model even if idle', () => {
      updateSchedulerConfig({ residentModels: ['model-resident'], idleTimeoutMs: 300_000 })
      vi.mocked(getLoadedEngine).mockReturnValue({ currentModel: 'model-resident' } as any)

      startScheduler()
      vi.advanceTimersByTime(330_000)

      expect(unloadModel).not.toHaveBeenCalled()
    })

    it('should not unload if idleTimeoutMs is 0', () => {
      updateSchedulerConfig({ idleTimeoutMs: 0 })
      vi.mocked(getLoadedEngine).mockReturnValue({ currentModel: 'model-x' } as any)

      startScheduler()
      vi.advanceTimersByTime(330_000)

      expect(unloadModel).not.toHaveBeenCalled()
    })
  })

  describe('preloadResidentModels', () => {
    it('should load configured resident models', async () => {
      updateSchedulerConfig({ residentModels: ['model-a'] })
      vi.mocked(getLoadedEngine).mockReturnValue(null as any)
      vi.mocked(getModel).mockReturnValue({ id: 'model-a', path: '/p' } as any)
      vi.mocked(loadModel).mockResolvedValue(undefined)

      const loaded = await preloadResidentModels()

      expect(loaded).toContain('model-a')
    })

    it('should fallback to lightweight model if no resident models', async () => {
      updateSchedulerConfig({ residentModels: [] })
      vi.mocked(ensureDefaultLightweightModelLoaded).mockResolvedValue({
        loaded: true,
        modelId: 'tiny-model',
        reason: null,
      })

      const loaded = await preloadResidentModels()

      expect(loaded).toContain('tiny-model')
    })

    it('should handle preload failures gracefully', async () => {
      updateSchedulerConfig({ residentModels: ['model-fail'] })
      vi.mocked(getLoadedEngine).mockReturnValue(null as any)
      vi.mocked(getModel).mockReturnValue(null as any)

      const loaded = await preloadResidentModels()

      expect(loaded).toEqual([])
    })
  })
})
