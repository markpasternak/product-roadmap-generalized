import { afterEach, describe, expect, it, vi } from 'vitest';
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
afterEach(() => { wrapper?.unmount(); localStorage.clear(); vi.restoreAllMocks(); });

describe('read-only item visibility', () => {
  it('shows all authored sections in compact and expanded modes and copies the permanent URL', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({ writeText } as unknown as Clipboard);
    wrapper = mount(DetailDrawer, { props: { item: { ...item, readingBody: `## Who it's for\nCreative teams.\n\n## Open questions\n${'A question with context. '.repeat(30)}\n\n## Custom note\nKeep this too.\n\n## Resources\nResource context.` } } });
    await flushPromises();
    const headings = () => wrapper!.findAll('[data-reading-body] .roadmap-section-heading').map(h => h.text());
    expect(headings()).toEqual(["Who it's for", 'Open questions', 'Custom note', 'Resources']);
    expect(wrapper.find('.item-section-toggle').exists()).toBe(true);
    await wrapper.get('[aria-label="Expand item"]').trigger('click');
    expect(headings()).toEqual(["Who it's for", 'Open questions', 'Custom note', 'Resources']);
    expect(wrapper.find('.item-section-toggle').exists()).toBe(false);
    expect(wrapper.findAll('a').find(a => a.text().includes('Open full page'))?.attributes('href')).toBe(item.href);
    await wrapper.get('[aria-label="Copy item link"]').trigger('click');
    await flushPromises();
    expect(writeText).toHaveBeenCalledWith(new URL(item.href, location.origin).href);
  });
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
