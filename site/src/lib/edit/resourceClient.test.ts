import { beforeEach, expect, it, vi } from 'vitest';

const { authedRequest } = vi.hoisted(() => ({ authedRequest: vi.fn() }));
vi.mock('./client', () => ({
  authedRequest,
  EDIT_API: 'https://edit.example.test',
  getToken: vi.fn(() => ''),
}));

import { invalidateResourceLibrary, listResources } from './resourceClient';

beforeEach(() => { authedRequest.mockReset(); invalidateResourceLibrary(); });

it('coalesces and caches the resource index while keeping callers isolated', async () => {
  authedRequest.mockResolvedValue(new Response(JSON.stringify([{ id: 'ast_one', name: 'Original', revisions: [] }]), { status: 200 }));
  const [first, second] = await Promise.all([listResources(), listResources()]);
  expect(authedRequest).toHaveBeenCalledTimes(1);
  first[0]!.name = 'Local edit';
  expect(second[0]!.name).toBe('Original');
  expect((await listResources())[0]!.name).toBe('Original');
  expect(authedRequest).toHaveBeenCalledTimes(1);
});

it('loads newly published files instead of the cached pre-publication library', async () => {
  authedRequest.mockResolvedValueOnce(new Response('[]'));
  expect(await listResources()).toEqual([]);
  invalidateResourceLibrary();
  authedRequest.mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'ast_new', name: 'Published cover', revisions: [] }])));
  expect((await listResources())[0]!.name).toBe('Published cover');
  expect(authedRequest).toHaveBeenCalledTimes(2);
});

it('does not let an older request overwrite or detach the refreshed library request', async () => {
  let oldResponse!: (response: Response) => void;
  let newResponse!: (response: Response) => void;
  authedRequest.mockImplementationOnce(() => new Promise(resolve => { oldResponse = resolve; }));
  const old = listResources();
  invalidateResourceLibrary();
  authedRequest.mockImplementationOnce(() => new Promise(resolve => { newResponse = resolve; }));
  const fresh = listResources();
  oldResponse(new Response('[]'));
  await old;
  const coalesced = listResources();
  expect(authedRequest).toHaveBeenCalledTimes(2);
  newResponse(new Response(JSON.stringify([{ id: 'ast_new', name: 'Replacement', revisions: [] }])));
  expect((await fresh)[0]!.name).toBe('Replacement');
  expect((await coalesced)[0]!.name).toBe('Replacement');
  expect((await listResources())[0]!.name).toBe('Replacement');
});
