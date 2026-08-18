import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import PresenceIndicator from './PresenceIndicator.vue';
import type { RealtimeUser } from '../../lib/share/canvasdrop';

const viewers = (n: number): RealtimeUser[] =>
  Array.from({ length: n }, (_, i) => ({ id: `u${i}`, name: `User ${i}` }));

describe('PresenceIndicator — pill', () => {
  it('renders "N viewing" with avatars (capped at 5) when realtime is available and viewers are present', () => {
    const w = mount(PresenceIndicator, {
      props: { viewers: viewers(7), realtimeAvailable: true },
    });

    expect(w.get('[data-test="presence-indicator"]').text()).toContain('7 viewing');
    // Avatar.vue renders a `.ring-2` span per viewer — capped at 5 even though there are 7 viewers.
    expect(w.findAll('.ring-2')).toHaveLength(5);
  });

  it('hides the pill when there are no viewers', () => {
    const w = mount(PresenceIndicator, { props: { viewers: [], realtimeAvailable: true } });
    expect(w.find('[data-test="presence-indicator"]').exists()).toBe(false);
  });

  it('hides the pill when realtime is unavailable, even with viewers', () => {
    const w = mount(PresenceIndicator, { props: { viewers: viewers(2), realtimeAvailable: false } });
    expect(w.find('[data-test="presence-indicator"]').exists()).toBe(false);
  });
});

describe('PresenceIndicator — also-editing nudge', () => {
  it('shows the "also editing" label when in edit mode and someone else is editing', () => {
    const w = mount(PresenceIndicator, {
      props: {
        othersEditing: [{ id: 'a', name: 'Ada' }],
        canEdit: true,
        editMode: true,
        present: false,
      },
    });

    const nudge = w.get('[data-test="also-editing"]');
    expect(nudge.text()).toContain('Ada is also editing');
  });

  it('pluralizes for multiple other editors', () => {
    const w = mount(PresenceIndicator, {
      props: {
        othersEditing: [{ id: 'a', name: 'Ada' }, { id: 'b', name: 'Bo' }],
        canEdit: true,
        editMode: true,
      },
    });

    expect(w.get('[data-test="also-editing"]').text()).toContain('Ada, Bo are also editing');
  });

  it('hides the nudge when othersEditing is empty', () => {
    const w = mount(PresenceIndicator, { props: { othersEditing: [], canEdit: true, editMode: true } });
    expect(w.find('[data-test="also-editing"]').exists()).toBe(false);
  });

  it('hides the nudge outside edit mode, even with others editing', () => {
    const w = mount(PresenceIndicator, {
      props: { othersEditing: [{ id: 'a', name: 'Ada' }], canEdit: true, editMode: false },
    });
    expect(w.find('[data-test="also-editing"]').exists()).toBe(false);
  });

  it('hides the nudge in presentation mode', () => {
    const w = mount(PresenceIndicator, {
      props: { othersEditing: [{ id: 'a', name: 'Ada' }], canEdit: true, editMode: true, present: true },
    });
    expect(w.find('[data-test="also-editing"]').exists()).toBe(false);
  });
});
