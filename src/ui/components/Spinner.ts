/**
 * Accessible loading indicator. Announces itself to screen readers via
 * `role="status"` + a visually-hidden label, and honours
 * `prefers-reduced-motion` (the CSS swaps the spin for a gentle pulse).
 */
import { el } from './dom';

export type SpinnerSize = 'sm' | 'md' | 'lg';

export interface SpinnerProps {
  size?: SpinnerSize;
  /** Screen-reader label. Defaults to "Loading". */
  label?: string;
  /** Center the spinner in its container with vertical padding. */
  block?: boolean;
}

export function createSpinner(props: SpinnerProps = {}): HTMLElement {
  const { size = 'md', label = 'Loading', block = false } = props;
  return el(
    'span',
    {
      class: ['c-spinner', `c-spinner--${size}`, block && 'c-spinner--block'],
      aria: { role: 'status', live: 'polite', label },
    },
    [
      el('span', { class: 'c-spinner__ring', aria: { hidden: true } }),
      el('span', { class: 'c-visually-hidden', text: label }),
    ],
  );
}
