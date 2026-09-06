<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { trapFocus, isTopFocusTrap } from "../../lib/focusTrap";
import type { Draft } from "../../lib/edit/store";
const props = defineProps<{
  mine: Draft;
  remote: Draft | null;
  fields: string[];
  titles: Record<string, string>;
}>();
const emit = defineEmits<{ resolve: [keepLocal: boolean]; close: [] }>();
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
          Review the overlapping changes and choose the complete draft to
          continue with. A recovery copy of both versions is kept on this
          device.
        </p>
        <div class="draft-comparison-rows">
          <article v-for="field in fields" :key="field">
            <h3>{{ label(field) }}</h3>
            <div class="draft-comparison-columns">
              <section>
                <h4>This device</h4>
                <pre>{{ value(mine, field) }}</pre>
              </section>
              <section>
                <h4>Saved to your account</h4>
                <pre>{{ value(remote, field) }}</pre>
              </section>
            </div>
          </article>
        </div>
        <footer>
          <button type="button" @click="emit('resolve', false)">
            Use the saved draft</button
          ><button type="button" @click="emit('resolve', true)">
            Keep this device’s draft
          </button>
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
