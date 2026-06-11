<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="store.showPopup" class="popup-overlay" @click.self="store.deny()">
        <div class="popup-card">
          <div class="popup-header">
            <div class="popup-app-info">
              <div class="popup-avatar" :style="{ background: avatarColor(store.consent?.clientId || '') }">
                {{ store.consent?.clientName?.[0]?.toUpperCase() || '?' }}
              </div>
              <div>
                <h3 class="popup-title">{{ t('popups.oauth.title') }}</h3>
                <p class="popup-subtitle">{{ t('popups.oauth.requestAccess', { name: store.consent?.clientName || '' }) }}</p>
              </div>
            </div>
            <span class="popup-countdown" :class="{ urgent: store.countdown <= 15 }">{{ store.countdown }}{{ t('common.seconds') }}</span>
          </div>

          <div class="popup-body">
            <!-- Model scopes -->
            <div v-if="store.modelScopes.length > 0" class="perm-section">
              <span class="perm-header">{{ t('popups.oauth.modelScopes') }}</span>
              <div class="perm-list">
                <div v-for="sd in store.modelScopes" :key="sd.scope" class="perm-item selected">
                  <span>{{ t('scopes.' + sd.scope, sd.scope) }}</span>
                  <em>{{ sd.description }}</em>
                </div>
              </div>
            </div>

            <!-- Knowledge scopes -->
            <div v-if="store.knowledgeScopes.length > 0" class="perm-section">
              <span class="perm-header">{{ t('popups.oauth.knowledgeScopes') }}</span>
              <div class="perm-list">
                <div v-for="sd in store.knowledgeScopes" :key="sd.scope" class="perm-item selected">
                  <span>{{ t('scopes.' + sd.scope, sd.scope) }}</span>
                  <em>{{ sd.description }}</em>
                </div>
              </div>
            </div>

            <!-- System scopes -->
            <div v-if="store.systemScopes.length > 0" class="perm-section">
              <span class="perm-header">{{ t('popups.oauth.systemScopes') }}</span>
              <div class="perm-list">
                <div v-for="sd in store.systemScopes" :key="sd.scope" class="perm-item selected">
                  <span>{{ t('scopes.' + sd.scope, sd.scope) }}</span>
                  <em>{{ sd.description }}</em>
                </div>
              </div>
            </div>
          </div>

          <div class="popup-footer">
            <el-button type="danger" plain @click="store.deny()">{{ t('popups.oauth.deny') }}</el-button>
            <el-button plain @click="store.grantModelOnly()">{{ t('popups.oauth.modelOnly') }}</el-button>
            <el-button type="primary" @click="store.grantAll()">{{ t('popups.oauth.allow') }}</el-button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useOAuthConsentStore } from '../../stores/oauthConsentStore'

const { t } = useI18n()
const store = useOAuthConsentStore()

function avatarColor(id: string): string {
  const colors = ['#21b56f', '#3b7fca', '#d66b2b', '#7f5fc7', '#008a8a']
  let hash = 0
  for (const c of id) hash = (hash * 31 + c.charCodeAt(0)) | 0
  return colors[Math.abs(hash) % colors.length]
}
</script>

<style scoped>
.popup-overlay {
  position: fixed;
  inset: 0;
  background: var(--mv-bg-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}
.popup-card {
  background: var(--mv-bg-primary);
  border-radius: var(--mv-radius-lg);
  width: 440px;
  max-height: 80vh;
  overflow-y: auto;
  box-shadow: var(--mv-shadow-popup);
}
.popup-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: var(--mv-space-lg);
  border-bottom: 1px solid var(--mv-border);
}
.popup-app-info {
  display: flex;
  align-items: center;
  gap: var(--mv-space-md);
}
.popup-avatar {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  color: white;
  font-weight: 700;
  font-size: 18px;
  flex-shrink: 0;
}
.popup-title {
  font-size: var(--mv-font-lg);
  font-weight: 600;
  margin: 0;
}
.popup-subtitle {
  font-size: var(--mv-font-sm);
  color: var(--mv-text-secondary);
  margin: 2px 0 0;
}
.popup-countdown {
  font-size: var(--mv-font-sm);
  color: var(--mv-text-tertiary);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}
.popup-countdown.urgent { color: var(--mv-danger); font-weight: 600; }

.popup-body { padding: var(--mv-space-lg); }
.perm-section { margin-bottom: var(--mv-space-lg); }
.perm-section:last-child { margin-bottom: 0; }
.perm-header {
  display: block;
  font-size: var(--mv-font-sm);
  font-weight: 600;
  margin-bottom: var(--mv-space-sm);
}
.perm-list { display: flex; flex-direction: column; gap: 4px; }
.perm-item {
  display: flex;
  align-items: center;
  gap: var(--mv-space-sm);
  padding: 6px var(--mv-space-sm);
  border-radius: var(--mv-radius-sm);
  font-size: var(--mv-font-sm);
}
.perm-item.selected { background: var(--mv-primary-light); }
.perm-item em { font-style: normal; color: var(--mv-text-tertiary); margin-left: auto; }

.popup-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--mv-space-sm);
  padding: var(--mv-space-md) var(--mv-space-lg);
  border-top: 1px solid var(--mv-border);
}
</style>
