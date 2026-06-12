import { describe, it, expect } from 'vitest';
import { Simulation } from '../src/sim/sim';
import { RegionSim } from '../src/sim/region';
import { DIFFICULTY_PRESETS } from '../src/sim/defs';
import type { TownDesign } from '../src/sim/defs';

const baseDesign: TownDesign = {
  currencySymbol: '$',
  difficulty: 'normal',
  location: 'river-valley',
  startingPop: 12,
};

describe('town design', () => {
  it('starting party size matches the design', () => {
    expect(new Simulation(42, { ...baseDesign, startingPop: 8 }).settlers.length).toBe(8);
    expect(new Simulation(42, { ...baseDesign, startingPop: 16 }).settlers.length).toBe(16);
  });

  it('difficulty scales founding stores and seed money', () => {
    const easy = new Simulation(42, { ...baseDesign, difficulty: 'easy' });
    const hard = new Simulation(42, { ...baseDesign, difficulty: 'hard' });
    expect(easy.economy.cash).toBe(DIFFICULTY_PRESETS.easy.startCash);
    expect(hard.economy.cash).toBe(DIFFICULTY_PRESETS.hard.startCash);
    expect(easy.stock.wood).toBeGreaterThan(hard.stock.wood);
    expect(easy.stock.meal).toBeGreaterThan(hard.stock.meal);
  });

  it('currency choice flows from town design into the region at the flip', () => {
    const sim = new Simulation(42, { ...baseDesign, currencySymbol: '€' });
    expect(sim.currencySymbol).toBe('€');
    const r = RegionSim.fromTown(sim, 8, 80, 80);
    expect(r.currencySymbol).toBe('€');
  });

  it('a designless boot behaves like the classic twelve-settler start', () => {
    const sim = new Simulation(42);
    expect(sim.settlers.length).toBe(12);
    expect(sim.economy.cash).toBe(500);
  });
});

describe('region design', () => {
  function region(): RegionSim {
    return RegionSim.fromTown(new Simulation(42), 8, 80, 80);
  }

  it('applies tax, services, and trade levy from the design', () => {
    const r = region();
    r.applyRegionDesign({ expansionSpeed: 'cautious', tradeOpenness: 'free-trade', taxRate: 0.22, servicesLevel: 2 });
    expect(r.taxRate).toBeCloseTo(0.22);
    expect(r.servicesLevel).toBe(2);
    expect(r.tradeLevyRate).toBeCloseTo(0.03);
  });

  it('expansion doctrine scales expedition requirements', () => {
    const r = region();
    r.applyRegionDesign({ expansionSpeed: 'aggressive', tradeOpenness: 'balanced', taxRate: 0.1, servicesLevel: 1 });
    expect(r.expansionCostMult()).toBeCloseTo(0.75);
    r.expansionSpeed = 'cautious';
    expect(r.expansionCostMult()).toBeCloseTo(1.25);
  });
});

describe('nation design', () => {
  function region(): RegionSim {
    return RegionSim.fromTown(new Simulation(42), 8, 80, 80);
  }

  it('economic system sets the steady-state output multiplier', () => {
    const r = region();
    r.applyNationDesign({ economicSystem: 'laissez-faire', militaryDoctrine: 'professional', allianceStance: 'opportunist' });
    expect(r.economyOutputMult()).toBeCloseTo(1.10);
    r.economicSystem = 'planned';
    expect(r.economyOutputMult()).toBeCloseTo(0.92);
  });

  it('re-picking the currency at the convention triggers a political transition', () => {
    const r = region();
    r.treasury = 10000;
    r.applyNationDesign({
      economicSystem: 'mixed', militaryDoctrine: 'professional', allianceStance: 'opportunist',
      currencySymbol: '£',
    });
    expect(r.currencySymbol).toBe('£');
    expect(r.currencyTransition).not.toBeNull();
    expect(r.currencyTransition!.cause).toBe('political');
    expect(r.treasury).toBeLessThan(10000); // capital flight took its cut
    expect(r.currencyEfficiency()).toBeLessThan(1);
  });

  it('keeping the currency costs nothing', () => {
    const r = region();
    r.treasury = 10000;
    r.applyNationDesign({ economicSystem: 'mixed', militaryDoctrine: 'professional', allianceStance: 'opportunist' });
    expect(r.currencyTransition).toBeNull();
    expect(r.treasury).toBe(10000);
  });
});

describe('central-bank currency switching', () => {
  function region(): RegionSim {
    const r = RegionSim.fromTown(new Simulation(42), 8, 80, 80);
    r.treasury = 10000;
    return r;
  }

  it('an unannounced strategic switch hits harder than an announced one', () => {
    const cold = region();
    cold.changeCurrency('€', 'strategic');
    const coldLoss = 10000 - cold.treasury;

    const warned = region();
    warned.announceCurrencyChange('€');
    // fast-forward past the announce lead by aging the announcement
    warned.currencyAnnouncement!.announcedDay = -200;
    warned.changeCurrency('€', 'strategic');
    const warnedLoss = 10000 - warned.treasury;

    expect(warnedLoss).toBeLessThan(coldLoss);
    expect(warned.currencyEfficiency()).toBeGreaterThan(cold.currencyEfficiency());
  });

  it('switching to the same symbol is a no-op', () => {
    const r = region();
    expect(r.changeCurrency('$').ok).toBe(false);
    expect(r.treasury).toBe(10000);
  });
});
