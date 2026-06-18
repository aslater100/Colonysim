/**
 * Procedural era-aware soundtrack (GDD §3.3) — no audio assets, every note is
 * a WebAudio oscillator, the same philosophy as the SFX synth. A lookahead
 * scheduler lays down voice-led harmony, a feel-appropriate bassline, a
 * *composed* melody and light percussion. The instrumentation and idiom age
 * with the century — ragtime stride in 1900, swung chip-jazz after the Great
 * War, lush parlour strings mid-century, modal analog synth in the 70s,
 * driving electronica in the 2000s, an airy hybrid pad in the speculative era.
 *
 * Unlike a random arpeggiator, the lead plays hand-written phrases: each era
 * owns a little library of motifs, stated relative to the current chord so they
 * transpose through the progression and always land on chord tones. The mix
 * follows a tension scalar — paused or calm drops to the ambient pad alone, a
 * raid brings the melody and full kit up. The chip timbre never fully leaves
 * (it is the franchise voice) but the era around it modernizes.
 */

/** Equal-tempered frequency for `semitones` above a reference pitch. */
function freqAt(baseHz: number, semitones: number): number {
  return baseHz * Math.pow(2, semitones / 12);
}

// Scales as semitone offsets within the octave.
const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  minor: [0, 2, 3, 5, 7, 8, 10],
} as const;

type ScaleName = keyof typeof SCALES;

/**
 * How the rhythm section carries each era — this is what makes ragtime sound
 * like ragtime and not like house music over the same chords.
 *  - `stride`   low root on beats 1 & 3, mid chord stab on 2 & 4 (ragtime).
 *  - `walk`     quarter-note walking bass that leans into the next chord (jazz).
 *  - `sustained` held root, a fifth mid-bar — pillowy parlour/ambient backing.
 *  - `syncopated` pushed, off-beat root accents (cool analog groove).
 *  - `driving`  root on every beat plus octave bounce (four-on-the-floor pop).
 */
type Feel = 'stride' | 'walk' | 'sustained' | 'syncopated' | 'driving';

/**
 * A melodic event, stated *relative to the current chord root* in scale
 * degrees so the phrase follows the harmony. Degree 0/2/4/6 are chord tones
 * (root, third, fifth, seventh); 1/3/5 are passing tones. `step` is the 16th
 * offset within the bar (0–15) and `dur` its length in 16ths.
 */
interface MNote {
  deg: number;
  step: number;
  dur: number;
  /** Octave for the lead voice; defaults to 3. */
  oct?: number;
}

type Phrase = MNote[];

export interface EraVoicing {
  id: string;
  /** First year (inclusive) this era's music takes over. */
  fromYear: number;
  scale: ScaleName;
  /** Chord roots as scale-degree indices; a bar sits on each in turn. */
  progression: number[];
  bpm: number;
  pad: OscillatorType;
  bass: OscillatorType;
  lead: OscillatorType;
  /** Detune spread (cents) for a fatter, analog-synth pad. */
  detune: number;
  /** Add a four-on-the-floor kick from this era on (electronica). */
  fourFloor: boolean;
  /** Rhythm-section character (see {@link Feel}). */
  feel: Feel;
  /** 0 = straight; ~0.55 = hard swing on the off-beat eighths (jazz lilt). */
  swing: number;
  /** Stack a seventh into the pad for a richer, jazzier bed. */
  seventh: boolean;
  /** Float a soft octave-up third over the pad for parlour/ambient shimmer. */
  shimmer: boolean;
  /** Hand-written motifs the lead draws from, one stated per bar. */
  melodies: Phrase[];
}

