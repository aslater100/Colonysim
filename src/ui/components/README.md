# UI Component Library

Reusable, framework-free UI primitives for CENTURIA's DOM/HUD layer. Built in
the same vanilla-TypeScript idiom as the rest of `src/ui/`, themed to match the
existing indigo glass aesthetic, and designed to cover the states real UIs hit:
**loading, empty, error, and ready** — with accessibility and keyboard support
baked in rather than bolted on.

```ts
import { Modal, AsyncContent, createButton } from './ui/components';
```

Importing the barrel also loads the component CSS (Vite handles it).

## Architecture

The library separates **presentational pieces** from **stateful containers**:

| Layer | Files | Shape | Why |
|-------|-------|-------|-----|
| Foundations | `dom.ts`, `component.ts` | `el()` builder, `Component` base | Typed DOM, one stable root per component, predictable lifecycle |
| Presentational | `Button`, `Spinner`, `EmptyState`, `ErrorState` | factory functions → `HTMLElement` / handle | No internal state; cheap to create, easy to compose |
| Containers | `AsyncContent`, `Modal` | classes extending `Component` | Own state, events, focus, and teardown |
| State model | `asyncState.ts` | pure functions | DOM-free, unit-tested precedence rules |

Presentational components are functions because they have nothing to manage
after creation. Containers are classes because they own a lifecycle (loads,
focus traps, listeners) that needs `mount`/`destroy`.

### Why a typed `el()` instead of `innerHTML`

The legacy panels build markup with template strings and `innerHTML`. That is
fine for static copy but unsafe for runtime values and clumsy for events.
`el(tag, attrs, children)` is just as terse, escapes text by default, and binds
listeners directly:

```ts
el('button', { class: 'c-btn', aria: { label: 'Close' }, on: { click: onClose } }, '✕');
```

## Components

### `createButton(props): ButtonHandle`

Native `<button>` (free keyboard + focus) with variants, sizes, and a
non-collapsing loading state.

```ts
const save = createButton({ label: 'Save', variant: 'primary', icon: '💾', onClick: doSave });
panel.appendChild(save.el);
save.setLoading(true);   // shows spinner, sets aria-busy, blocks clicks
save.setDisabled(false);
save.setLabel('Saved');
```

Props: `label`, `onClick`, `variant` (`primary | default | danger | ghost`),
`size` (`sm | md | lg`), `disabled`, `loading`, `icon`, `type`, `fullWidth`,
`ariaLabel`, `title`.

### `createSpinner(props?): HTMLElement`

`role="status"` loading indicator with a visually-hidden label. Honours
`prefers-reduced-motion` (pulse instead of spin). Props: `size`, `label`, `block`.

### `createEmptyState(props): HTMLElement`

For successful-but-empty results. `role="status"`. Props: `title`,
`description`, `icon`, `action` (a `ButtonProps` CTA).

### `createErrorState(props): HTMLElement`

For failures. `role="alert"` (announced immediately), optional collapsible
`details`, and a retry button. Props: `title`, `message`, `details`, `icon`,
`onRetry`, `retryLabel`.

### `AsyncContent<T>`

The workhorse. Drives one region through `idle → loading → ready | empty | error`
with built-in retry and race-safety (only the latest `load()` wins).

```ts
const list = new AsyncContent<Settlement[]>({
  loader: () => api.fetchSettlements(),
  render: (rows) => renderTable(rows),
  empty: { icon: '🗺️', title: 'No settlements yet', description: 'Found a town to begin.' },
  // error view auto-wires "Try again" to loader when omitted
});
list.mount(panel);
list.load();               // or list.setData(...) / list.setError(...) for push-based stores
```

The container is an `aria-live` region and toggles `aria-busy` during loads.
`list.view` exposes the current `AsyncView` for tests/conditionals.

### `Modal`

Accessible dialog. One correct implementation of what the ad-hoc `.event-modal`
/ `.win-modal` overlays each hand-roll:

- `role="dialog"` + `aria-modal`, labelled by its title
- focus moves in on open, **restored to the opener on close**
- **Tab / Shift+Tab trapped** inside the dialog
- **Esc** closes (opt-out via `closeOnEsc: false`)
- backdrop click closes (opt-out via `closeOnBackdrop: false`)
- background scroll locked; responsive (full-width sheet under 600px)

```ts
const modal = new Modal({
  title: 'Sign the peace treaty?',
  content: el('p', {}, 'This ends the war and freezes the border for 10 years.'),
  actions: [
    { label: 'Not now', variant: 'ghost', onClick: () => modal.close() },
    { label: 'Sign treaty', variant: 'primary', onClick: () => modal.close() },
  ],
});
modal.show();
```

## Accessibility & keyboard summary

| Concern | How it's handled |
|---------|------------------|
| Loading announced | `role="status"` + `aria-busy` on `AsyncContent` |
| Errors announced | `role="alert"` on the error state |
| Focus management | Modal traps Tab, restores focus to opener on close |
| Keyboard actions | Native `<button>`s; Esc closes modals |
| Reduced motion | Spinner pulses; modal/button animations disabled |
| Visible focus | Consistent `:focus-visible` ring on all interactives |
| Color independence | States pair color with icon + text, never color alone |

## Responsive

- Modals cap at the viewport and become a bottom sheet (`< 600px`), with
  stacked full-width footer buttons.
- State blocks center and constrain line length (`max-width` in `ch`).
- Buttons support `fullWidth` for narrow containers.

## Testing

`asyncState.ts` is intentionally DOM-free so the loading/empty/error/ready
precedence is unit-tested in the existing node/vitest harness — see
`tests/components-async.test.ts`. Run with `npm test`.

## Live gallery

`examples.ts` exports `mountComponentGallery(parent)` — mount it to eyeball
every component and drive `AsyncContent` through all of its states.
