import { describe, it, expect } from 'vitest';
import {
  RegionSim,
  AgendaKind,
  ARCHETYPE_AGENDA,
  AGENDA_PEACE_RESISTANCE,
  AGENDA_TABLE_COST,
  PEACE_TERMS,
  rivalAgendaKind,
  type RivalNation,
  type RivalArchetype,
  type PeaceTerm,
} from '../src/sim/region';

/**
 * AgendaKind — agenda-driven peace demands (GDD §7.4 + §6.3).
 *
 * Each rival archetype maps to a structured agenda kind that modulates the war-score
 * cost of specific peace terms at the peace table. Hegemons resist territorial
 * concessions; trading republics resist reparations; crusader states resist regime
 * change; etc. All behaviour is in player-query methods (peaceBasketAsk) → byte-identical.
 */

function makeRegion(seed = 42): RegionSim {
  return RegionSim.create(seed);
}

function ensureRival(r: RegionSim): RivalNation {
  if (r.rivals.length === 0) {
    (r as unknown as { spawnRival: () => void }).spawnRival();
  }
  return r.rivals[0];
}

function setWar(r: RegionSim, rv: RivalNation): void {
  (r as unknown as { playerWar: unknown }).playerWar = {
    rivalId: rv.id, cb: 'fabricated', defensive: false, startedDay: r.day,
    support: 70, score: 20, mobilization: 'limited', casualties: 0,
    blockade: false, allies: [], enemyAllies: [],
    occupied: 0, resistance: 0, occupationPolicy: 'conciliatory', brutality: false,
    units: [], supplyReserve: 3,
    front: { position: 20, peak: 20, phase: 'advancing' },
  };
}

function setArchetype(rv: RivalNation, arch: RivalArchetype): void {
  (rv as unknown as { archetype: RivalArchetype }).archetype = arch;
}

// ── Constants ────────────────────────────────────────────────────────────────

describe('AgendaKind type coverage', () => {
  const ALL_KINDS: AgendaKind[] = ['expansion', 'commerce', 'isolation', 'ideology', 'opportunism'];

  it('ARCHETYPE_AGENDA covers all 5 archetypes', () => {
    const archetypes: RivalArchetype[] = [
      'hegemon', 'trading_republic', 'hermit_kingdom', 'crusader_state', 'opportunist',
    ];
    for (const arch of archetypes) {
      expect(ARCHETYPE_AGENDA[arch]).toBeDefined();
      expect(ALL_KINDS).toContain(ARCHETYPE_AGENDA[arch]);
    }
  });

  it('AGENDA_PEACE_RESISTANCE covers all 5 agenda kinds', () => {
    for (const kind of ALL_KINDS) {
      expect(AGENDA_PEACE_RESISTANCE[kind]).toBeDefined();
    }
  });

  it('archetype mappings are distinct (each agenda kind appears at most once)', () => {
    const values = Object.values(ARCHETYPE_AGENDA);
    const unique = new Set(values);
    expect(unique.size).toBe(5);
  });
});

describe('ARCHETYPE_AGENDA expected mappings', () => {
  it('hegemon → expansion', () => expect(ARCHETYPE_AGENDA.hegemon).toBe('expansion'));
  it('trading_republic → commerce', () => expect(ARCHETYPE_AGENDA.trading_republic).toBe('commerce'));
  it('hermit_kingdom → isolation', () => expect(ARCHETYPE_AGENDA.hermit_kingdom).toBe('isolation'));
  it('crusader_state → ideology', () => expect(ARCHETYPE_AGENDA.crusader_state).toBe('ideology'));
  it('opportunist → opportunism', () => expect(ARCHETYPE_AGENDA.opportunist).toBe('opportunism'));
});

describe('rivalAgendaKind', () => {
  it('returns correct kind for each archetype', () => {
    const r = makeRegion();
    const rv = ensureRival(r);
    for (const [arch, expected] of Object.entries(ARCHETYPE_AGENDA) as [RivalArchetype, AgendaKind][]) {
      setArchetype(rv, arch);
      expect(rivalAgendaKind(rv)).toBe(expected);
    }
  });
});

// ── Peace table resistance values ────────────────────────────────────────────

