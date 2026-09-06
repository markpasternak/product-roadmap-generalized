<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
const props = withDefaults(defineProps<{
  detail?: string;
  dirty?: number;
  pending?: boolean;
  error?: string | null;
  saveState?: string;
  publication?: { sha?: string; stage?: string; htmlUrl?: string } | null;
  summary?: { edited: { title: string }[]; created: { title: string }[]; deleted: { title: string }[]; reorderLanes: number; resources?: number };
  blocked?: boolean;
  discardBlocked?: boolean;
  authExpired?: boolean;
}>(), { detail: 'Saved on this device', dirty: 0, pending: false, error: null, publication: null, blocked: false, discardBlocked: false, saveState: 'saved' });
const emit = defineEmits<{ dismiss: []; publish: []; discard: []; retry: []; signin: []; 'retry-save': [] }>();
const dismissed = ref(false);
function dismiss() { dismissed.value = true; emit('dismiss'); }
let timer: ReturnType<typeof setTimeout> | undefined;
watch(() => [props.publication?.sha, props.publication?.stage], () => {
  dismissed.value = false;
  clearTimeout(timer);
  if (props.publication?.stage === 'live') timer = setTimeout(dismiss, 6000);
}, { immediate: true });
onUnmounted(() => clearTimeout(timer));
const showPublication = computed(() => !!props.publication && !dismissed.value);
const saving = computed(() => props.saveState === 'saving');
const localOnly = computed(() => props.saveState === 'local');
const visible = computed(() => props.dirty || props.pending || props.error || showPublication.value || saving.value || localOnly.value || props.saveState === 'conflict');
const publicationText = computed(() => props.publication?.stage === 'live'
  ? 'Your changes are live'
  : props.publication?.stage === 'failed'
    ? 'Changes saved · site update failed'
    : props.publication?.stage === 'no_build'
      ? 'Changes saved · live update not confirmed'
      : 'Changes saved · updating the site…');
const primary = computed(() => props.pending ? 'Publishing your changes…'
  : props.dirty ? `${props.dirty} unpublished ${props.dirty === 1 ? 'change' : 'changes'}`
    : showPublication.value ? publicationText.value
      : localOnly.value ? 'Account update pending'
        : saving.value ? 'Saving workspace…' : 'No unpublished changes');
</script>
<template>
  <div v-if="visible" class="save-status" data-test="save-status">
    <div class="save-status-copy">
      <p role="status" aria-live="polite" class="save-status-primary">{{ primary }}</p>
      <p v-if="dirty && !pending" class="save-status-secondary">{{ detail.replace(/[.…]+$/, '') }}. Publish to update the roadmap.</p>
      <p v-else-if="localOnly" class="save-status-secondary">{{ detail }}. The account copy has not updated yet.</p>
      <p v-if="error" data-test="save-error" role="alert" class="save-status-error">
        {{ error }}
      </p>
      <div v-if="showPublication && !pending" class="save-status-secondary publication-status">
        <span v-if="dirty">{{ publicationText }}</span>
        <span v-if="publication?.stage === 'no_build'">Your changes are safe. You can keep working.</span>
        <a v-if="publication?.htmlUrl" :href="publication.htmlUrl" target="_blank" rel="noopener">View build</a>
        <button v-if="publication?.stage === 'failed' || publication?.stage === 'no_build'" type="button" class="save-status-link" @click="$emit('retry')">Check again</button>
        <button type="button" class="save-status-link" aria-label="Dismiss publication status" @click="dismiss">Dismiss</button>
      </div>
      <details v-if="dirty && summary" class="save-status-review">
        <summary>Review changes</summary>
        <div class="save-status-review-body">
          <p v-for="(item, i) in summary.edited" :key="`e-${i}`">Edited · {{ item.title }}</p>
          <p v-for="(item, i) in summary.created" :key="`c-${i}`">New · {{ item.title || 'Untitled item' }}</p>
          <p v-for="(item, i) in summary.deleted" :key="`d-${i}`">Will delete · {{ item.title }}</p>
          <p v-if="summary.reorderLanes">Priority changed in {{ summary.reorderLanes }} {{ summary.reorderLanes === 1 ? 'lane' : 'lanes' }}</p>
          <p v-if="summary.resources">{{ summary.resources }} file {{ summary.resources === 1 ? 'change' : 'changes' }}</p>
        </div>
      </details>
    </div>
    <div class="save-status-actions">
      <button v-if="authExpired" type="button" class="save-status-publish" data-test="sign-in-again" :disabled="pending" @click="$emit('signin')">Sign in with GitHub</button>
      <button v-if="localOnly && !authExpired" type="button" class="save-status-link" @click="$emit('retry-save')">Retry saving</button>
      <button v-if="dirty" type="button" class="save-status-discard" :disabled="pending || discardBlocked" :title="discardBlocked ? 'Finish uploads or resolve the pending publication or draft conflict first' : undefined" @click="$emit('discard')">Discard draft…</button>
      <button v-if="(dirty || error) && !authExpired" type="button" data-test="sync" class="save-status-publish" :disabled="pending || blocked" @click="$emit('publish')">{{ pending ? 'Publishing…' : error ? 'Retry publication' : 'Publish changes' }}</button>
    </div>
  </div>
</template>
<style scoped>
.save-status { display:flex; align-items:center; justify-content:space-between; gap:1rem; padding:1rem 1.25rem; background:var(--color-card); color:var(--color-text-primary-default); border-top:1px solid var(--color-border-subtle-default); font-size:.8125rem; }
.save-status-copy { min-width:0; flex:1; }
.save-status p { margin:0; }
.save-status-primary { font-weight:600; }
.save-status-secondary,.save-status-review { color:var(--color-text-subtle-default); margin-top:.35rem !important; line-height:1.5; }
.publication-status { display:flex; flex-wrap:wrap; gap:.4rem .75rem; }
.save-status-error { color:var(--color-feedback-error-text-independent-default); margin-top:.35rem !important; }
.save-status-link,.save-status-secondary a { color:var(--color-accent-brand-default); text-decoration:underline; text-underline-offset:3px; }
.save-status-link { background:transparent; border:0; cursor:pointer; padding:0; }
.save-status-error button { margin-left:.5rem; }
.save-status-review summary { cursor:pointer; width:fit-content; min-height:28px; }
.save-status-review-body { padding:.4rem 0; max-height:12rem; overflow:auto; }
.save-status-review-body p { padding:.15rem 0; }
.save-status-actions { display:flex; flex-wrap:wrap; align-items:center; gap:.65rem; }
.save-status-publish,.save-status-discard { min-height:40px; padding:.6rem .9rem; border-radius:8px; border:1px solid var(--color-border-subtle-default); background:transparent; color:var(--color-text-primary-default); font-size:inherit; font-weight:500; cursor:pointer; }
.save-status-publish { border-color:var(--color-accent-brand-default); background:var(--color-accent-brand-default); color:var(--color-text-primary-inverted-default); }
button:disabled { opacity:.5; cursor:default; }
button:focus-visible,summary:focus-visible,a:focus-visible { outline:2px solid var(--color-accent-brand-default); outline-offset:3px; }
@media(max-width:640px) { .save-status { align-items:stretch; flex-direction:column; padding:1rem; } .save-status-actions { justify-content:flex-end; } }
</style>
