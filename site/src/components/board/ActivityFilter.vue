<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Select from '../ui/Select.vue';
import { activityDate, activityRange, localTimeZone, parseActivity, type ActivityFilter } from '../../lib/activityFilter';
const props = defineProps<{ modelValue?: ActivityFilter | null; id: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: ActivityFilter | null] }>();
const field = ref('updated'), period = ref('any'), days = ref(14), from = ref(''), to = ref(''), zone = ref(localTimeZone());
const fieldOptions = [{ value: 'updated', label: 'Updated during' }, { value: 'created', label: 'Created' }];
const periodOptions = [
  { value: 'any', label: 'Any time' }, { value: '1', label: 'Today' },
  ...[7, 30, 90].map(n => ({ value: String(n), label: `Last ${n} days` })),
  { value: 'days', label: 'Last X days…' }, { value: 'range', label: 'Custom range…' },
];
watch(() => props.modelValue, value => {
  if (!value) { period.value = 'any'; return; }
  field.value = value.field; zone.value = value.timeZone;
  if (value.period === 'range') { period.value = 'range'; from.value = value.from; to.value = value.to; }
  else { days.value = value.days; period.value = [1, 7, 30, 90].includes(value.days) ? String(value.days) : 'days'; }
}, { immediate: true });
const candidate = computed(() => parseActivity(period.value === 'range'
  ? { field: field.value, timeZone: zone.value, period: 'range', from: from.value, to: to.value }
  : { field: field.value, timeZone: zone.value, period: 'relative', days: period.value === 'days' ? Number(days.value) : Number(period.value) }));
function apply() { if (candidate.value) emit('update:modelValue', candidate.value); }
function changePeriod(value: string) {
  period.value = value;
  if (value === 'any') { emit('update:modelValue', null); return; }
  if (value === 'range') {
    const range = props.modelValue ? activityRange(props.modelValue) : { from: activityDate(new Date().toISOString(), zone.value), to: activityDate(new Date().toISOString(), zone.value) };
    if (!from.value) from.value = range.from;
    if (!to.value) to.value = range.to;
  } else if (value !== 'days') apply();
}
function changeField(value: string) {
  field.value = value;
  if (period.value !== 'range' && period.value !== 'days' && props.modelValue) emit('update:modelValue', { ...props.modelValue, field: value as 'created' | 'updated' });
}
const pending = computed(() => JSON.stringify(candidate.value) !== JSON.stringify(props.modelValue));
</script>
<template>
  <fieldset class="activity-filter">
    <legend>Activity</legend>
    <label :for="`${id}-activity-field`" class="sr-only">Activity type</label>
    <Select :id="`${id}-activity-field`" :model-value="field" :options="fieldOptions" @update:model-value="changeField" />
    <label :for="`${id}-activity-period`" class="sr-only">Activity period</label>
    <Select :id="`${id}-activity-period`" :model-value="period" :options="periodOptions" @update:model-value="changePeriod" />
    <form v-if="period === 'range' || period === 'days'" class="activity-custom" @submit.prevent="apply">
      <template v-if="period === 'range'">
        <label :for="`${id}-activity-from`">From<input :id="`${id}-activity-from`" v-model="from" type="date" required /></label>
        <label :for="`${id}-activity-to`">To<input :id="`${id}-activity-to`" v-model="to" type="date" required /></label>
        <p v-if="from && to && from > to" role="alert">End date must be on or after the start date.</p>
      </template>
      <label v-else :for="`${id}-activity-days`">Number of days<input :id="`${id}-activity-days`" v-model="days" type="number" min="1" max="36500" required /></label>
      <button type="submit" :disabled="!candidate || !pending">Apply {{ period === 'range' ? 'range' : 'period' }}</button>
    </form>
    <p v-if="period !== 'any'" class="activity-hint">{{ field === 'updated' ? 'Published changes, including newly created items.' : 'When an item was first added to the roadmap.' }} Dates use {{ zone.replaceAll('_', ' ') }}.</p>
    <button v-if="modelValue || period !== 'any'" type="button" class="activity-clear" @click="period = 'any'; emit('update:modelValue', null)">Clear activity</button>
  </fieldset>
</template>
<style scoped>
.activity-filter { min-width: 0; display: grid; gap: .5rem; }
legend { font-size: .875rem; font-weight: 600; margin-bottom: .4rem; }
.activity-custom { display: grid; gap: .65rem; padding-top: .3rem; }
label { display: grid; gap: .3rem; font-size: .8rem; }
input { width: 100%; min-width: 0; max-width: 100%; box-sizing: border-box; color-scheme: inherit; border: 1px solid var(--color-border-subtle-default); background: var(--color-card); color: var(--color-text-primary-default); border-radius: 7px; padding: .55rem .65rem; font: inherit; min-height: 40px; }
button { font: inherit; font-size: .8rem; cursor: pointer; min-height: 40px; border-radius: 7px; }
button[type=submit] { border: 1px solid var(--color-border-subtle-default); background: var(--color-card); padding: .45rem .7rem; }
button:disabled { opacity: .45; cursor: default; }
.activity-clear { justify-self: start; color: var(--color-text-link-default); text-decoration: underline; }
.activity-hint, [role=alert] { font-size: .75rem; line-height: 1.5; color: var(--color-text-subtle-default); }
[role=alert] { color: var(--color-feedback-error-text-independent-default); }
:is(input, button):focus-visible { outline: 2px solid var(--color-accent-brand-default); outline-offset: 2px; }
</style>
