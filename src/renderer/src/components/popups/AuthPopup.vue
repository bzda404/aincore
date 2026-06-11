<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="store.showPopup" class="popup-overlay" @click.self="store.deny()">
        <div class="popup-card">
          <div class="popup-header">
            <div class="popup-app-info">
              <div class="popup-avatar" :style="{ background: avatarColor(store.pendingAuth?.app_id || '') }">
                {{ store.pendingAuth?.app_name?.[0]?.toUpperCase() || '?' }}
              </div>
              <div>
                <h3 class="popup-title">{{ t('popups.auth.title') }}</h3>
                <p class="popup-subtitle">{{ t('popups.auth.requestAccess', { name: store.pendingAuth?.app_name || '' }) }}</p>
              </div>
            </div>
            <span class="popup-countdown" :class="{ urgent: store.countdown <= 15 }">{{ store.countdown }}{{ t('common.seconds') }}</span>
          </div>

          <div class="popup-body">
            <!-- Models -->
            <div v-if="store.requestedModels.length > 0" class="perm-section">
              <span class="perm-header">{{ t('popups.auth.models') }}</span>
              <div class="perm-list">
                <label v-for="m in store.requestedModels" :key="m" class="perm-item" :class="{ selected: store.selectedModels.includes(m) }">
                  <input v-model="store.selectedModels" type="checkbox" :value="m" />
                  <span>{{ m }}</span>
                </label>
              </div>
            </div>

            <!-- Knowledge Bases -->
            <div v-if="store.requestedKbs.length > 0" class="perm-section">
              <span class="perm-header">{{ t('popups.auth.knowledgeBases') }}</span>
              <div class="perm-list">
                <label
                  v-for="kb in store.requestedKbs"
                  :key="kb.path"
                  class="perm-item"
                  :class="{ selected: store.isKbSelected(kb.path) }"
                  @click="store.toggleKbSelection(kb.path)"
                >
                  <input type="checkbox" :checked="store.isKbSelected(kb.path)" @click.stop="store.toggleKbSelection(kb.path)" />
                  <span>{{ kb.label || kb.path }}</span>
                  <em>{{ kb.scope === 'read_write' ? t('popups.auth.readWrite') : t('popups.auth.read') }}</em>
                </label>
              </div>
            </div>

            <!-- Duration -->
            <div class="perm-section">
              <span class="perm-header">{{ t('popups.auth.duration') }}</span>
              <div class="duration-row">
                <el-radio-group v-model="store.selectedDuration" size="small">
                  <el-radio-button :value="1">{{ t('popups.auth.hour1') }}</el-radio-button>
                  <el-radio-button :value="24">{{ t('popups.auth.hour24') }}</el-radio-button>
                  <el-radio-button :value="0">{{ t('popups.auth.permanent') }}</el-radio-button>
                </el-radio-group>
              </div>
            </div>
          </div>

          <div class="popup-footer">
            <el-button type="danger" plain @click="store.deny()">{{ t('popups.auth.deny') }}</el-button>
            <el-button plain @click="store.grantModelOnly()">{{ t('popups.auth.modelOnly') }}</el-button>
            <el-button type="primary" @click="store.grantAll()">{{ t('popups.auth.allow') }}</el-button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useAuthPopupStore } from '../../stores/authPopupStore'

const { t } = useI18n()
const store = useAuthPopupStore()

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
  cursor: pointer;
  font-size: var(--mv-font-sm);
}
.perm-item:hover { background: var(--mv-bg-tertiary); }
.perm-item.selected { background: var(--mv-primary-light); }
.perm-item em { font-style: normal; color: var(--mv-text-tertiary); margin-left: auto; }
.duration-row { padding-top: 4px; }

.popup-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--mv-space-sm);
  padding: var(--mv-space-md) var(--mv-space-lg);
  border-top: 1px solid var(--mv-border);
}
</style>
