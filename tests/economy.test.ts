import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/sim';
import { MINUTES_PER_DAY, MINUTES_PER_TICK, TUNING } from '../src/sim/defs';
import { BASE_PRICES } from '../src/sim/economy';

const ticksPerDay = MINUTES_PER_DAY / MINUTES_PER_TICK;

function runDays(sim: Simulation, days: number): void {
  for (let i = 0; i < days * ticksPerDay; i++) sim.tick();
}

describe('economy buildings (PR B2)', () => {
  it('a bakery cooks grain into meals, preferred over the cookhouse', () => {
    const sim = new Simulation(42);
    const bakery = sim.placeBuilding('bakery', 54, 48, true)!;
    sim.placeBuilding('kitchen', 40, 46, true);
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
    sim.placeBuilding('lodge', 54, 48, true);
    sim.stock.meal = 0;
    sim.stock.grain = 0;
    for (const s of sim.settlers) s.needs.food = 100; // nobody eats the take mid-test
    runDays(sim, 1);
    expect(sim.stock.game_meal).toBeGreaterThanOrEqual(TUNING.huntMealYield);
  });

  it('a market barters at fixed rates, and only once built', () => {
    const sim = new Simulation(42);
    expect(sim.trade('wood', 'grain')).toBe(false); // no market yet
    sim.placeBuilding('market', 53, 47, true);
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
    sim.placeBuilding('forester', 54, 48, true);
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
    sim.placeBuilding('granary', 54, 48, true);
    expect(sim.mealCap()).toBe(TUNING.mealCapBase + TUNING.mealCapPerGranary);
    sim.stock.meal = sim.mealCap() + 100;
    runDays(sim, 1);
    expect(sim.stock.meal).toBeLessThanOrEqual(sim.mealCap());
    expect(sim.stock.meal).toBeGreaterThan(TUNING.mealCapBase); // the granary kept the excess
  });

  it('the badly hurt take a clinic cot and heal at double rate', () => {
    const sim = new Simulation(42);
    const clinic = sim.placeBuilding('clinic', 54, 47, true)!;
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

describe('dynamic supply/demand pricing', () => {
  it('flooding the market with a good drops its marginal price', () => {
    const sim = new Simulation(42);
    sim.stock.wood = 1000;
    const spotBefore = sim.marketPrice('wood');
    // Sell a big batch — supply floods, price modifier falls.
    sim.sellToMarket('wood', 300);
    const spotAfter = sim.marketPrice('wood');
    expect(spotAfter).toBeLessThan(spotBefore);
    expect(sim.priceModifiers.wood).toBeLessThan(1.0);
  });

  it('a large sale earns less per unit than a small one (marginal pricing)', () => {
    const small = new Simulation(7);
    const big = new Simulation(7);
    small.stock.wood = 1000;
    big.stock.wood = 1000;
    const smallCash = small.sellToMarket('wood', 10);
    const bigCash = big.sellToMarket('wood', 300);
    const perUnitSmall = smallCash / 10;
    const perUnitBig = bigCash / 300;
    expect(perUnitBig).toBeLessThan(perUnitSmall);
  });

  it('prices recover toward base over the following days', () => {
    const sim = new Simulation(42);
    sim.stock.wood = 1000;
    sim.sellToMarket('wood', 300);
    const crashed = sim.priceModifiers.wood;
    expect(crashed).toBeLessThan(1.0);
    runDays(sim, 6);
    expect(sim.priceModifiers.wood).toBeGreaterThan(crashed);
  });

  it('the price modifier never falls below the floor when dumping', () => {
    const sim = new Simulation(42);
    sim.stock.wood = 100000;
    sim.sellToMarket('wood', 50000);
    expect(sim.priceModifiers.wood).toBeGreaterThanOrEqual(TUNING.marketPriceFloor);
  });

  it('buying bids the price up; modifier rises above 1.0', () => {
    const sim = new Simulation(42);
    sim.economy.cash = 100000;
    sim.buyFromMarket('grain', 200);
    expect(sim.priceModifiers.grain).toBeGreaterThan(1.0);
    expect(sim.marketPrice('grain')).toBeGreaterThan(BASE_PRICES.grain);
  });

  it('every resource has a base price defined', () => {
    const sim = new Simulation(1);
    for (const kind of Object.keys(sim.stock)) {
      expect(BASE_PRICES[kind]).toBeGreaterThan(0);
    }
  });

  it('the tailor twists flax into rope once clothing demand is met (Textile Farming)', () => {
    const sim = new Simulation(42);
    sim.townTechsResearched.push('textile_farming');
    sim.placeBuilding('tailor', 54, 48, true);
    sim.stock.flax = 200;
    sim.stock.clothes = 200; // nobody is threadbare → tailor spins rope instead
    for (const s of sim.settlers) s.clothedUntil = sim.minute + 1e9;
    runDays(sim, 2);
    expect(sim.stock.rope).toBeGreaterThan(0);
  });

  it('cooks preserve surplus meals into shelf-stable rations (Food Preservation)', () => {
    const sim = new Simulation(42);
    sim.townTechsResearched.push('food_preservation');
    sim.placeBuilding('kitchen', 54, 48, true);
    sim.stock.meal = sim.mealCap(); // larder overflowing
    for (const s of sim.settlers) s.needs.food = 100; // nobody eats it down
    runDays(sim, 2);
    expect(sim.stock.preserved).toBeGreaterThan(0);
  });

  it('inflation stays at zero without the Banking tech, and builds with surplus cash once researched', () => {
    const sim = new Simulation(42);
    sim.economy.cash = 1_000_000; // huge cash hoard, but no banking yet
    runDays(sim, 3);
    expect(sim.economy.inflation).toBe(0);
    sim.townTechsResearched.push('banking');
    runDays(sim, 5);
    expect(sim.economy.inflation).toBeGreaterThan(0); // too much coin chasing the goods
  });
});
