import { expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { reactive } from 'vue';
import FiltersSidebar from './FiltersSidebar.vue';
import { emptyFilters } from '../../lib/filters';

it('keeps selected stages and tags visible in collapsed lists so they can be removed', async () => {
  const filters = reactive({ ...emptyFilters(), stage: ['Shipped'], tags: ['tag-9'] });
  const wrapper = mount(FiltersSidebar, { props: {
    filters, assets: [], impactOptions: [], effortOptions: [],
    stages: ['Discovery', 'Validation', 'Shaping', 'Committed', 'Building', 'Pilot', 'Shipped'].map((value) => ({ value, count: 1 })),
    tagOptions: Array.from({ length: 10 }, (_, index) => ({ token: `tag-${index}`, label: `Tag ${index}`, count: 1, theme: false })),
  } });
  const selected = wrapper.findAll('input[type="checkbox"]').filter((input) => (input.element as HTMLInputElement).checked);
  expect(selected).toHaveLength(2);
  for (const input of selected) await input.setValue(false);
  expect(filters.stage).toEqual([]);
  expect(filters.tags).toEqual([]);
  wrapper.unmount();
});
