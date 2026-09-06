// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { createSSRApp, defineComponent, h, nextTick, ref } from 'vue';
import { renderToString } from '@vue/server-renderer';
import { PhArrowUpRight } from '@phosphor-icons/vue';

it('hydrates server-rendered icons without property errors and preserves reactive sizing', async () => {
  const size = ref(14);
  const Icon = defineComponent(() => () => h(PhArrowUpRight, { size: size.value }));
  const host = document.createElement('div');
  host.innerHTML = await renderToString(createSSRApp(Icon));
  document.body.append(host);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const app = createSSRApp(Icon);
  try {
    app.mount(host);
    const icon = host.querySelector('svg')!;
    expect(icon.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(icon.getAttribute('width')).toBe('14');
    size.value = 20;
    await nextTick();
    expect(icon.getAttribute('width')).toBe('20');
    expect(icon.getAttribute('height')).toBe('20');
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  } finally {
    app.unmount();
    host.remove();
    warn.mockRestore();
    error.mockRestore();
  }
});
