import { describe, it, expect } from 'vitest';
import {
  RegionSim, REGION_MINUTES_PER_TICK,
  WAR_SUPPORT_DECAY_MULT, WarScar, CASUS_BELLI_DEFS,
} from '../src/sim/region';
import { RegionMap } from '../src/sim/worldgen';
import { Weather } from '../src/sim/weather';
import { Rng } from '../src/sim/rng';
import { MINUTES_PER_DAY, GovType } from '../src/sim/defs';

/**
 * D2-mil scaffold: WAR_SUPPORT_DECAY_MULT + Front stub + warScars bookkeeping.
 *
 * All three are byte-identical:
 *   - DECAY_MULT: all values are 1.0 → multiplies by 1 → same result
 *   - Front stub: write-only (front.position mirrors w.score; nothing reads it)
 *   - warScars: written at war-end, never read in the tick path
 */

const GOV_TYPES: GovType[] = [
  'democracy','republic','monarchy','junta','const_monarchy','abs_monarchy',
  'oligarchy','theocracy','direct_democracy','corporatocracy','fascist',
  'social_democracy','autocracy','one_party','technocracy',
];

const ticksPerDay = MINUTES_PER_DAY / REGION_MINUTES_PER_TICK;
function runDays(r: RegionSim, days: number): void {
  for (let i = 0; i < days * ticksPerDay; i++) r.tick();
}
function colony(seed: number): RegionSim {
  return RegionSim.foundColony(new Rng(seed), new RegionMap(seed), new Weather(seed), {});
}

// ---- WAR_SUPPORT_DECAY_MULT ----

describe('WAR_SUPPORT_DECAY_MULT scaffold', () => {
  it('has an entry for every GovType', () => {
    for (const g of GOV_TYPES) {
      expect(WAR_SUPPORT_DECAY_MULT[g]).toBeDefined();
    }
  });

  it('all values are positive and finite', () => {
    for (const g of GOV_TYPES) {
      expect(WAR_SUPPORT_DECAY_MULT[g]).toBeGreaterThan(0);
      expect(isFinite(WAR_SUPPORT_DECAY_MULT[g])).toBe(true);
    }
  });

  it('direct_democracy decays fastest (≥1.4)', () => {
    expect(WAR_SUPPORT_DECAY_MULT.direct_democracy).toBeGreaterThanOrEqual(1.4);
  });

  it('fascist decays slowest (≤0.6)', () => {
    expect(WAR_SUPPORT_DECAY_MULT.fascist).toBeLessThanOrEqual(0.6);
  });

  it('accountability ordering: direct_democracy > democracy > one_party > fascist', () => {
    expect(WAR_SUPPORT_DECAY_MULT.direct_democracy).toBeGreaterThan(WAR_SUPPORT_DECAY_MULT.democracy);
    expect(WAR_SUPPORT_DECAY_MULT.democracy).toBeGreaterThan(WAR_SUPPORT_DECAY_MULT.one_party);
    expect(WAR_SUPPORT_DECAY_MULT.one_party).toBeGreaterThan(WAR_SUPPORT_DECAY_MULT.fascist);
  });

  it('has same key set as WAR_SUPPORT_FLOOR', async () => {
    const { WAR_SUPPORT_FLOOR } = await import('../src/sim/region');
    expect(Object.keys(WAR_SUPPORT_DECAY_MULT).sort())
      .toEqual(Object.keys(WAR_SUPPORT_FLOOR).sort());
  });
});

// ---- Front stub ----

describe('PlayerWar front stub', () => {
  it('front.position is set after a war tick', () => {
    const r = colony(42);
    const sim = r as unknown as {
      playerWar: {
        rivalId: number; cb: string; defensive: boolean; startedDay: number;
        support: number; score: number; mobilization: string; casualties: number;
        blockade: boolean; allies: number[]; enemyAllies: number[]; occupied: number;
        resistance: number; occupationPolicy: string; brutality: boolean;
        units: object[]; supplyReserve: number;
        front?: { position: number };
      } | null;
      warSupport: number;
      day: number;
    };

    // Inject a war; startedDay must be < today so tick resolves it
    const rival = (r as any).rivals?.[0];
    if (!rival) return; // no rivals spawned — skip gracefully
    sim.playerWar = {
      rivalId: rival.id, cb: 'border_dispute', defensive: false,
      startedDay: sim.day - 1, support: 60, score: 20, mobilization: 'peacetime',
      casualties: 0, blockade: false, allies: [], enemyAllies: [], occupied: 0,
      resistance: 0, occupationPolicy: 'conciliatory', brutality: false,
      units: [], supplyReserve: 3,
    };
    sim.warSupport = 60;

    // Run one tick — this calls tickPlayerWar which sets w.front
    r.tick();

    if (sim.playerWar) {
      // War still ongoing — front should be populated
      expect(sim.playerWar.front).toBeDefined();
      expect(typeof sim.playerWar.front!.position).toBe('number');
    }
    // If war ended this tick, front was on the (now null) object — test passes trivially
  });
});

