<script setup lang="ts">
import { ref, computed } from 'vue';
import Select from '../ui/Select.vue';
import ActivityFilter from './ActivityFilter.vue';
import { cn } from '../../lib/utils';
import { VISIBILITIES } from '../../lib/schema';
import { IS_PUBLIC } from '../../lib/audience';
import {
  activeFilterCount,
  type FilterState,
  type LevelFilterOption,
  type StageFilterOption,
  type TagFilterOption,
} from '../../lib/filters';
const props = defineProps<{
  filters: FilterState;
  owners?: string[];
  stages: StageFilterOption[];
  impactOptions: LevelFilterOption[];
  effortOptions: LevelFilterOption[];
  tagOptions: TagFilterOption[];
  hideHeader?: boolean;
}>();
const emit = defineEmits<{ (e: 'clear'): void }>();

// The sidebar renders twice (inline + mobile sheet); keep field ids unique.
const idp = props.hideHeader ? 'sheet' : 'side';

const visibilityOptions = [{ value: '', label: 'All items' }, ...VISIBILITIES.map((value) => ({ value, label: value }))];
const visibilityModel = computed({
  get: () => props.filters.visibility ?? '',
  set: (value: string) => (props.filters.visibility = value || null),
});
const ownerOptions = computed(() => [
  { value: '', label: 'All owners' },
  ...[...new Set([...(props.owners ?? []), props.filters.owner].filter((v): v is string => !!v))]
    .sort((a, b) => a.localeCompare(b)).map((value) => ({ value, label: value })),
]);
const ownerModel = computed({
  get: () => props.filters.owner ?? '',
  set: (value: string) => (props.filters.owner = value || null),
});

type MultiKey = 'stage' | 'impact' | 'effort';

const tagQuery = ref('');
const showAllTags = ref(false);
const showAllStages = ref(false);
const filteredTokens = computed(() =>
  props.tagOptions.filter((t) => t.label.toLowerCase().includes(tagQuery.value.toLowerCase())),
);
const visibleTokens = computed(() => (showAllTags.value ? filteredTokens.value : filteredTokens.value.filter((tag, index) => index < 7 || props.filters.tags.includes(tag.token))));
const visibleStages = computed(() => (showAllStages.value ? props.stages : props.stages.filter((stage, index) => index < 5 || props.filters.stage.includes(stage.value))));

const sectionTitle = 'text-single-sm-medium text-text-primary-default mb-1.5 block font-semibold';
const optionClass = (active: boolean) =>
  cn(
    'roadmap-action flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md border px-2.5 py-2 text-single-sm-medium transition-colors',
    active
      ? 'roadmap-selected-filter'
      : 'border-transparent text-text-subtle-default hover:bg-card hover:text-text-primary-default',
  );
const countClass =
  'ml-auto min-w-5 text-right text-xs text-text-subtle-default tabular-nums';

function checked(key: MultiKey, value: string) {
  return props.filters[key].includes(value);
}
function toggleMulti(key: MultiKey, value: string) {
  const arr = props.filters[key];
  const i = arr.indexOf(value);
  if (i >= 0) arr.splice(i, 1);
  else arr.push(value);
}
function toggleTag(token: string) {
  const i = props.filters.tags.indexOf(token);
  if (i >= 0) props.filters.tags.splice(i, 1);
  else props.filters.tags.push(token);
}
</script>

