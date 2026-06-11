<template>
  <span class="status-pill" :class="variant">{{ label }}</span>
</template>

<script setup lang="ts">
defineProps<{
  variant: 'running' | 'stopped' | 'ready' | 'idle' | 'loading' | 'error'
  label: string
}>()
</script>

<style scoped>
.status-pill {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: var(--mv-font-xs);
  font-weight: 500;
  line-height: 1.4;
}
.running, .ready { background: var(--mv-primary-light); color: var(--mv-primary-hover); }
.stopped, .error { background: var(--mv-danger-light); color: var(--mv-danger); }
.idle, .loading { background: var(--mv-bg-tertiary); color: var(--mv-text-tertiary); }
</style>