// Reusable motif libraries. Degrees are chord-relative; see {@link MNote}.
// Ragtime: dotted, syncopated, jaunty — accents land on the off-beats.
const M_RAGTIME: Phrase[] = [
  [
    { deg: 4, step: 0, dur: 1 }, { deg: 2, step: 1, dur: 1 }, { deg: 0, step: 2, dur: 2 },
    { deg: 2, step: 6, dur: 2 }, { deg: 4, step: 8, dur: 1 }, { deg: 6, step: 9, dur: 1 },
    { deg: 7, step: 10, dur: 2, oct: 4 }, { deg: 6, step: 14, dur: 2 },
  ],
  [
    { deg: 7, step: 0, dur: 2, oct: 4 }, { deg: 6, step: 4, dur: 1 }, { deg: 4, step: 5, dur: 1 },
    { deg: 2, step: 6, dur: 2 }, { deg: 4, step: 10, dur: 1 }, { deg: 2, step: 11, dur: 1 },
    { deg: 0, step: 12, dur: 4 },
  ],
  [
    { deg: 2, step: 0, dur: 1 }, { deg: 4, step: 1, dur: 1 }, { deg: 6, step: 3, dur: 2 },
    { deg: 4, step: 5, dur: 1 }, { deg: 2, step: 6, dur: 2 }, { deg: 0, step: 8, dur: 1 },
    { deg: 2, step: 9, dur: 1 }, { deg: 4, step: 10, dur: 4 },
  ],
  [
    { deg: 0, step: 0, dur: 2 }, { deg: 4, step: 2, dur: 2 }, { deg: 6, step: 4, dur: 1 },
    { deg: 7, step: 5, dur: 1, oct: 4 }, { deg: 6, step: 6, dur: 2 }, { deg: 4, step: 8, dur: 1 },
    { deg: 2, step: 9, dur: 3 }, { deg: 0, step: 12, dur: 4 },
  ],
];

// Chip-jazz: a long swung eighth line that climbs to the bluesy flat-seven.
const M_CHIPJAZZ: Phrase[] = [
  [
    { deg: 0, step: 0, dur: 2 }, { deg: 2, step: 2, dur: 2 }, { deg: 3, step: 4, dur: 2 },
    { deg: 4, step: 6, dur: 2 }, { deg: 6, step: 8, dur: 2 }, { deg: 4, step: 10, dur: 2 },
    { deg: 2, step: 12, dur: 4 },
  ],
  [
    { deg: 4, step: 0, dur: 2 }, { deg: 6, step: 2, dur: 2 }, { deg: 7, step: 4, dur: 2, oct: 4 },
    { deg: 6, step: 6, dur: 2 }, { deg: 4, step: 8, dur: 2 }, { deg: 2, step: 10, dur: 2 },
    { deg: 0, step: 12, dur: 4 },
  ],
  [
    { deg: 2, step: 0, dur: 2 }, { deg: 4, step: 2, dur: 2 }, { deg: 6, step: 4, dur: 2, oct: 4 },
    { deg: 7, step: 6, dur: 2, oct: 4 }, { deg: 6, step: 8, dur: 2 }, { deg: 4, step: 10, dur: 2 },
    { deg: 2, step: 12, dur: 4 },
  ],
  [
    { deg: 6, step: 0, dur: 2 }, { deg: 4, step: 2, dur: 2 }, { deg: 2, step: 4, dur: 2 },
    { deg: 0, step: 6, dur: 2 }, { deg: 2, step: 8, dur: 2 }, { deg: 4, step: 10, dur: 2 },
    { deg: 6, step: 12, dur: 4, oct: 4 },
  ],
];

// Mid-century: lyrical, long-breathed parlour phrasing.
const M_MIDCENTURY: Phrase[] = [
  [
    { deg: 2, step: 0, dur: 6 }, { deg: 4, step: 6, dur: 2 }, { deg: 6, step: 8, dur: 4 },
    { deg: 4, step: 12, dur: 4 },
  ],
  [
    { deg: 6, step: 0, dur: 4 }, { deg: 4, step: 4, dur: 4 }, { deg: 2, step: 8, dur: 4 },
    { deg: 0, step: 12, dur: 4 },
  ],
  [
    { deg: 0, step: 0, dur: 4 }, { deg: 2, step: 4, dur: 6 }, { deg: 4, step: 10, dur: 2 },
    { deg: 6, step: 12, dur: 4, oct: 4 },
  ],
  [
    { deg: 4, step: 0, dur: 8 }, { deg: 6, step: 8, dur: 4 }, { deg: 2, step: 12, dur: 4 },
  ],
];

