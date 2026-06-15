/**
 * Minimal draggable window manager. Any registered panel becomes draggable
 * (grab anywhere that isn't an interactive control), raises to the top on
 * focus, and remembers its position in localStorage.
 *
 * ponytail: drag-from-background instead of injected title bars — the panels
 * are mostly read-only displays, so we just exclude buttons/inputs from the
 * grab. Add a real title bar only if a panel turns into a dense form.
 */

interface WindowConfig {
  id: string;
  element: HTMLElement;
  baseZ: number;
}

// Don't start a drag when the press lands on something interactive.
const NO_DRAG = 'button, input, select, textarea, a, [data-action], .prio, .trade-btn, .trade-bulk, .sell-cash-btn, .sell-bulk, .buy-cash-btn';

const STORAGE_KEY = 'centuria_windows';
const FOCUS_Z = 1000;

export class WindowManager {
  private windows = new Map<string, WindowConfig>();
  private dragId: string | null = null;
  private dragDX = 0;
  private dragDY = 0;
  private focusId: string | null = null;
  private positions: Record<string, { x: number; y: number }>;

  constructor(configs: WindowConfig[] = []) {
    this.positions = this.load();
    for (const cfg of configs) this.register(cfg);
    document.addEventListener('mousedown', (e) => this.onDown(e), true);
    document.addEventListener('mousemove', (e) => this.onMove(e));
    document.addEventListener('mouseup', () => this.onUp());
  }

  /** Make a panel draggable. Safe to call after construction (region panels). */
  register(cfg: WindowConfig): void {
    this.windows.set(cfg.id, cfg);
    cfg.element.dataset.windowId = cfg.id;
    cfg.element.style.zIndex = String(cfg.baseZ);
    // Restore a saved drag position; otherwise leave the CSS anchor alone.
    const pos = this.positions[cfg.id];
    if (pos) this.placeAt(cfg.element, pos.x, pos.y);
  }

  /** Convert a panel to left/top anchoring at a screen position. */
  private placeAt(el: HTMLElement, x: number, y: number): void {
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    el.style.transform = 'none';
  }

  private onDown(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    const el = target.closest<HTMLElement>('[data-window-id]');
    if (!el) return;
    const id = el.dataset.windowId!;
    this.raise(id);
    // Only the background (not controls) starts a drag.
    if (target.closest(NO_DRAG)) return;
    const rect = el.getBoundingClientRect();
    this.dragId = id;
    this.dragDX = e.clientX - rect.left;
    this.dragDY = e.clientY - rect.top;
    el.style.cursor = 'grabbing';
    e.preventDefault();
  }

  private onMove(e: MouseEvent): void {
    if (!this.dragId) return;
    const cfg = this.windows.get(this.dragId);
    if (!cfg) return;
    const w = cfg.element.offsetWidth;
    const h = cfg.element.offsetHeight;
    const x = Math.max(0, Math.min(e.clientX - this.dragDX, window.innerWidth - Math.min(w, 80)));
    const y = Math.max(0, Math.min(e.clientY - this.dragDY, window.innerHeight - Math.min(h, 40)));
    this.placeAt(cfg.element, x, y);
  }

  private onUp(): void {
    if (!this.dragId) return;
    const cfg = this.windows.get(this.dragId);
    if (cfg) {
      cfg.element.style.cursor = '';
      const rect = cfg.element.getBoundingClientRect();
      this.positions[this.dragId] = { x: rect.left, y: rect.top };
      this.save();
    }
    this.dragId = null;
  }

  /** Bring a window to the front; restore the previously focused one's z. */
  private raise(id: string): void {
    if (this.focusId === id) return;
    if (this.focusId) {
      const prev = this.windows.get(this.focusId);
      if (prev) prev.element.style.zIndex = String(prev.baseZ);
    }
    const cfg = this.windows.get(id);
    if (cfg) cfg.element.style.zIndex = String(FOCUS_Z);
    this.focusId = id;
  }

  private load(): Record<string, { x: number; y: number }> {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch {
      return {};
    }
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.positions));
    } catch { /* private mode / quota — positions just won't persist */ }
  }
}
