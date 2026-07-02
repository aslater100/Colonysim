import { describe, it, expect } from 'vitest';
import {
  RegionSim,
  REVANCHISM_BUILDUP_YEARS,
  CASUS_BELLI_DEFS,
  RIVAL_ARCHETYPES,
  type WarScar,
  type RivalNation,
} from '../src/sim/region';
import { updateDiplomacy } from '../src/sim/systems/diplomacy';

/**
 * Rival revanchism: a defeated rival rebuilds and comes back for revenge.
 *
 * When the player wins a war (warScars entry with outcome 'victory'), the
 * losing rival is eligible to re-declare war using the 'revanchism' CB after
 * REVANCHISM_BUILDUP_YEARS have elapsed and relations stay hostile.
 *
 * Byte-identical guarantee: in headless/autoplay (no wars fought) warScars
 * is always empty → the revanchism block is never entered → no extra RNG call.
 */

function makeRegion(seed = 42): RegionSim {
  return RegionSim.create(seed);
}

function ensureRival(r: RegionSim): RivalNation {
  if (r.rivals.length === 0) {
    (r as unknown as { spawnRival: () => void }).spawnRival();
  }
  return r.rivals[0];
}

function plant(r: RegionSim, rivalId: number, rivalName: string, outcome: WarScar['outcome'], yearEnded: number): void {
  (r as unknown as { warScars: WarScar[] }).warScars.push({
    rivalId, rivalName, yearEnded, outcome, occupied: 0, casualties: 0, durationMonths: 6,
  });
}

// ---- constant ----

describe('REVANCHISM_BUILDUP_YEARS', () => {
  it('is exported and positive', () => {
    expect(typeof REVANCHISM_BUILDUP_YEARS).toBe('number');
    expect(REVANCHISM_BUILDUP_YEARS).toBeGreaterThan(0);
  });

  it('is at least 3 years (time to rebuild)', () => {
    expect(REVANCHISM_BUILDUP_YEARS).toBeGreaterThanOrEqual(3);
  });
});

// ---- CASUS_BELLI_DEFS completeness ----

describe('revanchism CB definition', () => {
  it('revanchism is defined with high war-support', () => {
    const def = CASUS_BELLI_DEFS['revanchism'];
    expect(def).toBeDefined();
    expect(def.support).toBeGreaterThanOrEqual(80);
  });

  it('revanchism has a description', () => {
    expect(CASUS_BELLI_DEFS['revanchism'].desc.length).toBeGreaterThan(0);
  });
});

// ---- player-facing availableCasusBelli ----

describe('player revanchism availability', () => {
  it('is offered when warScars has a "defeat" outcome for that rival', () => {
    const r = makeRegion();
    const rv = ensureRival(r);
    plant(r, rv.id, rv.name, 'defeat', 1950);
    (r as unknown as { nationProclaimed: boolean }).nationProclaimed = true;
    rv.relations = r.clampRel(-70);
    const cbs = r.availableCasusBelli(rv);
    expect(cbs).toContain('revanchism');
  });

  it('is NOT offered on "negotiated" outcome — that is not a defeat', () => {
    const r = makeRegion();
    const rv = ensureRival(r);
    plant(r, rv.id, rv.name, 'negotiated', 1950);
    (r as unknown as { nationProclaimed: boolean }).nationProclaimed = true;
    rv.relations = r.clampRel(-70);
    const cbs = r.availableCasusBelli(rv);
    expect(cbs).not.toContain('revanchism');
  });

  it('is NOT offered on "victory" outcome — that is their defeat, not ours', () => {
    const r = makeRegion();
    const rv = ensureRival(r);
    // A 'victory' scar means WE won → no player revanchism (rival lost)
    plant(r, rv.id, rv.name, 'victory', 1950);
    (r as unknown as { nationProclaimed: boolean }).nationProclaimed = true;
    rv.relations = r.clampRel(-70);
    const cbs = r.availableCasusBelli(rv);
    expect(cbs).not.toContain('revanchism');
  });
});

// ---- rival revanchism AI war declaration ----