// Analog: cool modal syncopation that pushes against the beat.
const M_ANALOG: Phrase[] = [
  [
    { deg: 0, step: 0, dur: 2 }, { deg: 2, step: 3, dur: 2 }, { deg: 4, step: 6, dur: 1 },
    { deg: 5, step: 7, dur: 1 }, { deg: 4, step: 8, dur: 2 }, { deg: 2, step: 11, dur: 2 },
    { deg: 0, step: 14, dur: 2 },
  ],
  [
    { deg: 4, step: 0, dur: 2 }, { deg: 6, step: 3, dur: 2 }, { deg: 4, step: 6, dur: 2 },
    { deg: 2, step: 9, dur: 1 }, { deg: 3, step: 10, dur: 1 }, { deg: 2, step: 11, dur: 1 },
    { deg: 0, step: 12, dur: 4 },
  ],
  [
    { deg: 2, step: 0, dur: 1 }, { deg: 4, step: 1, dur: 1 }, { deg: 5, step: 3, dur: 2 },
    { deg: 6, step: 6, dur: 2 }, { deg: 4, step: 8, dur: 1 }, { deg: 2, step: 10, dur: 2 },
    { deg: 0, step: 13, dur: 3 },
  ],
  [
    { deg: 6, step: 0, dur: 2 }, { deg: 4, step: 2, dur: 2 }, { deg: 5, step: 5, dur: 1 },
    { deg: 6, step: 6, dur: 2 }, { deg: 4, step: 9, dur: 2 }, { deg: 2, step: 11, dur: 2 },
    { deg: 0, step: 14, dur: 2 },
  ],
];

// Electronica: a tight, repetitive hook with a driving inner pulse.
const M_ELECTRONICA: Phrase[] = [
  [
    { deg: 0, step: 0, dur: 1 }, { deg: 0, step: 2, dur: 1 }, { deg: 2, step: 3, dur: 1 },
    { deg: 4, step: 4, dur: 2 }, { deg: 3, step: 8, dur: 1 }, { deg: 2, step: 10, dur: 1 },
    { deg: 0, step: 12, dur: 2 }, { deg: 4, step: 14, dur: 2, oct: 4 },
  ],
  [
    { deg: 4, step: 0, dur: 2, oct: 4 }, { deg: 2, step: 4, dur: 1 }, { deg: 0, step: 6, dur: 2 },
    { deg: 3, step: 8, dur: 1 }, { deg: 4, step: 10, dur: 1 }, { deg: 2, step: 12, dur: 2 },
    { deg: 0, step: 14, dur: 2 },
  ],
  [
    { deg: 2, step: 0, dur: 1 }, { deg: 4, step: 1, dur: 1 }, { deg: 0, step: 2, dur: 1 },
    { deg: 4, step: 3, dur: 2 }, { deg: 2, step: 6, dur: 1 }, { deg: 4, step: 8, dur: 2, oct: 4 },
    { deg: 3, step: 10, dur: 1 }, { deg: 0, step: 12, dur: 4 },
  ],
  [
    { deg: 0, step: 0, dur: 1 }, { deg: 3, step: 1, dur: 1 }, { deg: 4, step: 3, dur: 1 },
    { deg: 2, step: 4, dur: 2 }, { deg: 0, step: 7, dur: 1 }, { deg: 4, step: 8, dur: 2, oct: 4 },
    { deg: 2, step: 11, dur: 1 }, { deg: 0, step: 12, dur: 4 },
  ],
];

// Future: sparse, floating long tones that drift across the bar.
const M_FUTURE: Phrase[] = [
  [
    { deg: 4, step: 0, dur: 8 }, { deg: 6, step: 8, dur: 4 }, { deg: 7, step: 12, dur: 4, oct: 4 },
  ],
  [
    { deg: 7, step: 0, dur: 6, oct: 4 }, { deg: 4, step: 8, dur: 4 }, { deg: 2, step: 12, dur: 4 },
  ],
  [
    { deg: 2, step: 0, dur: 6 }, { deg: 4, step: 6, dur: 4 }, { deg: 6, step: 10, dur: 6, oct: 4 },
  ],
  [
    { deg: 6, step: 0, dur: 8, oct: 4 }, { deg: 4, step: 8, dur: 4 }, { deg: 0, step: 12, dur: 4 },
  ],
];

/**
 * The eight-era audio arc, keyed by date window (GDD §3.3). Ragtime chiptune
 * gives way to chip-jazz, then synth strings creep in mid-century, analog
 * idioms in the 70s–90s, layered electronica in the 2000s, and a calm hybrid
 * pad in the speculative era.
 */
