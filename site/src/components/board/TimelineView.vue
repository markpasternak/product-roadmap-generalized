<script setup lang="ts">
import { computed, ref } from 'vue';
import Select from '../ui/Select.vue';
import { productColor } from '../../lib/display';
import type { ItemVM } from '../../lib/filters';
import { timelineModel, timelineSettings, panTimeline, todayDate, dateDay, formatPlanDate, scheduleIssue, scheduleLabel, type TimelineSettings } from '../../lib/timeline';
import '../../styles/timeline.css';
const props = defineProps<{ items: ItemVM[]; settings?: TimelineSettings; client?: boolean }>();
const emit = defineEmits<{ select: [item: ItemVM]; settings: [settings: TimelineSettings]; board: [] }>();
const review = ref(false);
const config = computed(() => { const s = timelineSettings(props.settings); return props.client && (s.group === 'owner' || s.group === 'tag') ? { ...s, group: 'product' as const } : s; });
const model = computed(() => timelineModel(props.items, config.value));
const groups = computed(() => [{ value: 'product', label: 'Product' }, ...(!props.client ? [{ value: 'owner', label: 'Owner' }, { value: 'tag', label: 'Tag' }] : []), { value: 'stage', label: 'Stage' }, { value: 'none', label: 'None' }]);
const today = computed(() => (dateDay(todayDate())! - dateDay(model.value.range.from)!) / (dateDay(model.value.range.to)! - dateDay(model.value.range.from)! + 1) * 100);
const change = (patch: Partial<TimelineSettings>) => emit('settings', { ...config.value, ...patch });
const barStyle = (item: ItemVM) => { const p = model.value.position(item); return { left: `${p.left}%`, width: `${p.width}%`, padding: p.width < 4 ? '0' : '0 10px', fontSize: p.width < 4 ? '0' : '12px', '--product': productColor[item.product as keyof typeof productColor] ?? 'var(--color-accent-brand-default)' }; };
</script>
<template>
  <section class="timeline-view" aria-label="Roadmap timeline">
    <div class="timeline-controls">
      <label>Group by <Select :model-value="config.group" :options="groups" aria-label="Timeline grouping" @update:model-value="change({ group: $event as TimelineSettings['group'] })" /></label>
      <label>Scale <Select :model-value="config.scale" :options="[{value:'weeks',label:'Weeks'},{value:'months',label:'Months'},{value:'quarters',label:'Quarters'}]" aria-label="Timeline scale" @update:model-value="change({ scale: $event as TimelineSettings['scale'], fit: false })" /></label>
      <div class="timeline-navigation">
        <button type="button" aria-label="Previous period" @click="emit('settings', panTimeline(config, model.range, -1))">←</button>
        <button type="button" @click="change({ anchor: todayDate(), fit: false })">Today</button>
        <button type="button" aria-label="Next period" @click="emit('settings', panTimeline(config, model.range, 1))">→</button>
        <button type="button" :aria-pressed="config.fit" :disabled="!model.scheduled.length" @click="change({ fit: true })">Fit items</button>
      </div>
    </div>
    <div class="timeline-summary" role="status" aria-live="polite">
      <span><strong>{{ items.length }}</strong> matching · <strong>{{ model.visible.length }}</strong> shown</span>
      <button v-if="model.missing.length" type="button" :aria-expanded="review" @click="review = !review">{{ model.missing.length }} missing or invalid dates · {{ review ? 'Hide' : 'Review' }}</button>
      <button v-if="model.outside.length" type="button" @click="change({ fit: true })">{{ model.outside.length }} outside this period · Fit items</button>
    </div>
    <div v-if="review && model.missing.length" class="timeline-missing" aria-label="Items missing timeline dates">
      <p>These items need both a valid start and end date to appear on the timeline.</p>
      <button v-for="item in model.missing" :key="item.id" type="button" @click="emit('select', item)"><span>{{ item.title }}<small>{{ item.product }}</small></span><span>{{ scheduleIssue(item) }} →</span></button>
    </div>
    <p class="timeline-range-caption">{{ formatPlanDate(model.range.from) }} — {{ formatPlanDate(model.range.to) }} · Planned work windows · Line marks today<span v-if="config.group === 'tag'"> · Items with multiple tags appear in each group; counts are unique items</span></p>
    <div v-if="model.visible.length" class="timeline-chart" tabindex="0" aria-label="Timeline chart. Scroll horizontally to explore dates.">
      <div class="timeline-canvas">
        <div class="timeline-head"><div class="timeline-label">Roadmap item</div><div class="timeline-axis"><span v-for="tick in model.ticks" :key="tick.left" class="timeline-tick" :style="{left:tick.left+'%',width:tick.width+'%'}">{{ tick.label }}</span><span v-if="today >= 0 && today <= 100" class="timeline-today" :style="{left:today+'%'}" /></div></div>
        <details v-for="group in model.groups" :key="group.name" class="timeline-group" open>
          <summary>{{ group.name }}<small>{{ group.items.length }} {{ group.items.length === 1 ? 'item' : 'items' }}</small></summary>
          <div v-for="item in group.items" :key="item.id" class="timeline-row">
            <button class="timeline-label" type="button" :title="item.title" @click="emit('select', item)"><strong>{{ item.title }}</strong><small>{{ item.stage }} · {{ item.product }}</small></button>
            <div class="timeline-track"><span v-for="tick in model.ticks" :key="tick.left" class="timeline-tick" :style="{left:tick.left+'%',width:tick.width+'%'}" /><span v-if="today >= 0 && today <= 100" class="timeline-today" :style="{left:today+'%'}" />
              <button class="timeline-bar" type="button" :style="barStyle(item)" :data-before="model.position(item).before" :data-after="model.position(item).after" :aria-label="`${item.title}. Planned ${scheduleLabel(item)}. ${item.stage}`" :title="`${item.title}\n${scheduleLabel(item)}\n${item.stage}`" @click="emit('select', item)">{{ item.title }}</button>
            </div>
          </div>
        </details>
      </div>
    </div>
    <div v-else class="timeline-empty"><h3>{{ model.scheduled.length ? 'No items in this period' : 'No scheduled items yet' }}</h3><p>{{ model.scheduled.length ? 'Your dated items are outside the visible calendar window.' : 'Add a planned start and end to an item to see it here. Your undated work is still on the board.' }}</p><button v-if="model.scheduled.length" type="button" @click="change({fit:true})">Fit scheduled items</button><button v-else-if="model.missing.length" type="button" @click="review = true">Review missing dates</button><button type="button" @click="emit('board')">Back to board</button></div>
  </section>
