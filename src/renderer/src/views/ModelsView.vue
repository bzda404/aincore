<template>
  <div class="view-content models-split">
    <ModelListPanel class="models-left" />
    <ModelMarketPanel class="models-right" />
  </div>
</template>

<script setup lang="ts">
import ModelListPanel from '../components/models/ModelListPanel.vue'
import ModelMarketPanel from '../components/models/ModelMarketPanel.vue'
</script>

<style scoped>
.view-content {
  flex: 1;
  overflow-y: auto;
  padding: var(--mv-space-lg) var(--mv-space-xl);
}
.models-split {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--mv-space-lg);
  align-items: start;
}

@media (max-width: 980px) {
  .models-split { grid-template-columns: 1fr; }
}
</style>
