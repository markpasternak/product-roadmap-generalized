<script setup lang="ts">
// U4 (R3-R5, R10, R14): "New with AI" modal — a prompt + product picker that drafts a full
// item via `draftItem` and hands the result up to `Board.vue` to seed a working-copy created
// item and open it in the full-screen editor. A11y (focus trap, Escape-to-close, scroll lock)
// mirrors `ShareDialog.vue` + `focusTrap.ts` exactly.
import { ref, onMounted, onUnmounted, nextTick } from 'vue';
import Button from '../ui/Button.vue';
import Select from '../ui/Select.vue';
import { PhX, PhSparkle, PhCircleNotch, PhStop } from '@phosphor-icons/vue';
import { isTopFocusTrap, trapFocus } from '../../lib/focusTrap';
import { PRODUCTS } from '../../lib/schema';
import { draftItem, type DraftedItem } from '../../lib/ai/draftItem';
import { friendlyAiMessage, AiAbortedError } from '../../lib/ai/client';

const props = defineProps<{ initialProduct?: string | null }>();
const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'drafted', draft: DraftedItem & { product: string }): void;
}>();

const prompt = ref('');
const product = ref(props.initialProduct && (PRODUCTS as readonly string[]).includes(props.initialProduct) ? props.initialProduct : PRODUCTS[0]);
const generating = ref(false);
const error = ref<string | null>(null);

const productOptions = PRODUCTS.map((p) => ({ value: p, label: p }));

function friendlyMessage(err: unknown): string {
  return friendlyAiMessage(err, "Couldn't generate a draft right now. Please try again.");
}

// Client-side cancellation: canvas-drop's `ai.chat` has no abort param, so we can't
// abort the underlying network call — each `generate()` gets its own `AbortController`,
// and cancelling means "stop waiting on it and discard the result" once it resolves
// (via `AiAbortedError` — see `client.ts`), not an actual network abort.
let controller: AbortController | null = null;

async function generate() {
  if (generating.value || !prompt.value.trim()) return;
  generating.value = true;
  error.value = null;
  const thisController = new AbortController();
  controller = thisController;
  try {
    const draft = await draftItem(prompt.value, product.value, { signal: thisController.signal });
    if (controller === thisController && !thisController.signal.aborted) emit('drafted', { ...draft, product: product.value });
  } catch (err) {
    if (controller === thisController && !(err instanceof AiAbortedError)) error.value = friendlyMessage(err);
  } finally {
    if (controller === thisController) {
      generating.value = false;
      controller = null;
    }
  }
}

/** Cancels the in-flight `generate()` call (client-side only — see `controller` above)
 * and resets to idle. Used by close/Escape/scrim (which then also emit('close')) and by
 * the "Stop" button (which doesn't — it just cancels and leaves the dialog open). */
function cancelGeneration() {
  controller?.abort();
  controller = null;
  generating.value = false;
}

// A11y: Escape to close, scrim click to close, and the header close (X)/footer Cancel
// buttons — none of these are blocked while generating anymore (that trapped the user
// with no way out, since canvas-drop's ai.chat has no server-side abort param). Instead,
// closing while a generation is in flight cancels it first (client-side only) and then
// closes. Focus trap + scroll lock while open.
const panel = ref<HTMLElement>();
let release: (() => void) | null = null;
function closeDialog() {
  if (generating.value) cancelGeneration();
  emit('close');
}
function onKey(e: KeyboardEvent) {
  if (!isTopFocusTrap(panel.value)) return;
  if (e.key === 'Escape') closeDialog();
}
onMounted(async () => {
  document.addEventListener('keydown', onKey);
  await nextTick();
  if (panel.value) release = trapFocus(panel.value, { initialFocus: () => panel.value?.querySelector<HTMLTextAreaElement>('#ai-prompt') });
});
onUnmounted(() => {
  document.removeEventListener('keydown', onKey);
  release?.();
  controller?.abort();
});

const inputCls =
  'w-full rounded-lg border border-border-subtle-default bg-card px-3 py-2.5 text-single-sm-medium text-text-primary-default outline-none transition-colors focus:border-[color:var(--color-accent-brand-default)]';
