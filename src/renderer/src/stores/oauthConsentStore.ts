/**
 * OAuth consent popup store — OAuth 2.0 PKCE consent flow.
 * Fixes Bug C: grantModelOnly now passes filtered scopes instead of granting all.
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { OAuthConsentPopup } from '../types'

/** Model-related scopes for "Model Only" grant */
const MODEL_SCOPES = ['inference:read', 'models:read', 'models:manage']

export const useOAuthConsentStore = defineStore('oauthConsent', () => {
  // State
  const showPopup = ref(false)
  const consent = ref<OAuthConsentPopup | null>(null)
  const countdown = ref(120)

  let countdownTimer: ReturnType<typeof setInterval> | null = null
  let cleanupListener: (() => void) | null = null

  // Getters — categorized scopes
  const modelScopes = computed(() =>
    consent.value?.scopeDescriptions.filter(sd => MODEL_SCOPES.includes(sd.scope)) || [],
  )
  const knowledgeScopes = computed(() =>
    consent.value?.scopeDescriptions.filter(sd =>
      ['knowledge:read', 'knowledge:write'].includes(sd.scope),
    ) || [],
  )
  const systemScopes = computed(() =>
    consent.value?.scopeDescriptions.filter(sd =>
      ['system:status', 'offline_access'].includes(sd.scope),
    ) || [],
  )

  // Actions
  function setupListener() {
    if (cleanupListener) return
    cleanupListener = window.hub.onOAuthConsent((popup: unknown) => {
      consent.value = popup as OAuthConsentPopup
      countdown.value = 120
      showPopup.value = true
      startCountdown()
    })
  }

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

  /**
   * Resolve the OAuth consent.
   * @param grantedScopes - null to deny, string[] to grant specific scopes
   */
  async function resolve(grantedScopes: string[] | null) {
    if (!consent.value) return
    try {
      await window.hub.resolveOAuthConsent(consent.value.requestId, grantedScopes)
    } catch {
      // ignore
    }
    close()
  }

  /** Grant all requested scopes */
  async function grantAll() {
    if (!consent.value) return
    await resolve(consent.value.scopes)
  }

  /**
   * Grant only model-related scopes.
   * BUG FIX: Previously granted all scopes. Now filters to model scopes only.
   */
  async function grantModelOnly() {
    if (!consent.value) return
    const filtered = MODEL_SCOPES.filter(s => consent.value!.scopes.includes(s))
    await resolve(filtered)
  }

  /** Deny the consent */
  async function deny() {
    await resolve(null)
  }

  function close() {
    showPopup.value = false
    consent.value = null
    stopCountdown()
  }

  function cleanup() {
    if (cleanupListener) {
      cleanupListener()
      cleanupListener = null
    }
    stopCountdown()
  }

  return {
    // state
    showPopup, consent, countdown,
    // getters
    modelScopes, knowledgeScopes, systemScopes,
    // actions
    setupListener, grantAll, grantModelOnly, deny, close, cleanup,
  }
})
