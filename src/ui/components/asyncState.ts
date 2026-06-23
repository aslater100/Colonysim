/**
 * Pure state model for async data — kept DOM-free so it is unit-testable in the
 * existing node/vitest harness (no jsdom required). `AsyncContent` consumes
 * this; the rendering layer never decides *which* state to show, it only draws.
 */

/** Where a load currently sits. `idle` = never started. */
export type LoadPhase = 'idle' | 'loading' | 'ready' | 'error';

/** What the user should actually see — `ready` splits into `ready`/`empty`. */
export type AsyncView = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

export interface AsyncState<T> {
  phase: LoadPhase;
  data: T | undefined;
  error: Error | undefined;
}

export function initialState<T>(): AsyncState<T> {
  return { phase: 'idle', data: undefined, error: undefined };
}

/** Default emptiness test: empty array, empty string, or nullish. */
export function defaultIsEmpty(data: unknown): boolean {
  if (data == null) return true;
  if (Array.isArray(data)) return data.length === 0;
  if (typeof data === 'string') return data.trim() === '';
  return false;
}

/**
 * Decide which view to render from the raw state. The only place the
 * loading/empty/error/ready precedence is encoded — keep it here so the rule is
 * tested once and obeyed everywhere.
 */
export function resolveView<T>(
  state: AsyncState<T>,
  isEmpty: (data: T) => boolean = defaultIsEmpty,
): AsyncView {
  switch (state.phase) {
    case 'idle':
      return 'idle';
    case 'loading':
      return 'loading';
    case 'error':
      return 'error';
    case 'ready':
      return state.data === undefined || isEmpty(state.data) ? 'empty' : 'ready';
  }
}