const labelCls = 'text-single-sm-medium text-text-primary-default mb-1.5 block font-semibold';
const primaryCls =
  'bg-accent-brand-default hover:bg-accent-brand-hover active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none';
</script>

<template>
  <div class="fixed inset-0 z-50 grid place-items-center p-4">
    <div class="ai-scrim bg-surface-transparent-black-50 absolute inset-0" @click="closeDialog" />
    <div
      ref="panel"
      role="dialog"
      aria-modal="true"
      aria-label="New with AI"
      tabindex="-1"
      class="ai-panel bg-background border-border-subtle-default relative z-10 flex max-h-[calc(100dvh-2rem)] w-[560px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border shadow-xl outline-none"
    >
      <header class="border-border-subtle-default flex items-start justify-between gap-4 border-b px-6 py-4">
        <div class="flex items-center gap-2">
          <PhSparkle :size="18" class="text-[color:var(--color-accent-brand-default)]" />
          <div>
            <p class="roadmap-label">New with AI</p>
            <p class="text-single-sm-medium text-text-subtle-default mt-1">
              Describe the item — AI drafts a full spec for you to review and edit.
            </p>
          </div>
        </div>
        <button
          type="button"
          aria-label="Close"
          class="text-icons-subtle-default hover:text-text-primary-default -mr-1.5 -mt-1 grid size-9 shrink-0 place-items-center rounded-lg transition-colors disabled:pointer-events-none disabled:opacity-40"
          @click="closeDialog"
        >
          <PhX :size="18" />
        </button>
      </header>

      <div class="flex-1 overflow-y-auto px-6 py-5">
        <div class="space-y-4">
          <div>
            <label :class="labelCls" for="ai-product">Product</label>
            <Select id="ai-product" v-model="product" :options="productOptions" aria-label="Product" />
          </div>
          <div>
            <label :class="labelCls" for="ai-prompt">What should this item cover?</label>
            <textarea
              id="ai-prompt"
              v-model="prompt"
              data-test="ai-prompt"
              rows="5"
              placeholder="e.g. Let editors bulk-tag items from a multi-select on the board..."
              :disabled="generating"
              :class="[inputCls, 'resize-none disabled:opacity-60']"
              @keydown.meta.enter="generate"
              @keydown.ctrl.enter="generate"
            />
<p class="text-single-sm-medium text-text-subtle-default mt-1.5">The generated item opens as a private draft. Review it before publishing.</p>
          </div>
        </div>

        <p
          v-if="error"
          data-test="ai-error"
          role="alert"
          class="bg-surface-transparent-orange-25 text-single-sm-medium mt-4 rounded-lg px-3 py-2 text-[color:var(--color-accent-brand-default)]"
        >
          {{ error }}
        </p>
      </div>

      <footer class="border-border-subtle-default flex items-center justify-between gap-3 border-t px-6 py-4">
        <Button variant="ghost" @click="closeDialog">Cancel</Button>
        <div class="flex items-center gap-2">
          <Button v-if="generating" variant="ghost" data-test="ai-stop" @click="cancelGeneration">
            <PhStop :size="15" />
            Stop
          </Button>
          <Button
            variant="primary"
            data-test="ai-generate"
            :class="primaryCls"
            :disabled="!prompt.trim() || generating"
            @click="generate"
          >
            <PhCircleNotch v-if="generating" :size="16" class="animate-spin" />
            {{ generating ? 'Generating…' : 'Generate' }}
          </Button>
        </div>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.ai-scrim {
  animation: ai-fade 0.18s ease;
}
.ai-panel {
  animation: ai-pop 0.22s cubic-bezier(0.23, 1, 0.32, 1);
}
@keyframes ai-fade {
  from {
    opacity: 0;
  }
}
@keyframes ai-pop {
  from {
    opacity: 0;
    transform: translateY(6px) scale(0.98);
  }
}
@media (prefers-reduced-motion: reduce) {
  .ai-scrim,
  .ai-panel {
    animation: none;
  }
}
</style>
