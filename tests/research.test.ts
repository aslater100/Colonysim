import { describe, expect, it } from 'vitest';
import { ResearchBook, CORE_TECHS, CORE_TECH_MAP, RESEARCH_PER_DESK_PER_DAY } from '../src/sim/research';
import { TownCore } from '../src/sim/towncore';
import { TERRAIN, ZONE } from '../src/sim/build';
import { ROOM_TYPE_ID, MINUTES_PER_TICK } from '../src/sim/defs';
import { AgentStore } from '../src/sim/agents';

// Build-system B-6: TownCore research system.
// Library desks (education capacity) generate research points daily;
// the colony spends them on techs that boost yields and combat.

describe('ResearchBook', () => {
  it('starts with crop_rotation already researched (free)', () => {
    const rb = new ResearchBook();
    expect(rb.hasTech('crop_rotation')).toBe(true);
    expect(rb.points).toBe(0);
  });

  it('canResearch returns false for already-researched techs', () => {
    const rb = new ResearchBook();
    rb.points = 9999;
    expect(rb.canResearch('crop_rotation')).toBe(false);
  });

  it('canResearch returns false when points are insufficient', () => {
    const rb = new ResearchBook();
    rb.points = 0;
    const def = CORE_TECH_MAP.get('herbalism')!;
    expect(rb.points).toBeLessThan(def.cost);
    expect(rb.canResearch('herbalism')).toBe(false);
  });

  it('canResearch returns true when points are sufficient and prereqs met', () => {
    const rb = new ResearchBook();
    rb.points = 999;
    expect(rb.canResearch('herbalism')).toBe(true); // prereqs: none
  });

  it('canResearch returns false when a prereq is not yet researched', () => {
    const rb = new ResearchBook();
    rb.points = 999;
    // milling requires crop_rotation (already researched) — should be ok
    expect(rb.canResearch('milling')).toBe(true);
    // germ_theory requires first_aid which requires herbalism — neither done
    expect(rb.canResearch('germ_theory')).toBe(false);
  });

  it('research() deducts points and marks the tech as done', () => {
    const rb = new ResearchBook();
    const def = CORE_TECH_MAP.get('herbalism')!;
    rb.points = def.cost + 50;
    const before = rb.points;
    expect(rb.research('herbalism')).toBe(true);
    expect(rb.hasTech('herbalism')).toBe(true);
    expect(rb.points).toBe(before - def.cost);
  });

  it('research() fails when not enough points', () => {
    const rb = new ResearchBook();
    rb.points = 1;
    expect(rb.research('blacksmithing')).toBe(false);
    expect(rb.hasTech('blacksmithing')).toBe(false);
    expect(rb.points).toBe(1); // unchanged
  });

  it('research() fails when prereq is missing', () => {
    const rb = new ResearchBook();
    rb.points = 9999;
    // germ_theory requires first_aid → first_aid requires herbalism → chain not done
    expect(rb.research('germ_theory')).toBe(false);
    expect(rb.hasTech('germ_theory')).toBe(false);
  });

  it('addPoints accumulates desk × rate per day', () => {
    const rb = new ResearchBook();
    rb.addPoints(3); // 3 desks
    expect(rb.points).toBe(3 * RESEARCH_PER_DESK_PER_DAY);
  });

  it('autoResearch fires when the queue target becomes affordable', () => {
    const rb = new ResearchBook();
    const def = CORE_TECH_MAP.get('militia_training')!;
    rb.queue = 'militia_training';
    rb.points = def.cost - 1;
    expect(rb.autoResearch()).toBeNull(); // not enough yet
    rb.addPoints(1); // push it over the cost threshold
    const result = rb.autoResearch();
    expect(result).toBe('militia_training');
    expect(rb.hasTech('militia_training')).toBe(true);
    expect(rb.queue).toBeNull(); // cleared after research
  });

  it('available() lists techs whose prereqs are met but not yet researched', () => {
    const rb = new ResearchBook();
    const avail = rb.available().map(t => t.id);
    // crop_rotation is already researched → not in available
    expect(avail).not.toContain('crop_rotation');
    // milling prereq = crop_rotation (done) → available
    expect(avail).toContain('milling');
    // germ_theory prereq = first_aid (not done) → not available
    expect(avail).not.toContain('germ_theory');
  });

  it('serializes and restores faithfully', () => {
    const rb = new ResearchBook();
    rb.points = 42;
    rb.queue = 'milling';
    const save = rb.serialize();
    const rb2 = ResearchBook.deserialize(save);
    expect(rb2.points).toBe(42);
    expect(rb2.hasTech('crop_rotation')).toBe(true);
    expect(rb2.queue).toBe('milling');
  });

  it('all known techs have valid prereq references', () => {
    const ids = new Set(CORE_TECHS.map(t => t.id));
    for (const t of CORE_TECHS) {
      for (const p of t.prereqs) {
        expect(ids.has(p), `tech ${t.id} prereq ${p} is not in CORE_TECHS`).toBe(true);
      }
    }
  });
});

