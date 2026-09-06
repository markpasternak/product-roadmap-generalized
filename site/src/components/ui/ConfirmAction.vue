<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { isTopFocusTrap, trapFocus } from '../../lib/focusTrap';

defineProps<{ title: string; message: string; confirmLabel: string }>();
const emit = defineEmits<{ (event: 'confirm'): void; (event: 'cancel'): void }>();
const panel = ref<HTMLElement>();
let release: (() => void) | undefined;
function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape' && isTopFocusTrap(panel.value)) {
    event.preventDefault();
    emit('cancel');
  }
}
onMounted(() => {
  if (panel.value) release = trapFocus(panel.value);
  document.addEventListener('keydown', onKey);
});
onUnmounted(() => {
  document.removeEventListener('keydown', onKey);
  release?.();
});
</script>

<template>
  <Teleport to="body">
    <div class="confirmation-overlay fixed inset-0 z-[70] grid place-items-center p-4">
      <div class="absolute inset-0 bg-surface-transparent-black-50" @click="emit('cancel')" />
      <section ref="panel" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-message" tabindex="-1" class="relative w-full max-w-md rounded-xl border border-border-subtle-default bg-card p-6 shadow-xl">
        <h2 id="confirm-title" class="font-display text-2xl text-text-primary-default">{{ title }}</h2>
        <p id="confirm-message" class="mt-3 text-sm leading-relaxed text-text-subtle-default">{{ message }}</p>
        <div class="mt-6 flex flex-wrap justify-end gap-2">
          <button type="button" class="roadmap-action min-h-11 rounded-lg border border-border-subtle-default px-4 text-sm text-text-primary-default" data-test="cancel-action" @click="emit('cancel')">Cancel</button>
          <button type="button" class="roadmap-action roadmap-primary-action min-h-11 rounded-lg px-4 text-sm" data-test="confirm-action" @click="emit('confirm')">{{ confirmLabel }}</button>
        </div>
      </section>
    </div>
  </Teleport>
</template>
