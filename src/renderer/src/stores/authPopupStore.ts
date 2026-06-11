/**
 * Auth popup store — legacy session-based auth popup state and countdown.
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { usePolling } from '../composables/usePolling'
import type { AuthRequest } from '../types'

export const useAuthPopupStore = defineStore('authPopup', () => {
  // State
  const showPopup = ref(false)
  const pendingAuth = ref<AuthRequest | null>(null)
  const selectedModels = ref<string[]>([])
  const selectedKbs = ref<Array<{ path: string; label: string; scope: 'read' | 'read_write' }>>([])
  const selectedDuration = ref(24)
  const countdown = ref(120)

  let countdownTimer: ReturnType<typeof setInterval> | null = null

  // Getters
  const requestedModels = computed(() => pendingAuth.value?.requested_models || [])
  const requestedKbs = computed(() => pendingAuth.value?.requested_kbs || [])

  // Actions
  async function checkPending() {
    try {
      const pending = await window.hub.getPendingAuthRequests()
      if (pending.length > 0 && !showPopup.value) {
        pendingAuth.value = pending[0]
        selectedModels.value = [...pending[0].requested_models]
        selectedKbs.value = pending[0].requested_kbs.map(kb => ({
          path: kb.path,
          label: kb.label || kb.path,
          scope: kb.scope || 'read',
        }))
        countdown.value = 120
        showPopup.value = true
        startCountdown()
      }
    } catch {
      // ignore
    }
  }

  const polling = usePolling(checkPending, 3000)

  function startCountdown() {
    if (countdownTimer) clearInterval(countdownTimer)
    countdownTimer = setInterval(() => {
      countdown.value--
      if (countdown.value <= 0) {
        deny()
      }
    }, 1000)
  }

  function stopCountdown() {
    if (countdownTimer) {
      clearInterval(countdownTimer)
      countdownTimer = null
    }
  }

  async function resolve(granted: boolean, models?: string[], kbs?: Array<{ path: string; label?: string; scope?: 'read' | 'read_write' }>) {
    if (!pendingAuth.value) return
    try {
      await window.hub.resolveAuthRequest({
        request_id: pendingAuth.value.request_id,
        granted,
        models: models || selectedModels.value,
        knowledgeBases: kbs || (granted ? selectedKbs.value : []),
        duration_hours: selectedDuration.value,
      } as never)
    } catch {
      // ignore
    }
    close()
  }

  async function grantAll() {
    await resolve(true)
  }

  async function grantModelOnly() {
    await resolve(true, selectedModels.value, [])
  }

  async function deny() {
    await resolve(false, [], [])
  }

  function close() {
    showPopup.value = false
    pendingAuth.value = null
    stopCountdown()
  }

  function isKbSelected(path: string): boolean {
    return selectedKbs.value.some(kb => kb.path === path)
  }

  function toggleKbSelection(path: string) {
    const idx = selectedKbs.value.findIndex(kb => kb.path === path)
    if (idx >= 0) {
      selectedKbs.value.splice(idx, 1)
    } else {
      const kb = pendingAuth.value?.requested_kbs.find(k => k.path === path)
      if (kb) {
        selectedKbs.value.push({
          path: kb.path,
          label: kb.label || kb.path,
          scope: kb.scope || 'read',
        })
      }
    }
  }

  function startPolling() {
    polling.start()
  }

  function stopPolling() {
    polling.stop()
    stopCountdown()
  }

  return {
    // state
    showPopup, pendingAuth, selectedModels, selectedKbs,
    selectedDuration, countdown,
    // getters
    requestedModels, requestedKbs,
    // actions
    checkPending, grantAll, grantModelOnly, deny, close,
    isKbSelected, toggleKbSelection,
    startPolling, stopPolling,
  }
})
