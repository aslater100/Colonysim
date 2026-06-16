import { describe, expect, it } from 'vitest';
import { AgentStore, AState } from '../src/sim/agents';
import { BuildGrid } from '../src/sim/build';
import { Stockpile } from '../src/sim/stockpile';
import { serveMedical } from '../src/sim/needs';
import { TownCore } from '../src/sim/towncore';
import { ROOM_TYPE_ID, TUNING, MINUTES_PER_TICK } from '../src/sim/defs';

// Stage 4 behavior port: wounds → infection → scar + fever on the SoA agent core,
// plus infirmary/medicine recovery. Mirrors the fat sim's medical chain (GDD §2.2).

const INFIRMARY = ROOM_TYPE_ID.get('infirmary')!;
const HOME = ROOM_TYPE_ID.get('home')!;
const noop = () => 0; // RNG that never triggers the infection roll (returns 0 < chance)
const always = () => 0.999; // RNG that always fails the infection roll

// One tick = 4 game-minutes; helper to express durations in ticks.
const ticksForHours = (h: number) => Math.ceil((h * 60) / MINUTES_PER_TICK);

describe('medical — wounds', () => {
  it('an untreated wound bleeds health over time', () => {
    const a = new AgentStore(2);
    const i = a.spawn(0, 0);
    a.inflictWound(i, 0);
    const start = a.health[i];
    for (let t = 0; t < 20; t++) a.tick(t, always); // a couple of game-hours, no fester yet
    expect(a.health[i]).toBeLessThan(start);
    expect(a.health[i]).toBeCloseTo(start - TUNING.woundBleedPerHour * (20 * MINUTES_PER_TICK / 60), 1);
  });

  it('an untended wound scars over (stops bleeding) after the self-heal window', () => {
    const a = new AgentStore(2);
    const i = a.spawn(0, 0);
    a.food[i] = 100; // well-fed so regen can show recovery after the scar
    a.inflictWound(i, 0);
    // Run just past the self-heal window; never rolls infection (always-fail RNG).
    const ticks = ticksForHours(TUNING.woundSelfHealHours) + 5;
    for (let t = 0; t < ticks; t++) a.tick(t, always);
    expect(a.woundUntreated[i]).toBe(0);
    expect(a.infection[i]).toBe(0);
    // With the wound gone and food high, health is now recovering, not bleeding.
    const h1 = a.health[i];
    for (let t = ticks; t < ticks + 10; t++) a.tick(t, always);
    expect(a.health[i]).toBeGreaterThanOrEqual(h1);
  });

  it('a wound can fester into an infection past the infection window', () => {
    const a = new AgentStore(2);
    const i = a.spawn(0, 0);
    a.inflictWound(i, 0);
    // RNG returns 0 → always under the infection chance → guaranteed fester.
    const ticks = ticksForHours(TUNING.infectionWindowHours) + 2;
    for (let t = 0; t < ticks; t++) a.tick(t, noop);
    expect(a.infectionRolled[i]).toBe(1);
    expect(a.infection[i]).toBe(1);
  });

  it('the infection roll fires only once', () => {
    const a = new AgentStore(2);
    const i = a.spawn(0, 0);
    a.inflictWound(i, 0);
    const ticks = ticksForHours(TUNING.infectionWindowHours) + 2;
    for (let t = 0; t < ticks; t++) a.tick(t, always); // always fails → never infects
    expect(a.infectionRolled[i]).toBe(1);
    expect(a.infection[i]).toBe(0);
  });

  it('infection bleeds faster than a plain wound', () => {
    const wound = new AgentStore(1);
    const wi = wound.spawn(0, 0);
    wound.inflictWound(wi, 0);
    wound.infectionRolled[wi] = 1; // suppress the fester roll so only the wound bleeds

    const infected = new AgentStore(1);
    const ii = infected.spawn(0, 0);
    infected.inflictWound(ii, 0);
    infected.infectionRolled[ii] = 1;
    infected.infection[ii] = 1;

    for (let t = 0; t < 30; t++) { wound.tick(t, always); infected.tick(t, always); }
    expect(infected.health[ii]).toBeLessThan(wound.health[wi]);
  });
});

