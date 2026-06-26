import './style.css';
import { RegionSim } from './sim/region';
import { RegionView } from './ui/regionview';
import { WindowManager } from './ui/WindowManager';
import { Sfx } from './ui/audio';
import { Music } from './ui/music';
import { Soundscape } from './ui/soundscape';
import { DesignScreen } from './ui/designscreen';
import { TitleScreen } from './ui/titlescreen';
import { PauseMenu } from './ui/pausemenu';
import { TICKS_PER_SECOND } from './sim/defs';
import type { ScenarioSelection } from './ui/titlescreen';

const root = document.getElementById('app')!;
const canvas = document.createElement('canvas');
canvas.id = 'game';
root.appendChild(canvas);

const MINIMAP_W = 160;
const MINIMAP_H = 120;
const minimapCanvas = document.createElement('canvas');
minimapCanvas.id = 'minimap';
minimapCanvas.width = MINIMAP_W;
minimapCanvas.height = MINIMAP_H;
root.appendChild(minimapCanvas);

const SAVE_KEY = 'centuria-save';

function bootSim(): RegionSim | null {
  try {
    const pending = sessionStorage.getItem('centuria-load-on-boot');
    if (pending) {
      sessionStorage.removeItem('centuria-load-on-boot');
      const data = localStorage.getItem(SAVE_KEY);
      if (data) {
        const d = JSON.parse(data);
        if (d.v === 4 && d.region) {
          return RegionSim.deserialize(d.region);
        }
      }
    }
  } catch (err) {
    console.error('load failed, starting fresh:', err);
  }
  return null;
}

function resize(): void {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const g = canvas.getContext('2d')!;
  g.imageSmoothingEnabled = false;
}
resize();
window.addEventListener('resize', resize);

const sfx = new Sfx();
const music = new Music();
const soundscape = new Soundscape();
window.addEventListener('mousedown', () => { sfx.unlock(); music.unlock(); soundscape.unlock(); }, { once: true });
window.addEventListener('keydown', () => { sfx.unlock(); music.unlock(); soundscape.unlock(); }, { once: true });

let region: RegionSim | null = bootSim();
let regionView: RegionView | null = null;
let paused = false;
let speed = 1;
let pauseMenuOpen = false;

function updateUIState(): void {
  (window as any).gameSpeed = speed;
  (window as any).gamePaused = paused;
}
updateUIState();

const titleScreen = new TitleScreen(root, { sfx, music, soundscape });
const pauseMenu = new PauseMenu(root);
const fpsDiv = document.createElement('div');
fpsDiv.id = 'fps';
fpsDiv.style.cssText = 'position:fixed;bottom:4px;left:4px;font:10px monospace;color:#888;pointer-events:none;';
root.appendChild(fpsDiv);

function save(): boolean {
  if (!region) return false;
  try {
    const regionJson = region.serialize();
    localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 4, region: regionJson }));
    // Also save to pause menu slots
    const year = region.minute / (60 * 24 * 365);
    const description = `Year ${Math.floor(year)}, ${region.settlements.length} settlements`;
    pauseMenu.saveGame(regionJson, description);
    return true;
  } catch (err) {
    console.error('save failed:', err);
    return false;
  }
}

function enterRegionMode(r: RegionSim): void {
  region = r;
  (window as any).region = r;
  regionView = new RegionView(canvas, r, root);
  new WindowManager(regionView.draggablePanels);
  paused = false;
  updateUIState();
  titleScreen.hide();
}

function showTitleScreen(): void {
  paused = true;
  const hasSave = localStorage.getItem(SAVE_KEY) !== null;
  titleScreen.show(hasSave);
}

titleScreen.onNewColony = () => {
  new DesignScreen().showRegionDesign((design) => {
    const r = RegionSim.create(Date.now() % 100000, design);
    enterRegionMode(r);
  });
};
titleScreen.onBeginScenario = (sel: ScenarioSelection) => {
  const seed = Date.now() % 100000;
  if (sel.eraStart === '1919' && !sel.scenarioId) {
    // Sandbox 1919: standard new colony flow
    const r = RegionSim.create(seed, {});
    enterRegionMode(r);
  } else if (sel.eraStart === '1919') {
    // 1919 scenario: standard colony but with scenario wired
    const r = RegionSim.create(seed, {});
    r.activeScenario = sel.scenarioId;
    enterRegionMode(r);
  } else {
    // Era start: 1950 or 2000
    const r = RegionSim.fromEraStart(sel.eraStart as '1950' | '2000', {
      seed,
      scenarioId: sel.scenarioId ?? undefined,
    });
    enterRegionMode(r);
  }
};
titleScreen.onContinue = () => {
  sessionStorage.setItem('centuria-load-on-boot', '1');
  location.reload();
};
titleScreen.onQuit = () => window.close();

pauseMenu.onResume = () => {
  pauseMenuOpen = false;
  paused = false;
  updateUIState();
};
pauseMenu.onSave = () => { save(); };
pauseMenu.onQuit = () => {
  pauseMenuOpen = false;
  showTitleScreen();
};
pauseMenu.onLoadGame = (regionJson: string) => {
  try {
    const loaded = RegionSim.deserialize(regionJson);
    pauseMenuOpen = false;
    enterRegionMode(loaded);
  } catch (err) {
    console.error('failed to load game:', err);
  }
};

