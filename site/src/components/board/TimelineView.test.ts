import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import TimelineView from './TimelineView.vue';
import { timelineSettings } from '../../lib/timeline';
import type { ItemVM } from '../../lib/filters';
const a = { id:'a', title:'Release planning', product:'Music App', stage:'Building', horizon:'Now', tags:['growth'], owner:'Alice', startDate:'2026-09-01', endDate:'2026-09-30' } as ItemVM;
describe('timeline interactions', () => {
  it('opens the same item from a bar and reviews omitted items', async () => {
    const b = {...a,id:'b',title:'Unscheduled',startDate:undefined};
    const w=mount(TimelineView,{props:{items:[a,b],settings:timelineSettings({fit:true})}});
    expect(w.text()).toContain('2 matching');
    expect(w.text()).toContain('1 missing or invalid dates');
    await w.get('.timeline-bar').trigger('click');
    expect(w.emitted('select')?.[0]).toEqual([a]);
    await w.get('.timeline-summary button').trigger('click');
    expect(w.get('.timeline-missing').text()).toContain('Missing start');
    await w.get('.timeline-missing button').trigger('click');
    expect(w.emitted('select')?.[1]).toEqual([b]);
    w.unmount();
  });
  it('changes grouping and scale without modifying items', async () => {
    const w=mount(TimelineView,{props:{items:[a],settings:timelineSettings({fit:true})}});
    await w.get('[aria-label="Timeline grouping"]').setValue('tag');
    expect(w.emitted('settings')?.[0]?.[0]).toMatchObject({group:'tag'});
    await w.get('[aria-label="Timeline scale"]').setValue('weeks');
    expect(w.emitted('settings')?.[1]?.[0]).toMatchObject({scale:'weeks',fit:false});
    expect(a.startDate).toBe('2026-09-01'); w.unmount();
  });
  it('keeps owner and private tag grouping out of presentation mode', () => {
    const w=mount(TimelineView,{props:{items:[a],settings:timelineSettings({group:'owner',fit:true}),client:true}});
    expect(w.text()).not.toContain('Alice');
    expect(w.find('option[value="owner"]').exists()).toBe(false);w.unmount();
  });
});
