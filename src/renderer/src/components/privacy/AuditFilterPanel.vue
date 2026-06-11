<template>
  <div class="panel">
    <div class="section-head">
      <span class="section-title">{{ t('privacy.filters.title') }}</span>
      <div class="export-actions">
        <el-button size="small" plain :loading="privacyStore.isExporting" @click="privacyStore.exportAudit('json')">
          {{ t('privacy.filters.exportJson') }}
        </el-button>
        <el-button size="small" plain :loading="privacyStore.isExporting" @click="privacyStore.exportAudit('csv')">
          {{ t('privacy.filters.exportCsv') }}
        </el-button>
      </div>
    </div>

    <div class="filter-row">
      <el-select v-model="privacyStore.timeRange" size="small" @change="privacyStore.onFilterChange()">
        <el-option value="all" :label="t('privacy.filters.allTime')" />
        <el-option value="today" :label="t('privacy.filters.today')" />
        <el-option value="7days" :label="t('privacy.filters.last7days')" />
        <el-option value="30days" :label="t('privacy.filters.last30days')" />
      </el-select>
      <el-select v-model="privacyStore.clientFilter" size="small" @change="privacyStore.onFilterChange()">
        <el-option value="" :label="t('privacy.filters.allApps')" />
        <el-option v-for="c in privacyStore.auditClients" :key="c" :value="c" :label="c" />
      </el-select>
    </div>

    <div class="filter-row">
      <span class="filter-label">{{ t('privacy.filters.decision') }}</span>
      <el-radio-group v-model="privacyStore.decisionFilter" size="small" @change="privacyStore.onFilterChange()">
        <el-radio-button v-for="d in privacyStore.decisionOptions" :key="d" :value="d">
          {{ privacyStore.decisionLabel(d) }}
        </el-radio-button>
      </el-radio-group>
    </div>

    <div class="filter-row">
      <span class="filter-label">{{ t('privacy.filters.sensitivity') }}</span>
      <el-radio-group v-model="privacyStore.sensitivityFilter" size="small" @change="privacyStore.onFilterChange()">
        <el-radio-button v-for="s in privacyStore.sensitivityOptions" :key="s" :value="s">
          {{ privacyStore.sensitivityLabel(s) }}
        </el-radio-button>
      </el-radio-group>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { usePrivacyStore } from '../../stores/privacyStore'

const { t } = useI18n()
const privacyStore = usePrivacyStore()
</script>

<style scoped>
.filter-row {
  display: flex;
  align-items: center;
  gap: var(--mv-space-sm);
  margin-top: var(--mv-space-sm);
  flex-wrap: wrap;
}
.filter-label {
  font-size: var(--mv-font-sm);
  color: var(--mv-text-secondary);
  flex-shrink: 0;
}
.export-actions {
  display: flex;
  gap: var(--mv-space-xs);
}
</style>
