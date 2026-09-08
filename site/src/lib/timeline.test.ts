import { describe, expect, it } from 'vitest';
import { dateDay, plannedDateSchema, timelineModel, timelineRange, timelineSettings, scheduleIssue, type ScheduledItem } from './timeline';
const item = (id: string, startDate?: string, endDate?: string): ScheduledItem => ({ id, title: id, product: 'Music App', stage: 'Discovery', tags: [], startDate, endDate });
describe('planned timeline', () => {
  it('validates actual calendar dates and preserves YAML date-only values', () => {
    expect(dateDay('2026-02-29')).toBeNull();
    expect(dateDay('2028-02-29')).not.toBeNull();
    expect(dateDay('2026-2-01')).toBeNull();
    expect(plannedDateSchema.parse(new Date('2026-09-12T00:00:00Z'))).toBe('2026-09-12');
  });
  it('does not invent either endpoint, and accepts a same-day window', () => {
    expect(scheduleIssue(item('a'))).toBe('No dates');
    expect(scheduleIssue(item('a', '2026-09-01'))).toBe('Missing end');
    expect(scheduleIssue(item('a', undefined, '2026-09-01'))).toBe('Missing start');
    expect(scheduleIssue(item('a', '2026-09-02', '2026-09-01'))).toBe('End before start');
    expect(scheduleIssue(item('a', '2026-09-01', '2026-09-01'))).toBeNull();
  });
  it('counts missing and outside items separately, and clips overlaps inclusively', () => {
    const items = [item('a', '2026-08-01','2026-10-01'),item('b'),item('c','2026-10-01','2026-11-01'),item('d','2026-09-30','2026-09-30')];
    const model = timelineModel(items, timelineSettings(), {from:'2026-09-01',to:'2026-09-30'});
    expect(model.visible.map(i=>i.id)).toEqual(['a','d']);
    expect(model.missing.map(i=>i.id)).toEqual(['b']);
    expect(model.outside.map(i=>i.id)).toEqual(['c']);
    expect(model.position(items[0]!)).toMatchObject({left:0,width:100,before:true,after:true});
    expect(model.position(items[3]!).width).toBeCloseTo(100/30);
  });
  it('groups multiple tags without inflating overall item counts', () => {
    const a = {...item('a','2026-09-01','2026-10-01'),tags:['growth','platform','growth']};
    const model = timelineModel([a,item('b','2026-09-01','2026-09-01')],timelineSettings({group:'tag',fit:true}));
    expect(model.visible).toHaveLength(2);
    expect(model.groups.map(g=>g.name)).toEqual(['growth','platform','Untagged']);
    expect(model.groups.flatMap(g=>g.items)).toHaveLength(3);
  });
  it('uses calendar days through daylight-saving transitions and year boundaries', () => {
    expect(dateDay('2026-03-30')! - dateDay('2026-03-28')!).toBe(2);
    expect(timelineRange([item('a','2026-12-31','2027-01-01')],timelineSettings({fit:true}))).toEqual({from:'2026-12-01',to:'2027-01-31'});
  });
  it('recovers malformed stored view settings', () => {
    expect(timelineSettings({anchor:'not a date',group:'x'})).toEqual(timelineSettings());
  });
});

it('keeps extreme valid calendar windows finite', () => {
  expect(dateDay('0000-01-01')).toBeNull();
  const model=timelineModel([item('far','9999-12-01','9999-12-31')],timelineSettings({fit:true}));
  expect(model.range).toEqual({from:'9999-12-01',to:'9999-12-31'});
  expect(model.ticks).toHaveLength(1);
  expect(model.position(model.visible[0]!).width).toBe(100);
});
