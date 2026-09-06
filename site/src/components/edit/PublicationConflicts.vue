<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from "vue";
import { fetchItems, type ApiItem } from "../../lib/edit/client";
import { trapFocus, isTopFocusTrap } from "../../lib/focusTrap";
const props = defineProps<{
  ids: string[];
  drafts: Record<
    string,
    { title: string; body: string; fields: Record<string, string> }
  >;
}>();
const emit = defineEmits<{
  resolve: [id: string, keepMine: boolean, items: ApiItem[]];
  close: [];
}>();
const latest = ref<ApiItem[] | null>(null),
  error = ref(""),
  panel = ref<HTMLElement>();
let release: (() => void) | undefined;
async function load() {
  latest.value = null;
  error.value = "";
  try {
    latest.value = await fetchItems();
  } catch {
    error.value = "Could not load the latest versions. Your changes are kept.";
  }
}
watch(
  () => props.ids.join(","),
  () => {
    if (!latest.value) void load();
  },
  { immediate: true },
);
function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape' && isTopFocusTrap(panel.value)) {
    event.preventDefault();
    event.stopPropagation();
    emit('close');
  }
}
onMounted(() => {
  document.addEventListener('keydown', onKey);
  if (panel.value) release = trapFocus(panel.value);
});
onUnmounted(() => { release?.(); document.removeEventListener('keydown', onKey); });
</script>
<template>
  <div class="publication-conflicts">
    <section
      ref="panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="conflict-title"
      tabindex="-1"
    >
      <header>
        <div>
          <h2 id="conflict-title">Review overlapping changes</h2>
          <p>
            Independent edits are combined automatically. These changes need
            your choice.
          </p>
        </div>
        <button type="button" @click="emit('close')">Back to editing</button>
      </header>
      <p v-if="error" role="alert">
        {{ error }} <button @click="load">Try again</button>
      </p>
      <p v-else-if="!latest" role="status">Loading the latest versions…</p>
      <article v-else v-for="id in ids" :key="id">
        <h3>
          {{ drafts[id]?.title || id }} <small>{{ id }}</small>
        </h3>
        <div class="conflict-versions">
          <div>
            <h4>Your draft</h4>
            <dl>
              <template v-for="(value, key) in drafts[id]?.fields" :key="key"
                ><dt>{{ key }}</dt>
                <dd>{{ value || "Empty" }}</dd></template
              >
            </dl>
            <pre>{{ drafts[id]?.body }}</pre>
          </div>
          <div>
            <h4>Latest published version</h4>
            <template v-if="latest.find((i) => i.id === id)"
              ><dl>
                <template v-for="(_, key) in drafts[id]?.fields" :key="key"
                  ><dt>{{ key }}</dt>
                  <dd>
                    {{
                      latest.find((i) => i.id === id)?.frontmatter?.[key] ||
                      "Empty"
                    }}
                  </dd></template
                >
              </dl>
              <pre>{{ latest.find((i) => i.id === id)?.body }}</pre>
            </template>
            <p v-else>This item was deleted.</p>
          </div>
        </div>
        <footer>
          <button type="button" @click="emit('resolve', id, false, latest)">
            Use latest version</button
          ><button type="button" @click="emit('resolve', id, true, latest)">
            {{
              latest.some((i) => i.id === id)
                ? "Keep my changes"
                : "Restore as a new item"
            }}
          </button>
        </footer>
      </article>
    </section>
  </div>
</template>
<style scoped>
.publication-conflicts {
  position: fixed;
  inset: 0;
  z-index: 140;
  background: #0009;
  display: grid;
  place-items: center;
  padding: 1rem;
}
.publication-conflicts > section {
  width: min(1050px, 100%);
  max-height: calc(100dvh - 2rem);
  overflow: auto;
  background: var(--color-card);
  border: 1px solid var(--color-border-subtle-default);
  border-radius: 16px;
  padding: 1.5rem;
}
.publication-conflicts header {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
}
.publication-conflicts h2 {
  font-family: 'Source Serif Pro', Georgia, serif;
  font-size: 1.6rem;
}
.publication-conflicts p,
.publication-conflicts small {
  font-size: 0.85rem;
  color: var(--color-text-subtle-default);
  margin: 0.5rem 0;
}
.publication-conflicts article {
  margin-top: 1.5rem;
  border-top: 1px solid var(--color-border-subtle-default);
  padding-top: 1rem;
}
.publication-conflicts h3 {
  font-weight: 600;
}
.conflict-versions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  margin: 1rem 0;
}
.conflict-versions > div {
  min-width: 0;
  padding: 1rem;
  border: 1px solid var(--color-border-subtle-default);
  border-radius: 10px;
}
.conflict-versions h4 {
  font-weight: 600;
  margin-bottom: 0.8rem;
}
.conflict-versions pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: inherit;
  font-size: 0.82rem;
  max-height: 320px;
  overflow: auto;
}
.conflict-versions dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.4rem 1rem;
  font-size: 0.82rem;
  margin-bottom: 1rem;
}
.conflict-versions dt {
  color: var(--color-text-subtle-default);
}
.publication-conflicts button {
  font: inherit;
  font-size: 0.82rem;
  padding: 0.6rem 0.8rem;
  min-height: 40px;
  border-radius: 8px;
  border: 1px solid var(--color-border-subtle-default);
  cursor: pointer;
}
.publication-conflicts footer {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 0.6rem;
}
@media (max-width: 650px) {
  .conflict-versions {
    grid-template-columns: 1fr;
  }
  .publication-conflicts header {
    flex-direction: column;
  }
}
</style>
