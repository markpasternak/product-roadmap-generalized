import { afterEach, expect, it } from 'vitest';
import { defineComponent, ref } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import ActivityFilter from './ActivityFilter.vue';
let w: VueWrapper;
afterEach(() => w?.unmount());
function setup() {
  w = mount(defineComponent({ components: { ActivityFilter }, setup: () => ({ activity: ref(null) }), template: '<ActivityFilter id="test" v-model="activity" />' }));
}
it('applies quick periods and clears the filter', async () => {
  setup();
  await w.get('#test-activity-period').setValue('7');
  expect((w.vm as any).activity).toMatchObject({ field: 'updated', period: 'relative', days: 7 });
  await w.get('#test-activity-field').setValue('created');
  expect((w.vm as any).activity.field).toBe('created');
  await w.get('.activity-clear').trigger('click');
  expect((w.vm as any).activity).toBeNull();
});
it('keeps the current results while editing a range and rejects an inverted range', async () => {
  setup();
  await w.get('#test-activity-period').setValue('7');
  await w.get('#test-activity-period').setValue('range');
  await w.get('#test-activity-from').setValue('2026-08-10');
  await w.get('#test-activity-to').setValue('2026-08-01');
  expect(w.get('[role=alert]').text()).toContain('End date');
  expect(w.get('button[type=submit]').attributes('disabled')).toBeDefined();
  expect((w.vm as any).activity.period).toBe('relative');
  await w.get('#test-activity-to').setValue('2026-08-31');
  await w.get('form').trigger('submit');
  expect((w.vm as any).activity).toMatchObject({ period: 'range', from: '2026-08-10', to: '2026-08-31' });
});
it('supports a custom rolling number of days', async () => {
  setup();
  await w.get('#test-activity-period').setValue('days');
  await w.get('#test-activity-days').setValue(21);
  await w.get('form').trigger('submit');
  expect((w.vm as any).activity).toMatchObject({ period: 'relative', days: 21 });
});