describe('AGENDA_PEACE_RESISTANCE — design assertions', () => {
  it('expansion (hegemon) resists border_province harder than reparations', () => {
    const r = AGENDA_PEACE_RESISTANCE.expansion;
    expect(r.border_province ?? 0).toBeGreaterThan(r.reparations ?? 0);
  });

  it('commerce (trading_republic) resists reparations harder than border_province', () => {
    const r = AGENDA_PEACE_RESISTANCE.commerce;
    expect(r.reparations ?? 0).toBeGreaterThan(r.border_province ?? 0);
  });

  it('ideology (crusader_state) resists regime_change most of all', () => {
    const r = AGENDA_PEACE_RESISTANCE.ideology;
    const terms: PeaceTerm[] = ['reparations', 'border_province', 'regime_change'];
    for (const t of terms.filter(t => t !== 'regime_change')) {
      expect(r.regime_change ?? 0).toBeGreaterThan(r[t] ?? 0);
    }
  });

  it('opportunism has non-positive resistance on all terms (wants out fast)', () => {
    const r = AGENDA_PEACE_RESISTANCE.opportunism;
    for (const v of Object.values(r)) {
      expect(v).toBeLessThanOrEqual(0);
    }
  });

  it('isolation resists border_province but is relaxed about regime_change', () => {
    const r = AGENDA_PEACE_RESISTANCE.isolation;
    expect(r.border_province ?? 0).toBeGreaterThan(0);
    expect(r.regime_change ?? 0).toBeLessThan(0);
  });
});

// ── peaceBasketAsk integration ───────────────────────────────────────────────

describe('peaceBasketAsk — agenda-differentiated asks', () => {
  it('hegemon asks more for border_province than trading_republic', () => {
    const r = makeRegion();
    const rv = ensureRival(r);
    rv.weights.grudge = 0;
    setWar(r, rv);

    setArchetype(rv, 'hegemon');
    const hegemAsk = r.peaceBasketAsk(rv, ['border_province']);

    setArchetype(rv, 'trading_republic');
    const tradeAsk = r.peaceBasketAsk(rv, ['border_province']);

    expect(hegemAsk).toBeGreaterThan(tradeAsk);
  });

  it('trading_republic asks more for reparations than hegemon', () => {
    const r = makeRegion();
    const rv = ensureRival(r);
    rv.weights.grudge = 0;
    setWar(r, rv);

    setArchetype(rv, 'trading_republic');
    const tradeAsk = r.peaceBasketAsk(rv, ['reparations']);

    setArchetype(rv, 'hegemon');
    const hegemAsk = r.peaceBasketAsk(rv, ['reparations']);

    expect(tradeAsk).toBeGreaterThan(hegemAsk);
  });

  it('crusader_state asks most for regime_change', () => {
    const r = makeRegion();
    const rv = ensureRival(r);
    rv.weights.grudge = 0;
    setWar(r, rv);

    const archetypes: RivalArchetype[] = ['hegemon', 'trading_republic', 'hermit_kingdom', 'opportunist'];
    setArchetype(rv, 'crusader_state');
    const crusaderAsk = r.peaceBasketAsk(rv, ['regime_change']);

    for (const arch of archetypes) {
      setArchetype(rv, arch);
      const ask = r.peaceBasketAsk(rv, ['regime_change']);
      expect(crusaderAsk).toBeGreaterThan(ask);
    }
  });

  it('opportunist is easiest to conclude peace with across multiple terms', () => {
    const r = makeRegion();
    const rv = ensureRival(r);
    rv.weights.grudge = 0;
    setWar(r, rv);

    setArchetype(rv, 'opportunist');
    const opAsk = r.peaceBasketAsk(rv, ['reparations', 'border_province']);

    const others: RivalArchetype[] = ['hegemon', 'trading_republic', 'hermit_kingdom', 'crusader_state'];
    for (const arch of others) {
      setArchetype(rv, arch);
      const ask = r.peaceBasketAsk(rv, ['reparations', 'border_province']);
      // Opportunist accepts the lowest ask of any archetype
      expect(opAsk).toBeLessThanOrEqual(ask);
    }
  });

  it('agenda resistance equals exactly PEACE_TERMS[t].score + resist delta (zero peak)', () => {
    const r = makeRegion();
    const rv = ensureRival(r);
    rv.weights.grudge = 0;
    // Use zero front peak so peakLeverage = 0 — isolates the agenda resistance cleanly
    (r as unknown as { playerWar: unknown }).playerWar = {
      rivalId: rv.id, cb: 'fabricated', defensive: false, startedDay: r.day,
      support: 70, score: 20, mobilization: 'limited', casualties: 0,
      blockade: false, allies: [], enemyAllies: [],
      occupied: 0, resistance: 0, occupationPolicy: 'conciliatory', brutality: false,
      units: [], supplyReserve: 3,
      front: { position: 0, peak: 0, phase: 'contested' },
    };

    setArchetype(rv, 'crusader_state'); // ideology: regime_change +20
    const ask = r.peaceBasketAsk(rv, ['regime_change']);
    const expected = PEACE_TERMS.regime_change.score + (AGENDA_PEACE_RESISTANCE.ideology.regime_change ?? 0);
    expect(ask).toBe(expected);
  });

  it('grudge stacks on top of agenda resistance', () => {
    const r = makeRegion();
    const rv = ensureRival(r);
    setWar(r, rv);

    setArchetype(rv, 'crusader_state');
    rv.weights.grudge = 0;
    const noGrudge = r.peaceBasketAsk(rv, ['regime_change']);

    rv.weights.grudge = 5;
    const withGrudge = r.peaceBasketAsk(rv, ['regime_change']);

    expect(withGrudge).toBe(noGrudge + 5 * 2);
  });

  it('ask floors at 0 even for an opportunist facing a minimal basket', () => {
    const r = makeRegion();
    const rv = ensureRival(r);
    rv.weights.grudge = 0;
    setWar(r, rv);
    setArchetype(rv, 'opportunist');

    const ask = r.peaceBasketAsk(rv, ['status_quo']);
    expect(ask).toBeGreaterThanOrEqual(0);
  });
});

