import { describe, it, expect } from 'vitest';
import { RegionSim, SITUATION_TREATY_BONUS } from '../src/sim/region';
import type { RivalNation } from '../src/sim/region';

/**
 * Situation-aware deal valuation (GDD §6.3). A rival fighting a foreign war is
 * embattled — `rivalSituation` 1 — and signs protection (non-aggression /
 * defensive pact) and trade more readily, via an ADDITIVE `SITUATION_TREATY_BONUS`
 * so the lift applies even to a treaty its temperament normally dislikes. At peace
 * `rivalSituation` is 0 and the bonus is +0, so `evaluateDeal` is byte-identical to
 * before — which is why no existing diplomacy test (none set a foreign war) moves.
 * `evaluateDeal` is player-initiated only (UI / proposeDeal), never in the tick or
 * AI path, so the headless sim is untouched regardless.
 */

function makeRegion(seed = 42): RegionSim {
  const r = RegionSim.create(seed);
  (r as unknown as { stateProclaimed: boolean }).stateProclaimed = true;
  return r;
}

function ensureRival(r: RegionSim): RivalNation {
  if (r.rivals.length === 0) (r as unknown as { spawnRival: () => void }).spawnRival();
  return r.rivals[0];
}

/** Drag the rival into a foreign war against a fabricated opponent. */
function embroil(r: RegionSim, rv: RivalNation): void {
  r.foreignWars.push({ a: rv.id, b: 999999, startedDay: 0, endsDay: r.day + 999 });
}

describe('rivalSituation', () => {
  it('is 0 at peace and 1 while the rival fights a foreign war', () => {
    const r = makeRegion();
    const rv = ensureRival(r);
    expect(r.rivalSituation(rv)).toBe(0);
    embroil(r, rv);
    expect(r.rivalSituation(rv)).toBe(1);
  });
});

describe('situation-aware treatyAppetite', () => {
  it('adds exactly SITUATION_TREATY_BONUS for protection/trade when embattled', () => {
    const r = makeRegion();
    const rv = ensureRival(r);
    for (const kind of ['defensive_pact', 'non_aggression', 'trade_agreement'] as const) {
      const peace = r.treatyAppetite(rv, kind);
      embroil(r, rv);
      const war = r.treatyAppetite(rv, kind);
      // Reset the war for the next iteration.
      r.foreignWars = [];
      expect(war - peace).toBeCloseTo(SITUATION_TREATY_BONUS[kind]!, 10);
    }
  });

  it('leaves a treaty with no situational bonus (climate_accord) unchanged', () => {
    const r = makeRegion();
    const rv = ensureRival(r);
    const peace = r.treatyAppetite(rv, 'climate_accord');
    embroil(r, rv);
    expect(r.treatyAppetite(rv, 'climate_accord')).toBe(peace); // bonus is undefined → +0
    expect(SITUATION_TREATY_BONUS.climate_accord).toBeUndefined();
  });
});

describe('an embattled rival comes to the table', () => {
  it('accepts a bare trade pact it would reject at peace', () => {
    const r = makeRegion();
    const rv = ensureRival(r);
    // A controlled rival: a slightly-below-zero trade appetite at peace (commerce 2
    // → 2·1.6−4 = −0.8) that the +2 war bonus flips positive; zero table cost.
    rv.weights = { expansion: 0, commerce: 2, ideology: 0, honor: 0, risk: 0, grudge: 0 };
    rv.archetype = 'hegemon'; // no trade_agreement temperament modifier
    rv.relations = 100;       // tableCost 0
    rv.treaties = [];
    (r as unknown as { treatiesBroken: number }).treatiesBroken = 0;
    const basket = { treaties: ['trade_agreement'] as const, goldToThem: 0, goldToYou: 0, borderSettlement: false };

    const atPeace = r.evaluateDeal(rv, { ...basket, treaties: [...basket.treaties] });
    expect(atPeace.accept).toBe(false); // rejected — appetite sits just under the bar

    embroil(r, rv);
    const atWar = r.evaluateDeal(rv, { ...basket, treaties: [...basket.treaties] });
    expect(atWar.accept).toBe(true); // the war bonus tips it over
  });
});
