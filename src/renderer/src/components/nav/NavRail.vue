<template>
  <nav class="nav-rail">
    <div class="nav-top">
      <div class="brand-mark">M</div>
      <router-link
        v-for="item in navItems"
        :key="item.path"
        :to="item.path"
        class="nav-icon"
        :class="{ active: $route.path === item.path }"
        :title="t(item.labelKey)"
      >
        <span>{{ item.icon }}</span>
        <span v-if="item.path === '/apps' && badgeCount > 0" class="nav-badge">{{ badgeCount }}</span>
      </router-link>
    </div>
    <div class="nav-bottom">
      <span class="status-dot" :class="systemStore.hubStatusClass" :title="statusLabel"></span>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSystemStore } from '../../stores/systemStore'
import { useAuthPopupStore } from '../../stores/authPopupStore'
import { useOAuthConsentStore } from '../../stores/oauthConsentStore'

const { t } = useI18n()
const systemStore = useSystemStore()
const authPopupStore = useAuthPopupStore()
const oauthConsentStore = useOAuthConsentStore()

const navItems = [
  { path: '/dashboard', labelKey: 'nav.dashboard', icon: '⌂' },
  { path: '/models', labelKey: 'nav.models', icon: '▣' },
  { path: '/apps', labelKey: 'nav.apps', icon: '◇' },
  { path: '/appmarket', labelKey: 'nav.market', icon: '⊞' },
  { path: '/privacy', labelKey: 'nav.privacy', icon: '◉' },
  { path: '/settings', labelKey: 'nav.settings', icon: '⚙' },
]

const badgeCount = computed(() =>
  (authPopupStore.showPopup ? 1 : 0) + (oauthConsentStore.showPopup ? 1 : 0),
)

const statusLabel = computed(() =>
  systemStore.hubStatus === 'running' ? t('common.coreRunning') : t('common.coreOffline'),
)
</script>

<style scoped>
.nav-rail {
  position: fixed;
  left: 0;
  top: 0;
  bottom: 0;
  width: var(--mv-nav-width);
  background: var(--mv-bg-tertiary);
  border-right: 1px solid var(--mv-border);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  align-items: center;
  padding: 10px 0;
  z-index: 100;
}

.nav-top {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.brand-mark {
  width: 28px;
  height: 28px;
  border-radius: 7px;
  background: var(--mv-primary);
  color: var(--mv-text-inverse);
  display: grid;
  place-items: center;
  font-weight: 700;
  font-size: 14px;
  margin-bottom: 8px;
}

.nav-icon {
  width: 34px;
  height: 34px;
  border-radius: 7px;
  background: transparent;
  color: rgba(0, 0, 0, 0.55);
  cursor: pointer;
  display: grid;
  place-items: center;
  position: relative;
  font-size: 15px;
  text-decoration: none;
  transition: background var(--mv-transition-fast), color var(--mv-transition-fast);
}

.nav-icon:hover {
  background: rgba(0, 0, 0, 0.04);
  color: rgba(0, 0, 0, 0.75);
}

.nav-icon.active {
  background: var(--mv-primary-light);
  color: var(--mv-primary-hover);
}

.nav-badge {
  position: absolute;
  top: -2px;
  right: -2px;
  min-width: 14px;
  height: 14px;
  border-radius: 7px;
  background: var(--mv-danger);
  color: white;
  font-size: 9px;
  font-weight: 700;
  display: grid;
  place-items: center;
  padding: 0 3px;
}

.nav-bottom {
  padding-bottom: 4px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: block;
}

.status-dot.running {
  background: var(--mv-primary);
}

.status-dot.stopped {
  background: var(--mv-danger);
}
</style>
