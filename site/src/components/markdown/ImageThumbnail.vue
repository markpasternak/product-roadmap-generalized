<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { resourceHref, repositoryAssetPath } from "../../lib/resources";
import {
  resourcePreviewURLs,
  loadImagePreview,
} from "../../lib/edit/resourceClient";

const props = defineProps<{ href: string; authenticated?: boolean }>();
const failed = ref(false);
const src = computed(() => {
  const path = repositoryAssetPath(props.href);
  return path && path in resourcePreviewURLs.value
    ? resourcePreviewURLs.value[path]
    : resourceHref(props.href, import.meta.env.BASE_URL);
});
watch(src, () => {
  failed.value = false;
});
async function onError() {
  failed.value = true;
  const path = repositoryAssetPath(props.href);
  if (props.authenticated && path && !resourcePreviewURLs.value[path]) {
    try {
      await loadImagePreview(path);
    } catch {
      /* Keep an honest fallback. */
    }
  }
}
</script>
<template>
  <span class="image-thumbnail">
    <img
      v-if="src && !failed"
      :src="src"
      alt=""
      loading="lazy"
      decoding="async"
      referrerpolicy="no-referrer"
      @error="onError"
    />
    <span v-else class="image-thumbnail-fallback">{{
      failed ? "No preview" : "Image"
    }}</span>
  </span>
</template>
<style scoped>
.image-thumbnail {
  display: grid;
  place-items: center;
  width: 80px;
  height: 64px;
  flex-shrink: 0;
  overflow: hidden;
  border: 1px solid var(--color-border-subtle-default);
  border-radius: 8px;
  background: var(--color-surface-subtle-default);
}
.image-thumbnail img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.image-thumbnail-fallback {
  font-size: 11px;
  color: var(--color-text-subtle-default);
  text-align: center;
}
</style>