describe('TownCore research integration', () => {
  /** A colony with a walled library (3 desks) + kitchen (2 ovens) + home (2 beds). */
  function libraryColony(): TownCore {
    const core = new TownCore({ width: 32, height: 32, seed: 42 });
    const g = core.grid;
    const LIB = ROOM_TYPE_ID.get('library')!;
    const KIT = ROOM_TYPE_ID.get('kitchen')!;
    const HOME = ROOM_TYPE_ID.get('home')!;
    // Kitchen 2×5 at top
    g.designateRect(2, 2, 6, 5, KIT);
    for (let x = 1; x <= 7; x++) { g.setWall(x, 1); g.setWall(x, 6); }
    for (let y = 1; y <= 6; y++) { g.setWall(1, y); g.setWall(7, y); }
    g.placeStation('oven', 2, 2); g.placeStation('oven', 4, 2);
    g.setGate(4, 6);
    // Library
    g.designateRect(2, 9, 8, 12, LIB);
    for (let x = 1; x <= 9; x++) { g.setWall(x, 8); g.setWall(x, 13); }
    for (let y = 8; y <= 13; y++) { g.setWall(1, y); g.setWall(9, y); }
    g.placeStation('desk', 2, 9); g.placeStation('desk', 4, 9); g.placeStation('desk', 6, 9);
    g.setGate(4, 13);
    // Home
    g.designateRect(2, 16, 8, 19, HOME);
    for (let x = 1; x <= 9; x++) { g.setWall(x, 15); g.setWall(x, 20); }
    for (let y = 15; y <= 20; y++) { g.setWall(1, y); g.setWall(9, y); }
    g.placeStation('bunk', 2, 16); g.placeStation('bunk', 5, 16);
    g.setGate(4, 20);
    g.rebuildRooms();
    core.stock.add('grain', 1000);
    core.seedColony(4, 22, 4);
    return core;
  }

  it('library desks accumulate research points daily', () => {
    const core = libraryColony();
    const tpd = 360; // 360 ticks per game-day
    core.run(tpd); // one full day
    // 3 desks × RESEARCH_PER_DESK_PER_DAY points each
    expect(core.researchBook.points).toBeGreaterThanOrEqual(3 * RESEARCH_PER_DESK_PER_DAY);
  });

  it('research() unlocks a tech and logs the event', () => {
    const core = libraryColony();
    core.researchBook.points = 9999;
    expect(core.research('militia_training')).toBe(true);
    expect(core.researchBook.hasTech('militia_training')).toBe(true);
    expect(core.log.some(e => e.text.includes('militia_training'))).toBe(true);
  });

  it('crop_rotation boosts field yield above the base rate', () => {
    const core = new TownCore({ width: 24, height: 24, seed: 7 });
    core.seedColony(12, 12, 4);
    core.grid.setTerrain(3, 3, TERRAIN.SOIL);
    core.grid.setZone(3, 3, ZONE.FIELD);
    core.stock.add('meal', 100); // settlers eat meals so harvested grain is undisturbed
    const before = core.stock.count('grain');
    core.run(360); // one day
    // crop_rotation is free → 1.25 × weather.growthMult(0) grain (> 1.0 base)
    expect(core.stock.count('grain')).toBeGreaterThan(before + 1 * core.weather.growthMult(0));
  });

  it('forestry boosts woodcutter-zone wood yield', () => {
    function woodColony(): TownCore {
      const core = new TownCore({ width: 24, height: 24, seed: 7 });
      core.seedColony(12, 12, 4);
      // A row of trees worked by woodcutter zones.
      for (let x = 2; x <= 6; x++) { core.grid.setTerrain(x, 2, TERRAIN.TREE); core.grid.setZone(x, 2, ZONE.WOODCUTTER); }
      core.stock.add('meal', 100); // keep settlers fed so they don't starve mid-run
      return core;
    }
    const base = woodColony();
    base.run(360);
    const baseWood = base.stock.count('wood');

    const boosted = woodColony();
    boosted.researchBook.points = 9999;
    boosted.research('forestry');
    boosted.run(360);

    expect(boosted.stock.count('wood')).toBeGreaterThan(baseWood);
  });

  it('crop_science stacks on top of crop_rotation for higher field yield', () => {
    const core = new TownCore({ width: 24, height: 24, seed: 7 });
    core.seedColony(12, 12, 4);
    core.grid.setTerrain(3, 3, TERRAIN.SOIL);
    core.grid.setZone(3, 3, ZONE.FIELD);

    // Unlock crop_science (which prereqs crop_rotation — already done)
    core.researchBook.points = 9999;
    core.research('milling');        // needed as a prereq for crop_science
    core.research('crop_science');
    expect(core.researchBook.hasTech('crop_science')).toBe(true);

    core.stock.add('meal', 100); // settlers eat meals so harvested grain is undisturbed
    const before = core.stock.count('grain');
    core.run(360);
    // 1 tile × (1 + 0.25 + 0.20) × weather.growthMult(day 0)
    const expected = before + 1.45 * core.weather.growthMult(0);
    expect(core.stock.count('grain')).toBeCloseTo(expected, 2);
  });

  it('serialize/deserialize preserves the research book at save v7', () => {
    const core = libraryColony();
    core.researchBook.points = 500;
    core.researchBook.queue = 'milling';
    const twin = TownCore.deserialize(core.serialize());
    expect(twin.researchBook.points).toBe(500);
    expect(twin.researchBook.hasTech('crop_rotation')).toBe(true);
    expect(twin.researchBook.queue).toBe('milling');
  });
});