describe('medical — fever', () => {
  it('a feverish agent bleeds health and is flagged sick, then recovers when it passes', () => {
    const a = new AgentStore(2);
    const i = a.spawn(0, 0);
    a.food[i] = 100;
    a.makeSick(i, 10); // sick until tick 10
    a.tick(0, always);
    expect(a.sick[i]).toBe(1);
    const sickHealth = a.health[i];
    expect(sickHealth).toBeLessThan(100); // fever bled some health
    // Past the fever, the sick flag clears and health recovers (well-fed).
    for (let t = 1; t < 40; t++) a.tick(t, always);
    expect(a.sick[i]).toBe(0);
    expect(a.health[i]).toBeGreaterThan(sickHealth);
  });

  it('a feverish worker produces slower than a well one', () => {
    function meals(sick: boolean): number {
      const g = new BuildGrid(10, 10);
      const stock = new Stockpile();
      const agents = new AgentStore(2);
      g.designateRect(1, 1, 3, 3, ROOM_TYPE_ID.get('kitchen')!);
      const oven = g.placeStation('oven', 1, 1)!;
      g.rebuildRooms();
      stock.add('grain', 1000);
      const i = agents.spawn(1, 1);
      agents.assignStation(i, oven.id);
      if (sick) agents.sick[i] = 1;
      for (let t = 0; t < 60; t++) g.tickProduction(agents, stock, MINUTES_PER_TICK);
      return stock.count('meal');
    }
    expect(meals(true)).toBeLessThan(meals(false));
  });
});

describe('medical — infirmary recovery (serveMedical)', () => {
  function infirmary(beds: number): { g: BuildGrid; a: AgentStore; stock: Stockpile } {
    const g = new BuildGrid(12, 12);
    g.designateRect(2, 2, 6, 6, INFIRMARY);
    for (let x = 1; x <= 7; x++) { g.setWall(x, 1); g.setWall(x, 7); }
    for (let y = 1; y <= 7; y++) { g.setWall(1, y); g.setWall(7, y); }
    for (let k = 0; k < beds; k++) g.placeStation('sickbed', 2 + k, 2);
    g.rebuildRooms();
    return { g, a: new AgentStore(4), stock: new Stockpile() };
  }

  it('a sleeping patient in an infirmary heals faster than one resting in the open', () => {
    const { g, a, stock } = infirmary(2);
    const inBed = a.spawn(3, 3);   // inside the infirmary
    const outside = a.spawn(10, 10); // no room
    for (const i of [inBed, outside]) { a.state[i] = AState.Sleeping; a.health[i] = 50; a.food[i] = 100; }
    for (let t = 0; t < 30; t++) {
      serveMedical(g, a, stock);
      a.tick(t, noop);
    }
    expect(a.health[inBed]).toBeGreaterThan(a.health[outside]);
  });

  it('medicine cures a wound + infection and is consumed', () => {
    const { g, a, stock } = infirmary(2);
    stock.add('medicine', 3);
    const i = a.spawn(3, 3);
    a.state[i] = AState.Sleeping;
    a.inflictWound(i, 0);
    a.infection[i] = 1;
    serveMedical(g, a, stock);
    expect(a.woundUntreated[i]).toBe(0);
    expect(a.infection[i]).toBe(0);
    expect(stock.count('medicine')).toBe(2); // one unit consumed
  });

  it('medical capacity caps simultaneous patients (only as many as there are sickbeds)', () => {
    const { g, a, stock } = infirmary(1); // a single sickbed
    const p1 = a.spawn(3, 3);
    const p2 = a.spawn(4, 3);
    for (const i of [p1, p2]) { a.state[i] = AState.Sleeping; a.health[i] = 50; }
    serveMedical(g, a, stock);
    const boosted = [p1, p2].filter((i) => a.healMult[i] > 1).length;
    expect(boosted).toBe(1); // only one bed → only one patient gets the clinic bonus
  });

  it('resets healMult to 1 for agents not in a sickbed', () => {
    const { g, a, stock } = infirmary(1);
    const i = a.spawn(10, 10); // outside any room
    a.healMult[i] = 5; // stale from a prior tick
    serveMedical(g, a, stock);
    expect(a.healMult[i]).toBe(1);
  });
});

