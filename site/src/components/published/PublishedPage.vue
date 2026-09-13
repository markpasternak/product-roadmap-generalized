<script setup lang="ts">
import { computed, defineAsyncComponent } from 'vue';
import { PRODUCTS } from '../../lib/schema';
import { productSlug } from '../../lib/slugs';
import type { PublishedContent } from '../../lib/published/model';
const Board = defineAsyncComponent(() => import('../board/Board.vue'));
const ItemPage = defineAsyncComponent(() => import('./ItemPage.vue'));
const DocumentPage = defineAsyncComponent(() => import('./DocumentPage.vue'));
const props = defineProps<{ model: PublishedContent; base: string; route?: string }>();
const path = computed(() => (props.route ?? '').replace(/^\/+|\/+$/g, ''));
const initialProduct = computed(() => PRODUCTS.find(product => productSlug(product) === path.value));
const document = computed(() => props.model.documents.find(entry => entry.href === `${props.base}${path.value}`));
</script>

<template>
  <ItemPage v-if="path.startsWith('item/')" :model="model" :id="path.slice(5)" :base="base" :audience="model.audience" />
  <DocumentPage v-else-if="document" :entry="document" :rendered="model.documentHtml[document.href]" :base="base" />
  <main v-else class="mx-auto max-w-[1600px] px-4 py-4 sm:px-6 sm:py-5">
    <Board :items="model.boardItems" :base="base" :initial-product="initialProduct" />
  </main>
</template>
