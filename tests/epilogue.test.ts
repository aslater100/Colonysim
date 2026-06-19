import { describe, it, expect } from 'vitest';
import { RegionSim } from '../src/sim/region';

function makeRegion(seed = 42): RegionSim {
  return RegionSim.create(seed);
}

/** Reach into the private epilogue trigger set for a deterministic test. */
function triggerBeat(r: RegionSim, id: string): void {
  (r as unknown as { triggeredEpilogueEvents: Set<string> }).triggeredEpilogueEvents.add(id);
}

describe('Phase 4: Epilogue', () => {
  it('epilogueShown starts false', () => {
    const r = makeRegion();
    expect(r.epilogueShown).toBe(false);
  });

  it('epilogueBeats is empty before any event fires', () => {
    const r = makeRegion();
    expect(r.epilogueBeats()).toEqual([]);
  });

  it('epilogueBeats resolves triggered solarpunk beats to their text', () => {
    const r = makeRegion();
    (r as unknown as { eraBranch: string }).eraBranch = 'solarpunk';
    triggerBeat(r, 'sol-greening');
    triggerBeat(r, 'sol-commons');
    const beats = r.epilogueBeats();
    expect(beats.length).toBe(2);
    expect(beats.every((b) => typeof b.text === 'string' && b.text.length > 0)).toBe(true);
    expect(beats.map((b) => b.id).sort()).toEqual(['sol-commons', 'sol-greening']);
  });

  it('epilogueBeats only returns beats from the active branch pool', () => {
    const r = makeRegion();
    (r as unknown as { eraBranch: string }).eraBranch = 'drowned';
    // A solarpunk id is not in the drowned pool, so it resolves to nothing.
    triggerBeat(r, 'sol-greening');
    triggerBeat(r, 'drown-walls');
    const beats = r.epilogueBeats();
    expect(beats.map((b) => b.id)).toEqual(['drown-walls']);
  });

  it('epilogueShown persists across serialize/deserialize', () => {
    const r = makeRegion();
    r.epilogueShown = true;
    const r2 = RegionSim.deserialize(r.serialize());
    expect(r2.epilogueShown).toBe(true);
  });

  it('triggered epilogue beats persist across serialize/deserialize', () => {
    const r = makeRegion();
    (r as unknown as { eraBranch: string }).eraBranch = 'dystopia';
    triggerBeat(r, 'dys-surveillance');
    const r2 = RegionSim.deserialize(r.serialize());
    expect(r2.epilogueBeats().map((b) => b.id)).toContain('dys-surveillance');
  });
});
