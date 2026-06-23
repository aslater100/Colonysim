import { describe, expect, it } from 'vitest';
import {
  resolveView,
  initialState,
  defaultIsEmpty,
  type AsyncState,
} from '../src/ui/components/asyncState';

// These cover the one place the loading/empty/error/ready precedence lives.
// Kept DOM-free so they run in the default node/vitest environment.

describe('asyncState.resolveView', () => {
  it('starts idle', () => {
    expect(resolveView(initialState<number[]>())).toBe('idle');
  });

  it('reports loading while a load is in flight', () => {
    const state: AsyncState<number[]> = { phase: 'loading', data: undefined, error: undefined };
    expect(resolveView(state)).toBe('loading');
  });

  it('reports error regardless of any stale data', () => {
    const state: AsyncState<number[]> = { phase: 'error', data: [1, 2], error: new Error('x') };
    expect(resolveView(state)).toBe('error');
  });

  it('treats a ready-but-empty array as empty', () => {
    const state: AsyncState<number[]> = { phase: 'ready', data: [], error: undefined };
    expect(resolveView(state)).toBe('empty');
  });

  it('treats ready data with content as ready', () => {
    const state: AsyncState<number[]> = { phase: 'ready', data: [1], error: undefined };
    expect(resolveView(state)).toBe('ready');
  });

  it('treats ready with undefined data as empty', () => {
    const state: AsyncState<number[]> = { phase: 'ready', data: undefined, error: undefined };
    expect(resolveView(state)).toBe('empty');
  });

  it('honours a custom isEmpty predicate', () => {
    const state: AsyncState<{ rows: number[] }> = { phase: 'ready', data: { rows: [] }, error: undefined };
    expect(resolveView(state, (d) => d.rows.length === 0)).toBe('empty');
    expect(resolveView({ ...state, data: { rows: [1] } }, (d) => d.rows.length === 0)).toBe('ready');
  });
});

describe('asyncState.defaultIsEmpty', () => {
  it('flags nullish, empty arrays, and blank strings as empty', () => {
    expect(defaultIsEmpty(null)).toBe(true);
    expect(defaultIsEmpty(undefined)).toBe(true);
    expect(defaultIsEmpty([])).toBe(true);
    expect(defaultIsEmpty('   ')).toBe(true);
  });

  it('treats populated values as non-empty', () => {
    expect(defaultIsEmpty([0])).toBe(false);
    expect(defaultIsEmpty('hi')).toBe(false);
    expect(defaultIsEmpty(0)).toBe(false);
    expect(defaultIsEmpty({})).toBe(false);
  });
});
