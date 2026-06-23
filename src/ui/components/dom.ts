/**
 * Tiny typed DOM builder shared by every component in this library.
 *
 * The rest of the codebase builds UI by hand-writing HTML strings and calling
 * `innerHTML` (see WikiPanel). That is fine for static content but unsafe for
 * anything carrying user/runtime text and awkward for wiring events. `el()`
 * gives us the same terseness with type-checked tags, structured attributes,
 * and direct event binding — no string concatenation, no XSS foot-guns.
 */

export type Falsy = false | null | undefined;
export type Child = Node | string | number | Falsy;

/** Map of DOM events to typed listeners, e.g. `{ click: (e) => ... }`. */
export type Listeners = {
  [K in keyof HTMLElementEventMap]?: (ev: HTMLElementEventMap[K]) => void;
};

export interface ElAttrs {
  /** Space-separated class list. Falsy entries in an array are dropped. */
  class?: string | (string | Falsy)[];
  /** Text content (escaped by the DOM — safe for runtime values). */
  text?: string;
  /** Raw HTML. Only pass trusted, static markup. */
  html?: string;
  /** `data-*` attributes. */
  dataset?: Record<string, string>;
  /** Plain attributes. `true` adds a bare attribute, `false`/`undefined` removes it. */
  attrs?: Record<string, string | number | boolean | undefined>;
  /** `aria-*` attributes plus `role`, written without the `aria-` prefix (except `role`). */
  aria?: Record<string, string | number | boolean | undefined>;
  /** Inline styles. */
  style?: Partial<CSSStyleDeclaration>;
  /** Event listeners. */
  on?: Listeners;
}

function toClass(value: ElAttrs['class']): string {
  if (Array.isArray(value)) return value.filter(Boolean).join(' ');
  return value ?? '';
}

/**
 * Create an element. Children may be nodes, strings, numbers, or falsy
 * (falsy children are skipped, so `cond && el(...)` works inline).
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: ElAttrs = {},
  children: Child | Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  const cls = toClass(attrs.class);
  if (cls) node.className = cls;
  if (attrs.text != null) node.textContent = attrs.text;
  if (attrs.html != null) node.innerHTML = attrs.html;

  if (attrs.dataset) {
    for (const [k, v] of Object.entries(attrs.dataset)) node.dataset[k] = v;
  }
  if (attrs.attrs) {
    for (const [k, v] of Object.entries(attrs.attrs)) setAttr(node, k, v);
  }
  if (attrs.aria) {
    for (const [k, v] of Object.entries(attrs.aria)) {
      setAttr(node, k === 'role' ? 'role' : `aria-${k}`, v);
    }
  }
  if (attrs.style) Object.assign(node.style, attrs.style);
  if (attrs.on) {
    for (const [type, fn] of Object.entries(attrs.on)) {
      node.addEventListener(type, fn as EventListener);
    }
  }

  append(node, Array.isArray(children) ? children : [children]);
  return node;
}

function setAttr(node: HTMLElement, name: string, value: string | number | boolean | undefined): void {
  if (value === false || value == null) node.removeAttribute(name);
  else if (value === true) node.setAttribute(name, '');
  else node.setAttribute(name, String(value));
}

/** Append a list of children, skipping falsy entries. */
export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === false || child == null) continue;
    parent.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
}

/** Remove every child of a node. Faster and safer than `innerHTML = ''`. */
export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** Replace a node's children with new ones in a single pass. */
export function replaceChildren(node: Element, ...children: Child[]): void {
  clear(node);
  append(node, children);
}
