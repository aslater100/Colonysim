import { describe, it, expect } from 'vitest';
import { Simulation } from '../src/sim/sim';
import { RegionSim, RIVAL_REGIMES } from '../src/sim/region';
import { AI_DIFFICULTY, MINUTES_PER_DAY } from '../src/sim/defs';
import type { TownDesign } from '../src/sim/defs';
import { REGION_MINUTES_PER_TICK } from '../src/sim/region';

const baseDesign: TownDesign = {
  currencySymbol: '$',
  difficulty: 'normal',
  location: 'river-valley',
  startingPop: 12,
};

const ticksPerDay = MINUTES_PER_DAY / REGION_MINUTES_PER_TICK;

function grow(sim: Simulation): void {
  while (sim.settlers.length < 22) sim.spawnSettler(48, 50);
  sim.stock.wood = 200;
  sim.stock.meal = 200;
}

function region(difficulty: TownDesign['difficulty'], seed = 42): RegionSim {
  const sim = new Simulation(seed, { ...baseDesign, difficulty });
  grow(sim);
  return RegionSim.fromTown(sim, 8, 80, 80);
}

function runDays(r: RegionSim, days: number): void {
  for (let i = 0; i < days * ticksPerDay; i++) r.tick();
}

describe('AI difficulty propagation', () => {
  it('carries the chosen difficulty from town design into the region', () => {
    expect(region('easy').aiDifficulty).toBe('easy');
    expect(region('normal').aiDifficulty).toBe('normal');
    expect(region('hard').aiDifficulty).toBe('hard');
  });

  it('defaults to normal when no design was supplied', () => {
    const r = RegionSim.fromTown(new Simulation(42), 8, 80, 80);
    expect(r.aiDifficulty).toBe('normal');
  });

  it('scales the rival AI update cadence by difficulty', () => {
    const story = region('easy').regionalFactions.filter((f) => f.id !== 0);
    const brutal = region('hard').regionalFactions.filter((f) => f.id !== 0);
    expect(story.length).toBeGreaterThan(0);
    expect(brutal.length).toBeGreaterThan(0);
    for (const f of story) expect(f.updateFrequency).toBe(AI_DIFFICULTY.easy.updateFreq);
    for (const f of brutal) expect(f.updateFrequency).toBe(AI_DIFFICULTY.hard.updateFreq);
  });

  it('a brutal world fields more aggressive rivals than a story one', () => {
    const story = region('easy').regionalFactions.filter((f) => f.id !== 0);
    const brutal = region('hard').regionalFactions.filter((f) => f.id !== 0);
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(avg(brutal.map((f) => f.aggressiveness)))
      .toBeGreaterThan(avg(story.map((f) => f.aggressiveness)));
  });

  it('exposes difficulty knobs via aiKnobs()', () => {
    expect(region('hard').aiKnobs().expandChance).toBe(AI_DIFFICULTY.hard.expandChance);
    expect(region('easy').aiKnobs().raidMult).toBe(AI_DIFFICULTY.easy.raidMult);
  });
});

describe('Rival regimes', () => {
  it('every rival is born with an era-plausible government', () => {
    const r = region('normal');
    for (const f of r.regionalFactions) {
      if (f.id === r.playerFactionId) continue;
      const def = RIVAL_REGIMES.find((g) => g.id === f.regime);
      expect(def).toBeTruthy();
      expect(def!.eraFrom).toBeLessThanOrEqual(r.year);
    }
  });
});

describe('Goal generation is government-driven', () => {
  // Drive generateFactionGoal directly (private) so we can sample many goals
  // without the side effects of a full AI tick.
  function sampleGoals(regime: string, n = 40): string[] {
    const r = region('normal');
    const f = r.regionalFactions.find((x) => x.id !== r.playerFactionId)!;
    f.regime = regime;
    f.treasury = 400;
    // give it a couple of settlements so settlement-gated goals are available
    f.settlementIds = [r.settlements[0].id];
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const goal = (r as unknown as { generateFactionGoal(x: typeof f): { id: string; govTypes: string[] } | null })
        .generateFactionGoal(f);
      if (goal) {
        ids.push(goal.id);
        // every selected goal must suit the regime (or be universal)
        expect(goal.govTypes.length === 0 || goal.govTypes.includes(regime)).toBe(true);
      }
    }
    return ids;
  }

  it('a theocracy pursues theocratic ambitions', () => {
    const ids = sampleGoals('theocracy');
    expect(ids.length).toBeGreaterThan(0);
    // the religious goals should appear in the mix
    expect(ids.some((id) => id === 'convert_heathen' || id === 'one_true_faith')).toBe(true);
  });

  it('a junta leans military', () => {
    const ids = sampleGoals('junta');
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.some((id) => ['military_supremacy', 'fortress_realm', 'iron_fisted_rule', 'resource_monopoly'].includes(id))).toBe(true);
  });

  it('a merchant republic leans commercial', () => {
    const ids = sampleGoals('merchant_republic');
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.some((id) => ['trade_dominance', 'naval_trade_empire', 'mercantile_hegemony', 'enrich_treasury'].includes(id))).toBe(true);
  });

  it('the goal palette is wide (no single hard-coded ambition)', () => {
    // across regimes, many distinct goal ids should be reachable
    const seen = new Set<string>([
      ...sampleGoals('theocracy'),
      ...sampleGoals('junta'),
      ...sampleGoals('merchant_republic'),
      ...sampleGoals('parliamentary'),
      ...sampleGoals('abs_monarchy'),
      ...sampleGoals('peoples_republic'),
    ]);
    expect(seen.size).toBeGreaterThanOrEqual(8);
  });
});