// ── peaceCounter sort order ───────────────────────────────────────────────────

describe('peaceCounter — agenda-aware term shedding', () => {
  // Access private peaceCounter via any-cast for testing
  function getCounter(r: RegionSim, rv: RivalNation, terms: PeaceTerm[]): PeaceTerm[] {
    return (r as unknown as { peaceCounter: (rv: RivalNation, t: PeaceTerm[]) => PeaceTerm[] }).peaceCounter(rv, terms);
  }

  it('hegemon sheds reparations before border_province in counter', () => {
    const r = makeRegion();
    const rv = ensureRival(r);
    rv.weights.grudge = 0;

    // Set war score just enough to pass reparations alone but not both
    (r as unknown as { playerWar: { score: number } }).playerWar = {
      rivalId: rv.id, cb: 'fabricated', defensive: false, startedDay: 0,
      support: 70, score: 25, mobilization: 'limited', casualties: 0,
      blockade: false, allies: [], enemyAllies: [],
      occupied: 0, resistance: 0, occupationPolicy: 'conciliatory', brutality: false,
      units: [], supplyReserve: 3,
      front: { position: 25, peak: 25, phase: 'advancing' },
    };
    setArchetype(rv, 'hegemon'); // border_province effective: 55+15=70; reparations: 30-5=25
    // war score 25 can pass reparations (ask 25) but not border_province (ask 70)
    const counter = getCounter(r, rv, ['reparations', 'border_province']);
    // Hegemon's counter should retain reparations (cheaper) and drop border_province (dearest)
    expect(counter).toContain('reparations');
    expect(counter).not.toContain('border_province');
  });

  it('trading_republic sheds border_province before reparations in counter', () => {
    const r = makeRegion();
    const rv = ensureRival(r);
    rv.weights.grudge = 0;

    // Set war score to pass status_quo but not full basket
    (r as unknown as { playerWar: { score: number } }).playerWar = {
      rivalId: rv.id, cb: 'fabricated', defensive: false, startedDay: 0,
      support: 70, score: 26, mobilization: 'limited', casualties: 0,
      blockade: false, allies: [], enemyAllies: [],
      occupied: 0, resistance: 0, occupationPolicy: 'conciliatory', brutality: false,
      units: [], supplyReserve: 3,
      front: { position: 26, peak: 26, phase: 'advancing' },
    };
    setArchetype(rv, 'trading_republic'); // reparations effective: 30+15=45; border_province: 55-5=50
    // war score 26 → neither alone passes both, but reparations alone (45) also doesn't pass at score 26
    // Let's verify just the sort order: border_province (eff 50) > reparations (eff 45)
    // so trading_republic drops border_province FIRST (heaviest effective first)
    // At score 26: basket [reparations, border_province] ask = 45+50 = 95 → strip border_province
    // remaining [reparations] ask = 45 → still > 26, strip reparations too → []
    const counter = getCounter(r, rv, ['reparations', 'border_province']);
    // With only 26 war score, even reparations alone (45) is too expensive for trading_republic
    // So counter should be empty — but the SORT ORDER test: border_province shed first
    // Let's use a higher score test instead
    (r as unknown as { playerWar: { score: number } }).playerWar = {
      rivalId: rv.id, cb: 'fabricated', defensive: false, startedDay: 0,
      support: 70, score: 46, mobilization: 'limited', casualties: 0,
      blockade: false, allies: [], enemyAllies: [],
      occupied: 0, resistance: 0, occupationPolicy: 'conciliatory', brutality: false,
      units: [], supplyReserve: 3,
      front: { position: 46, peak: 46, phase: 'advancing' },
    };
    // score=46: basket [reparations, border_province] ask = 45+50=95 → strip border_province (eff 50)
    // remaining [reparations] ask = 45 → 46 ≥ 45 → PASS → counter = [reparations]
    const counter2 = getCounter(r, rv, ['reparations', 'border_province']);
    expect(counter2).toContain('reparations');
    expect(counter2).not.toContain('border_province');
  });
});

