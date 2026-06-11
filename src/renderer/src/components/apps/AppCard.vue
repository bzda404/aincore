<template>
  <div class="data-row app-card">
    <div class="app-avatar" :style="{ background: avatarColor(app.app_id) }">
      {{ app.name?.[0]?.toUpperCase() || '?' }}
    </div>
    <div class="row-main">
      <div class="app-name-row">
        <span class="row-title">{{ app.name }}</span>
        <StatusPill
          :variant="isActive ? 'ready' : 'idle'"
          :label="isActive ? t('apps.authorized') : t('apps.revokedState')"
        />
      </div>
      <span class="row-meta">
        {{ t('apps.lastSeen') }}: {{ app.last_seen_at || '-' }}
        <template v-if="permSummary"> · {{ permSummary }}</template>
      </span>
    </div>
    <el-button v-if="isActive" size="small" type="danger" plain @click="$emit('revoke', app.app_id)">
      {{ t('apps.revoke') }}
    </el-button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { hasActiveGrant, appPermissionSummary } from '../../stores/appStore'
import StatusPill from '../common/StatusPill.vue'
import type { AppItem } from '../../types'

const props = defineProps<{ app: AppItem }>()
defineEmits<{ revoke: [appId: string] }>()

const { t } = useI18n()

const isActive = computed(() => hasActiveGrant(props.app))
const permSummary = computed(() => appPermissionSummary(props.app, t))

function avatarColor(id: string): string {
  const colors = ['#21b56f', '#3b7fca', '#d66b2b', '#7f5fc7', '#008a8a']
  let hash = 0
  for (const c of id) hash = (hash * 31 + c.charCodeAt(0)) | 0
  return colors[Math.abs(hash) % colors.length]
}
</script>

<style scoped>
.app-card { gap: var(--mv-space-md); }
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
.app-name-row {
  display: flex;
  align-items: center;
  gap: var(--mv-space-sm);
}
</style>
