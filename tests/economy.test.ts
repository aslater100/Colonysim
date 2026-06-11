import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/sim';
import { MINUTES_PER_DAY, MINUTES_PER_TICK, TUNING } from '../src/sim/defs';

const ticksPerDay = MINUTES_PER_DAY / MINUTES_PER_TICK;

function runDays(sim: Simulation, days: number): void {
  for (let i = 0; i < days * ticksPerDay; i++) sim.tick();
}

describe('economy buildings (PR B2)', () => {
  it('a bakery cooks grain into meals, preferred over the cookhouse', () => {
    const sim = new Simulation(42);
    const bakery = sim.placeBuilding('bakery', 38, 32, true)!;
    sim.placeBuilding('kitchen', 24, 30, true);
    sim.stock.grain = 200;
    sim.stock.meal = 0;
    runDays(sim, 1);
    expect(sim.stock.meal).toBeGreaterThan(0);
    // the bakery, not the cookhouse, accumulated cook progress or got the work
    const cookhouse = sim.buildings.find((b) => b.defId === 'kitchen')!;
    expect(bakery.cookProgress + sim.stock.meal).toBeGreaterThan(0);
    expect(cookhouse.cookProgress).toBe(0);
  });

  it('a hunting lodge brings in meals without grain', () => {
    const sim = new Simulation(42);
    sim.placeBuilding('lodge', 38, 32, true);
    sim.stock.meal = 0;
    sim.stock.grain = 0;
    for (const s of sim.settlers) s.needs.food = 100; // nobody eats the take mid-test
    runDays(sim, 1);
    expect(sim.stock.meal).toBeGreaterThanOrEqual(TUNING.huntMealYield);
  });

  it('a market barters at fixed rates, and only once built', () => {
    const sim = new Simulation(42);
    expect(sim.trade('wood', 'grain')).toBe(false); // no market yet
    sim.placeBuilding('market', 37, 31, true);
    const wood = sim.stock.wood;
    const grain = sim.stock.grain;
    expect(sim.trade('wood', 'grain')).toBe(true);
    expect(sim.stock.wood).toBe(wood - TUNING.tradeRates['wood->grain'].give);
    expect(sim.stock.grain).toBe(grain + TUNING.tradeRates['wood->grain'].get);
    expect(sim.trade('meal', 'wood')).toBe(false); // no such rate
    sim.stock.stone = 1;
    expect(sim.trade('stone', 'grain')).toBe(false); // can't afford the rate
  });

  it('a forester plants saplings nearby that mature into trees', () => {
    const sim = new Simulation(42);
    sim.placeBuilding('forester', 38, 32, true);
    runDays(sim, 2);
    const saplings = sim.world.tiles.filter((t) => t.sapling);
    expect(saplings.length).toBeGreaterThan(0);
    for (const t of saplings) t.growth = 99.9;
    runDays(sim, 0.1);
    expect(sim.world.tiles.some((t) => t.kind === 'tree' && !t.sapling)).toBe(true);
    expect(saplings.some((t) => t.kind === 'tree')).toBe(true);
  });

  it('meals past the storage cap spoil daily; a granary raises the cap', () => {
    const sim = new Simulation(42);
    sim.stock.meal = TUNING.mealCapBase + 500;
    runDays(sim, 1);
    expect(sim.stock.meal).toBeLessThanOrEqual(TUNING.mealCapBase);
    expect(sim.log.some((l) => l.text.includes('spoiled'))).toBe(true);
    sim.placeBuilding('granary', 38, 32, true);
    expect(sim.mealCap()).toBe(TUNING.mealCapBase + TUNING.mealCapPerGranary);
    sim.stock.meal = sim.mealCap() + 100;
    runDays(sim, 1);
    expect(sim.stock.meal).toBeLessThanOrEqual(sim.mealCap());
    expect(sim.stock.meal).toBeGreaterThan(TUNING.mealCapBase); // the granary kept the excess
  });

  it('the badly hurt take a clinic cot and heal at double rate', () => {
    const sim = new Simulation(42);
    const clinic = sim.placeBuilding('clinic', 38, 31, true)!;
    sim.stock.meal = 500;
    const hurt = sim.settlers[0];
    hurt.health = 30; // below bedRestThreshold
    let tookCot = false;
    for (let i = 0; i < ticksPerDay && !tookCot; i++) {
      sim.tick();
      if (hurt.bedId === clinic.id && hurt.state === 'sleeping') tookCot = true;
    }
    expect(tookCot).toBe(true);
    runDays(sim, 1);
    // baseline regen is 0.5/h (12/day); the clinic's 2× must beat it
    expect(hurt.health).toBeGreaterThan(30 + 13);
  });
});
