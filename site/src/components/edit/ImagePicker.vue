<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import ImageThumbnail from "../markdown/ImageThumbnail.vue";
import { trapFocus, isTopFocusTrap } from "../../lib/focusTrap";
import { markdownLabel } from "../../lib/resources";
import type { ImageChoice } from "../../lib/edit/imageAuthoring";

const props = defineProps<{ images: ImageChoice[]; uploadImage?: (file: File, signal: AbortSignal, onProgress: (progress: number) => void) => Promise<ImageChoice> }>();
const emit = defineEmits<{ insert: [markdown: string]; cancel: [] }>();
const source = ref<"resources" | "url">(
  props.images.length || props.uploadImage ? "resources" : "url",
);
const selected = ref(""),
  url = ref(""),
  alt = ref(""),
  search = ref(""),
  error = ref("");
const uploadInput = ref<HTMLInputElement>();
const uploading = ref(false), progress = ref(0);
let uploadController: AbortController | undefined;
async function upload(file?: File) {
  if (!file || !props.uploadImage || uploading.value) return;
  error.value = '';
  uploading.value = true;
  progress.value = 0;
  const controller = new AbortController();
  uploadController = controller;
  try {
    const image = await props.uploadImage(file, controller.signal, p => { progress.value = p; });
    if (controller.signal.aborted) return;
    choose(image);
    source.value = 'resources';
    search.value = '';
  } catch (e) {
    if (!controller.signal.aborted) error.value = (e as Error).message;
  } finally { uploading.value = false; }
}
function close() { uploadController?.abort(); emit('cancel'); }
const panel = ref<HTMLElement>();
const choices = computed(() =>
  props.images.filter((i) =>
    i.name.toLowerCase().includes(search.value.toLowerCase()),
  ),
);
const href = computed(() =>
  source.value === "resources" ? selected.value : url.value.trim(),
);
function choose(image: ImageChoice) {
  selected.value = image.href;
  alt.value = image.name;
  error.value = "";
}
function insert() {
  if (uploading.value) return;
  let target = href.value;
  if (source.value === "url") {
    try {
      const parsed = new URL(target);
      if (!["https:", "http:"].includes(parsed.protocol)) throw new Error();
      target = parsed.href.replace(/[()]/g, (c) => (c === "(" ? "%28" : "%29"));
    } catch {
      error.value = "Enter a complete https:// or http:// image URL.";
      return;
    }
  } else if (!props.images.some((i) => i.href === target)) {
    error.value = "Choose an image resource.";
    return;
  }
  emit("insert", `![${markdownLabel(alt.value.trim())}](${target})`);
}
let release: (() => void) | undefined;
function onKey(event: KeyboardEvent) {
  if (event.key === "Escape" && isTopFocusTrap(panel.value)) {
    event.preventDefault();
    event.stopPropagation();
    close();
  }
}
onMounted(async () => {
  await nextTick();
  if (panel.value) release = trapFocus(panel.value);
  document.addEventListener("keydown", onKey);
});
onUnmounted(() => {
  uploadController?.abort();
  release?.();
  document.removeEventListener("keydown", onKey);
});
</script>
<template>
  <Teleport to="body">
    <div class="image-picker-overlay" @mousedown.self="close()">
      <section
        ref="panel"
        class="image-picker"
        role="dialog"
        aria-modal="true"
        aria-label="Insert image"
        tabindex="-1"
      >
        <header>
          <div>
            <h2 class="font-display">Insert image</h2>
            <p>Choose an image, upload one, or use an image URL.</p>
          </div>
          <button
            type="button"
            aria-label="Close image picker"
            @click="close()"
          >
            ✕
          </button>
        </header>
        <div class="image-source-switch" aria-label="Image source">
          <button
            type="button"
            :aria-pressed="source === 'resources'"
            @click="
              source = 'resources';
              error = '';
            "
          >
            Resources <span>{{ images.length }}</span>
          </button>
          <button
            type="button"
            :aria-pressed="source === 'url'"
            @click="
              source = 'url';
              error = '';
            "
          >
            Image URL
          </button>
        </div>
        <div v-if="uploadImage" class="image-upload">
          <input ref="uploadInput" type="file" accept="image/*" hidden @change="upload(($event.target as HTMLInputElement).files?.[0]); ($event.target as HTMLInputElement).value = ''" />
          <button type="button" :disabled="uploading" @click="uploadInput?.click()">Upload image</button>
          <small v-if="!uploading">Also saved to this item’s resources.</small>
          <span v-else role="status">{{ progress === 100 ? 'Processing image…' : `Uploading ${progress}%…` }}</span>
        </div>
        <form @submit.prevent="insert">
          <template v-if="source === 'resources'">
            <label v-if="images.length > 6"
              >Find an image<input
                v-model="search"
                type="search"
                placeholder="Search resources…"
            /></label>
            <div
              v-if="images.length"
              class="image-choice-grid"
              aria-label="Image resources"
            >
              <button
                v-for="image in choices"
                :key="image.href"
                type="button"
                class="image-choice"
                :aria-pressed="selected === image.href"
                @click="choose(image)"
              >
                <ImageThumbnail :href="image.href" authenticated /><strong>{{
                  image.name
                }}</strong
                ><small>{{
                  image.attached ? "Attached to this item" : "Library"
                }}</small>
              </button>
              <p v-if="!choices.length">No images match your search.</p>
            </div>
            <p v-else class="image-empty">
              No image resources yet. Upload an image or use an image URL.
            </p>
          </template>
          <label v-else
            >Image URL<input
              v-model="url"
              type="url"
              required
              placeholder="https://example.com/image.png"
            /><small
              >Use the direct image address. External images remain hosted at
              that address.</small
            ></label
          >
          <label
            >Alt text<input
              v-model="alt"
              placeholder="Describe what the image shows"
            /><small
              >A short description for people who cannot see the image. Leave
              empty for a decorative image.</small
            ></label
          >
          <p v-if="error" role="alert" class="image-picker-error">
            {{ error }}
          </p>
          <p class="image-syntax">
            Inserts <code>![alt text](image-url)</code>
          </p>
          <footer>
            <button type="button" @click="close()">Cancel</button
            ><button
              type="submit"
              class="image-insert-action"
              :disabled="!href || uploading"
            >
              Insert image
            </button>
          </footer>
        </form>
      </section>
    </div>
  </Teleport>
