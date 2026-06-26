/**
 * Diegetic soundscape — ambient layers under the music (GDD §3.3).
 *
 * "Soundscape is diegetic data: hammering, looms, train whistles → traffic
 * drone, phone rings → notification chimes, drone hum. Unrest is audible
 * (chanting under the music) before it's visible."
 *
 * No audio assets — every sound is a WebAudio oscillator, the same philosophy
 * as Sfx and Music. The class fires periodic ambient events based on live game
 * signals fed each frame via update().
 *
 * Atmosphere seam: when an {@link AudioRegistry} holds an `ambience-<era>` bed,
 * that recorded loop plays *under* the diegetic events on the same master bus —
 * the audio sibling of the music stems (music.ts) and the painted backdrop. No
 * bed loaded (the shipped default) → the procedural soundscape plays alone.
 */

import { ambienceStemSlot } from './audio/audioRegistry';
import type { AudioRegistry } from './audio/audioRegistry';

export interface SoundscapeContext {
  mode: 'town' | 'region';
  paused: boolean;
  year: number;
  /** Town: settlers currently executing build/construction tasks. */
  activeBuildWorkers: number;
  /** Region: rail routes with condition > 50. */
  activeRailRoutes: number;
  /** Region: highest grievance across all settlements (0–100). */
  maxGrievance: number;
  /** Shared tension scalar (0 = calm, 1 = under attack). */
  tension: number;
}

export class Soundscape {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  enabled: boolean;

  private nextHammerTime = 0;
  private nextTrainTime = 0;
  private nextChantTime = 0;
  private nextNatureTime = 0;

  // Optional recorded ambience bed (AudioRegistry, context-bound). Loops the
  // `ambience-<era>` stem under the diegetic events; no bed → no change.
  private ambience: AudioRegistry | null = null;
  private bedSlot = ''; // the bed currently looping ('' = none)
  private bedSource: AudioBufferSourceNode | null = null;
  private bedGain: GainNode | null = null;

  constructor() {
    let on = true;
    try {
      on = localStorage.getItem('centuria-soundscape') !== '0';
    } catch {
      // storage unavailable — default to on
    }
    this.enabled = on;
  }

  toggle(): void {
    this.enabled = !this.enabled;
    try {
      localStorage.setItem('centuria-soundscape', this.enabled ? '1' : '0');
    } catch {
      // preference won't persist
    }
    if (!this.enabled && this.masterGain) this.masterGain.gain.value = 0;
  }

  /** Attach a manifest-driven ambience registry. It decodes its beds on this
   *  engine's AudioContext; when it holds an `ambience-<era>` loop, that bed
   *  plays under the diegetic events. No beds → no change. */
  setAmbience(reg: AudioRegistry): void {
    this.ambience = reg;
    if (this.ctx) void reg.load(this.ctx);
  }

  unlock(): void {
    this.ensure();
  }

