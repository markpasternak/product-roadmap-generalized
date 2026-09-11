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
const selected = ref<string[]>([]);
const uploadedImages = ref<ImageChoice[]>([]);
const libraryScope = ref<'personal' | 'shared'>('personal');
const url = ref(""),
  alt = ref(""),
  search = ref(""),
  error = ref("");
const uploadInput = ref<HTMLInputElement>();
const uploading = ref(false), progress = ref(0);
const uploadName = ref(''), uploadIndex = ref(0), uploadTotal = ref(0);
let uploadController: AbortController | undefined;
async function upload(files: File[]) {
  if (!files.length || !props.uploadImage || uploading.value) return;
  error.value = '';
  uploading.value = true;
  progress.value = 0;
  const controller = new AbortController();
  uploadController = controller;
  uploadTotal.value = files.length;
  const failures: string[] = [];
  try {
    for (const [index, file] of files.entries()) {
      if (controller.signal.aborted) break;
      uploadIndex.value = index + 1;
      uploadName.value = file.name;
      progress.value = 0;
      try {
        const image = await props.uploadImage(file, controller.signal, p => { progress.value = p; });
        if (controller.signal.aborted) break;
        uploadedImages.value.push({ ...image, filename: file.name, mine: true });
        if (!selected.value.includes(image.href)) choose(image);
        source.value = 'resources';
        libraryScope.value = 'personal';
        search.value = '';
      } catch (e) {
        if (controller.signal.aborted) break;
        failures.push(`${file.name}: ${(e as Error).message}`);
      }
    }
    if (!controller.signal.aborted) error.value = failures.join('\n');
  } finally { uploading.value = false; }
}
function close() { uploadController?.abort(); emit('cancel'); }
const panel = ref<HTMLElement>();
const availableImages = computed(() => [...new Map([...props.images, ...uploadedImages.value].map(image => [image.href, image])).values()]);
const choices = computed(() => availableImages.value
  .filter(image => libraryScope.value === 'shared' ? !image.attached && !image.mine : image.attached || image.mine)
  .filter(image => [image.name, image.filename].some(value => value?.toLowerCase().includes(search.value.trim().toLowerCase()))));
const selectedImages = computed(() => selected.value.map(href => availableImages.value.find(image => image.href === href)).filter((image): image is ImageChoice => !!image));
const href = computed(() =>
  source.value === "resources" ? selected.value[0] ?? '' : url.value.trim(),
);
function choose(image: ImageChoice) {
  selected.value = selected.value.includes(image.href) ? selected.value.filter(href => href !== image.href) : [...selected.value, image.href];
  if (selected.value.length === 1) alt.value = availableImages.value.find(value => value.href === selected.value[0])?.name ?? image.name;
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
  } else {
    if (!selectedImages.value.length || selectedImages.value.length !== selected.value.length) {
      error.value = "Choose an image resource.";
      return;
    }
    emit('insert', selectedImages.value.map(image => `![${markdownLabel(selectedImages.value.length === 1 ? alt.value.trim() : image.name)}](${image.href})`).join('\n\n'));
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
            <p>Select images, upload several at once, or use an image URL.</p>
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
            Resources <span>{{ availableImages.length }}</span>
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
          <input ref="uploadInput" type="file" accept="image/*" multiple hidden @change="upload(Array.from(($event.target as HTMLInputElement).files ?? [])); ($event.target as HTMLInputElement).value = ''" />
          <button type="button" :disabled="uploading" @click="uploadInput?.click()">Upload images</button>
          <small v-if="!uploading">Also saved to this item’s resources.</small>
          <span v-else role="status">{{ uploadIndex }} of {{ uploadTotal }} · {{ uploadName }} · {{ progress === 100 ? 'Processing…' : `${progress}%` }}</span>
        </div>
        <form @submit.prevent="insert">
          <template v-if="source === 'resources'">
            <div class="image-library-switch" aria-label="Image library">
              <button type="button" :aria-pressed="libraryScope === 'personal'" @click="libraryScope = 'personal'">This item &amp; your uploads</button>
              <button type="button" :aria-pressed="libraryScope === 'shared'" @click="libraryScope = 'shared'">Shared library</button>
            </div>
            <label
              >Filter by name<input
                v-model="search"
                type="search"
                placeholder="Type an image name or filename…"
            /></label>
            <div v-if="search" class="image-filter-result"><span role="status">{{ choices.length }} {{ choices.length === 1 ? 'image' : 'images' }} found</span><button type="button" @click="search = ''">Clear filter</button></div>
            <div
              v-if="availableImages.length"
              class="image-choice-grid"
              aria-label="Image resources"
            >
              <button
                v-for="image in choices"
                :key="image.href"
                type="button"
                class="image-choice"
                :aria-pressed="selected.includes(image.href)"
                :title="image.filename || image.name"
                @click="choose(image)"
              >
                <ImageThumbnail :href="image.href" authenticated /><strong>{{
                  image.name
                }}</strong
                ><small v-if="image.filename && image.filename !== image.name" class="image-filename">{{ image.filename }}</small>
                <small>{{ image.attached ? 'Attached to this item' : image.mine ? 'Your upload' : image.uploadedBy ? `Uploaded by ${image.uploadedBy}` : 'Shared library' }}</small>
              </button>
              <p v-if="!choices.length">{{ search ? 'No images match your search.' : libraryScope === 'personal' ? 'No images here yet. Upload images or browse the shared library.' : 'No other shared images.' }}</p>
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
          <label v-if="source === 'url' || selectedImages.length <= 1"
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
          <p v-if="source === 'resources' && selectedImages.length > 1">{{ selectedImages.length }} images selected. Image names will be used as alt text.</p>
          <footer>
            <button type="button" @click="close()">Cancel</button
            ><button
              type="submit"
              class="image-insert-action"
              :disabled="!href || uploading"
            >
              {{ source === 'resources' && selectedImages.length > 1 ? `Insert ${selectedImages.length} images` : 'Insert image' }}
            </button>
          </footer>
        </form>
      </section>
    </div>
  </Teleport>
</template>
<style scoped>
.image-filter-result { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 13px; }
.image-upload { display: flex; align-items: center; gap: .75rem; flex-wrap: wrap; margin: 0 0 1rem; }
.image-library-switch { display:flex; gap:8px; flex-wrap:wrap; }
.image-library-switch [aria-pressed="true"] { border-color:var(--color-accent-brand-default); background:var(--color-surface-transparent-orange-25); }
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
  overflow-wrap: anywhere;
  font-size: 13px;
  font-weight: 500;
}
.image-choice small {
  font-size: 11px;
  overflow-wrap: anywhere;
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
  white-space: pre-line;
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