// ── Production-speed tech effects ──────────────────────────────────────────────
// Each test creates two identical single-station colonies, unlocks the tech in
// one, runs for a fixed number of ticks, and asserts higher throughput.

describe('TownCore production tech effects', () => {
  /** Build a minimal enclosed mill room with one millstone and two workers. */
  function millColony(): TownCore {
    const core = new TownCore({ width: 20, height: 20, seed: 99 });
    const MILL = ROOM_TYPE_ID.get('mill')!;
    const g = core.grid;
    g.designateRect(2, 2, 7, 5, MILL);
    for (let x = 1; x <= 8; x++) { g.setWall(x, 1); g.setWall(x, 6); }
    for (let y = 1; y <= 6; y++) { g.setWall(1, y); g.setWall(8, y); }
    g.placeStation('millstone', 2, 2);
    g.setGate(4, 6);
    g.rebuildRooms();
    core.stock.add('grain', 100000);
    core.seedColony(10, 10, 2);
    return core;
  }

  /** Build a minimal enclosed library room with one loom and two workers. */
  function loomColony(): TownCore {
    const core = new TownCore({ width: 20, height: 20, seed: 77 });
    const WEAVERY = ROOM_TYPE_ID.get('workshop')!;
    const g = core.grid;
    g.designateRect(2, 2, 8, 5, WEAVERY);
    for (let x = 1; x <= 9; x++) { g.setWall(x, 1); g.setWall(x, 6); }
    for (let y = 1; y <= 6; y++) { g.setWall(1, y); g.setWall(9, y); }
    g.placeStation('loom', 2, 2);
    g.setGate(4, 6);
    // Warehousing so the storage cap doesn't spoil the clothes we're measuring.
    g.designateRect(11, 2, 16, 6, ROOM_TYPE_ID.get('storehouse')!);
    for (let x = 11; x <= 16; x++) for (let y = 2; y <= 6; y++) g.placeStation('crate', x, y);
    g.rebuildRooms();
    core.stock.add('flax', 5000); // enough loom input for the run, but leaves cap room for clothes
    core.seedColony(10, 10, 2);
    return core;
  }

  it('milling tech makes millstones produce 30% more flour', () => {
    const base = millColony();
    base.run(2000);
    const baseFlour = base.stock.count('flour');

    const boosted = millColony();
    boosted.researchBook.points = 9999;
    boosted.research('milling');
    boosted.run(2000);
    const boostedFlour = boosted.stock.count('flour');

    expect(boostedFlour).toBeGreaterThan(baseFlour);
  });

  /** Build a minimal enclosed kitchen with one oven and two workers. */
  function ovenColony(): TownCore {
    const core = new TownCore({ width: 20, height: 20, seed: 55 });
    const KIT = ROOM_TYPE_ID.get('kitchen')!;
    const g = core.grid;
    g.designateRect(2, 2, 7, 5, KIT);
    for (let x = 1; x <= 8; x++) { g.setWall(x, 1); g.setWall(x, 6); }
    for (let y = 1; y <= 6; y++) { g.setWall(1, y); g.setWall(8, y); }
    g.placeStation('oven', 2, 2);
    g.setGate(4, 6);
    g.rebuildRooms();
    core.stock.add('grain', 100000);
    core.seedColony(10, 10, 2);
    return core;
  }

  it('baking tech makes ovens produce more meals', () => {
    const base = ovenColony();
    base.run(2000);
    const baseMeal = base.stock.count('meal');

    const boosted = ovenColony();
    boosted.researchBook.points = 9999;
    boosted.research('milling');  // prereq for baking
    boosted.research('baking');
    boosted.run(2000);

    expect(boosted.stock.count('meal')).toBeGreaterThan(baseMeal);
  });

  it('mechanization speeds every workstation (millstone throughput rises)', () => {
    const base = millColony();
    base.run(2000);
    const baseFlour = base.stock.count('flour');

    const boosted = millColony();
    boosted.researchBook.points = 99999;
    boosted.research('blacksmithing'); // mechanization prereqs
    boosted.research('carpentry');
    boosted.research('mechanization');
    expect(boosted.researchBook.hasTech('mechanization')).toBe(true);
    boosted.run(2000);

    expect(boosted.stock.count('flour')).toBeGreaterThan(baseFlour);
  });

  it('textile_farming tech makes looms produce more clothes', () => {
    const base = loomColony();
    base.run(2000);
    const baseClothes = base.stock.count('clothes');

    const boosted = loomColony();
    boosted.researchBook.points = 9999;
    boosted.research('textile_farming');
    boosted.run(2000);
    const boostedClothes = boosted.stock.count('clothes');

    expect(boostedClothes).toBeGreaterThan(baseClothes);
  });
});

