import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/sim';
import {
  RegionSim, REGION_MINUTES_PER_TICK, CASUS_BELLI_DEFS, PEACE_TERMS, RIVAL_REGIMES,
} from '../src/sim/region';
import { MINUTES_PER_DAY } from '../src/sim/defs';

const ticksPerDay = MINUTES_PER_DAY / REGION_MINUTES_PER_TICK;

function grow(sim: Simulation): void {
  while (sim.settlers.length < 22) sim.spawnSettler(32, 34);
  sim.stock.wood = 200;
  sim.stock.meal = 200;
}

function runDays(r: RegionSim, days: number): void {
  for (let i = 0; i < days * ticksPerDay; i++) r.tick();
}

function flippedPair(seed: number): { sim: Simulation; r: RegionSim } {
  const sim = new Simulation(seed);
  grow(sim);
  const r = RegionSim.fromTown(sim, 8, 80, 80);
  runDays(r, 5);
  return { sim, r };
}

/** A flipped region promoted all the way to Nation — war is Tier-3 (GDD §7). */
function nationReady(seed = 42): RegionSim {
  const { r } = flippedPair(seed);
  r.stateProclaimed = true;
  r.stateName = 'Testonia';
  r.govLean = 'council';
  r.treasury = 500;
  r.proclaimNation('Testland', 'democracy', {});
  return r;
}

describe('Casus belli & declaration (GDD §7.1)', () => {
  it('war is nation-tier: a mere State cannot declare', () => {
    const { r } = flippedPair(42);
    r.stateProclaimed = true;
    r.stateName = 'Testonia';
    r.govLean = 'council';
    const rv = r.spawnRival('hegemon')!;
    rv.relations = -80;
    expect(r.declareWar(rv.id, 'fabricated')).toBe(false);
  });

  it('honest grievances must be earned: CB list widens with their hostility', () => {
    const r = nationReady();
    const rv = r.spawnRival('trading_republic')!;
    rv.relations = 20;
    expect(r.availableCasusBelli(rv)).toEqual(['fabricated']);
    rv.relations = -30;
    expect(r.availableCasusBelli(rv)).toEqual(['border_dispute', 'fabricated']);
    rv.relations = -60;
    expect(r.availableCasusBelli(rv)).toEqual(['sponsored_raids', 'border_dispute', 'fabricated']);
    rv.treaties.push('non_aggression'); // a NAP fences off the raid grievance
    expect(r.availableCasusBelli(rv)).toEqual(['border_dispute', 'fabricated']);
  });

  it('CB quality sets war support at declaration; defensive wars start at 85', () => {
    const r = nationReady();
    const rv = r.spawnRival('hegemon')!;
    rv.relations = -60;
    expect(r.declareWar(rv.id, 'sponsored_raids')).toBe(true);
    expect(r.playerWar!.support).toBe(CASUS_BELLI_DEFS.sponsored_raids.support);
    expect(rv.relations).toBeLessThanOrEqual(-60);
    expect(r.log.some((l) => l.text.includes('WAR DECLARED'))).toBe(true);
    expect(r.declareWar(rv.id, 'fabricated')).toBe(false); // one front at a time
  });

  it('a fabricated incident costs legitimacy and is priced like a broken seal', () => {
    const r = nationReady();
    const rv = r.spawnRival('trading_republic')!;
    rv.relations = 20;
    const leg = r.legitimacy;
    expect(r.declareWar(rv.id, 'fabricated')).toBe(true);
    expect(r.legitimacy).toBe(leg - 10);
    expect(r.treatiesBroken).toBe(1);
    expect(r.playerWar!.support).toBe(40);
  });

  it('declaring war tears up the ink and the chanceries take note', () => {
    const r = nationReady();
    const rv = r.spawnRival('trading_republic')!;
    rv.relations = 60;
    r.proposeTreaty(rv.id, 'trade_agreement');
    rv.relations = -30;
    expect(r.declareWar(rv.id, 'border_dispute')).toBe(true);
    expect(rv.treaties).toHaveLength(0);
    expect(r.treatiesBroken).toBe(1);
  });

  it('an emboldened hostile power can declare war on the player', () => {
    const r = nationReady();
    const rv = r.spawnRival('hegemon')!;
    for (let i = 0; i < 120 && !r.playerWar; i++) {
      rv.relations = -90;
      runDays(r, 30);
    }
    expect(r.playerWar).not.toBeNull();
    expect(r.playerWar!.defensive).toBe(true);
    expect(r.playerWar!.support).toBe(85);
  });

  it('no envoys, gifts, or treaties cross the front', () => {
    const r = nationReady();
    const rv = r.spawnRival('trading_republic')!;
    rv.relations = -30;
    r.declareWar(rv.id, 'border_dispute');
    expect(r.sendEnvoy(rv.id)).toBe(false);
    expect(r.sendGift(rv.id)).toBe(false);
    expect(r.proposeTreaty(rv.id, 'non_aggression')).toBe(false);
  });
});