</template>
<style scoped>
.image-upload { display: flex; align-items: center; gap: .75rem; flex-wrap: wrap; margin: 0 0 1rem; }
.image-picker-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: grid;
  place-items: center;
  padding: 20px;
  background: var(--color-surface-transparent-black-50);
}
.image-picker {
  width: 100%;
  max-width: 580px;
  max-height: calc(100dvh - 40px);
  overflow: auto;
  padding: 24px;
  border: 1px solid var(--color-border-subtle-default);
  border-radius: 16px;
  background: var(--color-card);
  color: var(--color-text-primary-default);
  box-shadow: 0 24px 80px #0005;
}
header,
footer {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
}
h2 {
  font-size: 26px;
}
p,
small {
  color: var(--color-text-subtle-default);
  font-size: 13px;
  line-height: 1.5;
}
header p {
  margin-top: 4px;
}
button,
input {
  font: inherit;
}
button {
  cursor: pointer;
  min-height: 40px;
  padding: 8px 12px;
  border: 1px solid var(--color-border-subtle-default);
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font-size: 14px;
}
button:disabled {
  opacity: 0.4;
  cursor: default;
}
button:hover:not(:disabled) {
  background: var(--color-surface-subtle-default);
}
button:focus-visible,
input:focus-visible {
  outline: 2px solid var(--color-accent-brand-default);
  outline-offset: 3px;
}
.image-source-switch {
  display: flex;
  gap: 8px;
  margin: 24px 0 20px;
}
.image-source-switch span {
  margin-left: 6px;
  font-size: 12px;
}
.image-source-switch [aria-pressed="true"],
.image-choice[aria-pressed="true"] {
  border-color: var(--color-accent-brand-default);
  background: var(--color-surface-transparent-orange-25);
}
form,
label {
  display: grid;
  gap: 16px;
}
label {
  gap: 6px;
  font-size: 14px;
}
input {
  width: 100%;
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid var(--color-border-subtle-default);
  border-radius: 8px;
  background: var(--color-surface-subtle-default);
  color: inherit;
}
.image-choice-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 10px;
  max-height: 280px;
  overflow: auto;
  padding: 3px;
}
.image-choice {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  text-align: left;
  gap: 7px;
  min-width: 0;
  padding: 8px;
}
.image-choice :deep(.image-thumbnail) {
  width: 100%;
  height: 92px;
  border: 0;
}
.image-choice strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 500;
}
.image-choice small {
  font-size: 11px;
}
.image-empty {
  padding: 20px;
  border: 1px dashed var(--color-border-subtle-default);
  border-radius: 8px;
}
.image-syntax {
  font-size: 12px;
}
.image-picker-error {
  color: var(--color-feedback-error-text-independent-default);
}
footer {
  justify-content: flex-end;
  margin-top: 6px;
}
.image-insert-action {
  background: var(--color-accent-brand-default);
  color: #fff;
  border-color: transparent;
}
.image-insert-action:hover:not(:disabled) {
  background: var(--color-accent-brand-default);
  filter: brightness(0.95);
}
@media (max-width: 480px) {
  .image-picker-overlay {
    padding: 12px;
  }
  .image-picker {
    padding: 18px;
    max-height: calc(100dvh - 24px);
  }
}
</style>
