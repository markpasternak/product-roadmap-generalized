<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { PhX } from '@phosphor-icons/vue';
import { isTopFocusTrap, trapFocus } from '../../lib/focusTrap';
import RecentChanges from './RecentChanges.vue';
defineProps<{ items: { id: string; title: string }[]; base: string }>();
const emit = defineEmits<{ close: [] }>();
const panel = ref<HTMLElement>();
const heading = ref<HTMLElement>();
let release: (() => void) | undefined;
function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape' && isTopFocusTrap(panel.value)) {
    event.preventDefault();
    emit('close');
  }
}
onMounted(() => {
  if (panel.value) release = trapFocus(panel.value, { initialFocus: () => heading.value });
  document.addEventListener('keydown', onKey);
});
onUnmounted(() => { document.removeEventListener('keydown', onKey); release?.(); });
</script>
<template>
  <Teleport to="body">
    <div class="changes-backdrop" @click.self="emit('close')">
      <section ref="panel" class="changes-drawer" role="dialog" aria-modal="true" aria-labelledby="changes-drawer-title" tabindex="-1">
        <header>
          <div><h2 id="changes-drawer-title" ref="heading" tabindex="-1">Recent changes</h2><p>Published updates across the roadmap.</p></div>
          <button type="button" aria-label="Close recent changes" @click="emit('close')"><PhX :size="20" /></button>
        </header>
        <div class="changes-content"><RecentChanges :items="items" :base="base" :show-see-all="false" show-empty embedded /></div>
        <footer><a :href="base + 'changes'">Open full history →</a></footer>
      </section>
    </div>
  </Teleport>
</template>
<style scoped>
.changes-backdrop{position:fixed;inset:0;z-index:100;background:rgba(0,0,0,.38);display:flex;justify-content:flex-end}
.changes-drawer{width:min(640px,100%);height:100dvh;background:var(--color-card);color:var(--color-text-primary-default);display:flex;flex-direction:column;box-shadow:-12px 0 48px #0002}
header{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;padding:24px;border-bottom:1px solid var(--color-border-subtle-default)}h2{font-family:var(--font-display);font-size:26px;line-height:1.2}header p{font-size:13px;color:var(--color-text-subtle-default);margin-top:8px}header button{display:grid;place-items:center;flex-shrink:0;width:44px;height:44px;border:1px solid var(--color-border-subtle-default);border-radius:10px;background:transparent;color:inherit;cursor:pointer}.changes-content{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:24px}.changes-content :deep(li){flex-direction:column;align-items:flex-start;gap:6px;padding:18px 0}.changes-content :deep(li>span:last-child){margin-left:0}footer{border-top:1px solid var(--color-border-subtle-default);padding:12px 24px max(12px,env(safe-area-inset-bottom))}footer a{display:inline-flex;align-items:center;min-height:44px;font-size:13px;color:var(--color-text-link-default);text-decoration:underline;text-underline-offset:4px}button:focus-visible,a:focus-visible{outline:2px solid var(--color-accent-brand-default);outline-offset:3px}
</style>
