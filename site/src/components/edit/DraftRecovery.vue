<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { trapFocus } from '../../lib/focusTrap';
import type { DraftRecovery } from '../../composables/useDraftSync';
defineProps<{ copies: DraftRecovery[]; error?: string }>();
defineEmits<{ close: [] }>();
const panel = ref<HTMLElement>();
let release: (() => void) | undefined;
onMounted(() => { if (panel.value) release = trapFocus(panel.value); });
onUnmounted(() => release?.());
function download(copy: DraftRecovery, side: 'local' | 'remote') {
  const blob = new Blob([JSON.stringify(side === 'local' ? copy.local : copy.remote.data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `roadmap-draft-${side}-${copy.savedAt.slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
</script>
<template>
  <Teleport to="body"><div class="draft-recovery-backdrop">
    <section ref="panel" role="dialog" aria-modal="true" aria-labelledby="draft-recovery-title" tabindex="-1" @keydown.esc.stop.prevent="$emit('close')">
      <header><h2 id="draft-recovery-title">Draft recovery copies</h2><button type="button" @click="$emit('close')">Close</button></header>
      <p>These copies were kept when you resolved overlapping edits. Download either version to recover its text. Downloads do not change your current draft.</p>
      <p v-if="error" role="alert">{{ error }}</p>
      <p v-if="!copies.length">No recovery copies on this device yet.</p>
      <article v-for="copy in copies" :key="copy.key">
        <h3>{{ new Date(copy.savedAt).toLocaleString() }}</h3>
        <button type="button" @click="download(copy, 'local')">Download device draft</button>
        <button type="button" @click="download(copy, 'remote')">Download account draft</button>
        <details><summary>View saved text and fields</summary><pre>{{ JSON.stringify({ device: copy.local, account: copy.remote.data }, null, 2) }}</pre></details>
      </article>
    </section>
  </div></Teleport>
</template>
<style scoped>
.draft-recovery-backdrop { position:fixed; inset:0; z-index:150; display:grid; place-items:center; background:#0008; padding:1rem; }
section { width:min(680px,100%); max-height:85dvh; overflow:auto; padding:1.5rem; border-radius:16px; background:var(--color-card); color:var(--color-text-primary-default); }
header { display:flex; align-items:center; justify-content:space-between; gap:1rem; }
h2 { font-size:1.4rem; } p, article { margin-top:1rem; } article { border-top:1px solid var(--color-border-subtle-default); padding-top:1rem; }
button { min-height:44px; padding:.5rem .7rem; text-decoration:underline; } summary { cursor:pointer; padding:.5rem 0; } pre { white-space:pre-wrap; overflow-wrap:anywhere; font-size:.8rem; }
</style>
