<template>
  <div class="panel">
    <div class="section-head">
      <span class="section-title">{{ t('privacy.audit.title') }}</span>
      <el-button size="small" plain @click="onClear">{{ t('privacy.audit.clear') }}</el-button>
    </div>

    <div v-loading="privacyStore.isLoadingAudit">
      <EmptyState
        v-if="privacyStore.filteredEntries.length === 0"
        icon="◉"
        :message="privacyStore.auditStats.total > 0 ? t('privacy.audit.empty') : t('privacy.audit.emptyAll')"
      />

      <div v-else class="row-list compact">
        <div v-for="entry in privacyStore.filteredEntries" :key="entry.request_id + entry.timestamp" class="data-row">
          <span :class="'state-tag audit-' + entry.decision">{{ privacyStore.decisionLabel(entry.decision) }}</span>
          <span v-if="entry.sensitivity" :class="'state-tag sens-' + entry.sensitivity">
            {{ privacyStore.sensitivityLabel(entry.sensitivity) }}
          </span>
          <div class="row-main">
            <span class="row-title">{{ entry.client_name || t('privacy.audit.unknownApp') }}</span>
            <span class="row-meta">
              {{ entry.tool }} · {{ t('privacy.audit.piiCount', { count: entry.pii_count }) }} · {{ formatDate(entry.timestamp || '') }}
            </span>
          </div>
        </div>
      </div>

      <div v-if="privacyStore.hasMoreEntries" class="load-more">
        <el-button size="small" plain :loading="privacyStore.isLoadingAudit" @click="privacyStore.loadMore()">
          {{ t('privacy.audit.loadMore') }}
        </el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { ElMessageBox } from 'element-plus'
import { usePrivacyStore } from '../../stores/privacyStore'
import EmptyState from '../common/EmptyState.vue'

const { t } = useI18n()
const privacyStore = usePrivacyStore()

async function onClear() {
  try {
    await ElMessageBox.confirm(t('privacy.audit.clear') + '?', '', { type: 'warning' })
    await privacyStore.clearAudit()
  } catch {
    // cancelled
  }
}

function formatDate(ts: string): string {
  return new Date(ts).toLocaleString()
}
</script>

<style scoped>
.load-more {
  text-align: center;
  padding: var(--mv-space-md) 0;
}
.audit-allowed { background: var(--mv-primary-light); color: var(--mv-primary-hover); }
.audit-rejected { background: var(--mv-danger-light); color: var(--mv-danger); }
.audit-desensitized { background: var(--mv-warning-light); color: #92400e; }
.audit-timeout { background: var(--mv-bg-tertiary); color: var(--mv-text-tertiary); }
.sens-high { background: var(--mv-danger-light); color: var(--mv-danger); }
.sens-medium { background: var(--mv-warning-light); color: #92400e; }
.sens-low { background: var(--mv-info-light); color: var(--mv-info); }
</style>