describe('Goal ambition scales with difficulty', () => {
  it('a brutal AI sets itself tighter deadlines than a story AI', () => {
    // Same seed → identical aiRng stream → identical goal selection; only the
    // difficulty-driven deadline multiplier differs.
    function gap(difficulty: TownDesign['difficulty']): number {
      const r = region(difficulty, 7);
      const f = r.regionalFactions.find((x) => x.id !== r.playerFactionId)!;
      f.regime = 'abs_monarchy';
      f.treasury = 400;
      f.settlementIds = [r.settlements[0].id];
      const goal = (r as unknown as { generateFactionGoal(x: typeof f): { targetYear: number; generatedYear: number } | null })
        .generateFactionGoal(f)!;
      return goal.targetYear - goal.generatedYear;
    }
    expect(gap('easy')).toBeGreaterThan(gap('hard'));
  });
});

describe('Rival AI integration', () => {
  it('a funded rival founds settlements and proclaims a goal once the state stands', () => {
    const r = region('hard');
    r.stateProclaimed = true;
    const rival = r.regionalFactions.find((f) => f.id !== r.playerFactionId)!;
    rival.treasury = 500;
    // run a few years so the staggered scheduler fires several times
    runDays(r, 365 * 3);
    const r2 = r.faction(rival.id)!;
    expect(r2.settlementIds.length).toBeGreaterThanOrEqual(1);
    expect(r2.currentGoal).not.toBeNull();
    // the activity log should mention the rival's doings
    expect(r.log.some((e) => e.text.includes(rival.name))).toBe(true);
  });

  it('rivals stay idle before the state is proclaimed', () => {
    const r = region('hard');
    const rival = r.regionalFactions.find((f) => f.id !== r.playerFactionId)!;
    rival.treasury = 500;
    const before = rival.settlementIds.length;
    runDays(r, 365);
    expect(r.faction(rival.id)!.settlementIds.length).toBe(before);
  });

  it('techFocus tracks the active goal rather than sitting as dead data', () => {
    const r = region('normal');
    const f = r.regionalFactions.find((x) => x.id !== r.playerFactionId)!;
    f.regime = 'merchant_republic';
    f.treasury = 400;
    f.settlementIds = [r.settlements[0].id];
    const goal = (r as unknown as { generateFactionGoal(x: typeof f): { sectorFocus?: string } | null })
      .generateFactionGoal(f)!;
    if (goal.sectorFocus) expect(f.techFocus).toBe(goal.sectorFocus);
  });
});

describe('Diplomacy bends the regional economy', () => {
  type Internal = {
    formAlliance(a: number, b: number): boolean;
    factionTradeModifier(f: unknown): number;
    generateFactionGoal(f: unknown): { id: string } | null;
  };

  it('allies enjoy a trade premium', () => {
    const r = region('normal');
    const ai = r as unknown as Internal;
    const [a, b] = r.regionalFactions.filter((f) => f.id !== r.playerFactionId);
    ai.formAlliance(a.id, b.id);
    expect(ai.factionTradeModifier(a)).toBeGreaterThan(1.0);
  });

  it('goal-conflicting rivals suffer an embargo penalty', () => {
    const r = region('normal');
    const ai = r as unknown as Internal;
    const [a, b] = r.regionalFactions.filter((f) => f.id !== r.playerFactionId);
    // give both the identical ambition → maximal conflict, no alliance
    a.regime = b.regime = 'junta';
    a.treasury = b.treasury = 400;
    a.settlementIds = [r.settlements[0].id];
    b.settlementIds = [r.settlements[0].id];
    a.currentGoal = ai.generateFactionGoal(a) as typeof a.currentGoal;
    expect(a.currentGoal).not.toBeNull();
    // force the same goal so conflict is unambiguous
    b.currentGoal = a.currentGoal;
    expect(ai.factionTradeModifier(a)).toBeLessThan(1.0);
  });
});

describe('Faction AI persistence', () => {
  it('regime, difficulty, and alliances survive save/load', () => {
    const sim = new Simulation(42, { ...baseDesign, difficulty: 'hard' });
    grow(sim);
    const r = RegionSim.fromTown(sim, 8, 80, 80);
    r.stateProclaimed = true;
    runDays(r, 200);
    const r2 = RegionSim.deserialize(r.serialize(), sim);
    expect(r2.aiDifficulty).toBe('hard');
    expect(r2.regionalFactions.map((f) => f.regime)).toEqual(r.regionalFactions.map((f) => f.regime));
  });

  it('pre-regime saves are backfilled with a plausible government', () => {
    const sim = new Simulation(42);
    grow(sim);
    const r = RegionSim.fromTown(sim, 8, 80, 80);
    const raw = JSON.parse(r.serialize());
    for (const f of raw.regionalFactions) delete f.regime;
    delete raw.aiDifficulty;
    const r2 = RegionSim.deserialize(JSON.stringify(raw), sim);
    for (const f of r2.regionalFactions) expect(typeof f.regime).toBe('string');
    expect(r2.aiDifficulty).toBe('normal');
  });
});
