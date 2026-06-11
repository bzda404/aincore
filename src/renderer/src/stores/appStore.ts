/**
 * App store — registered apps, installed apps, Notes management.
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { useI18n } from 'vue-i18n'
import type { AppItem, InstalledApp } from '../types'
import { extractErrorCode } from '../../../shared/errorCodes'

export const useAppStore = defineStore('apps', () => {
  const { t } = useI18n()
  // State
  const registeredApps = ref<AppItem[]>([])
  const installedApps = ref<InstalledApp[]>([])
  const isLoadingApps = ref(false)
  const lastError = ref<string | null>(null)

  // Getters
  const connectedApps = computed(() => registeredApps.value.filter(hasActiveGrant))

  const notesApp = computed(() =>
    registeredApps.value.find(app =>
      app.name === 'MindVault Notes' || app.app_id.includes('mindvault-notes'),
    ) || null,
  )

  const notesConnected = computed(() => !!notesApp.value && hasActiveGrant(notesApp.value))
  const notesRevoked = computed(() => !!notesApp.value && !hasActiveGrant(notesApp.value))

  // Actions
  async function fetchApps() {
    isLoadingApps.value = true
    try {
      registeredApps.value = await window.hub.listApps()
      lastError.value = null
    } catch {
      registeredApps.value = []
      lastError.value = t('error.FETCH_APPS_FAILED')
    } finally {
      isLoadingApps.value = false
    }
  }

  async function fetchInstalledApps() {
    try {
      installedApps.value = await window.hub.getInstalledApps()
    } catch {
      installedApps.value = []
    }
  }

  async function openNotes() {
    try {
      const result = await window.hub.openNotes()
      if (result?.message) ElMessage.info(result.message)
    } catch (e: unknown) {
      ElMessage.error(t('error.APP_OPEN_FAILED'))
    }
  }

  async function revokeApp(appId: string) {
    try {
      await window.hub.revokeAllAuthForApp(appId)
      await fetchApps()
      ElMessage.success(t('common.revoke') + ' ✓')
    } catch (e: unknown) {
      ElMessage.error(t('error.APP_REVOKE_FAILED'))
    }
  }

  async function revokeNotes() {
    if (notesApp.value) {
      await revokeApp(notesApp.value.app_id)
    }
  }

  return {
    // state
    registeredApps, installedApps, isLoadingApps, lastError,
    // getters
    connectedApps, notesApp, notesConnected: notesConnected, notesRevoked,
    // actions
    fetchApps, fetchInstalledApps, openNotes, revokeApp, revokeNotes,
    // helpers
    hasActiveGrant, appPermissionSummary,
  }
})

// ============================================================
// Shared helper functions (exported for use in views/components)
// ============================================================

export function hasActiveGrant(app: AppItem): boolean {
  return (app.active_grants || 0) > 0 ||
    (app.granted_models?.length || 0) > 0 ||
    (app.granted_kbs?.length || 0) > 0
}

export function appPermissionSummary(app: AppItem, t?: (key: string, params?: Record<string, unknown>) => string): string {
  const modelCount = app.granted_models?.length || 0
  const kbCount = app.granted_kbs?.length || app.granted_knowledge_bases?.length || 0
  if (modelCount === 0 && kbCount === 0) return ''
  const parts: string[] = []
  if (modelCount > 0) parts.push(t ? t('apps.modelPerms', { count: modelCount }) : `${modelCount} model(s)`)
  if (kbCount > 0) parts.push(t ? t('apps.kbPerms', { count: kbCount }) : `${kbCount} KB(s)`)
  return parts.join(' · ')
}
