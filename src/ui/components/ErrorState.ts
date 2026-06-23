/**
 * Error state — shown when a load fails. Uses `role="alert"` so screen readers
 * announce it immediately, offers a retry affordance, and can tuck the raw
 * error text into a collapsible `<details>` so it's available without shouting.
 */
import { el } from './dom';
import { createButton } from './Button';

export interface ErrorStateProps {
  /** Headline. Defaults to "Something went wrong". */
  title?: string;
  /** Human-readable explanation. */
  message?: string;
  /** Technical detail (stack/raw message) hidden behind a disclosure. */
  details?: string;
  icon?: string | Node;
  /** Wires up a "Try again" button when provided. */
  onRetry?: () => void;
  /** Retry button label. Defaults to "Try again". */
  retryLabel?: string;
}

export function createErrorState(props: ErrorStateProps = {}): HTMLElement {
  const {
    title = 'Something went wrong',
    message,
    details,
    icon = '⚠️',
    onRetry,
    retryLabel = 'Try again',
  } = props;

  return el(
    'div',
    { class: 'c-state c-state--error', aria: { role: 'alert', live: 'assertive' } },
    [
      icon != null &&
        el('div', { class: 'c-state__icon', aria: { hidden: true } }, typeof icon === 'string' ? icon : [icon]),
      el('p', { class: 'c-state__title', text: title }),
      message && el('p', { class: 'c-state__desc', text: message }),
      details &&
        el('details', { class: 'c-state__details' }, [
          el('summary', { text: 'Details' }),
          el('pre', { class: 'c-state__pre', text: details }),
        ]),
      onRetry &&
        el('div', { class: 'c-state__actions' }, [
          createButton({ label: retryLabel, variant: 'primary', size: 'sm', icon: '↻', onClick: () => onRetry() }).el,
        ]),
    ],
  );
}
