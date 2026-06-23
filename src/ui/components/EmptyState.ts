/**
 * Empty state — shown when a load succeeds but there is nothing to display
 * (no settlements yet, no trade routes, an empty search). Communicates "this is
 * fine, here's what to do next" rather than leaving a blank panel.
 */
import { el } from './dom';
import { createButton, type ButtonProps } from './Button';

export interface EmptyStateProps {
  title: string;
  /** Supporting line explaining the emptiness or suggesting a next step. */
  description?: string;
  /** Decorative glyph (emoji) or node shown above the title. */
  icon?: string | Node;
  /** Optional call-to-action button. */
  action?: ButtonProps;
}

export function createEmptyState(props: EmptyStateProps): HTMLElement {
  const { title, description, icon, action } = props;
  return el(
    'div',
    { class: 'c-state c-state--empty', aria: { role: 'status', live: 'polite' } },
    [
      icon != null &&
        el('div', { class: 'c-state__icon', aria: { hidden: true } }, typeof icon === 'string' ? icon : [icon]),
      el('p', { class: 'c-state__title', text: title }),
      description && el('p', { class: 'c-state__desc', text: description }),
      action && el('div', { class: 'c-state__actions' }, [createButton(action).el]),
    ],
  );
}
