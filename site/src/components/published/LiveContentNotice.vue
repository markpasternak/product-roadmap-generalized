<script setup lang="ts">
import { computed } from 'vue';
import { usePublishedContent } from '../../lib/published/usePublishedContent';
const context = usePublishedContent();
const state = computed(() => context?.status.value ?? 'current');
const copy = computed(() => ({
  current: '',
  deferred: 'Published content has changed. Your current work is kept; the view will update when it is safe.',
  offline: 'Offline. Showing the last loaded roadmap.',
  error: 'Could not check for updates. Showing the last loaded roadmap; we will retry.',
  application: 'A new application version is available.',
})[state.value]);
function reload() { if (!context?.blocked.value) window.location.reload(); }
</script>
<template>
  <aside v-if="state !== 'current'" class="published-update-notice" role="status" data-published-status>
    <span>{{ copy }}</span>
    <template v-if="state === 'application'">
      <span v-if="context?.blocked.value">Finish or resolve your current work before reloading.</span>
      <button v-else type="button" @click="reload">Reload application</button>
    </template>
  </aside>
</template>
<style scoped>
.published-update-notice { position:fixed; left:50%; bottom:1rem; transform:translateX(-50%); z-index:45; display:flex; flex-wrap:wrap; gap:.5rem 1rem; width:max-content; max-width:calc(100vw - 2rem); padding:.75rem 1rem; border:1px solid var(--color-border-subtle-default); border-radius:.75rem; background:var(--color-card); color:var(--color-text-primary-default); font-size:.875rem; box-shadow:0 4px 20px rgb(0 0 0 / 10%); }
button { text-decoration:underline; font-weight:600; }
</style>
