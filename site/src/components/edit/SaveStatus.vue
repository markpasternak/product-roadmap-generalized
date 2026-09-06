<script setup lang="ts">
import { computed } from "vue";
const props = withDefaults(
  defineProps<{
    detail?: string;
    dirty?: number;
    pending?: boolean;
    error?: string | null;
    publication?: { stage?: string; htmlUrl?: string } | null;
    summary?: {
      edited: { title: string }[];
      created: { title: string }[];
      deleted: { title: string }[];
      reorderLanes: number;
      resources?: number;
    };
    blocked?: boolean;
    authExpired?: boolean;
  }>(),
  {
    detail: "Saved on this device",
    dirty: 0,
    pending: false,
    error: null,
    publication: null,
    blocked: false,
  },
);
defineEmits<{ publish: []; discard: []; retry: []; signin: [] }>();
const publicationText = computed(() =>
  !props.publication
    ? ""
    : props.publication.stage === "live"
      ? "Latest publication is live"
      : props.publication.stage === "failed"
        ? "Changes are in Git. The live site could not update."
        : props.publication.stage === "no_build"
          ? "Changes are in Git. Waiting to confirm the live site."
          : "Changes are in Git · updating the live site",
);
</script>
<template>
  <div class="save-status" data-test="save-status">
    <div class="save-status-copy">
      <p role="status" aria-live="polite" class="save-status-primary">
        {{ pending ? "Publishing your changes…" : detail }}
      </p>
      <p
        v-if="error"
        data-test="save-error"
        role="alert"
        class="save-status-error"
      >
        {{ error }}
        <button
          v-if="authExpired"
          type="button"
          class="save-status-link"
          data-test="sign-in-again"
          @click="$emit('signin')"
        >
          Sign in again
        </button>
      </p>
      <p v-if="publication && !pending" class="save-status-secondary">
        {{ publicationText }}
        <a
          v-if="publication.htmlUrl"
          :href="publication.htmlUrl"
          target="_blank"
          rel="noopener"
          >View build</a
        ><button
          v-if="
            publication.stage === 'failed' || publication.stage === 'no_build'
          "
          type="button"
          class="save-status-link"
          @click="$emit('retry')"
        >
          Check again
        </button>
      </p>
      <details v-if="dirty && summary" class="save-status-review">
        <summary>
          {{ dirty }} unpublished {{ dirty === 1 ? "change" : "changes" }} ·
          Review
        </summary>
        <div class="save-status-review-body">
          <p v-for="item in summary.edited" :key="`e-${item.title}`">
            Edited · {{ item.title }}
          </p>
          <p v-for="item in summary.created" :key="`c-${item.title}`">
            New · {{ item.title || "Untitled item" }}
          </p>
          <p v-for="item in summary.deleted" :key="`d-${item.title}`">
            Will delete · {{ item.title }}
          </p>
          <p v-if="summary.reorderLanes">
            Priority changed in {{ summary.reorderLanes }}
            {{ summary.reorderLanes === 1 ? "lane" : "lanes" }}
          </p>
          <p v-if="summary.resources">
            {{ summary.resources }} file
            {{ summary.resources === 1 ? "change" : "changes" }}
          </p>
          <button
            type="button"
            class="save-status-link"
            :disabled="pending"
            @click="$emit('discard')"
          >
            Discard unpublished changes…
          </button>
        </div>
      </details>
    </div>
    <button
      v-if="dirty || error"
      type="button"
      data-test="sync"
      class="save-status-publish"
      :disabled="pending || blocked"
      @click="$emit('publish')"
    >
      {{
        pending
          ? "Publishing…"
          : error
            ? "Retry publication"
            : "Publish changes"
      }}
    </button>
  </div>
</template>
<style scoped>
.save-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 1.25rem;
  background: var(--color-card);
  color: var(--color-text-primary-default);
  border-top: 1px solid var(--color-border-subtle-default);
  font-size: 0.8125rem;
}
.save-status-copy {
  min-width: 0;
  flex: 1;
}
.save-status p {
  margin: 0;
}
.save-status-primary {
  font-weight: 500;
}
.save-status-secondary,
.save-status-review {
  color: var(--color-text-subtle-default);
  margin-top: 0.3rem;
}
.save-status-error {
  color: var(--color-feedback-error-text-independent-default);
  margin-top: 0.3rem !important;
}
.save-status-secondary a,
.save-status-link {
  color: var(--color-accent-brand-default);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.save-status-link {
  margin-left: 0.5rem;
  background: transparent;
  border: 0;
  cursor: pointer;
}
.save-status-review summary {
  cursor: pointer;
  width: fit-content;
  min-height: 28px;
  display: list-item;
}
.save-status-review-body {
  padding: 0.4rem 0;
}
.save-status-review-body p {
  padding: 0.15rem 0;
}
.save-status-review-body button {
  margin: 0.5rem 0 0;
}
.save-status-publish {
  flex-shrink: 0;
  min-height: 42px;
  padding: 0.6rem 1rem;
  border-radius: 8px;
  border: 1px solid var(--color-accent-brand-default);
  background: var(--color-accent-brand-default);
  color: var(--color-text-primary-inverted-default);
  font-weight: 600;
  cursor: pointer;
}
.save-status-publish:disabled {
  opacity: 0.5;
  cursor: default;
}
@media (max-width: 540px) {
  .save-status {
    align-items: stretch;
    flex-direction: column;
    padding: 0.85rem 1rem;
  }
  .save-status-publish {
    align-self: flex-end;
  }
}
</style>
