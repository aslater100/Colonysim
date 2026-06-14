import { describe, expect, it } from 'vitest';
import { TownCore } from '../src/sim/towncore';
import { BASE_PRICES } from '../src/sim/economy';

// Stage 4 behavior port: trading/economy — buy/sell at dynamic prices (town tier).

describe('Market — pricing & elasticity', () => {
  it('returns base price when modifiers are neutral (1.0)', () => {
    const core = new TownCore({ seed: 1 });
    core.stock.add('grain', 100);
    const price = core.marketPrice('grain');
    expect(price).toBe(BASE_PRICES['grain']);
  });

  it('lowers price when selling in volume (flooding the market)', () => {
    const core = new TownCore({ seed: 2 });
    core.stock.add('grain', 500);
    core.gold = 10000; // plenty of gold

    const priceInitial = core.marketPrice('grain');
    core.sellToMarket('grain', 100); // dump on market
    const priceLower = core.marketPrice('grain');

    expect(priceLower).toBeLessThan(priceInitial);
  });

  it('raises price when buying in volume (scarce goods)', () => {
    const core = new TownCore({ seed: 3 });
    core.stock.add('tools', 100);
    core.gold = 100000;

    const priceInitial = core.marketPrice('tools');
    core.buyFromMarket('tools', 10);
    const priceHigher = core.marketPrice('tools');

    expect(priceHigher).toBeGreaterThan(priceInitial);
  });

  it('prices are clamped between 0.5× and 2.0× base', () => {
    const core = new TownCore({ seed: 4 });
    // Dump a huge amount to try to tank the price.
    core.stock.add('wood', 10000);
    core.gold = 1000000;
    core.sellToMarket('wood', 5000);

    const price = core.marketPrice('wood');
    const base = BASE_PRICES['wood'];
    expect(price).toBeGreaterThanOrEqual(base * 0.5);
    expect(price).toBeLessThanOrEqual(base * 2.0);
  });
});

describe('Market — buy/sell mechanics', () => {
  it('selling generates gold proportional to quantity', () => {
    const core = new TownCore({ seed: 5 });
    core.stock.add('grain', 100);
    const initialGold = core.gold;

    const revenue = core.sellToMarket('grain', 50);

    expect(revenue).toBeGreaterThan(0);
    expect(core.gold).toBe(initialGold + revenue);
    expect(core.stock.count('grain')).toBe(50);
  });

  it('selling fails gracefully when stock is insufficient', () => {
    const core = new TownCore({ seed: 6 });
    core.stock.add('grain', 10);
    const initialGold = core.gold;

    const revenue = core.sellToMarket('grain', 100);

    expect(revenue).toBe(0);
    expect(core.gold).toBe(initialGold); // unchanged
    expect(core.stock.count('grain')).toBe(10); // unchanged
  });

  it('buying requires sufficient gold', () => {
    const core = new TownCore({ seed: 7 });
    core.stock.add('tools', 100);
    core.gold = 100; // not much gold

    const success = core.buyFromMarket('tools', 100); // expensive!

    expect(success).toBe(false);
    expect(core.stock.count('tools')).toBe(100); // unchanged
  });

  it('buying succeeds when gold is sufficient', () => {
    const core = new TownCore({ seed: 8 });
    core.gold = 100000;
    const initialStock = core.stock.count('grain');

    const success = core.buyFromMarket('grain', 50);

    expect(success).toBe(true);
    expect(core.stock.count('grain')).toBe(initialStock + 50);
    expect(core.gold).toBeLessThan(100000); // spent gold
  });

  it('successive buys increase price each time', () => {
    const core = new TownCore({ seed: 9 });
    core.gold = 100000;

    const prices: number[] = [];
    for (let i = 0; i < 3; i++) {
      prices.push(core.marketPrice('tools'));
      core.buyFromMarket('tools', 1);
    }

    // Each buy should raise the price (elasticity drives it up).
    expect(prices[1]).toBeGreaterThan(prices[0]);
    expect(prices[2]).toBeGreaterThan(prices[1]);
  });
});

describe('Market — serialization', () => {
  it('round-trips gold and price modifiers', () => {
    const core = new TownCore({ seed: 10 });
    core.gold = 50;
    core.stock.add('grain', 100);
    core.sellToMarket('grain', 30);

    const twin = TownCore.deserialize(JSON.parse(JSON.stringify(core.serialize())));

    expect(twin.gold).toBe(core.gold);
    expect(twin.marketPrice('grain')).toBe(core.marketPrice('grain'));
  });

  it('old saves without gold backfill to 0', () => {
    const core = new TownCore({ seed: 11 });
    const data = core.serialize();
    const oldData = { ...data, gold: undefined };
    const restored = TownCore.deserialize(oldData as any);
    expect(restored.gold).toBe(0);
  });
});

describe('TownCore — trading integration', () => {
  it('colony can trade to balance resources', () => {
    const core = new TownCore({ seed: 12 });
    core.stock.add('grain', 200);
    core.stock.add('tools', 0); // need tools

    // Sell surplus grain, buy cheap resources.
    const grainRevenue = core.sellToMarket('grain', 100); // sell a lot
    expect(grainRevenue).toBeGreaterThan(0);

    // Wood is cheaper than tools, so it's more likely we can afford it.
    const woodAffored = core.buyFromMarket('wood', Math.floor(grainRevenue / (BASE_PRICES['wood'] * 1.5)));
    expect(woodAffored).toBe(true);
    expect(core.stock.count('wood')).toBeGreaterThan(0);
  });

  it('market is independent per resource (no crosstalk)', () => {
    const core = new TownCore({ seed: 13 });
    core.stock.add('grain', 200);
    core.stock.add('wood', 200);

    core.sellToMarket('grain', 100);
    const woodPrice = core.marketPrice('wood');
    const baseWoodPrice = BASE_PRICES['wood'];

    // Selling grain shouldn't affect wood price.
    expect(woodPrice).toBe(baseWoodPrice);
  });
});