  private ensure(): AudioContext | null {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    }
    try {
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0;
      this.masterGain.connect(this.ctx.destination);
      const now = this.ctx.currentTime;
      this.nextHammerTime = now + 1.0 + Math.random() * 2;
      this.nextTrainTime  = now + 5.0 + Math.random() * 6;
      this.nextChantTime  = now + 2.0 + Math.random() * 2;
      this.nextNatureTime = now + 3.0 + Math.random() * 4;
      if (this.ambience) void this.ambience.load(this.ctx);
    } catch {
      this.ctx = null;
    }
    return this.ctx;
  }

  /**
   * Manage the recorded ambience bed on the master bus: swap it at era turnover
   * (or when one first becomes available), stop it when none applies, and ease
   * its level. Routed through `masterGain`, so pause/disable already silence it.
   * A no-op while no beds are loaded — the shipped, procedural-only path.
   */
  private updateBed(ctx: AudioContext, year: number): void {
    const reg = this.ambience;
    const slot = ambienceStemSlot(year);
    const have = !!reg && reg.has(slot);
    if (have && slot !== this.bedSlot) {
      const buf = reg!.get(slot);
      if (buf) this.startBed(ctx, buf, slot);
    } else if (!have && this.bedSlot) {
      this.stopBed(ctx);
    }
    if (this.bedGain && this.bedSlot) {
      const target = 0.7; // a soft, steady floor under the diegetic events
      this.bedGain.gain.value += (target - this.bedGain.gain.value) * 0.04;
    }
  }

  private startBed(ctx: AudioContext, buf: AudioBuffer, slot: string): void {
    this.stopBed(ctx); // fade out and release the outgoing bed first
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = 0; // eased up by updateBed so the entry isn't a click
    src.connect(gain).connect(this.masterGain!);
    try {
      src.start(ctx.currentTime + 0.02);
    } catch {
      /* a source can only start once; ignore */
    }
    this.bedSource = src;
    this.bedGain = gain;
    this.bedSlot = slot;
  }

  private stopBed(ctx: AudioContext): void {
    const src = this.bedSource;
    const gain = this.bedGain;
    if (src && gain) {
      const t = ctx.currentTime;
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.linearRampToValueAtTime(0, t + 0.4); // brief fade, no click
      try {
        src.stop(t + 0.42);
      } catch {
        /* never started */
      }
    }
    this.bedSource = null;
    this.bedGain = null;
    this.bedSlot = '';
  }

  private tone(
    freq: number, t: number, dur: number, type: OscillatorType, vol: number,
    glideTo?: number,
  ): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (glideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(this.masterGain!);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** Rhythmic blunt taps — wood-and-iron construction work. */
  private hammer(t: number): void {
    for (let i = 0; i < 3; i++) {
      const delay = i * 0.22;
      this.tone(155 + Math.random() * 45, t + delay, 0.07, 'sawtooth', 0.07, 78);
    }
  }

  /**
   * Steam train whistle: the two-tone call that echoes across the valley.
   * A B♭5 (≈987 Hz) and its octave, both gliding down roughly a tone.
   */
  private trainWhistle(t: number): void {
    this.tone(987,  t, 1.4, 'sawtooth', 0.044, 880);
    this.tone(1976, t, 1.4, 'sawtooth', 0.022, 1760);
    this.tone(1320, t, 0.10, 'square',  0.014);
  }

  /**
   * Crowd chanting: call-and-response from layered voices. Builds as
   * `intensity` (0–1) rises — audible before the grievance bar fills.
   */
  private chant(t: number, intensity: number): void {
    const vol = intensity * 0.048;
    for (let i = 0; i < 5; i++) {
      const f = 190 + i * 35 + (Math.random() - 0.5) * 14;
      this.tone(f,       t,        0.35, 'triangle', vol);
      this.tone(f * 1.5, t + 0.55, 0.30, 'triangle', vol * 0.65);
    }
  }

  /** Bird chirp: a quick ascending trill — frontier calm. */
  private birdChirp(t: number): void {
    const base = 2400 + Math.random() * 900;
    this.tone(base, t, 0.08, 'sine', 0.030, base * 1.35);
    if (Math.random() < 0.55) {
      const delay = 0.12 + Math.random() * 0.10;
      const b2 = base * (0.85 + Math.random() * 0.45);
      this.tone(b2, t + delay, 0.08, 'sine', 0.024, b2 * 1.4);
    }
  }

  /** Call from the main animation loop each frame, alongside music.update(). */
  update(c: SoundscapeContext): void {
    if (!this.enabled) return;
    const ctx = this.ensure();
    if (!ctx || !this.masterGain) return;

    // Ease master volume: silent when paused, gently present when playing.
    const targetVol = c.paused ? 0 : 0.38;
    this.masterGain.gain.value += (targetVol - this.masterGain.gain.value) * 0.04;

    // Recorded ambience bed (procedural-only by default). Managed every frame so
    // era swaps stay current; routed through masterGain, so pause silences it.
    this.updateBed(ctx, c.year);

    if (c.paused) return;

    const now = ctx.currentTime;

    // Hammering: town tier, settlers on construction tasks.
    if (c.mode === 'town' && c.activeBuildWorkers > 0 && now >= this.nextHammerTime) {
      this.hammer(now + 0.05);
      const density = Math.min(1, c.activeBuildWorkers / 4);
      this.nextHammerTime = now + 1.1 + (1 - density) * 2.4 + Math.random() * 1.1;
    }

    // Train whistle: region tier, at least one rail route in good shape.
    if (c.mode === 'region' && c.activeRailRoutes > 0 && now >= this.nextTrainTime) {
      this.trainWhistle(now + 0.05);
      this.nextTrainTime = now + 9 + Math.random() * 14;
    }

    // Crowd chanting: region tier, grievance crossing 50.
    if (c.mode === 'region' && c.maxGrievance > 50 && now >= this.nextChantTime) {
      const intensity = (c.maxGrievance - 50) / 50;
      this.chant(now + 0.05, intensity);
      this.nextChantTime = now + 0.7 + (1 - intensity) * 1.1 + Math.random() * 0.5;
    }

    // Bird chirps: any mode, calm conditions.
    const calm = c.activeBuildWorkers === 0 && c.maxGrievance < 35 && c.tension < 0.2;
    if (calm && now >= this.nextNatureTime) {
      this.birdChirp(now + 0.05);
      this.nextNatureTime = now + 4 + Math.random() * 8;
    }
  }
}