export const ERAS: EraVoicing[] = [
  { id: 'ragtime', fromYear: 1900, scale: 'major', progression: [0, 3, 4, 0], bpm: 104, pad: 'triangle', bass: 'square', lead: 'square', detune: 0, fourFloor: false, feel: 'stride', swing: 0.2, seventh: false, shimmer: false, melodies: M_RAGTIME },
  { id: 'chipjazz', fromYear: 1918, scale: 'mixolydian', progression: [0, 5, 1, 4], bpm: 96, pad: 'triangle', bass: 'triangle', lead: 'square', detune: 0, fourFloor: false, feel: 'walk', swing: 0.55, seventh: true, shimmer: false, melodies: M_CHIPJAZZ },
  { id: 'midcentury', fromYear: 1945, scale: 'major', progression: [0, 4, 5, 3], bpm: 84, pad: 'sine', bass: 'triangle', lead: 'triangle', detune: 4, fourFloor: false, feel: 'sustained', swing: 0.3, seventh: true, shimmer: true, melodies: M_MIDCENTURY },
  { id: 'analog', fromYear: 1970, scale: 'dorian', progression: [0, 6, 5, 4], bpm: 112, pad: 'sawtooth', bass: 'sawtooth', lead: 'square', detune: 10, fourFloor: false, feel: 'syncopated', swing: 0, seventh: true, shimmer: false, melodies: M_ANALOG },
  { id: 'electronica', fromYear: 2000, scale: 'minor', progression: [0, 5, 3, 4], bpm: 124, pad: 'sawtooth', bass: 'square', lead: 'sawtooth', detune: 8, fourFloor: true, feel: 'driving', swing: 0, seventh: false, shimmer: false, melodies: M_ELECTRONICA },
  { id: 'future', fromYear: 2040, scale: 'dorian', progression: [0, 3, 5, 1], bpm: 76, pad: 'sine', bass: 'sine', lead: 'triangle', detune: 6, fourFloor: false, feel: 'sustained', swing: 0, seventh: true, shimmer: true, melodies: M_FUTURE },
];

/** The era whose date window contains `year` (clamped to the first/last era). */
export function eraForYear(year: number): EraVoicing {
  let chosen = ERAS[0];
  for (const e of ERAS) if (year >= e.fromYear) chosen = e;
  return chosen;
}

/** Live signals the soundtrack reacts to, fed from the game loop each frame. */
export interface MusicContext {
  year: number;
  paused: boolean;
  /** 0 = calm, 1 = under attack — raises lead/drum intensity. */
  tension: number;
}

const BASE_HZ = 55; // A1, the floor the bass sits near.

export class Music {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  enabled: boolean;

  // Scheduler state.
  private nextNoteTime = 0;
  private step = 0; // 16th-note counter, wraps every 16 (one bar)
  private bar = 0;
  private era = ERAS[0];
  // The motif chosen for the current bar, possibly octave-shifted for variety.
  private barPhrase: Phrase = ERAS[0].melodies[0];
  private barOctShift = 0;
  // Smoothed mix targets so layers fade in and out instead of clicking.
  private intensity = 0; // lead/perc presence, eased toward a target
  private seed = 0x2545f491; // tiny LCG state for melodic choice

  constructor() {
    let on = true;
    try {
      on = localStorage.getItem('centuria-music') !== '0';
    } catch {
      // storage unavailable — default to music on
    }
    this.enabled = on;
  }

  toggle(): void {
    this.enabled = !this.enabled;
    try {
      localStorage.setItem('centuria-music', this.enabled ? '1' : '0');
    } catch {
      // preference just won't persist
    }
    if (!this.enabled && this.master) this.master.gain.value = 0;
  }