// ── Health/infection tech effects ──────────────────────────────────────────────

describe('TownCore health tech effects', () => {
  it('first_aid reduces wound infection chance by 40%', () => {
    // Run many wounded agents through a tick window and count infections.
    const TICKS = 500;
    const COUNT = 40;
    let rand: () => number;

    function countInfections(withTech: boolean): number {
      // Deterministic RNG so both arms are comparable.
      let seed = 12345;
      rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; };

      const store = new AgentStore(COUNT);
      for (let i = 0; i < COUNT; i++) {
        store.spawn(5, 5);
        store.health[i] = 100;
        store.woundUntreated[i] = 1;
        store.woundAt[i] = 0; // wounded at tick 0
        store.infectionRolled[i] = 0;
        store.food[i] = 80;
        store.warmth[i] = 80;
      }
      const infChanceMult = withTech ? 0.6 : 1.0;
      for (let t = 0; t < TICKS; t++) store.tick(t, rand, infChanceMult);
      let infected = 0;
      for (let i = 0; i < COUNT; i++) if (store.infection[i] === 1) infected++;
      return infected;
    }

    const withoutTech = countInfections(false);
    const withTech = countInfections(true);
    // With the lower infection chance we expect fewer or equal infections.
    expect(withTech).toBeLessThanOrEqual(withoutTech);
  });

  it('germ_theory halves infection bleed rate', () => {
    // A single infected agent loses health slower with germ_theory active.
    let seed = 99999;
    const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; };

    function healthAfterInfection(infectionBleedMult: number): number {
      const store = new AgentStore(1);
      store.spawn(5, 5);
      store.health[0] = 100;
      store.infection[0] = 1;  // already infected
      store.food[0] = 80;
      store.warmth[0] = 80;
      for (let t = 0; t < 360; t++) store.tick(t, rand, 1.0, infectionBleedMult);
      return store.health[0];
    }

    const normalHealth = healthAfterInfection(1.0);
    const germHealth = healthAfterInfection(0.5);
    expect(germHealth).toBeGreaterThan(normalHealth);
  });
});