<template>
  <aside :class="cn(hideHeader ? 'w-full' : 'roadmap-panel w-64 shrink-0 rounded-2xl p-5')">
    <div v-if="!hideHeader" class="mb-4 flex items-center justify-between">
      <span class="roadmap-label">Filters</span>
      <button
        v-if="activeFilterCount(filters)"
        class="text-single-sm-medium text-text-link-default hover:underline"
        @click="emit('clear')"
      >
        Clear all
      </button>
    </div>

    <div class="space-y-5">
      <ActivityFilter v-model="filters.activity" :id="idp" />
      <div v-if="!IS_PUBLIC">
        <label :for="idp + '-owner'" :class="sectionTitle">Owner</label>
        <Select :id="idp + '-owner'" v-model="ownerModel" :options="ownerOptions" />
      </div>

      <div v-if="!IS_PUBLIC">
        <label :for="idp + '-visibility'" :class="sectionTitle">Visibility</label>
        <Select :id="idp + '-visibility'" v-model="visibilityModel" :options="visibilityOptions" />
        <p class="mt-2 text-xs leading-relaxed text-text-subtle-default">Item visibility. Share access is set separately.</p>
      </div>

      <fieldset class="min-w-0" v-if="stages.length">
        <legend :class="sectionTitle">Stage</legend>
        <div class="grid gap-1.5">
          <label v-for="s in visibleStages" :key="s.value" :class="optionClass(checked('stage', s.value))">
            <input
              type="checkbox"
              :checked="checked('stage', s.value)"
              class="size-4 shrink-0 rounded accent-[color:var(--color-accent-brand-default)]"
              @change="toggleMulti('stage', s.value)"
            />
            <span class="min-w-0 flex-1 truncate">{{ s.value }}</span>
            <span :class="countClass">{{ s.count }}</span>
          </label>
        </div>
        <button
          v-if="stages.length > 5"
          class="text-single-sm-medium text-text-subtle-default hover:text-text-primary-default mt-2"
          @click="showAllStages = !showAllStages"
        >
          {{ showAllStages ? 'Show fewer stages' : 'Show all stages' }}
        </button>
      </fieldset>

      <fieldset class="min-w-0" v-if="impactOptions.length">
        <legend :class="sectionTitle">Impact</legend>
        <div class="grid gap-1.5">
          <label v-for="l in impactOptions" :key="l.value" :class="optionClass(checked('impact', l.value))">
            <input
              type="checkbox"
              :checked="checked('impact', l.value)"
              class="size-4 shrink-0 rounded accent-[color:var(--color-accent-brand-default)]"
              @change="toggleMulti('impact', l.value)"
            />
            <span class="min-w-0 flex-1">{{ l.value }}</span>
            <span :class="countClass">{{ l.count }}</span>
          </label>
        </div>
      </fieldset>

      <fieldset class="min-w-0" v-if="effortOptions.length">
        <legend :class="sectionTitle">Effort</legend>
        <div class="grid gap-1.5">
          <label v-for="l in effortOptions" :key="l.value" :class="optionClass(checked('effort', l.value))">
            <input
              type="checkbox"
              :checked="checked('effort', l.value)"
              class="size-4 shrink-0 rounded accent-[color:var(--color-accent-brand-default)]"
              @change="toggleMulti('effort', l.value)"
            />
            <span class="min-w-0 flex-1">{{ l.value }}</span>
            <span :class="countClass">{{ l.count }}</span>
          </label>
        </div>
      </fieldset>

      <fieldset class="min-w-0" v-if="tagOptions.length || filters.tags.length">
        <legend :class="sectionTitle">Tags</legend>
        <input
          v-model="tagQuery"
          type="search"
          autocomplete="off"
          :name="idp + '-tag-search'"
          aria-label="Search tags"
          placeholder="Search tags..."
          class="text-single-sm-medium text-text-primary-default border-border-subtle-default bg-card/80 w-full rounded-lg border px-3 py-2 outline-none focus:border-[color:var(--color-accent-brand-default)]"
        />
        <div class="mt-2.5 space-y-1.5">
          <label
            v-for="t in visibleTokens"
            :key="t.token"
            :class="optionClass(filters.tags.includes(t.token))"
          >
            <input
              type="checkbox"
              :checked="filters.tags.includes(t.token)"
              class="size-4 shrink-0 rounded accent-[color:var(--color-accent-brand-default)]"
              @change="toggleTag(t.token)"
            />
            <span class="min-w-0 flex-1 truncate">{{ t.label }}</span>
            <span :class="countClass">{{ t.count }}</span>
          </label>
          <p v-if="!filteredTokens.length" class="text-single-sm-medium text-text-subtle-default">No tags</p>
        </div>
        <button
          v-if="filteredTokens.length > 7"
          class="text-single-sm-medium text-text-subtle-default hover:text-text-primary-default mt-2"
          @click="showAllTags = !showAllTags"
        >
          {{ showAllTags ? 'Show fewer tags' : 'Show more tags' }}
        </button>
      </fieldset>
    </div>
  </aside>
</template>
