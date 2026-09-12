import { beforeEach, expect, it, vi } from 'vitest';

const { authedRequest } = vi.hoisted(() => ({ authedRequest: vi.fn() }));
vi.mock('./client', () => ({
  authedRequest,
  EDIT_API: 'https://edit.example.test',
  getToken: vi.fn(() => ''),
}));

import { listResources } from './resourceClient';

beforeEach(() => authedRequest.mockReset());

it('coalesces and caches the resource index while keeping callers isolated', async () => {
  authedRequest.mockResolvedValue(new Response(JSON.stringify([{ id: 'ast_one', name: 'Original', revisions: [] }]), { status: 200 }));
  const [first, second] = await Promise.all([listResources(), listResources()]);
  expect(authedRequest).toHaveBeenCalledTimes(1);
  first[0]!.name = 'Local edit';
  expect(second[0]!.name).toBe('Original');
  expect((await listResources())[0]!.name).toBe('Original');
  expect(authedRequest).toHaveBeenCalledTimes(1);
});
