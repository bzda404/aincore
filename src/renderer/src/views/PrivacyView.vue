<template>
  <div class="view-content">
    <AuditStatsGrid />
    <div class="privacy-panels">
      <PrivacyConfigPanel />
      <AuditFilterPanel />
    </div>
    <AuditLogTable />
  </div>
</template>

<script setup lang="ts">
import AuditStatsGrid from '../components/privacy/AuditStatsGrid.vue'
import PrivacyConfigPanel from '../components/privacy/PrivacyConfigPanel.vue'
import AuditFilterPanel from '../components/privacy/AuditFilterPanel.vue'
import AuditLogTable from '../components/privacy/AuditLogTable.vue'
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
.privacy-panels {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--mv-space-lg);
  align-items: start;
}

@media (max-width: 980px) {
  .privacy-panels { grid-template-columns: 1fr; }
}
</style>
