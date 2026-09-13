<script setup lang="ts">
import { computed } from 'vue';
import Breadcrumb from '../ui/Breadcrumb.vue';
import { DOC_COLLECTIONS, DOC_TYPE_LABEL, docBasename } from '../../lib/slugs';
import { formatDateOnly, isoDateOnly } from '../../lib/dates';
import type { PublishedContent } from '../../lib/published/model';
const props = defineProps<{ model: PublishedContent; base: string }>();
const groups = computed(() => DOC_COLLECTIONS.map(coll => ({ coll, label: DOC_TYPE_LABEL[coll], docs: props.model.documents.filter(doc => doc.coll === coll) })).filter(group => group.docs.length));
const itemTitle = computed(() => new Map(props.model.boardItems.map(item => [item.id, item.title])));
</script>

<template>
  <main class="support-page page-reveal mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
    <Breadcrumb :items="[{ label: 'Roadmap', href: base }, { label: 'Source documents' }]" />
    <section class="roadmap-masthead mt-6 rounded-[20px] px-5 py-5 sm:px-6 sm:py-6 lg:px-7">
      <h1 class="roadmap-display roadmap-title text-[2rem] sm:text-[2.55rem]">Source documents</h1>
      <p class="roadmap-muted text-body-md mt-3 max-w-2xl">Workshop notes, research, and planning documents referenced by roadmap items. Open an item’s <b class="roadmap-title font-medium">Resources</b> to see the material relevant to that work.</p>
    </section>
    <section class="mt-6" aria-label="Source documents">
      <div v-if="!groups.length" class="border-border-subtle-default bg-card rounded-xl border border-dashed px-5 py-6">
        <p class="text-single-base-medium text-text-primary-default">No source documents available</p>
        <p class="text-body-md text-text-primary-default mt-1 max-w-2xl">Return to the <a :href="base" class="text-text-link-default underline underline-offset-4">roadmap</a> to explore current work.</p>
      </div>
      <section v-for="(group, index) in groups" :key="group.coll" :class="{ 'mt-6': index > 0 }">
        <h2 v-if="groups.length > 1" class="roadmap-label mb-3">{{ group.label }}</h2>
        <ul class="divide-border-subtle-default divide-y border-b border-border-subtle-default">
          <li v-for="doc in group.docs" :key="doc.href">
            <a :href="doc.href" class="roadmap-action group hover:bg-surface-primary-hover block px-3 py-5">
              <span class="flex items-start justify-between gap-4"><span class="text-single-base-medium text-text-primary-default group-hover:text-text-link-default min-w-0">{{ doc.data.title ?? docBasename(doc.id) }}</span><span aria-hidden="true" class="text-text-link-default shrink-0">→</span></span>
              <span v-if="doc.data.status || doc.data.updated || (doc.data.roadmap_item && itemTitle.has(doc.data.roadmap_item))" class="text-single-sm-medium text-text-subtle-default mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span v-if="doc.data.status" class="bg-surface-subtle-default rounded-full px-2 py-0.5">{{ doc.data.status }}</span>
                <span v-if="doc.data.roadmap_item && itemTitle.has(doc.data.roadmap_item)">For {{ itemTitle.get(doc.data.roadmap_item) }} ({{ doc.data.roadmap_item }})</span>
                <span v-if="doc.data.updated">Updated <time :datetime="isoDateOnly(doc.data.updated)">{{ formatDateOnly(doc.data.updated) }}</time></span>
              </span>
            </a>
          </li>
        </ul>
      </section>
      <p v-if="groups.length" class="text-body-sm text-text-subtle-default mt-5 max-w-2xl">These documents record the context when they were written. Check the <a :href="base" class="text-text-link-default underline underline-offset-4">roadmap</a> for current priorities and progress.</p>
    </section>
  </main>
</template>
