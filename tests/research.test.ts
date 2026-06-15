import { describe, expect, it } from 'vitest';
import { ResearchBook, CORE_TECHS, CORE_TECH_MAP, RESEARCH_PER_DESK_PER_DAY } from '../src/sim/research';
import { TownCore } from '../src/sim/towncore';
import { TERRAIN, ZONE } from '../src/sim/build';
import { ROOM_TYPE_ID } from '../src/sim/defs';

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
    const before = core.stock.count('grain');
    core.run(360); // one day
    // crop_rotation is free → 1.25 grain (not 1.0)
    expect(core.stock.count('grain')).toBeGreaterThan(before + 1);
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

    const before = core.stock.count('grain');
    core.run(360);
    // 1 tile × (1 + 0.25 + 0.20) = 1.45 grain
    expect(core.stock.count('grain')).toBeCloseTo(before + 1.45, 2);
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