  /** Call from a user gesture so the browser lets the context start. */
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
      this.master = this.ctx.createGain();
      this.master.gain.value = 0;
      this.master.connect(this.ctx.destination);
      this.nextNoteTime = this.ctx.currentTime + 0.1;
    } catch {
      this.ctx = null;
    }
    return this.ctx;
  }

  /** A fast deterministic-ish pick in [0,1); keeps the melody from looping flat. */
  private rand(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 0x100000000;
  }

  /** Frequency for `degree` steps up the current scale (degrees may exceed 7). */
  private scaleFreq(degree: number, octave: number): number {
    const scale = SCALES[this.era.scale];
    // Floor-divide so negative degrees wrap down a full octave cleanly.
    const idx = ((degree % scale.length) + scale.length) % scale.length;
    const oct = octave + Math.floor(degree / scale.length);
    return freqAt(BASE_HZ, scale[idx] + 12 * oct);
  }

  /** Scale-degree root of the bar `n` bars from now. */
  private rootAt(barOffset: number): number {
    const p = this.era.progression;
    return p[(this.bar + barOffset) % p.length];
  }

  /**
   * One enveloped oscillator note on the master bus. `attack` shapes the onset
   * — a quick pluck for leads, a slow swell for sustained strings/pads.
   */
  private note(
    freq: number, time: number, durS: number, type: OscillatorType, vol: number,
    detune = 0, attack = 0.02,
  ): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, time);
    if (detune) osc.detune.setValueAtTime(detune, time);
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(vol, time + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + durS);
    osc.connect(gain).connect(this.master!);
    osc.start(time);
    osc.stop(time + durS + 0.02);
  }

  /** A short noise burst for hats; built from a buffer source. */
  private noise(time: number, durS: number, vol: number): void {
    const ctx = this.ctx!;
    const len = Math.max(1, Math.floor(ctx.sampleRate * durS));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + durS);
    src.connect(gain).connect(this.master!);
    src.start(time);
    src.stop(time + durS);
  }

  /** Pick the bar's motif and decide whether to restate it an octave up. */
  private chooseBarPhrase(): void {
    const mel = this.era.melodies;
    this.barPhrase = mel[this.bar % mel.length];
    // Occasionally lift a restatement an octave for a brighter answer.
    this.barOctShift = this.rand() < 0.25 ? 1 : 0;
  }

  /** Lay down all the voices that land on `step` (a 16th) at `time`. */
  private scheduleStep(time: number, intensity: number): void {
    const e = this.era;
    const root = this.rootAt(0);
    const stepDur = 60 / e.bpm / 4;
    // Swing pushes the off-beat eighths (the "and" of each beat) later.
    const swung = e.swing > 0 && this.step % 4 === 2
      ? time + e.swing * stepDur
      : time;

    // --- Harmony: a voice-led pad at the top of each bar, the ambient bed
    // that keeps playing even when the game is paused. A stacked seventh and a
    // floating octave third add the richness the bare triad was missing.
    if (this.step === 0) {
      const barS = stepDur * 16;
      const voices = e.seventh ? [0, 2, 4, 6] : [0, 2, 4];
      for (const d of voices) {
        const det = e.detune ? this.rand() * e.detune - e.detune / 2 : 0;
        this.note(this.scaleFreq(root + d, 2), time, barS, e.pad, 0.013, det, 0.08);
      }
      if (e.shimmer) {
        this.note(this.scaleFreq(root + 2, 3), time, barS, e.pad, 0.008, 0, 0.25);
      }
    }

    // --- Bass: character depends on the era's feel.
    this.scheduleBass(swung, intensity);

    // --- Comp: harmonic stabs that give the groove its bounce.
    this.scheduleComp(swung, intensity);

    // --- Melody: the composed motif for this bar, chord tones woven with
    // passing tones, present whenever the game is live (scaled by intensity).
    if (intensity > 0.1) {
      for (const n of this.barPhrase) {
        if (n.step !== this.step) continue;
        const oct = (n.oct ?? 3) + this.barOctShift;
        const dur = n.dur * stepDur * 0.92;
        const vol = 0.03 * (0.5 + 0.5 * intensity);
        this.note(this.scaleFreq(root + n.deg, oct), swung, dur, e.lead, vol);
      }
    }

    // --- Percussion: hat on the off-beats once there's energy, plus the kick.
    if (intensity > 0.35) {
      if (this.step % 2 === 0) this.noise(swung, 0.04, 0.02 * intensity);
      const kickStep = e.fourFloor ? this.step % 4 === 0 : this.step === 0 || this.step === 8;
      if (kickStep) this.note(freqAt(BASE_HZ, -12), time, 0.12, 'sine', 0.06 * intensity);
    }
  }

  /** The bassline for the current step, shaped by the era's {@link Feel}. */
  private scheduleBass(time: number, intensity: number): void {
    if (intensity <= 0.05) return; // paused → pad only, bass drops out
    const e = this.era;
    const root = this.rootAt(0);
    const beat = 60 / e.bpm;
    const s = this.step;
    switch (e.feel) {
      case 'stride':
        // Low root on beats 1 & 3; the off-beats are the comp's job.
        if (s === 0 || s === 8) this.note(this.scaleFreq(root, 1), time, beat * 0.6, e.bass, 0.055);
        break;
      case 'walk': {
        // Quarter-note walk: root, third, fifth, then a scale step that leans
        // into the next bar's chord — the engine of swing-era motion.
        if (s % 4 !== 0) break;
        const next = this.rootAt(1);
        const degs = [root, root + 2, root + 4, next - 1];
        this.note(this.scaleFreq(degs[s / 4], 1), time, beat * 0.85, e.bass, 0.05);
        break;
      }
      case 'sustained':
        // Held root, a fifth mid-bar — a soft pillow under parlour/ambient.
        if (s === 0) this.note(this.scaleFreq(root, 1), time, beat * 3.6, e.bass, 0.045, 0, 0.06);
        else if (s === 8) this.note(this.scaleFreq(root + 4, 1), time, beat * 1.6, e.bass, 0.035, 0, 0.06);
        break;
      case 'syncopated':
        // Pushed accents that anticipate the beat — a cool analog lope.
        if (s === 0 || s === 6 || s === 8 || s === 14) {
          this.note(this.scaleFreq(root, 1), time, beat * 0.5, e.bass, 0.05);
        }
        break;
      case 'driving':
        // Root on every beat, an octave bounce on the off-beats for energy.
        if (s % 4 === 0) this.note(this.scaleFreq(root, 1), time, beat * 0.45, e.bass, 0.055);
        else if (s % 4 === 2) this.note(this.scaleFreq(root, 2), time, beat * 0.3, e.bass, 0.03 * intensity);
        break;
    }
  }

  /** Chordal comping — the "stride" left hand and off-beat synth stabs. */
  private scheduleComp(time: number, intensity: number): void {
    if (intensity <= 0.15) return;
    const e = this.era;
    const root = this.rootAt(0);
    const beat = 60 / e.bpm;
    const s = this.step;
    const stab = (vol: number, durMul: number) => {
      for (const d of [0, 2, 4]) {
        this.note(this.scaleFreq(root + d, 2), time, beat * durMul, e.pad, vol);
      }
    };
    if (e.feel === 'stride') {
      // The signature mid-register chord on beats 2 & 4.
      if (s === 4 || s === 12) stab(0.02, 0.4);
    } else if (e.feel === 'syncopated' || e.feel === 'driving') {
      // Light off-beat stabs that lock with the groove.
      if (s % 4 === 2) stab(0.014 * intensity, 0.25);
    }
  }

  /**
   * Advance the scheduler up to a short lookahead horizon. Called once per
   * animation frame from the game loop, fed the live game signals.
   */
  update(c: MusicContext): void {
    if (!this.enabled) {
      if (this.master) this.master.gain.value = 0;
      return;
    }
    const ctx = this.ensure();
    if (!ctx || !this.master) return;

    // Pick the era for the current year; switches take effect at the next bar.
    const era = eraForYear(c.year);
    // Ease master volume up from silence, and the lead/drum intensity toward a
    // target set by pause and tension. Paused → pad only; tension → full kit.
    const targetMaster = 0.5;
    this.master.gain.value += (targetMaster - this.master.gain.value) * 0.02;
    const targetIntensity = c.paused ? 0 : 0.45 + 0.55 * Math.min(1, Math.max(0, c.tension));
    this.intensity += (targetIntensity - this.intensity) * 0.03;

    const stepDur = 60 / era.bpm / 4; // a 16th note
    const horizon = ctx.currentTime + 0.2;
    while (this.nextNoteTime < horizon) {
      this.era = era;
      if (this.step === 0) this.chooseBarPhrase();
      this.scheduleStep(this.nextNoteTime, this.intensity);
      this.nextNoteTime += stepDur;
      this.step = (this.step + 1) % 16;
      if (this.step === 0) this.bar++;
    }
  }
}
