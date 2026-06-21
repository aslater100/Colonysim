/**
 * Pause Menu — shown when ESC is pressed during gameplay.
 * Allows saving, loading, and returning to title screen.
 */

export interface SaveSlot {
  slot: number;
  timestamp: number;
  regionJson: string;
  description: string;
}

const SAVE_SLOTS_KEY = 'centuria-save-slots';
const MAX_SLOTS = 3;

function getSaveSlots(): SaveSlot[] {
  try {
    const data = localStorage.getItem(SAVE_SLOTS_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function saveSaveSlots(slots: SaveSlot[]): boolean {
  try {
    localStorage.setItem(SAVE_SLOTS_KEY, JSON.stringify(slots));
    return true;
  } catch {
    return false;
  }
}

export class PauseMenu {
  private el: HTMLElement;
  private slots: SaveSlot[] = [];
  private view: 'main' | 'save' | 'load' = 'main';

  onResume: (() => void) | null = null;
  onSave: (() => void) | null = null;
  onQuit: (() => void) | null = null;
  onLoadGame: ((regionJson: string) => void) | null = null;

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'pause-menu hidden';
    root.appendChild(this.el);
    this.el.addEventListener('click', (e) => this.handleClick(e));
  }

  show(): void {
    this.slots = getSaveSlots();
    this.view = 'main';
    this.render();
    this.el.classList.remove('hidden');
  }

  hide(): void {
    this.el.classList.add('hidden');
  }

  saveGame(regionJson: string, description: string): boolean {
    const slots = getSaveSlots();
    const slot: SaveSlot = {
      slot: slots.length < MAX_SLOTS ? slots.length : 0,
      timestamp: Date.now(),
      regionJson,
      description,
    };

    if (slots.length >= MAX_SLOTS) {
      slots.shift(); // remove oldest
    }
    slots.push(slot);
    return saveSaveSlots(slots);
  }

  private handleClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    const action = target.dataset.action;

    if (!action) return;

    switch (action) {
      case 'resume':
        this.hide();
        this.onResume?.();
        break;
      case 'save':
        this.view = 'save';
        this.render();
        break;
      case 'load':
        this.view = 'load';
        this.render();
        break;
      case 'quit':
        this.hide();
        this.onQuit?.();
        break;
      case 'save-slot': {
        const btn = target as HTMLButtonElement;
        btn.disabled = true;
        btn.textContent = 'Saving…';
        this.onSave?.();
        btn.textContent = 'Saved ✓';
        setTimeout(() => { this.view = 'main'; this.render(); }, 800);
        break;
      }
      case 'load-slot': {
        const slotIndex = parseInt(target.dataset.slot || '0');
        const slots = getSaveSlots();
        if (slots[slotIndex]) {
          this.onLoadGame?.(slots[slotIndex].regionJson);
          this.hide();
        }
        break;
      }
      case 'back':
        this.view = 'main';
        this.render();
        break;
    }
  }

  private render(): void {
    this.el.innerHTML = '';

    if (this.view === 'main') {
      this.renderMainMenu();
    } else if (this.view === 'save') {
      this.renderSaveMenu();
    } else if (this.view === 'load') {
      this.renderLoadMenu();
    }
  }

  private renderMainMenu(): void {
    const hasSaves = this.slots.length > 0;
    this.el.innerHTML = `
      <div class="pause-menu-content">
        <h1>Paused</h1>
        <div class="pause-menu-buttons">
          <button data-action="resume" class="pause-btn">Resume Game</button>
          <button data-action="save" class="pause-btn">Save Game</button>
          <button data-action="load" class="pause-btn" ${!hasSaves ? 'disabled' : ''}>Load Game</button>
          <button data-action="quit" class="pause-btn">Return to Menu</button>
        </div>
      </div>
    `;
    this.el.querySelector('button')?.focus();
  }

  private renderSaveMenu(): void {
    const slots = getSaveSlots();
    const slotsList = Array.from({ length: MAX_SLOTS }, (_, i) => {
      const existing = slots[i];
      if (existing) {
        const date = new Date(existing.timestamp).toLocaleString();
        return `<div class="save-slot">
          <button data-action="save-slot" data-slot="${i}" class="slot-btn">
            Slot ${i + 1}: ${date}<br><small>${existing.description}</small>
          </button>
        </div>`;
      }
      return `<div class="save-slot">
        <button data-action="save-slot" data-slot="${i}" class="slot-btn">Slot ${i + 1} (Empty)</button>
      </div>`;
    }).join('');

    this.el.innerHTML = `
      <div class="pause-menu-content">
        <h1>Save Game</h1>
        <div class="save-slots">
          ${slotsList}
        </div>
        <button data-action="back" class="pause-btn back-btn">Back</button>
      </div>
    `;
  }

  private renderLoadMenu(): void {
    const slotsList = this.slots.map((slot, i) => {
      const date = new Date(slot.timestamp).toLocaleString();
      return `<div class="save-slot">
        <button data-action="load-slot" data-slot="${i}" class="slot-btn">
          Slot ${slot.slot + 1}: ${date}<br><small>${slot.description}</small>
        </button>
      </div>`;
    }).join('');

    this.el.innerHTML = `
      <div class="pause-menu-content">
        <h1>Load Game</h1>
        <div class="save-slots">
          ${slotsList || '<p>No saves found</p>'}
        </div>
        <button data-action="back" class="pause-btn back-btn">Back</button>
      </div>
    `;
  }
}
