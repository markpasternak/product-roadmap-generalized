<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch } from "vue";
import type { DraftChoices } from '../../composables/useDraftSync';
import { trapFocus, isTopFocusTrap } from "../../lib/focusTrap";
import type { Draft } from "../../lib/edit/store";
const props = defineProps<{
  mine: Draft;
  remote: Draft | null;
  fields: string[];
  titles: Record<string, string>;
}>();
const emit = defineEmits<{ resolve: [choices: DraftChoices]; close: [] }>();
const choices = ref<DraftChoices>({});
watch(() => props.fields, () => { choices.value = {}; });
const ready = computed(() => props.fields.every(field => !!choices.value[field]));
const panel = ref<HTMLElement>();
let release: (() => void) | undefined;
function key(event: KeyboardEvent) {
  if (event.key === "Escape" && isTopFocusTrap(panel.value)) {
    event.stopPropagation();
    emit("close");
  }
}
onMounted(() => {
  if (panel.value) release = trapFocus(panel.value);
  document.addEventListener("keydown", key);
});
onUnmounted(() => {
  release?.();
  document.removeEventListener("keydown", key);
});
function label(path: string) {
  const [kind, id, field] = path.split(".");
  if (kind === "bodies") return `${props.titles[id] ?? id} · Write-up`;
  if (kind === "fields") return `${props.titles[id] ?? id} · ${field}`;
  return (
    (
      {
        created: "New items",
        deleted: "Deleted items",
        reorder: "Priorities",
        assets: "Files",
        requestPayload: "Pending publication",
      } as Record<string, string>
    )[kind] ?? "Draft state"
  );
}
function value(draft: Draft | null, path: string) {
  const result = path.split(".").reduce<any>((o, k) => o?.[k], draft);
  if (result == null) return "No change";
  if (typeof result === "string") return result || "Empty";
  if (Array.isArray(result))
    return (
      result
        .map((v) =>
          typeof v === "string"
            ? (props.titles[v] ?? v)
            : (v.title ?? v.name ?? v.resource?.name ?? "File change"),
        )
        .join("\n") || "None"
    );
  return "Changed on this device";
}
</script>
<template>
  <Teleport to="body"
    ><div class="draft-comparison-backdrop">
      <section
        ref="panel"
        class="draft-comparison"
        role="dialog"
        aria-modal="true"
        aria-labelledby="draft-comparison-title"
        tabindex="-1"
      >
        <header>
          <h2 id="draft-comparison-title">
            This draft changed on another device
          </h2>
          <button
            type="button"
            @click="emit('close')"
            aria-label="Close draft comparison"
          >
            Close
          </button>
        </header>
        <p>
          Choose a version for each overlapping change. Independent changes from
          both devices will be kept. We’ll also try to keep a device backup of both versions.
        </p>
        <div class="draft-comparison-rows">
          <article v-for="(field, index) in fields" :key="field">
            <h3>{{ label(field) }}</h3>
            <div class="draft-comparison-columns">
              <section>
                <h4>This device</h4>
                <pre>{{ value(mine, field) }}</pre>
                <label><input v-model="choices[field]" type="radio" :name="`draft-choice-${index}`" value="local" /> Keep this change</label>
              </section>
              <section>
                <h4>Saved to your account</h4>
                <pre>{{ value(remote, field) }}</pre>
                <label><input v-model="choices[field]" type="radio" :name="`draft-choice-${index}`" value="remote" /> Use this change</label>
              </section>
            </div>
          </article>
        </div>
        <footer>
          <p>{{ Object.keys(choices).length }} of {{ fields.length }} choices made</p>
          <button type="button" :disabled="!ready" @click="emit('resolve', choices)">Continue with these choices</button>
        </footer>
      </section>
    </div></Teleport
  >
</template>
<style scoped>
.draft-comparison-backdrop {
  position: fixed;
  inset: 0;
  z-index: 140;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: rgb(0 0 0/0.5);
}
.draft-comparison {
  width: min(860px, 100%);
  max-height: 90dvh;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.5rem;
  background: var(--color-card);
  color: var(--color-text-primary-default);
  border: 1px solid var(--color-border-subtle-default);
  border-radius: 16px;
  box-shadow: 0 24px 100px #0004;
}
.draft-comparison header,
.draft-comparison footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}
.draft-comparison h2 {
  font:
    1.5rem "Source Serif Pro",
    serif;
}
.draft-comparison h3 {
  font-weight: 600;
  margin-bottom: 0.6rem;
}
.draft-comparison h4 {
  font-size: 0.8rem;
  color: var(--color-text-subtle-default);
  margin-bottom: 0.5rem;
}
.draft-comparison-rows {
  min-height: 0;
  overflow: auto;
}
.draft-comparison article {
  padding: 1rem 0;
  border-top: 1px solid var(--color-border-subtle-default);
}
.draft-comparison-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}
.draft-comparison-columns section {
  min-width: 0;
}
.draft-comparison pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: inherit;
  font-size: 0.875rem;
  max-height: 240px;
  overflow: auto;
}
.draft-comparison button {
  border: 1px solid var(--color-border-subtle-default);
  padding: 0.6rem 0.8rem;
  border-radius: 8px;
}
.draft-comparison label { display:flex; align-items:center; gap:.5rem; min-height:44px; cursor:pointer; }
.draft-comparison button:disabled { opacity:.5; cursor:default; }
.draft-comparison footer button:last-child {
  background: var(--color-accent-brand-default);
  color: var(--color-text-on-accent-default, #fff);
}
@media (max-width: 600px) {
  .draft-comparison-columns {
    grid-template-columns: 1fr;
  }
  .draft-comparison {
    padding: 1rem;
  }
}
</style>