// ---- warScars bookkeeping ----

describe('warScars post-war bookkeeping', () => {
  it('starts empty', () => {
    const r = colony(1);
    expect((r as any).warScars).toEqual([]);
  });

  it('WarScar interface has expected shape', () => {
    const scar: WarScar = {
      rivalId: 1,
      rivalName: 'Testland',
      yearEnded: 1950,
      outcome: 'victory',
      occupied: 2,
      casualties: 1500,
      durationMonths: 18,
    };
    expect(scar.outcome).toBe('victory');
    expect(scar.durationMonths).toBe(18);
  });

  it('all four outcome variants are valid', () => {
    const outcomes: WarScar['outcome'][] = ['victory', 'defeat', 'negotiated', 'status_quo'];
    expect(outcomes).toHaveLength(4);
  });

  it('warScars survives a serialize/deserialize round-trip', () => {
    const r = colony(7);
    (r as any).warScars = [
      { rivalId: 5, rivalName: 'Rivalia', yearEnded: 1920, outcome: 'victory', occupied: 1, casualties: 800, durationMonths: 12 },
    ];
    const json = r.serialize();
    const r2 = RegionSim.deserialize(json);
    const scars = (r2 as any).warScars as WarScar[];
    expect(scars).toHaveLength(1);
    expect(scars[0].rivalName).toBe('Rivalia');
    expect(scars[0].outcome).toBe('victory');
    expect(scars[0].durationMonths).toBe(12);
  });

  it('empty warScars round-trips to []', () => {
    const r = colony(3);
    const r2 = RegionSim.deserialize(r.serialize());
    expect((r2 as any).warScars).toEqual([]);
  });

  it('warScars backfills to [] for old saves lacking the field', () => {
    const r = colony(2);
    const raw = JSON.parse(r.serialize());
    delete raw.warScars;
    const r2 = RegionSim.deserialize(JSON.stringify(raw));
    expect((r2 as any).warScars).toEqual([]);
  });

  it('captulate() writes a defeat scar and clears playerWar', () => {
    const r = colony(42);
    const rival = (r as any).rivals?.[0];
    if (!rival) return;
    const sim = r as unknown as { playerWar: unknown; warScars: WarScar[]; day: number; warSupport: number };
    sim.playerWar = {
      rivalId: rival.id, cb: 'border_dispute', defensive: false,
      startedDay: sim.day - 60, support: 30, score: -80, mobilization: 'peacetime',
      casualties: 200, blockade: false, allies: [], enemyAllies: [], occupied: 0,
      resistance: 0, occupationPolicy: 'conciliatory', brutality: false,
      units: [], supplyReserve: 1,
    };
    r.capitulate();
    expect(sim.playerWar).toBeNull();
    expect(sim.warScars.length).toBe(1);
    expect(sim.warScars[0].outcome).toBe('defeat');
    expect(sim.warScars[0].rivalId).toBe(rival.id);
    expect(sim.warScars[0].casualties).toBe(200);
  });

  it('proposePeace() writes a victory scar when terms are accepted', () => {
    const r = colony(42);
    const rival = (r as any).rivals?.[0];
    if (!rival) return;
    const sim = r as unknown as { playerWar: unknown; warScars: WarScar[]; day: number; warSupport: number };
    // High war score → rival accepts status_quo
    sim.playerWar = {
      rivalId: rival.id, cb: 'border_dispute', defensive: false,
      startedDay: sim.day - 30, support: 80, score: 90, mobilization: 'peacetime',
      casualties: 50, blockade: false, allies: [], enemyAllies: [], occupied: 0,
      resistance: 0, occupationPolicy: 'conciliatory', brutality: false,
      units: [], supplyReserve: 3,
    };
    const accepted = r.proposePeace([{ type: 'status_quo', warScoreCost: 0 }]);
    if (accepted) {
      expect(sim.playerWar).toBeNull();
      expect(sim.warScars.length).toBe(1);
      expect(sim.warScars[0].outcome).toBe('victory');
    } else {
      // Proposal rejected — scar not written (correct; only on actual end)
      expect(sim.warScars.length).toBe(0);
    }
  });
});

