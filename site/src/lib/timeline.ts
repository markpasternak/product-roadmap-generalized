import { z } from 'zod';

const DAY = 86400000;
export function dateDay(value?: string | null): number | null {
  if (!value || value.startsWith('0000-') || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time / DAY : null;
}
const FIRST_DAY = Date.parse('0001-01-01T00:00:00Z') / DAY;
const LAST_DAY = Date.parse('9999-12-31T00:00:00Z') / DAY;
export const dayDate = (day: number) => new Date(Math.max(FIRST_DAY, Math.min(LAST_DAY, day)) * DAY).toISOString().slice(0, 10);
export const todayDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const plannedDateSchema = z.preprocess(v => v instanceof Date ? v.toISOString().slice(0, 10) : v,
  z.string().refine(v => v === '' || dateDay(v) !== null, 'Use a valid date (YYYY-MM-DD)').optional());
export const timelineSettingsSchema = z.object({
  group: z.enum(['product', 'owner', 'tag', 'stage', 'none']).default('product'),
  scale: z.enum(['weeks', 'months', 'quarters']).default('months'),
  anchor: z.string().refine(v => dateDay(v) !== null).optional(),
  fit: z.boolean().default(false),
});
export type TimelineSettings = z.infer<typeof timelineSettingsSchema>;
export const timelineSettings = (value?: unknown): TimelineSettings => {
  const parsed = timelineSettingsSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : { group: 'product', scale: 'months', fit: false };
};
export interface ScheduledItem { id: string; title: string; product: string; stage: string; owner?: string; tags: string[]; startDate?: string | null; endDate?: string | null; }
export interface TimelineRange { from: string; to: string; }
export function scheduleIssue(item: Pick<ScheduledItem, 'startDate' | 'endDate'>): string | null {
  if (!item.startDate && !item.endDate) return 'No dates';
  if (!item.startDate) return 'Missing start';
  if (!item.endDate) return 'Missing end';
  const start = dateDay(item.startDate), end = dateDay(item.endDate);
  if (start === null || end === null) return 'Invalid date';
  return end < start ? 'End before start' : null;
}
export function scheduleLabel(item: Pick<ScheduledItem, 'startDate' | 'endDate'>): string {
  if (!item.startDate && !item.endDate) return '';
  return `${item.startDate ? formatPlanDate(item.startDate) : 'Start not set'} → ${item.endDate ? formatPlanDate(item.endDate) : 'End not set'}`;
}
export function formatPlanDate(value: string): string {
  const day = dateDay(value);
  return day === null ? value : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(day * DAY);
}
function monthStart(date: string, delta = 0): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + delta);
  return dayDate(d.getTime() / DAY);
}
function monthEnd(date: string, delta = 1): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + delta, 0);
  return dayDate(d.getTime() / DAY);
}
export function timelineRange(items: ScheduledItem[], settings: TimelineSettings, today = todayDate()): TimelineRange {
  const dated = items.filter(i => !scheduleIssue(i));
  if (settings.fit && dated.length) {
    const from = monthStart(dated.map(i => i.startDate!).sort()[0]!);
    const last = dated.map(i => i.endDate!).sort().at(-1)!;
    return { from, to: monthEnd(last) };
  }
  const from = settings.anchor ?? monthStart(today, -1);
  const start = dateDay(from)!;
  return { from, to: settings.scale === 'weeks' ? dayDate(start + 83) : monthEnd(from, settings.scale === 'quarters' ? 12 : 6) };
}
export function panTimeline(settings: TimelineSettings, range: TimelineRange, direction: number): TimelineSettings {
  const days = dateDay(range.to)! - dateDay(range.from)! + 1;
  return { ...settings, fit: false, anchor: dayDate(dateDay(range.from)! + direction * days) };
}
export function timelineModel<T extends ScheduledItem>(items: T[], settings: TimelineSettings, fixedRange?: TimelineRange) {
  const range = fixedRange ?? timelineRange(items, settings);
  const from = dateDay(range.from)!, to = dateDay(range.to)!;
  const span = to - from + 1;
  const missing = items.filter(i => scheduleIssue(i));
  const scheduled = items.filter(i => !scheduleIssue(i));
  const visible = scheduled.filter(i => dateDay(i.startDate)! <= to && dateDay(i.endDate)! >= from);
  const visibleSet = new Set(visible);
  const outside = scheduled.filter(i => !visibleSet.has(i));
  const groups = new Map<string, T[]>();
  for (const item of visible) {
    const keys = settings.group === 'none' ? ['All items'] : settings.group === 'tag' ? [...new Set(item.tags.length ? item.tags : ['Untagged'])]
      : [settings.group === 'owner' ? item.owner?.trim() || 'Unassigned' : item[settings.group] || 'Unassigned'];
    for (const key of keys) groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const ticks: { label: string; left: number; width: number }[] = [];
  const weekly = settings.scale === 'weeks' && span <= 200;
  let cursor = from;
  while (cursor <= to && ticks.length < 100) {
    const month = new Date(cursor * DAY).getUTCMonth();
    const boundary = weekly ? cursor + 7 : dateDay(monthStart(dayDate(cursor), span > 1100 ? Math.max(12, Math.ceil(span / 365 / 50) * 12) : settings.scale === 'quarters' || span > 366 ? 3 - month % 3 : 1))!;
    const next = boundary <= cursor || boundary === LAST_DAY ? to + 1 : boundary;
    const d = new Date(cursor * DAY);
    const label = weekly ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(d)
      : span > 1100 ? String(d.getUTCFullYear()) : settings.scale === 'quarters' || span > 366 ? `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`
      : new Intl.DateTimeFormat('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(d);
    ticks.push({ label, left: (cursor - from) / span * 100, width: (Math.min(next, to + 1) - cursor) / span * 100 });
    cursor = next;
  }
  const position = (item: T) => ({ left: Math.max(0, (dateDay(item.startDate)! - from) / span * 100), width: Math.max(.3, (Math.min(to, dateDay(item.endDate)!) - Math.max(from, dateDay(item.startDate)!) + 1) / span * 100), before: dateDay(item.startDate)! < from, after: dateDay(item.endDate)! > to });
  return { range, missing, scheduled, visible, outside, ticks, position, groups: [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([name, rows]) => ({ name, items: [...rows].sort((a, b) => a.startDate!.localeCompare(b.startDate!) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id)) })) };
}
