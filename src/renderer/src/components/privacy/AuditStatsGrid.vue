<template>
  <div v-loading="privacyStore.isLoadingStats" class="stats-grid">
    <div class="stat-card">
      <span class="stat-value">{{ privacyStore.auditStats.total }}</span>
      <span class="stat-label">{{ t('privacy.stats.total') }}</span>
    </div>
    <div class="stat-card stat-allowed">
      <span class="stat-value">{{ privacyStore.auditStats.byDecision.allowed }}</span>
      <span class="stat-label">{{ t('privacy.stats.allowed') }}</span>
    </div>
    <div class="stat-card stat-rejected">
      <span class="stat-value">{{ privacyStore.auditStats.byDecision.rejected }}</span>
      <span class="stat-label">{{ t('privacy.stats.rejected') }}</span>
    </div>
    <div class="stat-card stat-desensitized">
      <span class="stat-value">{{ privacyStore.auditStats.byDecision.desensitized }}</span>
      <span class="stat-label">{{ t('privacy.stats.desensitized') }}</span>
    </div>
    <div class="stat-card stat-timeout">
      <span class="stat-value">{{ privacyStore.auditStats.byDecision.timeout }}</span>
      <span class="stat-label">{{ t('privacy.stats.timeout') }}</span>
    </div>
    <div class="stat-card stat-high">
      <span class="stat-value">{{ privacyStore.auditStats.bySensitivity.high }}</span>
      <span class="stat-label">{{ t('privacy.stats.high') }}</span>
    </div>
    <div class="stat-card stat-medium">
      <span class="stat-value">{{ privacyStore.auditStats.bySensitivity.medium }}</span>
      <span class="stat-label">{{ t('privacy.stats.medium') }}</span>
    </div>
    <div class="stat-card stat-low">
      <span class="stat-value">{{ privacyStore.auditStats.bySensitivity.low }}</span>
      <span class="stat-label">{{ t('privacy.stats.low') }}</span>
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
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--mv-space-md);
}
.stat-card {
  padding: var(--mv-space-md);
  border: 1px solid var(--mv-border);
  border-radius: var(--mv-radius-sm);
  text-align: center;
}
.stat-value {
  display: block;
  font-size: var(--mv-font-xl);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.stat-label {
  display: block;
  font-size: var(--mv-font-xs);
  color: var(--mv-text-tertiary);
  margin-top: 2px;
}
.stat-allowed { border-left: 3px solid var(--mv-primary); }
.stat-rejected { border-left: 3px solid var(--mv-danger); }
.stat-desensitized { border-left: 3px solid var(--mv-warning); }
.stat-timeout { border-left: 3px solid var(--mv-text-tertiary); }
.stat-high { border-left: 3px solid var(--mv-danger); }
.stat-medium { border-left: 3px solid var(--mv-warning); }
.stat-low { border-left: 3px solid var(--mv-info); }

@media (max-width: 980px) {
  .stats-grid { grid-template-columns: repeat(2, 1fr); }
}
</style>
