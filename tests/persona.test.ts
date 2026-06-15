import { describe, expect, it } from 'vitest';
import { AgentStore, AState, STARTING_SKILL, Housing } from '../src/sim/agents';
import { BuildGrid } from '../src/sim/build';
import { Stockpile } from '../src/sim/stockpile';
import { serveNeeds } from '../src/sim/needs';
import { TRAIT_DEFS, ROOM_TYPE_ID, MINUTES_PER_TICK } from '../src/sim/defs';

// Stage 4 behavior port: traits + skills on the SoA agent core. The fat-object
// sim carries `traits: string[]` + per-WorkKind `skills`; here trait effects
// collapse into flat multiplier columns at spawn, and a single craft `skill`
// column accelerates production and grows while working.

const idx = (id: string) => TRAIT_DEFS.findIndex((t) => t.id === id);
const KITCHEN = ROOM_TYPE_ID.get('kitchen')!;
const noop = () => 0;

// Assign a specific pair of traits by id (deterministic, no RNG).
function setTraits(a: AgentStore, i: number, t0: string, t1: string): void {
  a.trait0[i] = idx(t0);
  a.trait1[i] = idx(t1);
  // applyTraits is private; round-trip through serialize/deserialize re-derives the
  // collapsed columns from the trait indices — the same path a save load uses.
  const r = AgentStore.deserialize(a.serialize());
  a.workSpeedMult[i] = r.workSpeedMult[i];
  a.moodBaseBonus[i] = r.moodBaseBonus[i];
  a.warmthDecayMult[i] = r.warmthDecayMult[i];
  a.foodDecayMult[i] = r.foodDecayMult[i];
  a.housingPref[i] = r.housingPref[i];
}

describe('persona — defaults', () => {
  it('a fresh agent is competent (skill 5) and untraited (all mults neutral)', () => {
    const a = new AgentStore(4);
    const i = a.spawn(0, 0);
    expect(a.skill[i]).toBe(STARTING_SKILL);
    expect(a.trait0[i]).toBe(-1);
    expect(a.trait1[i]).toBe(-1);
    expect(a.workSpeedMult[i]).toBe(1);
    expect(a.foodDecayMult[i]).toBe(1);
    expect(a.warmthDecayMult[i]).toBe(1);
    expect(a.moodBaseBonus[i]).toBe(0);
    expect(a.housingPref[i]).toBe(Housing.None);
  });
});

