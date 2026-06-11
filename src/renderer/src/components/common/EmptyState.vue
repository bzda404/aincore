<template>
  <div class="empty-state">
    <span v-if="icon" class="empty-icon">{{ icon }}</span>
    <p class="empty-message">{{ message }}</p>
    <button v-if="actionLabel" class="btn btn-outline btn-sm" @click="$emit('action')">{{ actionLabel }}</button>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  icon?: string
  message: string
  actionLabel?: string
}>()
defineEmits<{ action: [] }>()
</script>

<style scoped>
.empty-state {
  text-align: center;
  padding: var(--mv-space-2xl) var(--mv-space-lg);
  color: var(--mv-text-tertiary);
}
.empty-icon {
  font-size: 28px;
  display: block;
  margin-bottom: var(--mv-space-sm);
  opacity: 0.5;
}
.empty-message {
  font-size: var(--mv-font-sm);
  margin-bottom: var(--mv-space-md);
}
</style>
