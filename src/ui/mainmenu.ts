/**
 * Main menu for the 4X campaign: boot screen with new game, continue, and classic game options.
 */

export type StartPref = 'river-valley' | 'coastal' | 'highlands' | 'surprise';

interface MenuResult {
  action: 'continue' | 'newgame' | 'classic';
  pref?: StartPref;
}

const SAVE_KEY = 'centuria-4x-save';

function hasSave(): boolean {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw !== null;
  } catch {
    return false;
  }
}

export function showMainMenu(): Promise<MenuResult> {
  return new Promise((resolve) => {
    const container = document.createElement('div');
    container.className = 'cv-main-menu';
    document.body.appendChild(container);

    const dialog = document.createElement('div');
    dialog.className = 'cv-menu-dialog';
    container.appendChild(dialog);

    const title = document.createElement('h1');
    title.className = 'cv-menu-title';
    title.textContent = 'CENTURIA';
    dialog.appendChild(title);

    const subtitle = document.createElement('p');
    subtitle.className = 'cv-menu-subtitle';
    subtitle.textContent = 'A colony-to-nation simulation, 1800–2100';
    dialog.appendChild(subtitle);

    const buttonGroup = document.createElement('div');
    buttonGroup.className = 'cv-menu-buttons';
    dialog.appendChild(buttonGroup);

    // Continue button (if save exists)
    if (hasSave()) {
      const continueBtn = document.createElement('button');
      continueBtn.className = 'cv-menu-btn cv-menu-btn-primary';
      continueBtn.textContent = 'Continue Campaign';
      continueBtn.addEventListener('click', () => {
        container.remove();
        resolve({ action: 'continue' });
      });
      buttonGroup.appendChild(continueBtn);
    }

    // New Game button
    const newGameBtn = document.createElement('button');
    newGameBtn.className = 'cv-menu-btn cv-menu-btn-primary';
    newGameBtn.textContent = 'New Campaign';
    newGameBtn.addEventListener('click', () => {
      showStartPreferences(container, resolve);
    });
    buttonGroup.appendChild(newGameBtn);

    // Classic Game button
    const classicBtn = document.createElement('button');
    classicBtn.className = 'cv-menu-btn cv-menu-btn-secondary';
    classicBtn.textContent = 'Classic Colony (v0.41)';
    classicBtn.addEventListener('click', () => {
      container.remove();
      resolve({ action: 'classic' });
    });
    buttonGroup.appendChild(classicBtn);
  });
}

function showStartPreferences(
  menuContainer: HTMLElement,
  resolve: (result: MenuResult) => void,
): void {
  // Clear the menu dialog
  const dialog = menuContainer.querySelector('.cv-menu-dialog') as HTMLElement;
  if (!dialog) return;
  dialog.innerHTML = '';

  const title = document.createElement('h2');
  title.className = 'cv-menu-title';
  title.textContent = 'Choose Starting Region';
  dialog.appendChild(title);

  const subtitle = document.createElement('p');
  subtitle.className = 'cv-menu-subtitle';
  subtitle.textContent = 'Each terrain type shapes your early strategy';
  dialog.appendChild(subtitle);

  const prefs: Array<{ pref: StartPref; label: string; desc: string }> = [
    {
      pref: 'river-valley',
      label: 'River Valley',
      desc: 'Fertile, defensible. Best for balanced growth.',
    },
    {
      pref: 'coastal',
      label: 'Coastal',
      desc: 'Accessible to trade and fishing. Opens naval routes early.',
    },
    {
      pref: 'highlands',
      label: 'Highlands',
      desc: 'Defensible but isolated. Mining and timber are plentiful.',
    },
    {
      pref: 'surprise',
      label: 'Random',
      desc: 'The gods decide where you land.',
    },
  ];

  const grid = document.createElement('div');
  grid.className = 'cv-pref-grid';
  dialog.appendChild(grid);

  for (const { pref, label, desc } of prefs) {
    const card = document.createElement('div');
    card.className = 'cv-pref-card';
    grid.appendChild(card);

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'startpref';
    radio.value = pref;
    radio.id = `pref-${pref}`;
    radio.className = 'cv-pref-radio';
    radio.checked = pref === 'river-valley'; // default
    card.appendChild(radio);

    const labelEl = document.createElement('label');
    labelEl.htmlFor = `pref-${pref}`;
    labelEl.className = 'cv-pref-label';
    card.appendChild(labelEl);

    const labelTitle = document.createElement('div');
    labelTitle.className = 'cv-pref-label-title';
    labelTitle.textContent = label;
    labelEl.appendChild(labelTitle);

    const labelDesc = document.createElement('div');
    labelDesc.className = 'cv-pref-label-desc';
    labelDesc.textContent = desc;
    labelEl.appendChild(labelDesc);
  }

  const buttonGroup = document.createElement('div');
  buttonGroup.className = 'cv-menu-buttons';
  dialog.appendChild(buttonGroup);

  const backBtn = document.createElement('button');
  backBtn.className = 'cv-menu-btn cv-menu-btn-secondary';
  backBtn.textContent = 'Back';
  backBtn.addEventListener('click', () => {
    // Rebuild main menu screen
    const buildMainMenu = () => {
      dialog.innerHTML = '';
      const t = document.createElement('h1');
      t.className = 'cv-menu-title';
      t.textContent = 'CENTURIA';
      dialog.appendChild(t);

      const s = document.createElement('p');
      s.className = 'cv-menu-subtitle';
      s.textContent = 'A colony-to-nation simulation, 1800–2100';
      dialog.appendChild(s);

      const bg = document.createElement('div');
      bg.className = 'cv-menu-buttons';
      dialog.appendChild(bg);

      if (hasSave()) {
        const cb = document.createElement('button');
        cb.className = 'cv-menu-btn cv-menu-btn-primary';
        cb.textContent = 'Continue Campaign';
        cb.addEventListener('click', () => {
          menuContainer.remove();
          resolve({ action: 'continue' });
        });
        bg.appendChild(cb);
      }

      const nb = document.createElement('button');
      nb.className = 'cv-menu-btn cv-menu-btn-primary';
      nb.textContent = 'New Campaign';
      nb.addEventListener('click', () => {
        showStartPreferences(menuContainer, resolve);
      });
      bg.appendChild(nb);

      const clb = document.createElement('button');
      clb.className = 'cv-menu-btn cv-menu-btn-secondary';
      clb.textContent = 'Classic Colony (v0.41)';
      clb.addEventListener('click', () => {
        menuContainer.remove();
        resolve({ action: 'classic' });
      });
      bg.appendChild(clb);
    };
    buildMainMenu();
  });
  buttonGroup.appendChild(backBtn);

  const startBtn = document.createElement('button');
  startBtn.className = 'cv-menu-btn cv-menu-btn-primary';
  startBtn.textContent = 'Start Campaign';
  startBtn.addEventListener('click', () => {
    const selected = document.querySelector(
      'input[name="startpref"]:checked',
    ) as HTMLInputElement | null;
    if (selected) {
      menuContainer.remove();
      resolve({ action: 'newgame', pref: selected.value as StartPref });
    }
  });
  buttonGroup.appendChild(startBtn);
}
