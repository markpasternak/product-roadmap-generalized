import { afterEach, describe, expect, it } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import DetailDrawer from './DetailDrawer.vue';
import type { ItemVM } from '../../lib/filters';

const item: ItemVM = {
  id: 'TEST-1', title: 'Visibility example', product: 'Music App',
  horizon: 'Now', stage: 'Building', owner: 'Example owner',
  impact: 'High', effort: 'Low', visibility: 'Internal', order: 1, updated: '',
  tags: [], themes: [], oneliner: '', outcome: '', sections: [],
  editUrl: '', links: [], text: '', href: '/item/TEST-1/',
};
let wrapper: VueWrapper | undefined;
afterEach(() => { wrapper?.unmount(); localStorage.clear(); });

describe('read-only item visibility', () => {
  it.each(['Internal', 'Public'] as const)('shows %s beside the item status', async (visibility) => {
    wrapper = mount(DetailDrawer, { props: { item: { ...item, visibility } } });
    await flushPromises();
    const field = wrapper.findAll('.detail-status-summary > div')
      .find((row) => row.find('dt').text() === 'Visibility');
    expect(field?.find('dd').text()).toBe(visibility);
  });

  it('keeps visibility out of client-facing presentation details', async () => {
    wrapper = mount(DetailDrawer, { props: { item, client: true } });
    await flushPromises();
    expect(wrapper.findAll('.detail-status-summary dt').map((field) => field.text()))
      .not.toContain('Visibility');
  });
});