describe('medical — serialization', () => {
  it('round-trips wound / infection / fever state; transient flags reset', () => {
    const a = new AgentStore(2);
    const i = a.spawn(1, 1);
    a.inflictWound(i, 7);
    a.infectionRolled[i] = 1;
    a.infection[i] = 1;
    a.makeSick(i, 99);
    a.sick[i] = 1; a.healMult[i] = 2; // transient — should not persist
    const r = AgentStore.deserialize(a.serialize());
    expect(r.woundUntreated[0]).toBe(1);
    expect(r.woundAt[0]).toBeCloseTo(7);
    expect(r.infectionRolled[0]).toBe(1);
    expect(r.infection[0]).toBe(1);
    expect(r.sickUntilTick[0]).toBeCloseTo(99);
    expect(r.sick[0]).toBe(0);     // recomputed next tick
    expect(r.healMult[0]).toBe(1); // recomputed next tick
  });

  it('backfills healthy state for pre-medical saves', () => {
    const a = new AgentStore(2);
    a.spawn(0, 0);
    const save = a.serialize() as Record<string, unknown>;
    delete save.woundUntreated; delete save.infection; delete save.sickUntilTick;
    delete save.woundAt; delete save.infectionRolled;
    const r = AgentStore.deserialize(save as never);
    expect(r.woundUntreated[0]).toBe(0);
    expect(r.infection[0]).toBe(0);
    expect(r.sickUntilTick[0]).toBe(0);
  });
});

describe('medical — TownCore integration', () => {
  it('a wounded founder is healed by an infirmary with medicine, and survives', () => {
    const core = new TownCore({ width: 24, height: 24, seed: 5 });
    const g = core.grid;
    // A walled infirmary with two sickbeds.
    g.designateRect(2, 2, 6, 6, INFIRMARY);
    for (let x = 1; x <= 7; x++) { g.setWall(x, 1); g.setWall(x, 7); }
    for (let y = 1; y <= 7; y++) { g.setWall(1, y); g.setWall(7, y); }
    g.placeStation('sickbed', 2, 2);
    g.placeStation('sickbed', 3, 2);
    g.rebuildRooms();
    core.stock.add('medicine', 5);
    core.seedColony(3, 3, 2); // founders spawn inside the infirmary
    // Wound one founder and let them rest there.
    core.agents.inflictWound(0, core.tickNo);
    core.agents.state[0] = AState.Sleeping;
    core.agents.rest[0] = 10;
    const before = core.population;
    core.run(40);
    expect(core.population).toBe(before); // nobody died of the wound
    expect(core.agents.infection[0]).toBe(0);
  });
});

describe('exposure — freezing is lethal (warmth ≤ 0)', () => {
  it('deep cold bleeds health where a warm settler holds steady', () => {
    const a = new AgentStore(2);
    const cold = a.spawn(0, 0);
    const warm = a.spawn(1, 0);
    a.food[cold] = a.food[warm] = 100; // well-fed isolates cold from starvation
    a.warmth[cold] = 0;                 // frozen through (warmth isn't regened in tick())
    a.warmth[warm] = 80;
    const startCold = a.health[cold];
    const ticks = ticksForHours(6);
    for (let t = 0; t < ticks; t++) a.tick(t, always);
    expect(a.health[cold]).toBeLessThan(startCold); // froze
    expect(a.health[warm]).toBe(100);               // unharmed (regen-capped)
  });

  it('prolonged deep cold is fatal (health reaches zero)', () => {
    const a = new AgentStore(1);
    const i = a.spawn(0, 0);
    a.food[i] = 100;     // not starvation — this is the cold alone
    a.warmth[i] = 0;
    const ticks = ticksForHours(150); // ~100 hp at the freeze bleed rate → dead well inside
    for (let t = 0; t < ticks; t++) a.tick(t, always);
    expect(a.health[i]).toBeLessThanOrEqual(0);
  });
});
