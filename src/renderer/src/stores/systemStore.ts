/**
 * System store — Hub status, engine state, memory, version.
 * Manages the polling lifecycle for Core status data.
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePolling } from '../composables/usePolling'
import type { HubStatusResponse } from '../types'

export const useSystemStore = defineStore('system', () => {
  const { t } = useI18n()
  // State
  const hubStatus = ref<'running' | 'stopped'>('running')
  const engineStatus = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const loadedModelId = ref<string | null>(null)
  const ramUsedMB = ref(0)
  const coreVersion = ref('')
  const socketPath = ref('/tmp/aincore.sock')
  const transport = ref('uds')
  const memFallback = ref(false)
  const isLoading = ref(true)
  const lastError = ref<string | null>(null)
  const inferenceTelemetry = ref<{
    lastLatencyMs: number | null
    lastTokensPerSecond: number | null
    updatedAt: string | null
  }>({ lastLatencyMs: null, lastTokensPerSecond: null, updatedAt: null })

  // Getters
  const modelReady = computed(() => loadedModelId.value !== null && engineStatus.value === 'ready')
  const hubStatusClass = computed(() => hubStatus.value === 'running' ? 'running' : 'stopped')

  // Actions
  async function fetchStatus() {
    try {
      const s: HubStatusResponse = await window.hub.getStatus()
      hubStatus.value = s.running ? 'running' : 'stopped'
      loadedModelId.value = s.loadedModel || null
      engineStatus.value = s.status || 'idle'
      const memory = s.scheduler?.memoryUsage || s.memoryUsage || null
      if (memory?.rss) ramUsedMB.value = Math.round(memory.rss / 1048576)
      if (s.version) coreVersion.value = s.version
      if (s.socketPath) socketPath.value = s.socketPath
      if (s.transport) transport.value = s.transport
      if (s.memFallback !== undefined) memFallback.value = s.memFallback
      if (s.telemetry) {
        inferenceTelemetry.value = {
          lastLatencyMs: s.telemetry.lastLatencyMs ?? null,
          lastTokensPerSecond: s.telemetry.lastTokensPerSecond ?? null,
          updatedAt: s.telemetry.updatedAt ?? null,
        }
      }
      lastError.value = null
    } catch {
      hubStatus.value = 'stopped'
      lastError.value = t('error.CORE_INIT_FAILED')
    } finally {
      isLoading.value = false
    }
  }

  const polling = usePolling(fetchStatus, 8000)

  function startPolling() {
    polling.start()
  }

  function stopPolling() {
    polling.stop()
  }

  return {
    // state
    hubStatus, engineStatus, loadedModelId, ramUsedMB,
    coreVersion, socketPath, transport, memFallback,
    isLoading, lastError, inferenceTelemetry,
    // getters
    modelReady, hubStatusClass,
    // actions
    fetchStatus, startPolling, stopPolling,
  }
})