describe('rival revanchism war declaration', () => {
  it('fires with revanchism CB given conditions: old enough scar + hostile + no pact', () => {
    const r = makeRegion(99);
    (r as unknown as { nationProclaimed: boolean }).nationProclaimed = true;
    const rv = ensureRival(r);

    // Make rival a hegemon so the probability is as high as possible
    rv.archetype = 'hegemon';
    rv.weights = { ...RIVAL_ARCHETYPES['hegemon'].weights };

    // Plant a victory scar old enough (we beat them 10 years ago)
    const currentYear: number = (r as unknown as { year: number }).year;
    plant(r, rv.id, rv.name, 'victory', currentYear - REVANCHISM_BUILDUP_YEARS - 5);

    rv.treaties = [];

    // Run diplomacy; re-pin relations before each call so drift doesn't lift them.
    // Reset any non-revanchism war that fires first so we keep trying.
    let fired = false;
    for (let i = 0; i < 2000; i++) {
      rv.relations = r.clampRel(-65);
      updateDiplomacy(r);
      if (r.playerWar?.cb === 'revanchism') { fired = true; break; }
      if (r.playerWar) (r as unknown as { playerWar: null }).playerWar = null;
    }
    expect(fired).toBe(true);
  });

  it('does NOT fire before REVANCHISM_BUILDUP_YEARS have elapsed', () => {
    const r = makeRegion(99);
    (r as unknown as { nationProclaimed: boolean }).nationProclaimed = true;
    const rv = ensureRival(r);

    rv.archetype = 'hegemon';
    rv.weights = { ...RIVAL_ARCHETYPES['hegemon'].weights };

    const currentYear: number = (r as unknown as { year: number }).year;
    // Only 1 year ago — buildup not complete
    plant(r, rv.id, rv.name, 'victory', currentYear - 1);

    rv.treaties = [];

    for (let i = 0; i < 500; i++) {
      rv.relations = r.clampRel(-65);
      updateDiplomacy(r);
      if (r.playerWar?.cb === 'revanchism') {
        expect.fail('revanchism fired before buildup period elapsed');
      }
      if (r.playerWar) { (r as unknown as { playerWar: null }).playerWar = null; }
    }
  });

  it('does NOT fire when a non_aggression pact is active', () => {
    const r = makeRegion(99);
    (r as unknown as { nationProclaimed: boolean }).nationProclaimed = true;
    const rv = ensureRival(r);

    rv.archetype = 'hegemon';
    rv.weights = { ...RIVAL_ARCHETYPES['hegemon'].weights };

    const currentYear: number = (r as unknown as { year: number }).year;
    plant(r, rv.id, rv.name, 'victory', currentYear - REVANCHISM_BUILDUP_YEARS - 5);

    rv.relations = r.clampRel(-65);
    rv.treaties = ['non_aggression'];

    for (let i = 0; i < 500; i++) {
      rv.relations = r.clampRel(-65);
      updateDiplomacy(r);
      if (r.playerWar?.cb === 'revanchism') {
        expect.fail('revanchism fired despite non_aggression pact');
      }
      if (r.playerWar) { (r as unknown as { playerWar: null }).playerWar = null; }
    }
  });

  it('does NOT fire when warScars has only player-defeat scars (rival did not lose)', () => {
    const r = makeRegion(99);
    (r as unknown as { nationProclaimed: boolean }).nationProclaimed = true;
    const rv = ensureRival(r);

    rv.archetype = 'hegemon';
    rv.weights = { ...RIVAL_ARCHETYPES['hegemon'].weights };

    // 'defeat' means the PLAYER lost — rival has nothing to avenge
    plant(r, rv.id, rv.name, 'defeat', 1940);

    rv.treaties = [];

    for (let i = 0; i < 500; i++) {
      rv.relations = r.clampRel(-65);
      updateDiplomacy(r);
      if (r.playerWar?.cb === 'revanchism') {
        expect.fail('revanchism fired when rival never lost a war');
      }
      if (r.playerWar) { (r as unknown as { playerWar: null }).playerWar = null; }
    }
  });
});

// ---- log message flavour ----

describe('revanchism war log message', () => {
  it('uses revenge flavour text when rival declares with revanchism CB', () => {
    const r = makeRegion(7);
    (r as unknown as { nationProclaimed: boolean }).nationProclaimed = true;
    const rv = ensureRival(r);

    rv.relations = r.clampRel(-80);
    rv.treaties = [];
    r.startPlayerWar(rv, 'revanchism', true);

    const log: Array<{ text: string }> = (r as unknown as { log: { text: string }[] }).log;
    const warEntry = log.find(e => e.text.includes('revenge') || e.text.includes('vengeance') || e.text.includes('forgiven'));
    expect(warEntry).toBeDefined();
  });

  it('ordinary defensive war keeps the generic message', () => {
    const r = makeRegion(7);
    (r as unknown as { nationProclaimed: boolean }).nationProclaimed = true;
    const rv = ensureRival(r);

    rv.relations = r.clampRel(-80);
    rv.treaties = [];
    r.startPlayerWar(rv, 'border_dispute', true);

    const log: Array<{ text: string }> = (r as unknown as { log: { text: string }[] }).log;
    const warEntry = log.find(e => e.text.includes('defensive war'));
    expect(warEntry).toBeDefined();
  });

  it('revanchism war sets CB to "revanchism" on playerWar', () => {
    const r = makeRegion(7);
    const rv = ensureRival(r);
    (r as unknown as { nationProclaimed: boolean }).nationProclaimed = true;
    rv.treaties = [];
    r.startPlayerWar(rv, 'revanchism', true);
    expect(r.playerWar?.cb).toBe('revanchism');
    expect(r.playerWar?.defensive).toBe(true);
  });
});