// ── AGENDA_TABLE_COST — deal table overhead by agenda kind ───────────────────

describe('AGENDA_TABLE_COST', () => {
  it('isolation has positive table cost (hermit kingdoms are hard to sit down with)', () => {
    expect((AGENDA_TABLE_COST.isolation ?? 0)).toBeGreaterThan(0);
  });

  it('opportunism has negative table cost (opportunists deal with anyone)', () => {
    expect((AGENDA_TABLE_COST.opportunism ?? 0)).toBeLessThan(0);
  });
});

describe('evaluateDeal — agenda table-cost differentiation', () => {
  function setRelations(rv: RivalNation, rel: number): void {
    (rv as unknown as { relations: number }).relations = rel;
  }

  it('hermit_kingdom is harder to deal with than trading_republic at the same relations', () => {
    const r = makeRegion();
    const rv = ensureRival(r);
    rv.weights.grudge = 0;
    setRelations(rv, 20); // neutral-ish — above the walk threshold

    // Same gold offer to both archetypes — hermit_kingdom should have higher cost
    setArchetype(rv, 'trading_republic');
    const tradeVerdict = r.evaluateDeal(rv, { treaties: [], goldToThem: 30, goldToYou: 0 });

    setArchetype(rv, 'hermit_kingdom');
    const hermitVerdict = r.evaluateDeal(rv, { treaties: [], goldToThem: 30, goldToYou: 0 });

    // The hermit kingdom's cost is higher (harder to satisfy)
    expect(hermitVerdict.cost).toBeGreaterThan(tradeVerdict.cost);
  });

  it('opportunist is easier to deal with than trading_republic at the same relations', () => {
    const r = makeRegion();
    const rv = ensureRival(r);
    rv.weights.grudge = 0;
    setRelations(rv, 20);

    setArchetype(rv, 'trading_republic');
    const tradeVerdict = r.evaluateDeal(rv, { treaties: [], goldToThem: 30, goldToYou: 0 });

    setArchetype(rv, 'opportunist');
    const oppVerdict = r.evaluateDeal(rv, { treaties: [], goldToThem: 30, goldToYou: 0 });

    // The opportunist's cost is lower (easier to satisfy)
    expect(oppVerdict.cost).toBeLessThanOrEqual(tradeVerdict.cost);
  });
});
