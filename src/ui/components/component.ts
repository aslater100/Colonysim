/**
 * Minimal lifecycle base for stateful container components (AsyncContent,
 * Modal). Presentational pieces (Button, Spinner, EmptyState, ErrorState) are
 * plain factory functions instead — they have no internal state worth a class.
 *
 * Architecture: one stable root element per component. `render()` paints into
 * that root; `setProps()` patches props and repaints. The root reference never
 * changes, so parents can hold onto `component.el` safely across updates.
 */

export abstract class Component<P extends object = Record<string, never>> {
  /** Stable root node — safe to insert once and keep referencing. */
  readonly el: HTMLElement;
  protected props: P;
  private didMount = false;

  constructor(props: P, root?: HTMLElement) {
    this.props = props;
    this.el = root ?? this.createRoot();
  }

  /** Override to change the root tag/class. Defaults to a plain `<div>`. */
  protected createRoot(): HTMLElement {
    return document.createElement('div');
  }

  /** Paint the component's current props into `this.el`. */
  protected abstract render(): void;

  /** Insert into the DOM and perform the first render. */
  mount(parent: Node): this {
    parent.appendChild(this.el);
    this.render();
    this.didMount = true;
    this.onMount();
    return this;
  }

  /** Merge a prop patch and repaint (only if already mounted). */
  setProps(patch: Partial<P>): void {
    Object.assign(this.props, patch);
    if (this.didMount) this.render();
  }

  /** Remove from the DOM and run teardown (event listeners, timers, etc.). */
  destroy(): void {
    this.onDestroy();
    this.el.remove();
    this.didMount = false;
  }

  /** Hook: called once after the first mount. */
  protected onMount(): void {}

  /** Hook: called on destroy — unbind anything bound in `onMount`. */
  protected onDestroy(): void {}
}
