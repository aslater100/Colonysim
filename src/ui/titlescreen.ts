interface AudioHandles {
  sfx: { muted: boolean; toggleMuted(): void } | null;
  music: { enabled: boolean; toggle(): void; unlock(): void } | null;
  soundscape: { enabled: boolean; toggle(): void; unlock(): void } | null;
}

export class TitleScreen {
  private el: HTMLElement;
  private view: 'main' | 'options' = 'main';
  private hasSave = false;

  onNewColony: (() => void) | null = null;
  onContinue: (() => void) | null = null;
  onQuit: (() => void) | null = null;

  constructor(root: HTMLElement, private audio: AudioHandles) {
    this.el = document.createElement('div');
    this.el.className = 'title-screen hidden';
    root.appendChild(this.el);
    this.el.addEventListener('mousedown', (e) => this.handleClick(e));
  }

  show(hasSave: boolean): void {
    this.hasSave = hasSave;
    this.view = 'main';
    this.render();
    this.el.classList.remove('hidden');
  }

  hide(): void {
    this.el.classList.add('hidden');
  }

  private render(): void {
    this.el.innerHTML = this.view === 'main' ? this.mainHtml() : this.optionsHtml();
  }

  private mainHtml(): string {
    return `
      <div class="ts-layout">
        <div class="ts-left">
          <div class="ts-brand">
            <h1 class="ts-title">CENTURIA</h1>
            <p class="ts-tagline">Build &nbsp;·&nbsp; Endure &nbsp;·&nbsp; Govern</p>
          </div>
          <blockquote class="ts-quote">
            "A colony is only as strong as the hands willing to work it —<br>
            and the mind willing to lead them."
          </blockquote>
          <p class="ts-version">v0.29.0 &nbsp;·&nbsp; Early Access</p>
        </div>
        <div class="ts-panel">
          <nav class="ts-nav">
            <button class="ts-btn ts-btn-primary" id="ts-new">New Colony</button>
            <button class="ts-btn" id="ts-continue" ${this.hasSave ? '' : 'disabled'}>Continue</button>
            <div class="ts-sep"></div>
            <button class="ts-btn" id="ts-options">Options &nbsp;<span class="ts-arrow">›</span></button>
            <div class="ts-sep"></div>
            <button class="ts-btn ts-btn-quit" id="ts-quit">Quit to Desktop</button>
          </nav>
        </div>
      </div>`;
  }

  private optionsHtml(): string {
    const { sfx, music, soundscape } = this.audio;
    const isFullscreen = !!document.fullscreenElement;
    return `
      <div class="ts-layout">
        <div class="ts-left">
          <div class="ts-brand">
            <h1 class="ts-title">CENTURIA</h1>
            <p class="ts-tagline">Options</p>
          </div>
        </div>
        <div class="ts-panel">
          <nav class="ts-nav">
            <button class="ts-btn ts-btn-back" id="ts-back">‹ &nbsp;Back</button>
            <div class="ts-sep"></div>
            <button class="ts-btn ts-toggle" id="ts-sound">
              <span>Sound Effects</span>
              <span class="ts-val ${sfx?.muted ? 'ts-off' : 'ts-on'}">${sfx?.muted ? 'OFF' : 'ON'}</span>
            </button>
            <button class="ts-btn ts-toggle" id="ts-music">
              <span>Music</span>
              <span class="ts-val ${music?.enabled ? 'ts-on' : 'ts-off'}">${music?.enabled ? 'ON' : 'OFF'}</span>
            </button>
            <button class="ts-btn ts-toggle" id="ts-ambience">
              <span>Ambience</span>
              <span class="ts-val ${soundscape?.enabled ? 'ts-on' : 'ts-off'}">${soundscape?.enabled ? 'ON' : 'OFF'}</span>
            </button>
            <div class="ts-sep"></div>
            <button class="ts-btn ts-toggle" id="ts-fullscreen">
              <span>Display Mode</span>
              <span class="ts-val">${isFullscreen ? 'Fullscreen' : 'Windowed'}</span>
            </button>
          </nav>
        </div>
      </div>`;
  }

  private handleClick(e: MouseEvent): void {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!btn || btn.disabled) return;
    switch (btn.id) {
      case 'ts-new': this.onNewColony?.(); break;
      case 'ts-continue': this.onContinue?.(); break;
      case 'ts-quit': this.onQuit?.(); break;
      case 'ts-options': this.view = 'options'; this.render(); break;
      case 'ts-back': this.view = 'main'; this.render(); break;
      case 'ts-sound':
        this.audio.sfx?.toggleMuted();
        this.render();
        break;
      case 'ts-music':
        this.audio.music?.toggle();
        this.audio.music?.unlock();
        this.render();
        break;
      case 'ts-ambience':
        this.audio.soundscape?.toggle();
        this.audio.soundscape?.unlock();
        this.render();
        break;
      case 'ts-fullscreen':
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen?.().catch(() => {});
        } else {
          document.exitFullscreen?.().catch(() => {});
        }
        this.render();
        break;
    }
  }
}
