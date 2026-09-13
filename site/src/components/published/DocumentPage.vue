<script setup lang="ts">
import { computed } from 'vue';
import Breadcrumb from '../ui/Breadcrumb.vue';
import Mermaid from '../markdown/Mermaid.vue';
import { DOC_TYPE_LABEL, docBasename } from '../../lib/slugs';
import { formatDateOnly, isoDateOnly } from '../../lib/dates';
import { toneSurface, toneText, type Tone } from '../../lib/display';
import type { PublishedModel } from '../../lib/published/model';

const props = defineProps<{ entry: PublishedModel['documents'][number]; rendered: { html: string; headings: { depth: number; slug: string; text: string }[] }; base: string }>();
const title = computed(() => props.entry.data.title ?? docBasename(props.entry.id));
const tone = computed(() => ({ prds: 'orange', techDesign: 'blue', research: 'green' })[props.entry.coll] as Tone);
const sections = computed(() => props.rendered.headings.filter(heading => heading.depth === 2));
</script>

<template>
  <main class="support-page page-reveal mx-auto max-w-3xl px-6 py-10">
    <Breadcrumb :items="[{ label: 'Roadmap', href: base }, { label: 'Source documents', href: `${base}docs` }, { label: title }]" />
    <div class="mt-5 flex flex-wrap items-center gap-2">
      <span class="text-single-sm-medium rounded-md px-2 py-0.5 font-semibold tracking-wide uppercase" :style="{ background: toneSurface[tone], color: toneText[tone] }">{{ DOC_TYPE_LABEL[entry.coll] }}</span>
      <span v-if="entry.data.status" class="text-single-sm-medium text-text-subtle-default bg-surface-subtle-default rounded-full px-2.5 py-0.5">{{ entry.data.status }}</span>
    </div>
    <h1 class="roadmap-display text-text-primary-default mt-5 text-[2.25rem] sm:text-[3rem] text-balance">{{ title }}</h1>
    <p v-if="entry.data.updated" class="text-single-sm-medium text-text-subtle-default mt-4">Updated <time :datetime="isoDateOnly(entry.data.updated)">{{ formatDateOnly(entry.data.updated) }}</time></p>
    <details v-if="entry.backlinks.length" class="document-disclosure mt-5">
      <summary>Related roadmap items <span class="text-text-subtle-default">· {{ entry.backlinks.length }}</span></summary>
      <ul class="grid gap-1 pb-3"><li v-for="link in entry.backlinks" :key="link.id"><a :href="link.href" class="inline-flex min-h-10 items-center py-1 text-sm text-text-link-default underline-offset-4 hover:underline">{{ link.title }} ({{ link.id }})</a></li></ul>
    </details>
    <article class="mt-5">
      <details v-if="sections.length > 3" class="document-disclosure mb-7">
        <summary>On this page <span class="text-text-subtle-default">· {{ sections.length }} sections</span></summary>
        <nav aria-label="On this page" class="grid gap-1 pb-3"><a v-for="heading in sections" :key="heading.slug" :href="`#${heading.slug}`" class="inline-flex min-h-10 items-center py-1 text-sm text-text-link-default underline-offset-4 hover:underline">{{ heading.text }}</a></nav>
      </details>
      <div :key="rendered.html" class="roadmap-prose" v-html="rendered.html" />
    </article>
    <Mermaid :key="rendered.html" />
  </main>
</template>
