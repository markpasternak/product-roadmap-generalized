import { afterEach, expect, it, vi } from 'vitest';
import { createItemViewPreference } from './itemViewPreference';

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

it('starts compact and restores the last explicit choice on a later visit', () => {
  const preference = createItemViewPreference();
  expect(preference.read()).toBe(false);
  preference.write(true);
  expect(createItemViewPreference().read()).toBe(true);
  preference.write(false);
  expect(createItemViewPreference().read()).toBe(false);
});

it('keeps the choice for this visit when browser storage is blocked', () => {
  vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError'); });
  const preference = createItemViewPreference();
  expect(preference.read()).toBe(false);
  expect(() => preference.write(true)).not.toThrow();
  expect(preference.read()).toBe(true);
  preference.write(false);
  expect(preference.read()).toBe(false);
});
