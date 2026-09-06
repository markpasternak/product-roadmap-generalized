import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';

const { meMock, audience } = vi.hoisted(() => ({ meMock: vi.fn(), audience: { public: false } }));
vi.mock('../../lib/edit/client', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/edit/client')>(),
  me: meMock,
  loginUrl: () => 'https://edit.example.test/auth/login',
}));
vi.mock('../../lib/audience', () => ({ get IS_PUBLIC() { return audience.public; } }));
import Navbar from './Navbar.vue';

let wrapper: VueWrapper;
beforeEach(() => {
  audience.public = false;
  meMock.mockReset().mockResolvedValue({ editor: false, login: '' });
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  document.documentElement.dataset.theme = 'dark';
});
afterEach(() => {
  wrapper?.unmount();
  delete (globalThis as any).canvasdrop;
  delete document.documentElement.dataset.theme;
  localStorage.clear();
  vi.restoreAllMocks();
});
async function openAccount() {
  await wrapper.get('[aria-controls="site-account-panel"]').trigger('click');
  await flushPromises();
}

describe('Navbar account controls', () => {
  it('separates the sharing identity from GitHub editing access', async () => {
    (globalThis as any).canvasdrop = {
      me: vi.fn(async () => ({ id: 'dev', email: 'dev@example.com', name: 'Mark' })),
      canvases: {},
    };
    wrapper = mount(Navbar, { props: { base: '/', active: 'shares' } });
    await flushPromises();
    expect(wrapper.get('a[href="/shares"]').attributes('aria-current')).toBe('page');
    expect(meMock).not.toHaveBeenCalled();
    await openAccount();
    expect(wrapper.text()).toContain('Mark');
    expect(wrapper.text()).toContain('Signed in for sharing');
    expect(wrapper.get('.account-sign-in').text()).toBe('Sign in to edit');
    expect(wrapper.text()).toContain('Uses your GitHub account');
  });

  it('shows editing access for an authorized editor and refreshes on reopening', async () => {
    meMock.mockResolvedValue({ editor: true, login: 'octocat' });
    wrapper = mount(Navbar, { props: { base: '/' } });
    await openAccount();
    expect(wrapper.text()).toContain('Editing enabled');
    expect(wrapper.text()).toContain('octocat');
    expect(wrapper.find('.account-sign-in').exists()).toBe(false);
    await openAccount(); // Close.
    meMock.mockResolvedValue({ editor: false, login: 'reader' });
    await openAccount();
    expect(wrapper.text()).toContain('View-only access');
    expect(wrapper.text()).not.toContain('Editing enabled');
  });

  it('applies and remembers appearance, with Escape returning focus to Account', async () => {
    wrapper = mount(Navbar, { props: { base: '/' }, attachTo: document.body });
    await openAccount();
    const select = wrapper.get('#site-appearance');
    expect((select.element as HTMLSelectElement).value).toBe('dark');
    await select.setValue('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('rm-theme')).toBe('light');
    await select.trigger('keydown', { key: 'Escape' });
    expect(wrapper.find('#site-account-panel').exists()).toBe(false);
    expect(document.activeElement).toBe(wrapper.get('[aria-controls="site-account-panel"]').element);
  });

  it('dismisses on outside clicks and focus leaving the disclosure', async () => {
    wrapper = mount(Navbar, { props: { base: '/' } });
    await openAccount();
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await flushPromises();
    expect(wrapper.find('#site-account-panel').exists()).toBe(false);
    await openAccount();
    await wrapper.get('.site-account').trigger('focusout', { relatedTarget: wrapper.get('nav a').element });
    expect(wrapper.find('#site-account-panel').exists()).toBe(false);
  });

  it('captures an editing callback on a support page', async () => {
    window.history.replaceState(null, '', '/docs?sort=updated#roadmap_edit_token=test-callback-token');
    wrapper = mount(Navbar, { props: { base: '/', active: 'docs' } });
    await flushPromises();
    expect(localStorage.getItem('rm-edit-token')).toBe('test-callback-token');
    expect(window.location.hash).toBe('');
    expect(window.location.pathname + window.location.search).toBe('/docs?sort=updated');
  });

  it('keeps appearance available when checking editing access fails', async () => {
    meMock.mockRejectedValueOnce(new Error('unavailable'));
    wrapper = mount(Navbar, { props: { base: '/' } });
    await openAccount();
    expect(wrapper.get('[role="alert"]').text()).toContain('Couldn’t check');
    expect(wrapper.find('#site-appearance').exists()).toBe(true);
    await wrapper.get('button.account-sign-in').trigger('click');
    await flushPromises();
    expect(wrapper.get('a.account-sign-in').text()).toBe('Sign in to edit');
  });

  it('offers only appearance on the public site without probing editing access', async () => {
    audience.public = true;
    wrapper = mount(Navbar, { props: { base: '/' } });
    expect(wrapper.get('[aria-controls="site-account-panel"]').attributes('aria-label')).toBe('Appearance');
    await openAccount();
    expect(meMock).not.toHaveBeenCalled();
    expect(wrapper.find('#site-appearance').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('Roadmap editing');
  });
});
