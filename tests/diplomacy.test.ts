import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/sim';
import {
  RegionSim, REGION_MINUTES_PER_TICK, RIVAL_ARCHETYPES, RIVAL_REGIMES, TREATY_DEFS,
  ENVOY_COST, GIFT_COST, MAX_RIVALS, RIVAL_EMERGENCE_YEAR, TREATY_BREACH_PENALTY,
} from '../src/sim/region';
import { MINUTES_PER_DAY, DAYS_PER_YEAR, START_YEAR } from '../src/sim/defs';

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

/** A flipped region promoted to State, the way the other suites do it. */
function stateReady(seed = 42): RegionSim {
  const { r } = flippedPair(seed);
  r.stateProclaimed = true;
  r.stateName = 'Testonia';
  r.govLean = 'council';
  r.treasury = 500;
  return r;
}

function toYear(r: RegionSim, year: number): void {
  const target = (year - START_YEAR) * DAYS_PER_YEAR * MINUTES_PER_DAY;
  if (r.minute < target) r.minute = target;
}

describe('Rival nations (GDD §6.2–6.3)', () => {
  it('spawnRival builds a power from its archetype weights and announces it', () => {
    const r = stateReady();
    const rv = r.spawnRival('trading_republic')!;
    expect(rv).not.toBeNull();
    // jitter is ±1 around the §6.3 preset
    expect(Math.abs(rv.weights.commerce - RIVAL_ARCHETYPES.trading_republic.weights.commerce)).toBeLessThanOrEqual(1);
    expect(Math.abs(rv.weights.honor - RIVAL_ARCHETYPES.trading_republic.weights.honor)).toBeLessThanOrEqual(1);
    expect(rv.agenda.length).toBeGreaterThan(0);
    expect(rv.pop).toBeGreaterThan(1000); // nation-scale from day one (§6.4)
    expect(r.log.some((l) => l.text.includes('A NEW POWER'))).toBe(true);
  });

  it('the world holds at most MAX_RIVALS powers', () => {
    const r = stateReady();
    for (let i = 0; i < MAX_RIVALS; i++) expect(r.spawnRival()).not.toBeNull();
    expect(r.spawnRival()).toBeNull();
    expect(r.rivals).toHaveLength(MAX_RIVALS);
  });

  it('rivals emerge on the world\'s own clock once the era opens', () => {
    const r = stateReady();
    toYear(r, RIVAL_EMERGENCE_YEAR);
    expect(r.rivals).toHaveLength(0);
    runDays(r, 20 * DAYS_PER_YEAR); // by ~1942 the band has fired
    expect(r.rivals.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Diplomacy verbs (GDD §5.4)', () => {
  it('envoys cost treasury, warm relations, and have a cooldown', () => {
    const r = stateReady();
    const rv = r.spawnRival('trading_republic')!;
    const before = rv.relations;
    const cash = r.treasury;
    expect(r.sendEnvoy(rv.id)).toBe(true);
    expect(rv.relations).toBeGreaterThan(before);
    expect(r.treasury).toBe(cash - ENVOY_COST);
    expect(r.sendEnvoy(rv.id)).toBe(false); // cooldown
  });

  it('gifts are dearer and faster, with their own cooldown', () => {
    const r = stateReady();
    const rv = r.spawnRival('hegemon')!;
    const before = rv.relations;
    expect(r.sendGift(rv.id)).toBe(true);
    expect(rv.relations).toBeGreaterThan(before);
    expect(r.treasury).toBe(500 - GIFT_COST);
    expect(r.sendGift(rv.id)).toBe(false);
  });

  it('treaties are personality-priced: cold rivals walk away, warm ones sign', () => {
    const r = stateReady();
    const rv = r.spawnRival('hermit_kingdom')!;
    rv.relations = -50;
    expect(r.proposeTreaty(rv.id, 'defensive_pact')).toBe(false);
    expect(rv.treaties).toHaveLength(0);
    expect(r.log.some((l) => l.text.includes('declines'))).toBe(true);
    rv.relations = 80;
    expect(r.proposeTreaty(rv.id, 'trade_agreement')).toBe(true);
    expect(rv.treaties).toContain('trade_agreement');
    expect(r.proposeTreaty(rv.id, 'trade_agreement')).toBe(false); // already signed
  });

  it('a trade agreement pays monthly export earnings into the treasury', () => {
    const r = stateReady();
    const rv = r.spawnRival('trading_republic')!;
    rv.relations = 60;
    expect(r.proposeTreaty(rv.id, 'trade_agreement')).toBe(true);
    runDays(r, 35); // at least one monthly economy pass
    expect(r.exportEarningsLastMonth).toBeGreaterThan(0);
  });

  it('breaking a treaty is remembered: relations drop and every future ask rises', () => {
    const r = stateReady();
    const rv = r.spawnRival('trading_republic')!;
    rv.relations = 60;
    r.proposeTreaty(rv.id, 'trade_agreement');
    const askBefore = r.treatyAsk(rv, 'non_aggression');
    const relBefore = rv.relations;
    expect(r.breakTreaty(rv.id, 'trade_agreement')).toBe(true);
    expect(rv.treaties).toHaveLength(0);
    expect(r.treatiesBroken).toBe(1);
    expect(rv.relations).toBeLessThan(relBefore);
    expect(r.treatyAsk(rv, 'non_aggression')).toBe(askBefore + TREATY_BREACH_PENALTY);
  });

  it('AI-initiated offers can be signed or declined from the panel', () => {
    const r = stateReady();
    const a = r.spawnRival('trading_republic')!;
    const b = r.spawnRival('hegemon')!;
    r.offers.push({ rivalId: a.id, kind: 'trade_agreement', expiresDay: r.day + 90 });
    r.offers.push({ rivalId: b.id, kind: 'non_aggression', expiresDay: r.day + 90 });
    expect(r.acceptOffer(a.id)).toBe(true);
    expect(a.treaties).toContain('trade_agreement');
    const relBefore = b.relations;
    expect(r.declineOffer(b.id)).toBe(true);
    expect(b.treaties).toHaveLength(0);
    expect(b.relations).toBeLessThan(relBefore); // a remembered slight
    expect(r.offers).toHaveLength(0);
  });
});

describe('Hostility & the wider world (GDD §6.4)', () => {
  it('a non-aggression pact takes a rival off the hostile list', () => {
    const r = stateReady();
    const rv = r.spawnRival('hegemon')!;
    rv.relations = -60;
    expect(r.hostileRivals()).toHaveLength(1);
    rv.treaties.push('non_aggression');
    expect(r.hostileRivals()).toHaveLength(0);
  });

  it('hostile rivals sponsor raids — rifles of foreign make turn up', () => {
    const r = stateReady();
    const rv = r.spawnRival('hegemon')!;
    rv.relations = -80;
    const t = r.settlements[0];
    // sponsorship is a coin flip per raid; ten raids make it near-certain
    for (let i = 0; i < 10; i++) (r as any).eventRaid(t);
    expect(r.log.some((l) => l.text.includes('foreign make'))).toBe(true);
  });
});

describe('The world between the powers (GDD §6.3–6.4)', () => {
  it('regimes are era-gated: no fascism in 1900, richer pools later', () => {
    const r = stateReady();
    const early = r.spawnRival()!;
    expect(RIVAL_REGIMES.find((g) => g.id === early.regime)!.eraFrom).toBeLessThanOrEqual(r.year);
    toYear(r, 1935);
    const late = r.spawnRival()!;
    const def = RIVAL_REGIMES.find((g) => g.id === late.regime)!;
    expect(def.eraFrom).toBeLessThanOrEqual(1935);
  });

  it('every power arrives with a founding history and writes more of it', () => {
    const r = stateReady();
    const rv = r.spawnRival('hegemon')!;
    expect(rv.history.length).toBeGreaterThanOrEqual(1);
    expect(rv.history[0]).toContain('Proclaimed');
  });

  it('the world keeps its own ledger: every pair of powers has relations', () => {
    const r = stateReady();
    r.spawnRival('hegemon');
    r.spawnRival('trading_republic');
    r.spawnRival('hermit_kingdom');
    expect(Object.keys(r.rivalPairs)).toHaveLength(3); // 3 powers = 3 pairs
  });

  it('foreign wars set the pair at daggers, arm the export boom, and make news', () => {
    const r = stateReady();
    const a = r.spawnRival('hegemon')!;
    const b = r.spawnRival('crusader_state')!;
    expect(r.startForeignWar(a.id, b.id)).toBe(true);
    expect(r.warBetween(a.id, b.id)).toBeDefined();
    expect(r.pairRelations(a.id, b.id)).toBeLessThanOrEqual(-60);
    expect(r.warBoomUntil).toBeGreaterThan(r.day);
    expect(r.log.some((l) => l.text.includes('WAR ABROAD'))).toBe(true);
    expect(r.startForeignWar(a.id, b.id)).toBe(false); // already at war
  });

  it('wars end in a dictated peace: history written, loser sometimes toppled', () => {
    const r = stateReady();
    const a = r.spawnRival('hegemon')!;
    const b = r.spawnRival('opportunist')!;
    r.startForeignWar(a.id, b.id);
    r.foreignWars[0].endsDay = r.day + 31; // bring the peace forward
    runDays(r, 70);
    expect(r.foreignWars).toHaveLength(0);
    expect(r.log.some((l) => l.text.includes('PEACE ABROAD'))).toBe(true);
    const all = [...a.history, ...b.history].join(' ');
    expect(all).toContain('Defeated by');
    expect(all).toContain('Victorious over');
  });

  it('refugee waves from foreign wars reach the valley\'s towns', () => {
    const r = stateReady();
    const a = r.spawnRival('hegemon')!;
    const b = r.spawnRival('crusader_state')!;
    r.startForeignWar(a.id, b.id);
    r.foreignWars[0].endsDay = r.day + 10000; // a long war
    runDays(r, 24 * 30); // 24 monthly ticks at 20% each
    expect(r.log.some((l) => l.text.includes('Refugees from the'))).toBe(true);
  });

  it('allies do not go to war with each other', () => {
    const r = stateReady();
    const a = r.spawnRival('hegemon')!;
    const b = r.spawnRival('crusader_state')!;
    const key = r.pairKey(a.id, b.id);
    r.alliances.push(key);
    r.rivalPairs[key] = -80; // even at daggers drawn, the pact holds
    runDays(r, 24 * 30);
    expect(r.warBetween(a.id, b.id)).toBeUndefined();
  });
});

describe('Diplomacy save/load', () => {
  it('round-trips rivals, treaties, offers, and the reputation ledger', () => {
    const { sim, r } = flippedPair(42);
    r.stateProclaimed = true;
    r.stateName = 'Testonia';
    r.govLean = 'council';
    r.treasury = 500;
    const rv = r.spawnRival('trading_republic')!;
    const foe = r.spawnRival('hegemon')!;
    rv.relations = 55;
    r.proposeTreaty(rv.id, 'trade_agreement');
    r.offers.push({ rivalId: rv.id, kind: 'non_aggression', expiresDay: r.day + 90 });
    r.treatiesBroken = 1;
    r.startForeignWar(rv.id, foe.id);
    const town = Simulation.deserialize(sim.serialize());
    const r2 = RegionSim.deserialize(r.serialize(), town);
    expect(r2.rivals.map((x) => [x.name, x.archetype, x.regime, x.treaties, x.history])).toEqual(
      r.rivals.map((x) => [x.name, x.archetype, x.regime, x.treaties, x.history]));
    expect(r2.rivals[0].relations).toBe(r.rivals[0].relations);
    expect(r2.offers).toEqual(r.offers);
    expect(r2.treatiesBroken).toBe(1);
    expect(r2.rivalPairs).toEqual(r.rivalPairs);
    expect(r2.foreignWars).toEqual(r.foreignWars);
    expect(r2.alliances).toEqual(r.alliances);
  });

  it('pre-diplomacy saves load with an empty world', () => {
    const { sim, r } = flippedPair(42);
    const d = JSON.parse(r.serialize());
    delete d.rivals;
    delete d.offers;
    delete d.treatiesBroken;
    delete d.warBoomUntil;
    const town = Simulation.deserialize(sim.serialize());
    const r2 = RegionSim.deserialize(JSON.stringify(d), town);
    expect(r2.rivals).toEqual([]);
    expect(r2.offers).toEqual([]);
    expect(r2.treatiesBroken).toBe(0);
    runDays(r2, 3); // and it still ticks
  });
});
