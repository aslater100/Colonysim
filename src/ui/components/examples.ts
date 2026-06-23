/**
 * Usage gallery for the component library. Not wired into the game — it's a
 * living reference you can mount anywhere to see every component and state.
 *
 *   import { mountComponentGallery } from './ui/components/examples';
 *   mountComponentGallery(document.getElementById('app')!);
 */
import {
  AsyncContent,
  Modal,
  createButton,
  createEmptyState,
  createErrorState,
  createSpinner,
  el,
} from './index';

interface Settlement { name: string; pop: number; }

/** Stand-in for a real data source; flips between success/empty/failure. */
function fakeFetch(outcome: 'ok' | 'empty' | 'fail', delay = 700): Promise<Settlement[]> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (outcome === 'fail') reject(new Error('Network unreachable (simulated)'));
      else if (outcome === 'empty') resolve([]);
      else resolve([{ name: 'Aldermoor', pop: 1240 }, { name: 'Brixfen', pop: 880 }]);
    }, delay);
  });
}

function settlementTable(rows: Settlement[]): HTMLElement {
  return el(
    'ul',
    { class: 'demo-list' },
    rows.map((r) => el('li', {}, `${r.name} — ${r.pop.toLocaleString()} pop`)),
  );
}

export function mountComponentGallery(parent: HTMLElement): void {
  const root = el('div', { class: 'cv-app', style: { padding: '24px', display: 'grid', gap: '24px' } });
  parent.appendChild(root);

  // --- Buttons -------------------------------------------------------------
  const buttons = createButton({ label: 'Save', variant: 'primary', icon: '💾', onClick: () => alert('Saved') });
  const loadingBtn = createButton({ label: 'Load more', onClick: () => {
    loadingBtn.setLoading(true);
    setTimeout(() => loadingBtn.setLoading(false), 1200);
  } });
  root.append(
    section('Buttons', [
      buttons.el,
      loadingBtn.el,
      createButton({ label: 'Delete', variant: 'danger', onClick: () => {} }).el,
      createButton({ label: 'Cancel', variant: 'ghost', onClick: () => {} }).el,
      createButton({ label: 'Disabled', disabled: true }).el,
    ]),
  );

  // --- Standalone states ---------------------------------------------------
  root.append(
    section('States', [
      createSpinner({ block: true }),
      createEmptyState({
        icon: '🏘️',
        title: 'No settlements yet',
        description: 'Found your first town to start building a nation.',
        action: { label: 'Found a town', variant: 'primary', onClick: () => {} },
      }),
      createErrorState({
        message: 'Could not load the economy report.',
        details: 'TypeError: cannot read property "gdp" of undefined',
        onRetry: () => alert('Retrying…'),
      }),
    ]),
  );

  // --- AsyncContent: the full lifecycle, driven by buttons -----------------
  const asyncList = new AsyncContent<Settlement[]>({
    render: settlementTable,
    empty: { icon: '🗺️', title: 'No settlements', description: 'Nothing has been founded here.' },
    loadingLabel: 'Loading settlements',
  });
  const controls = el('div', { style: { display: 'flex', gap: '8px', marginBottom: '8px' } }, [
    createButton({ label: 'Load (ok)', size: 'sm', onClick: () => void asyncList.load(() => fakeFetch('ok')) }).el,
    createButton({ label: 'Load (empty)', size: 'sm', onClick: () => void asyncList.load(() => fakeFetch('empty')) }).el,
    createButton({ label: 'Load (fail)', size: 'sm', onClick: () => void asyncList.load(() => fakeFetch('fail')) }).el,
  ]);
  const asyncSection = section('AsyncContent', [controls]);
  asyncList.mount(asyncSection);
  root.append(asyncSection);

  // --- Modal ---------------------------------------------------------------
  root.append(
    section('Modal', [
      createButton({
        label: 'Open dialog',
        variant: 'primary',
        onClick: () => {
          const modal = new Modal({
            title: 'Sign the peace treaty?',
            content: el('p', {}, 'This ends the war with Brixfen and freezes the current border for 10 years.'),
            actions: [
              { label: 'Not now', variant: 'ghost', onClick: () => modal.close() },
              { label: 'Sign treaty', variant: 'primary', onClick: () => modal.close() },
            ],
          });
          modal.show();
        },
      }).el,
    ]),
  );
}

function section(title: string, children: Node[]): HTMLElement {
  return el('section', {}, [
    el('h3', { text: title, style: { margin: '0 0 8px', color: '#6366f1' } }),
    el('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' } }, children),
  ]);
}
