import { z } from 'zod';
import type { ItemHistory } from './itemHistory';
import { formatDateOnly } from './dates';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
});
const timeZoneSchema = z.string().max(100).refine(value => {
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
});
const common = { field: z.enum(['created', 'updated']), timeZone: timeZoneSchema };
export const activityFilterSchema = z.union([
  z.object({ ...common, period: z.literal('relative'), days: z.number().int().min(1).max(36500) }),
  z.object({ ...common, period: z.literal('range'), from: dateSchema, to: dateSchema }).refine(value => value.from <= value.to),
]);
export type ActivityFilter = z.infer<typeof activityFilterSchema>;
export function parseActivity(value: unknown): ActivityFilter | null {
  const result = activityFilterSchema.safeParse(value);
  return result.success ? result.data : null;
}
export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}
const formatters = new Map<string, Intl.DateTimeFormat>();
export function activityDate(value: string, timeZone: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    formatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(date);
  const part = (key: string) => parts.find(p => p.type === key)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function activityRange(filter: ActivityFilter, now = Date.now()): { from: string; to: string } {
  if (filter.period === 'range') return { from: filter.from, to: filter.to };
  const to = activityDate(new Date(now).toISOString(), filter.timeZone);
  const start = new Date(`${to}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - filter.days + 1);
  return { from: start.toISOString().slice(0, 10), to };
}
export function matchesActivity(item: ItemHistory, filter: ActivityFilter | null | undefined, now = Date.now()): boolean {
  if (!filter) return true;
  const { from, to } = activityRange(filter, now);
  const values = filter.field === 'created'
    ? [item.createdAt || item.created || '']
    : item.activityDates ?? [item.updatedAt || item.updated || ''];
  return values.some(value => {
    const date = activityDate(value, filter.timeZone);
    return !!date && date >= from && date <= to;
  });
}
export function activityLabel(filter: ActivityFilter): string {
  const field = filter.field === 'created' ? 'Created' : 'Updated';
  const period = filter.period === 'relative'
    ? filter.days === 1 ? 'Today' : `Last ${filter.days} days`
    : `${formatDateOnly(filter.from)} – ${formatDateOnly(filter.to)}`;
  return `${field} · ${period}`;
}
export function activityFromParams(params: URLSearchParams): ActivityFilter | null {
  const field = params.get('activity');
  const timeZone = params.get('tz') || 'UTC';
  return parseActivity(params.has('days')
    ? { field, timeZone, period: 'relative', days: Number(params.get('days')) }
    : { field, timeZone, period: 'range', from: params.get('from'), to: params.get('to') });
}
export function writeActivityParams(params: URLSearchParams, filter: ActivityFilter | null | undefined) {
  if (!filter) return;
  params.set('activity', filter.field);
  params.set('tz', filter.timeZone);
  if (filter.period === 'relative') params.set('days', String(filter.days));
  else { params.set('from', filter.from); params.set('to', filter.to); }
}
