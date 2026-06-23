/**
 * Button — a native `<button>` (so keyboard, focus, and Enter/Space come for
 * free) wrapped in a typed factory with a small mutation handle.
 *
 * Variants/sizes map to the project's indigo theme. The `loading` state swaps
 * the label for a spinner, sets `aria-busy`, and disables interaction without
 * collapsing the button's width (no layout jump).
 */
import { el } from './dom';
import { createSpinner } from './Spinner';

export type ButtonVariant = 'primary' | 'default' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  label: string;
  onClick?: (ev: MouseEvent) => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  /** Leading icon (emoji/glyph or any node). */
  icon?: string | Node;
  /** Native button type; defaults to "button" so it never submits by surprise. */
  type?: 'button' | 'submit' | 'reset';
  /** Stretch to the container width. */
  fullWidth?: boolean;
  /** Accessible name when the label is an icon/glyph only. */
  ariaLabel?: string;
  /** Native tooltip. */
  title?: string;
}

export interface ButtonHandle {
  readonly el: HTMLButtonElement;
  setLoading(loading: boolean): void;
  setDisabled(disabled: boolean): void;
  setLabel(label: string): void;
}

export function createButton(props: ButtonProps): ButtonHandle {
  const {
    label, onClick, variant = 'default', size = 'md',
    disabled = false, loading = false, icon, type = 'button',
    fullWidth = false, ariaLabel, title,
  } = props;

  const labelSpan = el('span', { class: 'c-btn__label', text: label });

  const button = el('button', {
    class: ['c-btn', `c-btn--${variant}`, `c-btn--${size}`, fullWidth && 'c-btn--block'],
    attrs: { type, title },
    aria: { label: ariaLabel, busy: loading || undefined },
    on: {
      click: (ev) => {
        if (button.disabled || button.dataset.loading === 'true') return;
        onClick?.(ev);
      },
    },
  });

  if (icon != null) {
    button.appendChild(
      el('span', { class: 'c-btn__icon', aria: { hidden: true } }, typeof icon === 'string' ? icon : [icon]),
    );
  }
  button.appendChild(labelSpan);

  const handle: ButtonHandle = {
    el: button,
    setLoading(next) {
      button.dataset.loading = String(next);
      button.disabled = next || button.dataset.disabled === 'true';
      button.setAttribute('aria-busy', String(next));
      const existing = button.querySelector('.c-spinner');
      if (next && !existing) {
        button.insertBefore(createSpinner({ size: 'sm', label: 'Working' }), labelSpan);
      } else if (!next && existing) {
        existing.remove();
      }
    },
    setDisabled(next) {
      button.dataset.disabled = String(next);
      button.disabled = next || button.dataset.loading === 'true';
    },
    setLabel(next) {
      labelSpan.textContent = next;
    },
  };

  if (disabled) handle.setDisabled(true);
  if (loading) handle.setLoading(true);
  return handle;
}