describe('persona — trait roll', () => {
  it('rollTraits assigns two distinct traits', () => {
    const a = new AgentStore(4);
    const i = a.spawn(0, 0);
    let rng = 1;
    const rand = () => (rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    a.rollTraits(i, rand);
    expect(a.trait0[i]).toBeGreaterThanOrEqual(0);
    expect(a.trait1[i]).toBeGreaterThanOrEqual(0);
    expect(a.trait0[i]).not.toBe(a.trait1[i]);
  });

  it('collapses trait effects into the multiplier columns (industrious × hardy)', () => {
    const a = new AgentStore(4);
    const i = a.spawn(0, 0);
    setTraits(a, i, 'industrious', 'hardy');
    expect(a.workSpeedMult[i]).toBeCloseTo(1.15);   // industrious
    expect(a.warmthDecayMult[i]).toBeCloseTo(0.6);  // hardy
  });

  it('multiplies two work-speed traits multiplicatively (lazy × industrious)', () => {
    const a = new AgentStore(4);
    const i = a.spawn(0, 0);
    setTraits(a, i, 'lazy', 'industrious');
    expect(a.workSpeedMult[i]).toBeCloseTo(0.85 * 1.15);
  });

  it('sums mood base and takes the first housing preference', () => {
    const a = new AgentStore(4);
    const i = a.spawn(0, 0);
    setTraits(a, i, 'optimist', 'loner');
    expect(a.moodBaseBonus[i]).toBeCloseTo(8);          // optimist +8
    expect(a.housingPref[i]).toBe(Housing.Private);     // loner → private
  });
});

describe('persona — needs reflect traits', () => {
  it('a gourmand gets hungry faster than a neutral settler', () => {
    const a = new AgentStore(4);
    const neutral = a.spawn(0, 0);
    const greedy = a.spawn(0, 0);
    setTraits(a, greedy, 'gourmand', 'optimist'); // foodDecay 1.3
    for (let t = 0; t < 30; t++) a.tick(t, noop);
    expect(a.food[greedy]).toBeLessThan(a.food[neutral]);
  });

  it('a hardy settler keeps more warmth when exposed', () => {
    const g = new BuildGrid(8, 8); // no rooms → everyone is exposed
    const a = new AgentStore(4);
    const neutral = a.spawn(2, 2);
    const tough = a.spawn(2, 2);
    setTraits(a, tough, 'hardy', 'optimist'); // warmthDecay 0.6
    for (let t = 0; t < 20; t++) serveNeeds(g, a, MINUTES_PER_TICK);
    expect(a.warmth[tough]).toBeGreaterThan(a.warmth[neutral]);
  });

  it('an optimist settles to a higher mood than a pessimist with identical needs', () => {
    const a = new AgentStore(4);
    const up = a.spawn(0, 0);
    const down = a.spawn(0, 0);
    setTraits(a, up, 'optimist', 'industrious');
    setTraits(a, down, 'pessimist', 'industrious');
    // Freeze needs by topping them up each tick so only moodBase differs.
    for (let t = 0; t < 200; t++) {
      a.food[up] = a.rest[up] = a.warmth[up] = a.recreation[up] = a.social[up] = 60;
      a.food[down] = a.rest[down] = a.warmth[down] = a.recreation[down] = a.social[down] = 60;
      a.tick(t, noop);
    }
    expect(a.mood[up]).toBeGreaterThan(a.mood[down]);
  });
});

describe('persona — skill', () => {
  it('skill grows while Working and is capped at 10', () => {
    const a = new AgentStore(4);
    const i = a.spawn(0, 0);
    a.state[i] = AState.Working;
    const start = a.skill[i];
    for (let t = 0; t < 50; t++) a.tick(t, noop);
    expect(a.skill[i]).toBeGreaterThan(start);
    // Run long enough to saturate; never exceeds the cap.
    for (let t = 0; t < 100000; t++) a.tick(t, noop);
    expect(a.skill[i]).toBeLessThanOrEqual(10);
    expect(a.skill[i]).toBeCloseTo(10);
  });

  it('skill does not grow while idle', () => {
    const a = new AgentStore(4);
    const i = a.spawn(0, 0);
    a.state[i] = AState.Idle;
    const start = a.skill[i];
    for (let t = 0; t < 50; t++) a.tick(t, noop);
    expect(a.skill[i]).toBe(start);
  });

  it('a skilled / industrious worker produces faster than an unskilled one', () => {
    // Two identical kitchens, one worker each: a master vs a novice.
    function run(skill: number, traits: [string, string] | null): number {
      const g = new BuildGrid(10, 10);
      const stock = new Stockpile();
      const agents = new AgentStore(2);
      g.designateRect(1, 1, 3, 3, KITCHEN);
      const oven = g.placeStation('oven', 1, 1)!; // 2 grain → 2 meal, work=60
      g.rebuildRooms();
      stock.add('grain', 1000);
      const i = agents.spawn(1, 1);
      agents.assignStation(i, oven.id);
      agents.skill[i] = skill;
      if (traits) setTraits(agents, i, traits[0], traits[1]);
      for (let t = 0; t < 60; t++) g.tickProduction(agents, stock, MINUTES_PER_TICK);
      return stock.count('meal');
    }
    const novice = run(0, null);            // effort 0.5
    const competent = run(5, null);         // effort 1.0
    const master = run(10, ['industrious', 'optimist']); // effort 1.5 × 1.15
    expect(competent).toBeGreaterThan(novice);
    expect(master).toBeGreaterThan(competent);
  });

  it('skill-5 + neutral traits is exactly one worker of effort (back-compat)', () => {
    // The default persona must leave production bit-identical to the old headcount
    // model: a single default worker fires the 60-min oven at tick 15 (15×4=60).
    const g = new BuildGrid(10, 10);
    const stock = new Stockpile();
    const agents = new AgentStore(2);
    g.designateRect(1, 1, 3, 3, KITCHEN);
    const oven = g.placeStation('oven', 1, 1)!;
    g.rebuildRooms();
    stock.add('grain', 20);
    const i = agents.spawn(1, 1);
    agents.assignStation(i, oven.id);
    for (let t = 0; t < 14; t++) g.tickProduction(agents, stock, MINUTES_PER_TICK);
    expect(stock.count('meal')).toBe(0);
    g.tickProduction(agents, stock, MINUTES_PER_TICK);
    expect(stock.count('meal')).toBe(2);
  });
});

describe('persona — serialization', () => {
  it('round-trips skill + traits and re-derives the collapsed mults', () => {
    const a = new AgentStore(4);
    const i = a.spawn(3, 4);
    setTraits(a, i, 'industrious', 'gourmand');
    a.skill[i] = 7.5;
    const r = AgentStore.deserialize(a.serialize());
    expect(r.skill[0]).toBeCloseTo(7.5);
    expect(r.trait0[0]).toBe(a.trait0[i]);
    expect(r.trait1[0]).toBe(a.trait1[i]);
    expect(r.workSpeedMult[0]).toBeCloseTo(1.15);
    expect(r.foodDecayMult[0]).toBeCloseTo(1.3);
  });

  it('backfills a competent, untraited persona for pre-Stage-4 saves', () => {
    const a = new AgentStore(4);
    a.spawn(0, 0);
    const save = a.serialize() as Record<string, unknown>;
    delete save.skill; delete save.trait0; delete save.trait1; // simulate an old save
    const r = AgentStore.deserialize(save as never);
    expect(r.skill[0]).toBe(STARTING_SKILL);
    expect(r.trait0[0]).toBe(-1);
    expect(r.workSpeedMult[0]).toBe(1);
  });
});

// --- B-6 PART 3: settler names on the SoA store ---
describe('AgentStore names', () => {
  it('assigns a stable, deterministic name on spawn', () => {
    const a = new AgentStore(8);
    const i = a.spawn(1, 1);
    expect(a.name(i)).toMatch(/\S+ \S+/); // "First Last"
    const b = new AgentStore(8);
    const j = b.spawn(5, 5);
    expect(a.name(i)).toBe(b.name(j)); // same id → same name, no rng
  });

  it('keeps names aligned through swap-remove', () => {
    const a = new AgentStore(8);
    a.spawn(0, 0); a.spawn(1, 1); a.spawn(2, 2);
    const lastName = a.name(2);
    a.remove(0); // index 2 swaps down into 0
    expect(a.name(0)).toBe(lastName);
    expect(a.name(a.count)).toBe(''); // out of range
  });

  it('round-trips names through serialize/deserialize', () => {
    const a = new AgentStore(8);
    a.spawn(0, 0); a.spawn(1, 1);
    const names = [a.name(0), a.name(1)];
    const r = AgentStore.deserialize(a.serialize());
    expect([r.name(0), r.name(1)]).toEqual(names);
  });

  it('derives names from id for a pre-name save', () => {
    const a = new AgentStore(8);
    a.spawn(0, 0); a.spawn(1, 1);
    const save = a.serialize();
    delete save.names; // simulate an old save
    const r = AgentStore.deserialize(save);
    expect(r.name(0)).toBe(a.name(0));
    expect(r.name(1)).toBe(a.name(1));
  });
});

// Guard: a degenerate RNG must not hang the distinct-trait reroll.
describe('AgentStore.rollTraits robustness', () => {
  it('terminates and yields two distinct traits even with a constant rand', () => {
    const a = new AgentStore(2);
    const i = a.spawn(0, 0);
    a.rollTraits(i, () => 0.5); // constant: old code looped forever here
    expect(a.trait0[i]).not.toBe(a.trait1[i]);
    expect(a.trait0[i]).toBeGreaterThanOrEqual(0);
    expect(a.trait1[i]).toBeGreaterThanOrEqual(0);
  });
});
