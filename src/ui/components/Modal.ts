/**
 * Modal — an accessible dialog. Everything the rest of the game's ad-hoc
 * overlays (.event-modal, .win-modal) re-implement by hand, done once and
 * correctly:
 *
 *   • role="dialog" + aria-modal, labelled by its title
 *   • focus moves into the dialog on open and is restored to the opener on close
 *   • Tab / Shift+Tab are trapped inside the dialog
 *   • Esc closes (opt-out), backdrop click closes (opt-in, default on)
 *   • background page scroll is locked while open
 *   • responsive: sizes cap at the viewport and go full-bleed on small screens
 */
import { Component } from './component';
import { el } from './dom';
import { createButton, type ButtonProps } from './Button';

let modalSeq = 0;

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

export type ModalSize = 'sm' | 'md' | 'lg';

export interface ModalProps {
  title: string;
  /** Body content. */
  content: Node | string;
  /** Footer action buttons, rendered right-aligned. */
  actions?: ButtonProps[];
  size?: ModalSize;
  /** Esc closes the dialog. Default true. */
  closeOnEsc?: boolean;
  /** Clicking the backdrop closes the dialog. Default true. */
  closeOnBackdrop?: boolean;
  /** Show the "✕" close button in the header. Default true. */
  showClose?: boolean;
  /** Called after the dialog closes (any path). */
  onClose?: () => void;
}

export class Modal extends Component<ModalProps> {
  private readonly titleId = `c-modal-title-${++modalSeq}`;
  private dialog!: HTMLElement;
  private bodyEl!: HTMLElement;
  private previouslyFocused: Element | null = null;
  private open = false;

  protected createRoot(): HTMLElement {
    const root = document.createElement('div');
    root.className = 'c-modal-backdrop';
    return root;
  }

  /** Build markup and show. Returns `this` for chaining. */
  show(parent: Node = document.body): this {
    if (this.open) return this;
    this.previouslyFocused = document.activeElement;
    this.mount(parent);
    document.body.classList.add('c-modal-open');
    this.open = true;

    document.addEventListener('keydown', this.onKeydown, true);
    this.focusInitial();
    return this;
  }

  close = (): void => {
    if (!this.open) return;
    this.open = false;
    document.removeEventListener('keydown', this.onKeydown, true);
    document.body.classList.remove('c-modal-open');
    this.destroy();
    (this.previouslyFocused as HTMLElement | null)?.focus?.();
    this.props.onClose?.();
  };

  /** Swap the body content without rebuilding the whole dialog. */
  setContent(content: Node | string): void {
    this.props.content = content;
    this.bodyEl.replaceChildren(typeof content === 'string' ? document.createTextNode(content) : content);
  }

  protected render(): void {
    const { title, content, actions, size = 'md', showClose = true } = this.props;
    this.el.replaceChildren();

    this.bodyEl = el('div', { class: 'c-modal__body' }, [
      typeof content === 'string' ? document.createTextNode(content) : content,
    ]);

    this.dialog = el(
      'div',
      {
        class: ['c-modal', `c-modal--${size}`],
        aria: { role: 'dialog', modal: 'true', labelledby: this.titleId },
      },
      [
        el('div', { class: 'c-modal__header' }, [
          el('h2', { class: 'c-modal__title', attrs: { id: this.titleId }, text: title }),
          showClose &&
            createButton({
              label: '✕', ariaLabel: 'Close dialog', variant: 'ghost', size: 'sm', onClick: this.close,
            }).el,
        ]),
        this.bodyEl,
        actions && actions.length > 0 &&
          el('div', { class: 'c-modal__footer' }, actions.map((a) => createButton(a).el)),
      ],
    );

    this.el.appendChild(this.dialog);

    this.el.addEventListener('mousedown', (e) => {
      if (e.target === this.el && (this.props.closeOnBackdrop ?? true)) this.close();
    });
  }

  private onKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && (this.props.closeOnEsc ?? true)) {
      e.preventDefault();
      this.close();
      return;
    }
    if (e.key === 'Tab') this.trapTab(e);
  };

  /** Keep focus cycling within the dialog. */
  private trapTab(e: KeyboardEvent): void {
    const items = Array.from(this.dialog.querySelectorAll<HTMLElement>(FOCUSABLE))
      .filter((n) => n.offsetParent !== null);
    if (items.length === 0) {
      e.preventDefault();
      this.dialog.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  private focusInitial(): void {
    const target =
      this.dialog.querySelector<HTMLElement>('[autofocus]') ??
      this.dialog.querySelector<HTMLElement>(FOCUSABLE);
    if (target) {
      target.focus();
    } else {
      // Nothing focusable — make the dialog itself focusable so focus lands inside.
      this.dialog.tabIndex = -1;
      this.dialog.focus();
    }
  }
}
