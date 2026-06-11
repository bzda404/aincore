<template>
  <div class="panel">
    <span class="section-title">{{ t('privacy.config.title') }}</span>

    <div class="config-row">
      <span>{{ t('privacy.config.enableIntercept') }}</span>
      <el-switch v-model="privacyStore.config.enabled" @change="onUpdate" />
    </div>
    <div class="config-row">
      <span>{{ t('privacy.config.enableDesensitize') }}</span>
      <el-switch v-model="privacyStore.config.desensitizeEnabled" @change="onUpdate" />
    </div>
    <div class="config-row">
      <span>{{ t('privacy.config.autoRejectTimeout') }}</span>
      <el-input-number
        v-model="privacyStore.config.timeoutSeconds"
        :min="5"
        :max="300"
        size="small"
        @change="onUpdate"
      />
    </div>

    <div v-if="appStore.registeredApps.length > 0" class="perm-summary">
      <div v-for="app in appStore.registeredApps" :key="app.app_id" class="summary-row">
        <span>{{ app.name }}</span>
        <strong>{{ appPermissionSummary(app, t) || t('apps.noPerms') }}</strong>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { usePrivacyStore } from '../../stores/privacyStore'
import { useAppStore, appPermissionSummary } from '../../stores/appStore'

const { t } = useI18n()
const privacyStore = usePrivacyStore()
const appStore = useAppStore()

function onUpdate() {
  privacyStore.updateConfig(privacyStore.config)
}
</script>

<style scoped>
.config-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--mv-space-sm) 0;
  font-size: var(--mv-font-sm);
}
.perm-summary {
  margin-top: var(--mv-space-md);
  padding-top: var(--mv-space-md);
  border-top: 1px solid var(--mv-border);
}
.summary-row {
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
  font-size: var(--mv-font-sm);
}
</style>
