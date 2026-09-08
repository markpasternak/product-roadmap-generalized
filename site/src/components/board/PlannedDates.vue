<script setup lang="ts">
import { computed } from 'vue';
import { scheduleIssue, scheduleLabel, dateDay, todayDate } from '../../lib/timeline';
const props = defineProps<{ startDate?: string | null; endDate?: string | null; compact?: boolean }>();
const label = computed(() => scheduleLabel(props));
const valid = computed(() => !scheduleIssue(props));
const today = computed(() => valid.value ? Math.max(0, Math.min(100, (dateDay(todayDate())! - dateDay(props.startDate)!)/(dateDay(props.endDate)! - dateDay(props.startDate)! + 1)*100)) : 0);
const within = computed(() => valid.value && todayDate() >= props.startDate! && todayDate() <= props.endDate!);
</script>
<template>
  <div v-if="label" class="planned-dates" :class="{'is-compact':compact}" data-test="planned-dates">
    <span class="planned-label">Planned</span> <span>{{ label }}</span>
    <div v-if="valid && !compact" class="planned-line" role="img" :aria-label="`Planned work window: ${label}${within ? '. Marker shows today, not completion progress.' : ''}`"><i /><i /><span v-if="within" :style="{left:today+'%'}" title="Today" /></div>
    <small v-if="!valid && !compact">{{ scheduleIssue(props) }} · Not shown on the timeline</small>
  </div>
</template>
<style scoped>
.planned-dates{font-size:13px;color:var(--color-text-subtle-default);margin:16px 0;line-height:1.6}.planned-label{font-weight:600;margin-right:6px}.is-compact{font-size:11px;margin:9px 0 0}.planned-line{position:relative;height:2px;margin:16px 4px;background:var(--color-border-subtle-default)}.planned-line i{position:absolute;width:7px;height:7px;border-radius:50%;background:var(--color-text-subtle-default);top:-3px;left:-3px}.planned-line i+i{left:auto;right:-3px}.planned-line span{position:absolute;height:12px;top:-5px;width:3px;background:var(--color-accent-brand-default)}small{display:block;font-size:11px}
</style>
