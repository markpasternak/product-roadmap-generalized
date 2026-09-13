<script setup lang="ts">
import { computed, defineAsyncComponent } from 'vue';
import { PRODUCTS } from '../../lib/schema';
import { productSlug } from '../../lib/slugs';
import type { PublishedContent } from '../../lib/published/model';
import { pageKind } from '../../lib/published/routes';
const Board = defineAsyncComponent(() => import('../board/Board.vue'));
const ItemPage = defineAsyncComponent(() => import('./ItemPage.vue'));
const DocumentPage = defineAsyncComponent(() => import('./DocumentPage.vue'));
const DocumentsIndex = defineAsyncComponent(() => import('./DocumentsIndex.vue'));
const ThemesPage = defineAsyncComponent(() => import('./ThemesPage.vue'));
const ChangelogPage = defineAsyncComponent(() => import('./ChangelogPage.vue'));
const ChangesPage = defineAsyncComponent(() => import('./ChangesPage.vue'));
const props = defineProps<{ model: PublishedContent; base: string; route?: string }>();
const path = computed(() => (props.route ?? '').replace(/^\/+|\/+$/g, ''));
const kind = computed(() => pageKind(path.value));
const initialProduct = computed(() => PRODUCTS.find(product => productSlug(product) === path.value));
const document = computed(() => props.model.documents.find(entry => entry.href === `${props.base}${path.value}`));
</script>

<template>
  <ItemPage v-if="kind === 'item'" :model="model" :id="path.slice(5)" :base="base" :audience="model.audience" />
  <DocumentPage v-else-if="document" :entry="document" :rendered="model.documentHtml[document.href]" :base="base" />
  <DocumentsIndex v-else-if="kind === 'documents'" :model="model" :base="base" />
  <ThemesPage v-else-if="kind === 'themes'" :model="model" :base="base" />
  <ChangelogPage v-else-if="kind === 'changelog'" :model="model" :base="base" />
  <ChangesPage v-else-if="kind === 'changes'" :model="model" :base="base" />
  <main v-else-if="kind === 'board'" class="mx-auto max-w-[1600px] px-4 py-4 sm:px-6 sm:py-5">
    <Board :items="model.boardItems" :base="base" :initial-product="initialProduct" />
  </main>
  <main v-else class="mx-auto max-w-3xl p-6"><h1>Content unavailable</h1><p>This page is no longer part of the published roadmap.</p><a :href="base">Return to roadmap</a></main>
</template>
