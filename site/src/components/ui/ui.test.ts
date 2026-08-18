import { afterEach, describe, it, expect, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import Pill from './Pill.vue';
import Badge from './Badge.vue';
import SegmentedControl from './SegmentedControl.vue';
import Navbar from './Navbar.vue';

afterEach(() => {
  delete (globalThis as any).canvasdrop;
  vi.restoreAllMocks();
});

describe('Pill', () => {
  it('emits toggle and reflects aria-pressed', async () => {
    const w = mount(Pill, { props: { active: false }, slots: { default: 'Music App' } });
    expect(w.attributes('aria-pressed')).toBe('false');
    expect(w.text()).toBe('Music App');
    await w.trigger('click');
    expect(w.emitted('toggle')).toHaveLength(1);
  });

  it('active renders inverted styling', () => {
    const w = mount(Pill, { props: { active: true } });
    expect(w.attributes('aria-pressed')).toBe('true');
    expect(w.classes().join(' ')).toContain('bg-foreground');
  });
});

describe('Badge', () => {
  it('renders slot with the tone class', () => {
    const w = mount(Badge, { props: { tone: 'violet' }, slots: { default: 'Podcasts & Audiobooks' } });
    expect(w.text()).toBe('Podcasts & Audiobooks');
    expect(w.classes().join(' ')).toContain('transparent-violet');
  });
});

describe('SegmentedControl', () => {
  it('updates the model on option click', async () => {
    const w = mount(SegmentedControl, {
      props: { options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], modelValue: 'a' },
    });
    await w.findAll('button')[1]!.trigger('click');
    expect(w.emitted('update:modelValue')?.[0]).toEqual(['b']);
  });
});

describe('Navbar', () => {
  it('shows the signed-in Canvas Drop author when the SDK is available', async () => {
    (globalThis as any).canvasdrop = {
      me: vi.fn(async () => ({ id: 'dev', email: 'dev@example.com', name: 'Mark' })),
      canvases: {},
    };

    const w = mount(Navbar, { props: { base: '/', active: 'shares' } });
    await flushPromises();

    expect(w.text()).toContain('Mark');
    expect(w.get('a[href="/shares"]').text()).toContain('Shares');
  });
});
