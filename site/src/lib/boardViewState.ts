import { z } from 'zod';
import { HORIZONS } from './schema';
import type { SortKey } from './filters';

export interface BoardViewState {
  horizons: string[];
  group: 'horizon' | 'product';
  sort: SortKey;
  reverseLanes: boolean;
}

export const DEFAULT_BOARD_VIEW_STATE: BoardViewState = {
  horizons: ['Now', 'Next', 'Later'],
  group: 'horizon',
  sort: 'manual',
  reverseLanes: false,
};

export const BOARD_VIEW_STORAGE_KEY = 'rm-board-view-v1';

const schema = z.object({
  horizons: z.array(z.enum(HORIZONS)),
  group: z.enum(['horizon', 'product']),
  sort: z.enum(['manual', 'impact', 'effort', 'updated', 'title']),
  reverseLanes: z.boolean(),
});

function copy(state: BoardViewState): BoardViewState {
  return { ...state, horizons: [...state.horizons] };
}

export function readBoardViewState(raw: string | null, legacyReverse = false): BoardViewState {
  try {
    const result = schema.safeParse(JSON.parse(raw ?? 'null'));
    if (result.success) return result.data;
  } catch {
    /* Use the safe defaults below. */
  }
  return { ...copy(DEFAULT_BOARD_VIEW_STATE), reverseLanes: legacyReverse };
}

export function hasBoardViewParams(params: URLSearchParams): boolean {
  return ['horizon', 'group', 'sort', 'reverse'].some(key => params.has(key));
}

export function boardViewStateFromParams(params: URLSearchParams): BoardViewState {
  const state = copy(DEFAULT_BOARD_VIEW_STATE);
  const horizons = params.getAll('horizon').filter((value): value is (typeof HORIZONS)[number] =>
    (HORIZONS as readonly string[]).includes(value),
  );
  if (horizons.length) state.horizons = horizons;
  else if (params.get('horizon') === 'none') state.horizons = [];
  if (params.get('group') === 'product') state.group = 'product';
  const sort = params.get('sort');
  if (sort && schema.shape.sort.safeParse(sort).success) state.sort = sort as SortKey;
  state.reverseLanes = params.get('reverse') === '1';
  return state;
}

export function writeBoardViewParams(params: URLSearchParams, state: BoardViewState): void {
  params.delete('horizon');
  if (state.horizons.length) state.horizons.forEach(horizon => params.append('horizon', horizon));
  else params.set('horizon', 'none');
  params.set('group', state.group);
  params.set('sort', state.sort);
  params.set('reverse', state.reverseLanes ? '1' : '0');
}
