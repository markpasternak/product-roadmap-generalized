<script setup lang="ts">
import { ref, computed } from 'vue';
import Select from '../ui/Select.vue';
import { cn } from '../../lib/utils';
import { PRODUCTS } from '../../lib/schema';
import {
  activeFilterCount,
  ANY_ASSET_KEY,
  type AssetFilterOption,
  type FilterState,
  type LevelFilterOption,
  type StageFilterOption,
  type TagFilterOption,
} from '../../lib/filters';
import {
  levelColor,
  toneSurface,
  toneSurfaceStrong,
  toneText,
  type Tone,
} from '../../lib/display';
import { linkSource } from '../../lib/sources';
import {
  PhArrowUp,
  PhDiamond,
  PhGauge,
  PhStack,
  PhTrendUp,
} from '@phosphor-icons/vue';

const props = defineProps<{
  filters: FilterState;
  assets: AssetFilterOption[];
  stages: StageFilterOption[];
  impactOptions: LevelFilterOption[];
  effortOptions: LevelFilterOption[];
  tagOptions: TagFilterOption[];
  hideHeader?: boolean;
}>();
const emit = defineEmits<{ (e: 'clear'): void }>();

// The sidebar renders twice (inline + mobile sheet); keep field ids unique.
const idp = props.hideHeader ? 'sheet' : 'side';

const productOptions = [{ value: '', label: 'All products' }, ...PRODUCTS.map((p) => ({ value: p, label: p }))];
const productModel = computed({
  get: () => props.filters.product ?? '',
  set: (v: string) => (props.filters.product = v || null),
});

type MultiKey = 'stage' | 'impact' | 'effort' | 'assets';

const stageToneMap: Record<string, Tone> = {
  Discovery: 'violet',
  Validation: 'blue',
  Shaping: 'yellow',
  Committed: 'orange',
  Building: 'green',
  Pilot: 'blue',
  Shipped: 'green',
  Parked: 'gray',
};
const levelToneMap: Record<string, Tone> = {
  Low: 'green',
  Medium: 'yellow',
  High: 'orange',
};

const tagQuery = ref('');
const showAllTags = ref(false);
const showAllStages = ref(false);
const filteredTokens = computed(() =>
  props.tagOptions.filter((t) => t.label.toLowerCase().includes(tagQuery.value.toLowerCase())),
);
const visibleTokens = computed(() => (showAllTags.value ? filteredTokens.value : filteredTokens.value.slice(0, 7)));
const visibleStages = computed(() => (showAllStages.value ? props.stages : props.stages.slice(0, 5)));

const sectionTitle = 'text-single-sm-medium text-text-primary-default mb-1.5 block font-semibold';
const optionClass = (active: boolean) =>
  cn(
    'roadmap-action flex min-h-10 cursor-pointer items-center gap-2.5 rounded-xl border px-2.5 py-2 text-single-sm-medium transition-colors',
    active
      ? 'roadmap-selected-filter'
      : 'border-border-subtle-default bg-card/70 text-text-subtle-default hover:bg-card hover:text-text-primary-default',
  );
const countClass =
  'ml-auto min-w-5 rounded-lg border border-border-subtle-default/70 bg-surface-subtle-default px-1.5 py-0.5 text-center text-[11px] leading-none text-text-subtle-default tabular-nums';

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
function assetIcon(option: AssetFilterOption) {
  if (option.key === ANY_ASSET_KEY) return PhStack;
  return linkSource(option.label).Icon;
}
function assetTone(option: AssetFilterOption): Tone {
  return option.key === ANY_ASSET_KEY ? 'orange' : linkSource(option.label).tone;
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
      <div>
        <label :for="idp + '-product'" :class="sectionTitle">Product</label>
        <Select :id="idp + '-product'" v-model="productModel" :options="productOptions" />
      </div>

      <div v-if="impactOptions.length">
        <span :class="sectionTitle">Impact</span>
        <div class="grid gap-1.5">
          <label v-for="l in impactOptions" :key="l.value" :class="optionClass(checked('impact', l.value))">
            <input
              type="checkbox"
              :checked="checked('impact', l.value)"
              class="size-4 shrink-0 rounded accent-[color:var(--color-accent-brand-default)]"
              @change="toggleMulti('impact', l.value)"
            />
            <span
              class="grid size-7 shrink-0 place-items-center rounded-lg"
              :style="{ background: toneSurfaceStrong[levelToneMap[l.value]], color: levelColor(l.value) }"
            >
              <PhArrowUp :size="15" weight="bold" />
            </span>
            <span class="min-w-0 flex-1">{{ l.value }}</span>
            <span :class="countClass">{{ l.count }}</span>
          </label>
        </div>
      </div>

      <div v-if="effortOptions.length">
        <span :class="sectionTitle">Effort</span>
        <div class="grid gap-1.5">
          <label v-for="l in effortOptions" :key="l.value" :class="optionClass(checked('effort', l.value))">
            <input
              type="checkbox"
              :checked="checked('effort', l.value)"
              class="size-4 shrink-0 rounded accent-[color:var(--color-accent-brand-default)]"
              @change="toggleMulti('effort', l.value)"
            />
            <span
              class="grid size-7 shrink-0 place-items-center rounded-lg"
              :style="{ background: toneSurfaceStrong[levelToneMap[l.value]], color: levelColor(l.value) }"
            >
              <PhGauge :size="15" />
            </span>
            <span class="min-w-0 flex-1">{{ l.value }}</span>
            <span :class="countClass">{{ l.count }}</span>
          </label>
        </div>
      </div>

      <div v-if="stages.length">
        <span :class="sectionTitle">Stage</span>
        <div class="grid gap-1.5">
          <label v-for="s in visibleStages" :key="s.value" :class="optionClass(checked('stage', s.value))">
            <input
              type="checkbox"
              :checked="checked('stage', s.value)"
              class="size-4 shrink-0 rounded accent-[color:var(--color-accent-brand-default)]"
              @change="toggleMulti('stage', s.value)"
            />
            <span
              class="grid size-7 shrink-0 place-items-center rounded-lg"
              :style="{ background: toneSurface[stageToneMap[s.value]], color: toneText[stageToneMap[s.value]] }"
            >
              <PhTrendUp :size="15" />
            </span>
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
      </div>

      <div v-if="assets.length">
        <span :class="sectionTitle">Assets</span>
        <div class="grid gap-1.5">
          <label
            v-for="asset in assets"
            :key="asset.key"
            :class="optionClass(checked('assets', asset.key))"
          >
            <input
              type="checkbox"
              :checked="checked('assets', asset.key)"
              class="size-4 shrink-0 rounded accent-[color:var(--color-accent-brand-default)]"
              @change="toggleMulti('assets', asset.key)"
            />
            <span
              class="grid size-7 shrink-0 place-items-center rounded-lg"
              :style="{ background: toneSurfaceStrong[assetTone(asset)], color: toneText[assetTone(asset)] }"
            >
              <component :is="assetIcon(asset)" :size="15" />
            </span>
            <span class="min-w-0 flex-1 truncate">{{ asset.label }}</span>
            <span :class="countClass">{{ asset.count }}</span>
          </label>
        </div>
      </div>

      <div v-if="tagOptions.length || filters.tags.length">
        <span :class="sectionTitle">Tags</span>
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
            <span
              class="grid size-7 shrink-0 place-items-center rounded-lg"
              :style="{ background: t.theme ? toneSurface.orange : toneSurface.gray, color: t.theme ? toneText.orange : toneText.gray }"
            >
              <PhDiamond :size="13" weight="fill" />
            </span>
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
      </div>
    </div>
  </aside>
</template>
