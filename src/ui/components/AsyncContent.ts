/**
 * AsyncContent<T> — the workhorse. Drives a piece of UI through the full
 * lifecycle of a data load: idle → loading → (ready | empty | error), with a
 * built-in retry path. Hand it a `loader` and a `render`; it owns the rest.
 *
 *   const list = new AsyncContent<Settlement[]>({
 *     loader: () => api.fetchSettlements(),
 *     render: (rows) => renderTable(rows),
 *     empty: { title: 'No settlements yet', description: 'Found a town to begin.' },
 *   });
 *   list.mount(panel);
 *   list.load();
 *
 * Accessibility: the content region is an `aria-live` polite area and toggles
 * `aria-busy` during loads, so assistive tech tracks state changes without the
 * caller wiring anything up.
 */
import { Component } from './component';
import { clear } from './dom';
import { createSpinner } from './Spinner';
import { createEmptyState, type EmptyStateProps } from './EmptyState';
import { createErrorState, type ErrorStateProps } from './ErrorState';
import {
  type AsyncState,
  type AsyncView,
  initialState,
  resolveView,
  defaultIsEmpty,
} from './asyncState';

export interface AsyncContentProps<T> {
  /** Produces the data. Stored so the error/retry path can re-invoke it. */
  loader?: () => Promise<T>;
  /** Render the loaded, non-empty data into one or more nodes. */
  render: (data: T) => Node | Node[];
  /** Custom emptiness test (defaults to empty array/string/nullish). */
  isEmpty?: (data: T) => boolean;
  /** Override the loading view (defaults to a centered spinner). */
  loading?: () => Node;
  /** Empty-view content. A factory gets full control; an object configures the default. */
  empty?: EmptyStateProps | (() => Node);
  /** Error-view content. A factory gets the error; an object configures the default. */
  error?: ErrorStateProps | ((error: Error) => Node);
  /** Loading announcement for screen readers. */
  loadingLabel?: string;
}

export class AsyncContent<T> extends Component<AsyncContentProps<T>> {
  private state: AsyncState<T> = initialState<T>();

  protected createRoot(): HTMLElement {
    const root = document.createElement('div');
    root.className = 'c-async';
    root.setAttribute('aria-live', 'polite');
    return root;
  }

  /** Manually push data in (e.g. from a store/subscription rather than a promise). */
  setData(data: T): void {
    this.state = { phase: 'ready', data, error: undefined };
    this.render();
  }

  /** Manually push an error in. */
  setError(error: Error): void {
    this.state = { phase: 'error', data: this.state.data, error };
    this.render();
  }

  /** Force the loading view (e.g. before an external fetch you control). */
  setLoading(): void {
    this.state = { phase: 'loading', data: this.state.data, error: undefined };
    this.render();
  }

  /**
   * Run the configured `loader` (or an override passed here), transitioning
   * loading → ready/error. Safe against races: only the latest call wins.
   */
  async load(loader?: () => Promise<T>): Promise<void> {
    const fn = loader ?? this.props.loader;
    if (!fn) throw new Error('AsyncContent.load() called without a loader');
    this.props.loader = fn;
    const token = ++this.loadToken;
    this.setLoading();
    try {
      const data = await fn();
      if (token !== this.loadToken) return; // superseded by a newer load
      this.setData(data);
    } catch (err) {
      if (token !== this.loadToken) return;
      this.setError(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private loadToken = 0;

  /** The current view the user is seeing — handy for tests and conditionals. */
  get view(): AsyncView {
    return resolveView(this.state, this.props.isEmpty ?? defaultIsEmpty);
  }

  protected render(): void {
    const view = this.view;
    this.el.setAttribute('aria-busy', String(view === 'loading'));
    this.el.dataset.view = view;
    clear(this.el);

    switch (view) {
      case 'idle':
        return; // nothing requested yet — render nothing
      case 'loading':
        this.el.append(this.props.loading?.() ?? createSpinner({ block: true, label: this.props.loadingLabel ?? 'Loading' }));
        return;
      case 'empty':
        this.el.append(this.renderEmpty());
        return;
      case 'error':
        this.el.append(this.renderError());
        return;
      case 'ready': {
        const out = this.props.render(this.state.data as T);
        this.el.append(...(Array.isArray(out) ? out : [out]));
        return;
      }
    }
  }

  private renderEmpty(): Node {
    const e = this.props.empty;
    if (typeof e === 'function') return e();
    return createEmptyState(e ?? { title: 'Nothing here yet' });
  }

  private renderError(): Node {
    const error = this.state.error ?? new Error('Unknown error');
    const e = this.props.error;
    if (typeof e === 'function') return e(error);
    // Default error view auto-wires retry to the stored loader when present.
    return createErrorState({
      message: error.message,
      details: error.stack,
      onRetry: this.props.loader ? () => void this.load() : undefined,
      ...e,
    });
  }
}
