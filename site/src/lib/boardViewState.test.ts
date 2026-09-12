import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BOARD_VIEW_STATE,
  boardViewStateFromParams,
  hasBoardViewParams,
  readBoardViewState,
  writeBoardViewParams,
} from './boardViewState';

describe('board view state', () => {
  it('reads valid local preferences and falls back safely', () => {
    expect(readBoardViewState(JSON.stringify({
      horizons: ['Now', 'Completed'], group: 'product', sort: 'updated', reverseLanes: true,
    }))).toEqual({ horizons: ['Now', 'Completed'], group: 'product', sort: 'updated', reverseLanes: true });
    expect(readBoardViewState('broken')).toEqual(DEFAULT_BOARD_VIEW_STATE);
  });

  it('treats any view parameter as an explicit view and defaults missing fields', () => {
    const params = new URLSearchParams('sort=updated');
    expect(hasBoardViewParams(params)).toBe(true);
    expect(boardViewStateFromParams(params)).toEqual({ ...DEFAULT_BOARD_VIEW_STATE, sort: 'updated' });
  });

  it('serializes a complete deterministic view, including defaults and no horizons', () => {
    const params = new URLSearchParams('q=launch&horizon=Later');
    writeBoardViewParams(params, { horizons: [], group: 'horizon', sort: 'manual', reverseLanes: false });
    expect(params.get('q')).toBe('launch');
    expect(params.getAll('horizon')).toEqual(['none']);
    expect(params.get('group')).toBe('horizon');
    expect(params.get('sort')).toBe('manual');
    expect(params.get('reverse')).toBe('0');
  });
});