describe('Mobilization & the front (GDD §7.2–7.3)', () => {
  it('mobilization multiplies combat power — and democracies reach Total slowly', () => {
    const r = nationReady();
    const rv = r.spawnRival('hegemon')!;
    rv.relations = -60;
    r.declareWar(rv.id, 'sponsored_raids');
    const peacetime = r.warPower();
    expect(r.setMobilization('partial')).toBe(true);
    expect(r.warPower()).toBeGreaterThan(peacetime);
    // a war of choice: the chamber refuses Total before six months
    r.playerWar!.defensive = false;
    expect(r.setMobilization('total')).toBe(false);
    r.playerWar!.startedDay -= 200;
    expect(r.setMobilization('total')).toBe(true);
  });

  it('a defensive war unlocks Total mobilization at once', () => {
    const r = nationReady();
    const rv = r.spawnRival('hegemon')!;
    rv.relations = -60;
    r.declareWar(rv.id, 'sponsored_raids');
    r.playerWar!.defensive = true;
    expect(r.setMobilization('total')).toBe(true);
  });

  it('the front moves on the power ratio and attrition scars the cohorts', () => {
    const r = nationReady();
    const rv = r.spawnRival('trading_republic')!;
    rv.relations = -30;
    r.declareWar(rv.id, 'border_dispute');
    r.militiaLevel = 4;  // a funded, drilled army…
    rv.pop = 50;         // …against a hollow shell of a power
    runDays(r, 95); // three monthly resolutions
    expect(r.playerWar!.score).toBeGreaterThan(0);
    expect(r.playerWar!.casualties).toBeGreaterThan(0);
  });
});

describe('War support & the home front (GDD §7.4–7.5)', () => {
  it('when support breaks through the regime floor, the war ends on their terms', () => {
    const r = nationReady();
    const rv = r.spawnRival('hegemon')!;
    rv.relations = -60;
    r.declareWar(rv.id, 'sponsored_raids');
    r.playerWar!.support = 20; // democracy floor is 45; the break line is 30
    runDays(r, 35);
    expect(r.playerWar).toBeNull();
    expect(r.log.some((l) => l.text.includes('HOME FRONT BREAKS'))).toBe(true);
    expect(r.log.some((l) => l.text.includes('DEFEAT'))).toBe(true);
  });

  it('a collapsing war score means a dictated peace: treasury and people pay', () => {
    const r = nationReady();
    const rv = r.spawnRival('hegemon')!;
    rv.relations = -60;
    r.declareWar(rv.id, 'sponsored_raids');
    rv.pop = 1_000_000; // an unwinnable war
    r.playerWar!.score = -55;
    const cash = (r.treasury = 400);
    const leg = r.legitimacy;
    runDays(r, 35);
    expect(r.playerWar).toBeNull();
    expect(r.treasury).toBeLessThan(cash);
    expect(r.legitimacy).toBeLessThan(leg);
    expect(rv.history.some((h) => h.includes('Dictated peace'))).toBe(true);
  });
});

describe('The peace table (GDD §7.4)', () => {
  function atWar(arch: 'hegemon' | 'trading_republic' = 'trading_republic') {
    const r = nationReady();
    const rv = r.spawnRival(arch)!;
    rv.relations = -30;
    r.declareWar(rv.id, 'border_dispute');
    return { r, rv };
  }

  it('terms are priced in war score with a grudge premium, and overreach is refused', () => {
    const { r, rv } = atWar();
    expect(r.peaceAsk(rv, 'reparations')).toBe(PEACE_TERMS.reparations.score + rv.weights.grudge * 2);
    r.playerWar!.score = 5;
    expect(r.offerPeace('regime_change')).toBe(false);
    expect(r.playerWar).not.toBeNull();
    expect(r.log.some((l) => l.text.includes('rejects the terms'))).toBe(true);
  });

  it('reparations: they pay the bill, the war ends, legitimacy recovers', () => {
    const { r, rv } = atWar();
    r.playerWar!.score = 100;
    const cash = r.treasury;
    const leg = r.legitimacy;
    expect(r.offerPeace('reparations')).toBe(true);
    expect(r.playerWar).toBeNull();
    expect(r.treasury).toBeGreaterThan(cash * 0.9); // tranche beats the demobilization bill
    expect(r.legitimacy).toBeGreaterThan(leg);
    expect(rv.history.some((h) => h.includes('Paid reparations'))).toBe(true);
  });

  it('annexing the border province is the Versailles trap: a revanchist for fifty years', () => {
    const { r, rv } = atWar();
    r.playerWar!.score = 100;
    const grudge = rv.weights.grudge;
    const popBefore = r.totalPop();
    expect(r.offerPeace('border_province')).toBe(true);
    expect(r.totalPop()).toBeGreaterThan(popBefore); // annexed souls join the nation
    expect(rv.weights.grudge).toBe(Math.min(10, grudge + 3));
    expect(rv.relations).toBe(-80);
    expect(rv.history.some((h) => h.includes('revanchists'))).toBe(true);
  });

  it('regime change topples their government and installs a friendlier one', () => {
    const { r, rv } = atWar('hegemon');
    const oldRegime = rv.regime;
    r.playerWar!.score = 100;
    expect(r.offerPeace('regime_change')).toBe(true);
    expect(rv.regime).not.toBe(oldRegime);
    expect(RIVAL_REGIMES.some((g) => g.id === rv.regime)).toBe(true);
    expect(rv.relations).toBe(15);
  });
});

describe('War save/load', () => {
  it('round-trips the player war', () => {
    const { sim, r } = flippedPair(42);
    r.stateProclaimed = true;
    r.stateName = 'Testonia';
    r.govLean = 'council';
    r.treasury = 500;
    r.proclaimNation('Testland', 'democracy', {});
    const rv = r.spawnRival('hegemon')!;
    rv.relations = -60;
    r.declareWar(rv.id, 'sponsored_raids');
    r.setMobilization('partial');
    r.playerWar!.score = 22;
    const town = Simulation.deserialize(sim.serialize());
    const r2 = RegionSim.deserialize(r.serialize(), town);
    expect(r2.playerWar).toEqual(r.playerWar);
  });

  it('pre-war saves load at peace', () => {
    const { sim, r } = flippedPair(42);
    const d = JSON.parse(r.serialize());
    delete d.playerWar;
    const town = Simulation.deserialize(sim.serialize());
    const r2 = RegionSim.deserialize(JSON.stringify(d), town);
    expect(r2.playerWar).toBeNull();
    runDays(r2, 3); // and it still ticks
  });
});