if (region) {
  enterRegionMode(region);
} else {
  showTitleScreen();
}

// ---- input ----
const keys = new Set<string>();

window.addEventListener('keydown', (e) => {
  keys.add(e.key);
  // A cinematic is playing: any key skips it and consumes the event.
  if (regionView?.isCinematicPlaying()) { regionView.skipCinematic(); e.preventDefault(); return; }
  if (e.key === ' ') {
    if (!pauseMenuOpen) {
      paused = !paused;
      updateUIState();
    }
    e.preventDefault();
    return;
  }
  if (e.key === '1') { speed = 1; updateUIState(); }
  if (e.key === '2') { speed = 3; updateUIState(); }
  if (e.key === '3') { speed = 8; updateUIState(); }
  if ((e.key === '+' || e.key === '=') && regionView) { regionView.zoomAt(canvas.width / 2, canvas.height / 2, 1); e.preventDefault(); return; }
  if (e.key === '-' && regionView) { regionView.zoomAt(canvas.width / 2, canvas.height / 2, -1); e.preventDefault(); return; }
  if (e.key === 's' && e.ctrlKey) { save(); e.preventDefault(); return; }
  if (e.key === 'Escape') {
    if (pauseMenuOpen) {
      pauseMenuOpen = false;
      pauseMenu.hide();
      paused = false;
      updateUIState();
    } else if (regionView && !regionView.ceremonyOpen) {
      pauseMenuOpen = true;
      paused = true;
      updateUIState();
      pauseMenu.show();
    }
    e.preventDefault();
    return;
  }
  if (regionView && !pauseMenuOpen) {
    if (e.key === 't' || e.key === 'T') { regionView.researchOpen = !regionView.researchOpen; e.preventDefault(); return; }
    if (e.key === 'p' || e.key === 'P') { regionView.toggleProvinceView(); e.preventDefault(); return; }
    if ((e.key === 'b' || e.key === 'B') && region?.hasCentralBank()) {
      regionView.centralBankOpen = !regionView.centralBankOpen; e.preventDefault(); return;
    }
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.key));


const regionDrag = { active: false, lastX: 0, lastY: 0, moved: 0 };

canvas.addEventListener('mousemove', (e) => {
  if (regionDrag.active && e.buttons === 1 && regionView) {
    const dx = e.clientX - regionDrag.lastX;
    const dy = e.clientY - regionDrag.lastY;
    regionDrag.lastX = e.clientX;
    regionDrag.lastY = e.clientY;
    regionDrag.moved += Math.abs(dx) + Math.abs(dy);
    regionView.panBy(dx, dy);
  }
});

canvas.addEventListener('mousedown', (e) => {
  if (regionView) {
    regionDrag.active = true;
    regionDrag.lastX = e.clientX;
    regionDrag.lastY = e.clientY;
    regionDrag.moved = 0;
  }
});

window.addEventListener('mouseup', () => { regionDrag.active = false; });

canvas.addEventListener('click', (e) => {
  if (regionDrag.moved < 5) regionView?.click(e.clientX, e.clientY);
});

canvas.addEventListener('wheel', (e) => {
  if (regionView) {
    const dir = e.deltaY < 0 ? 1 : -1;
    regionView.zoomAt(e.clientX, e.clientY, dir);
    e.preventDefault();
  }
});

// ---- main loop ----
let acc = 0;
let last = performance.now();
let frameMsEma = 16.7;

function loop(now: number): void {
  const rawMs = now - last;
  // Soft-cap at ~70 FPS: skip render if frame arrived too soon (120 Hz+).
  if (rawMs < 14) { requestAnimationFrame(loop); return; }
  const dt = Math.min(0.25, rawMs / 1000);
  last = now;
  if (rawMs > 0 && rawMs < 1000) frameMsEma += (rawMs - frameMsEma) * 0.1;

  // Arrow/WASD pan
  void dt; // pan not yet implemented in RegionView

  if (!paused && region && regionView) {
    acc += dt * TICKS_PER_SECOND * speed;
    let guard = 0;
    while (acc >= 1 && guard++ < 64) {
      if (!regionView.ceremonyOpen) region.tick();
      acc -= 1;
    }
  }

  if (region && regionView) {
    regionView.draw();
    minimapCanvas.classList.add('hidden');
  }

  const year = region?.year ?? 1900;
  // Dynamic mixing: feed real war/unrest/crisis tension to music + soundscape
  // (was hardcoded 0). null region (title screen) is calm.
  const tension = region ? region.tensionScalar() : 0;
  music.update({ year, paused, tension });

  soundscape.update({
    mode: 'region',
    paused,
    year,
    activeBuildWorkers: 0,
    activeRailRoutes: region ? region.activeRailRoutes : 0,
    maxGrievance: region ? region.maxGrievance : 0,
    tension,
  });

  const fps = Math.round(1000 / frameMsEma);
  fpsDiv.textContent = `${fps} fps`;

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
