<template>
  <div class="view-content">
    <!-- Built-in Notes section -->
    <div class="panel">
      <span class="section-title">{{ t('apps.builtin') }}</span>
      <div class="builtin-row">
        <div class="app-avatar notes-avatar">N</div>
        <div class="row-main">
          <div class="app-name-row">
            <span class="row-title">AinCore Notes</span>
            <StatusPill
              :variant="appStore.notesConnected ? 'ready' : appStore.notesRevoked ? 'error' : 'idle'"
              :label="notesStateLabel"
            />
          </div>
          <span class="row-meta">{{ notesPermissionText }}</span>
        </div>
        <el-button type="primary" size="small" :disabled="!systemStore.modelReady" @click="appStore.openNotes()">
          {{ t('apps.open') }}
        </el-button>
        <el-button
          v-if="appStore.notesConnected"
          size="small"
          type="danger"
          plain
          @click="appStore.revokeNotes()"
        >
          {{ t('apps.revoke') }}
        </el-button>
      </div>
    </div>

    <!-- Connected apps section -->
    <div class="panel">
      <span class="section-title">{{ t('apps.connected') }}</span>

      <EmptyState
        v-if="appStore.registeredApps.length === 0"
        icon="◇"
        :message="t('apps.emptyApps')"
      />

      <div v-else class="row-list">
        <AppCard
          v-for="app in appStore.registeredApps"
          :key="app.app_id"
          :app="app"
          @revoke="appStore.revokeApp"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppStore, appPermissionSummary } from '../stores/appStore'
import { useSystemStore } from '../stores/systemStore'
import StatusPill from '../components/common/StatusPill.vue'
import EmptyState from '../components/common/EmptyState.vue'
import AppCard from '../components/apps/AppCard.vue'

const { t } = useI18n()
const appStore = useAppStore()
const systemStore = useSystemStore()

const notesStateLabel = computed(() => {
  if (appStore.notesConnected) return t('dashboard.task2.connected')
  if (appStore.notesRevoked) return t('dashboard.task2.revoked')
  return t('dashboard.task2.unconnected')
})

const notesPermissionText = computed(() => {
  if (!appStore.notesApp) return t('apps.noPerms')
  return appPermissionSummary(appStore.notesApp, t) || t('apps.noPerms')
})
</script>

<style scoped>
.view-content {
  flex: 1;
  overflow-y: auto;
  padding: var(--mv-space-lg) var(--mv-space-xl);
  display: flex;
  flex-direction: column;
  gap: var(--mv-space-lg);
}
.builtin-row {
  display: flex;
  align-items: center;
  gap: var(--mv-space-md);
  margin-top: var(--mv-space-md);
}
.app-avatar {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  color: white;
  font-weight: 600;
  font-size: 14px;
  flex-shrink: 0;
}
.notes-avatar { background: var(--mv-primary); }
.app-name-row {
  display: flex;
  align-items: center;
  gap: var(--mv-space-sm);
}
</style>