</template>
<style scoped>
.timeline-view{min-width:0}.timeline-controls{display:flex;flex-wrap:wrap;align-items:end;gap:12px;margin:16px 0}.timeline-controls label{display:grid;gap:5px;font-size:11px;color:var(--color-text-subtle-default)}.timeline-navigation{display:flex;gap:6px;margin-left:auto;flex-wrap:wrap}.timeline-navigation button,.timeline-empty button{border:1px solid var(--color-border-subtle-default);border-radius:8px;padding:8px 12px;min-height:40px;background:var(--color-card);color:var(--color-text-primary-default);font-size:13px;cursor:pointer}.timeline-navigation button[aria-pressed=true]{border-color:var(--color-accent-brand-default);color:var(--color-accent-brand-default)}button:disabled{opacity:.4;cursor:default}.timeline-summary{display:flex;gap:14px;flex-wrap:wrap;align-items:center;font-size:13px;margin:12px 0}.timeline-summary button{background:none;border:0;color:var(--color-text-link-default);text-decoration:underline;text-underline-offset:3px;cursor:pointer;min-height:32px}.timeline-range-caption{margin:12px 0}.timeline-missing{border:1px solid var(--color-border-subtle-default);border-radius:12px;padding:12px 16px;max-height:300px;overflow:auto}.timeline-missing p{font-size:13px;color:var(--color-text-subtle-default);margin-bottom:8px}.timeline-missing button{display:flex;justify-content:space-between;align-items:center;width:100%;text-align:left;gap:16px;padding:12px 0;background:none;border:0;border-top:1px solid var(--color-border-subtle-default);font-size:13px;color:var(--color-text-primary-default);cursor:pointer}.timeline-missing small{display:block;color:var(--color-text-subtle-default);margin-top:4px}.timeline-empty{text-align:center;padding:48px 24px;border:1px dashed var(--color-border-subtle-default);border-radius:14px;background:var(--color-card)}.timeline-empty h3{font-family:var(--font-display);font-size:24px}.timeline-empty p{max-width:460px;margin:10px auto 20px;color:var(--color-text-subtle-default);line-height:1.6}.timeline-empty button{margin:4px}button:focus-visible{outline:2px solid var(--color-accent-brand-default);outline-offset:2px}@media(max-width:640px){.timeline-navigation{margin-left:0}.timeline-controls{gap:8px}.timeline-missing button{align-items:start}}
</style>
