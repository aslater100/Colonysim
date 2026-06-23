/**
 * Reusable UI component library.
 *
 * Importing this barrel also pulls in the component stylesheet (Vite handles
 * the CSS), so consumers only need `import { Modal, AsyncContent } from '.../components'`.
 *
 * Architecture at a glance:
 *   • dom.ts / component.ts ......... foundations (typed element builder + lifecycle base)
 *   • Button / Spinner / EmptyState / ErrorState ... presentational pieces (factory fns)
 *   • AsyncContent .................. container that drives loading/empty/error/ready
 *   • Modal ......................... accessible dialog (focus trap, Esc, restore focus)
 *   • asyncState.ts ................. pure, DOM-free state model (unit-tested)
 */
import './components.css';

export { el, clear, append, replaceChildren } from './dom';
export type { Child, ElAttrs, Listeners } from './dom';

export { Component } from './component';

export { createButton } from './Button';
export type { ButtonProps, ButtonHandle, ButtonVariant, ButtonSize } from './Button';

export { createSpinner } from './Spinner';
export type { SpinnerProps, SpinnerSize } from './Spinner';

export { createEmptyState } from './EmptyState';
export type { EmptyStateProps } from './EmptyState';

export { createErrorState } from './ErrorState';
export type { ErrorStateProps } from './ErrorState';

export { AsyncContent } from './AsyncContent';
export type { AsyncContentProps } from './AsyncContent';

export { Modal } from './Modal';
export type { ModalProps, ModalSize } from './Modal';

export {
  resolveView,
  initialState,
  defaultIsEmpty,
} from './asyncState';
export type { AsyncState, AsyncView, LoadPhase } from './asyncState';