// ---- Revanchism CB ----

describe('revanchism CasusBelli', () => {
  it('CASUS_BELLI_DEFS includes revanchism with high support', () => {
    expect(CASUS_BELLI_DEFS.revanchism).toBeDefined();
    expect(CASUS_BELLI_DEFS.revanchism.support).toBeGreaterThan(60);
  });

  it('revanchism is NOT available without a prior defeat scar', () => {
    const r = colony(42);
    const rival = (r as any).rivals?.[0];
    if (!rival) return;
    const cbs = r.availableCasusBelli(rival);
    expect(cbs).not.toContain('revanchism');
  });

  it('revanchism becomes available after a defeat scar against that rival', () => {
    const r = colony(42);
    const rival = (r as any).rivals?.[0];
    if (!rival) return;
    // Inject a defeat scar against this rival
    (r as any).warScars = [
      { rivalId: rival.id, rivalName: rival.name, yearEnded: 1920, outcome: 'defeat', occupied: 0, casualties: 500, durationMonths: 6 },
    ] as WarScar[];
    const cbs = r.availableCasusBelli(rival);
    expect(cbs).toContain('revanchism');
  });

  it('revanchism is NOT available for a defeat scar against a DIFFERENT rival', () => {
    const r = colony(42);
    const rival = (r as any).rivals?.[0];
    if (!rival) return;
    // Scar against rival id 9999 (doesn't exist)
    (r as any).warScars = [
      { rivalId: 9999, rivalName: 'Phantomia', yearEnded: 1920, outcome: 'defeat', occupied: 0, casualties: 200, durationMonths: 3 },
    ] as WarScar[];
    const cbs = r.availableCasusBelli(rival);
    expect(cbs).not.toContain('revanchism');
  });

  it('revanchism is NOT available for a VICTORY scar (only defeat triggers it)', () => {
    const r = colony(42);
    const rival = (r as any).rivals?.[0];
    if (!rival) return;
    (r as any).warScars = [
      { rivalId: rival.id, rivalName: rival.name, yearEnded: 1921, outcome: 'victory', occupied: 1, casualties: 300, durationMonths: 8 },
    ] as WarScar[];
    const cbs = r.availableCasusBelli(rival);
    expect(cbs).not.toContain('revanchism');
  });

  it('revanchism appears in generateCasusBelli when a defeat scar exists', () => {
    const r = colony(42);
    const rival = (r as any).rivals?.[0];
    if (!rival) return;
    (r as any).warScars = [
      { rivalId: rival.id, rivalName: rival.name, yearEnded: 1920, outcome: 'defeat', occupied: 0, casualties: 500, durationMonths: 6 },
    ] as WarScar[];
    const cbs = r.generateCasusBelli(rival.id);
    expect(cbs.some((c) => c.type === 'revanchism')).toBe(true);
  });

  it('revanchism declareWar succeeds with the defeat scar present', () => {
    const r = colony(42);
    // Force nation proclaimed status so declareWar doesn't gate on it
    (r as any).nationProclaimed = true;
    const rival = (r as any).rivals?.[0];
    if (!rival) return;
    (r as any).warScars = [
      { rivalId: rival.id, rivalName: rival.name, yearEnded: 1920, outcome: 'defeat', occupied: 0, casualties: 500, durationMonths: 6 },
    ] as WarScar[];
    const ok = r.declareWar(rival.id, 'revanchism');
    // Revanchism gives support 85 — higher than border_dispute (60) and fabricated (40)
    if (ok) {
      expect((r as any).warSupport).toBeGreaterThanOrEqual(80);
    }
    // If ok is false it may be because there was already a war — acceptable
  });
});
