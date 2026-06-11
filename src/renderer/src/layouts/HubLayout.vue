<template>
  <div class="hub-app">
    <!-- Memory fallback warning -->
    <div v-if="systemStore.memFallback" class="mem-warning">
      <span>{{ t('common.memFallback') }}</span>
    </div>

    <NavRail />

    <div class="workspace">
      <header class="workspace-header">
        <div>
          <h1 class="workspace-title">{{ t($route.meta.title as string) }}</h1>
          <p class="workspace-subtitle">{{ subtitle }}</p>
        </div>
      </header>

      <router-view v-slot="{ Component }">
        <Transition name="fade" mode="out-in">
          <component :is="Component" />
        </Transition>
      </router-view>
    </div>

    <!-- Global popups -->
    <AuthPopup />
    <OAuthConsentPopup />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useSystemStore } from '../stores/systemStore'
import { useAppStore } from '../stores/appStore'
import { useAuthPopupStore } from '../stores/authPopupStore'
import { useOAuthConsentStore } from '../stores/oauthConsentStore'
import { useModelStore } from '../stores/modelStore'
import { usePrivacyStore } from '../stores/privacyStore'
import { usePolling } from '../composables/usePolling'
import NavRail from '../components/nav/NavRail.vue'
import AuthPopup from '../components/popups/AuthPopup.vue'
import OAuthConsentPopup from '../components/popups/OAuthConsentPopup.vue'

const { t } = useI18n()
const route = useRoute()
const systemStore = useSystemStore()
const appStore = useAppStore()
const modelStore = useModelStore()
const privacyStore = usePrivacyStore()
const authPopupStore = useAuthPopupStore()
const oauthConsentStore = useOAuthConsentStore()

const subtitle = computed(() => {
  const key = `dashboard.subtitle`
  const name = route.name as string
  if (name === 'dashboard') return t('dashboard.subtitle')
  if (name === 'models') return t('models.subtitle')
  if (name === 'apps') return t('apps.subtitle')
  if (name === 'appmarket') return t('appmarket.subtitle')
  if (name === 'privacy') return t('privacy.subtitle')
  return t('settings.subtitle')
})

// Polling for app data
const appPolling = usePolling(async () => {
  await appStore.fetchApps()
}, 8000)

// Polling for privacy data
const privacyPolling = usePolling(async () => {
  await privacyStore.refreshAll()
}, 8000)

// Visibility-aware polling: stop when window is hidden, resume when visible
function handleVisibilityChange() {
  if (document.hidden) {
    systemStore.stopPolling()
    appPolling.stop()
    privacyPolling.stop()
    authPopupStore.stopPolling()
  } else {
    // Resume polling and fetch fresh data immediately
    systemStore.startPolling()
    appPolling.start()
    privacyPolling.start()
    authPopupStore.startPolling()
    systemStore.fetchStatus()
  }
}

onMounted(async () => {
  // Initial data load
  await Promise.all([
    systemStore.fetchStatus(),
    modelStore.fetchModels(),
    modelStore.fetchDefaultModel(),
    appStore.fetchApps(),
    privacyStore.refreshAll(),
  ])

  // Start all polling
  systemStore.startPolling()
  appPolling.start()
  privacyPolling.start()
  authPopupStore.startPolling()
  oauthConsentStore.setupListener()

  // Listen for visibility changes to pause/resume polling
  document.addEventListener('visibilitychange', handleVisibilityChange)
})

onUnmounted(() => {
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  systemStore.stopPolling()
  appPolling.stop()
  privacyPolling.stop()
  authPopupStore.stopPolling()
  oauthConsentStore.cleanup()
  modelStore.cleanup()
})
</script>

<style scoped>
.hub-app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  background: var(--mv-bg-primary);
  color: var(--mv-text-primary);
}

.mem-warning {
  background: var(--mv-warning-light);
  color: #92400e;
  text-align: center;
  padding: 6px 16px;
  font-size: var(--mv-font-sm);
  font-weight: 500;
}

.workspace {
  flex: 1;
  margin-left: var(--mv-nav-width);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.workspace-header {
  padding: var(--mv-space-lg) var(--mv-space-xl);
  border-bottom: 1px solid var(--mv-border);
  flex-shrink: 0;
}

.workspace-title {
  font-size: var(--mv-font-xl);
  font-weight: 600;
  margin: 0;
  line-height: 1.3;
}

.workspace-subtitle {
  font-size: var(--mv-font-sm);
  color: var(--mv-text-tertiary);
  margin: 2px 0 0;
}
</style>
