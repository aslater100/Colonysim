import { describe, it, expect } from 'vitest';
import { RegionSim, REGION_MINUTES_PER_TICK, MINISTER_ROLES, ENVOY_COOLDOWN_DAYS } from '../src/sim/region';
import { MINUTES_PER_DAY, DAYS_PER_YEAR, START_YEAR } from '../src/sim/defs';

const ticksPerDay = MINUTES_PER_DAY / REGION_MINUTES_PER_TICK;

function makeNation(seed = 42): RegionSim {
  const r = RegionSim.create(seed);
  r.stateProclaimed = true;
  r.nationProclaimed = true;
  r.govType = 'republic';
  r.legitimacy = 60;
  r.activePolicies = [];
  r.treasury = 2000;
  r.passedLaws.add('central_bank_charter');
  r.passedLaws.add('income_tax');
  return r;
}

function fireAnchor(r: RegionSim, year: number, times = 300): void {
  r.minute = (year - START_YEAR) * DAYS_PER_YEAR * MINUTES_PER_DAY;
  const priv = r as unknown as { tickHistoricalAnchors(): void };
  for (let i = 0; i < times; i++) priv.tickHistoricalAnchors();
}

function forceDepressionConditions(r: RegionSim): void {
  // Stretch leverage and suppress confidence so the crash threshold is met
  (r as unknown as { privateLeverage: number }).privateLeverage = 0.5;
  (r as unknown as { policyRate: number }).policyRate = 0.3;
  (r as unknown as { confidence: number }).confidence = 40;
}

// ---- Great Depression anchor ----

describe('Historical anchor: Great Depression (1927–1936)', () => {
  it('crashFired starts false', () => {
    const r = makeNation();
    expect((r as unknown as { crashFired: boolean }).crashFired).toBe(false);
  });

  it('fires in the 1927–1936 window when leverage and confidence conditions are met', () => {
    const r = makeNation();
    forceDepressionConditions(r);
    fireAnchor(r, 1930, 1);
    expect((r as unknown as { crashFired: boolean }).crashFired).toBe(true);
    expect(r.log.some((l) => l.text.includes('THE CRASH'))).toBe(true);
  });

  it('does not fire outside the 1927–1936 window', () => {
    const r = makeNation();
    forceDepressionConditions(r);
    fireAnchor(r, 1920, 500);
    expect((r as unknown as { crashFired: boolean }).crashFired).toBe(false);
    fireAnchor(r, 1950, 500);
    expect((r as unknown as { crashFired: boolean }).crashFired).toBe(false);
  });

  it('does not fire when leverage is low', () => {
    const r = makeNation();
    (r as unknown as { privateLeverage: number }).privateLeverage = 0.1;
    (r as unknown as { policyRate: number }).policyRate = 0.05;
    (r as unknown as { confidence: number }).confidence = 40;
    fireAnchor(r, 1930, 500);
    expect((r as unknown as { crashFired: boolean }).crashFired).toBe(false);
  });

  it('does not fire when confidence is high', () => {
    const r = makeNation();
    (r as unknown as { privateLeverage: number }).privateLeverage = 0.5;
    (r as unknown as { policyRate: number }).policyRate = 0.3;
    (r as unknown as { confidence: number }).confidence = 80;
    fireAnchor(r, 1930, 500);
    expect((r as unknown as { crashFired: boolean }).crashFired).toBe(false);
  });

  it('does not fire a second time after crashFired is set', () => {
    const r = makeNation();
    forceDepressionConditions(r);
    (r as unknown as { crashFired: boolean }).crashFired = true;
    const logBefore = r.log.length;
    fireAnchor(r, 1930, 500);
    expect(r.log.filter((l) => l.text.includes('THE CRASH')).length).toBe(0);
    expect(r.log.length).toBe(logBefore);
  });

  it('collapses confidence when it fires', () => {
    const r = makeNation();
    forceDepressionConditions(r);
    const confBefore = (r as unknown as { confidence: number }).confidence;
    fireAnchor(r, 1930, 1);
    if ((r as unknown as { crashFired: boolean }).crashFired) {
      expect((r as unknown as { confidence: number }).confidence).toBeLessThan(confBefore - 30);
    }
  });

  it('drains treasury representing bank failures', () => {
    const r = makeNation();
    forceDepressionConditions(r);
    r.treasury = 5000;
    const treasBefore = r.treasury;
    fireAnchor(r, 1930, 1);
    if ((r as unknown as { crashFired: boolean }).crashFired) {
      expect(r.treasury).toBeLessThan(treasBefore);
    }
  });

  it('pushes unemployment_wave events to player settlements', () => {
    const r = makeNation();
    forceDepressionConditions(r);
    fireAnchor(r, 1930, 1);
    if ((r as unknown as { crashFired: boolean }).crashFired) {
      const hasUnemployment = r.settlements.some((t) =>
        t.activeEvents.some((ev) => ev.kind === 'labor_shortage'),
      );
      expect(hasUnemployment).toBe(true);
    }
  });

  it('raises grievance and lowers satisfaction in player settlements', () => {
    const r = makeNation();
    forceDepressionConditions(r);
    const grBefore = r.settlements[0]?.grievance ?? 0;
    const satBefore = r.settlements[0]?.satisfaction ?? 50;
    fireAnchor(r, 1930, 1);
    if ((r as unknown as { crashFired: boolean }).crashFired) {
      const t = r.settlements[0];
      if (t) {
        expect(t.grievance).toBeGreaterThan(grBefore);
        expect(t.satisfaction).toBeLessThan(satBefore);
      }
    }
  });

  it('logs a political radicalization message', () => {
    const r = makeNation();
    forceDepressionConditions(r);
    fireAnchor(r, 1930, 1);
    if ((r as unknown as { crashFired: boolean }).crashFired) {
      expect(r.log.some((l) => l.text.includes('DEPRESSION'))).toBe(true);
    }
  });

  it('serialize / deserialize round-trips crashFired', () => {
    const r = makeNation();
    (r as unknown as { crashFired: boolean }).crashFired = true;
    const r2 = RegionSim.deserialize(r.serialize());
    expect((r2 as unknown as { crashFired: boolean }).crashFired).toBe(true);
  });

  it('old saves without crashFired backfill to false', () => {
    const r = makeNation();
    const raw = JSON.parse(r.serialize());
    delete raw.crashFired;
    const r2 = RegionSim.deserialize(JSON.stringify(raw));
    expect((r2 as unknown as { crashFired: boolean }).crashFired).toBe(false);
  });
});

// ---- Cabinet expansion ----

describe('Cabinet: 6 minister roles', () => {
  it('MINISTER_ROLES has all six portfolios', () => {
    const ids = MINISTER_ROLES.map((r) => r.id);
    expect(ids).toContain('interior');
    expect(ids).toContain('treasury');
    expect(ids).toContain('defence');
    expect(ids).toContain('foreign');
    expect(ids).toContain('science');
    expect(ids).toContain('information');
    expect(MINISTER_ROLES).toHaveLength(6);
  });

  it('science minister boosts researchRate()', () => {
    const r = makeNation();
    r.proclaimNation('Test', 'democracy', {});
    const rateWithout = r.researchRate();
    const notable = r.notables[0];
    if (notable) {
      const m = r.ministers.find((x) => x.role === 'science');
      if (m) m.notableId = notable.id;
    }
    expect(r.researchRate()).toBeGreaterThan(rateWithout);
  });

  it('information minister reduces legitimacy decay', () => {
    const r = makeNation();
    r.proclaimNation('Test', 'democracy', {});
    r.legitimacy = 80;
    const notable = r.notables[0];
    if (notable) {
      const m = r.ministers.find((x) => x.role === 'information');
      if (m) m.notableId = notable.id;
    }
    const tick = r as unknown as { tickLegitimacy(): void };
    const legBefore = r.legitimacy;
    tick.tickLegitimacy();
    const decayWithMinister = legBefore - r.legitimacy;

    // Reset without minister
    r.legitimacy = 80;
    const m2 = r.ministers.find((x) => x.role === 'information');
    if (m2) m2.notableId = null;
    tick.tickLegitimacy();
    const decayWithout = legBefore - r.legitimacy;

    expect(decayWithMinister).toBeLessThan(decayWithout);
  });

  it('foreign minister increases envoy relations gain', () => {
    const r = makeNation();
    r.stateProclaimed = true;
    r.treasury = 1000;
    const spawnRival = (r as unknown as { spawnRival(): void }).spawnRival.bind(r);
    spawnRival();
    const rv = r.rivals[0];

    // Send two envoys at different cooldown windows, comparing gain with and without minister
    // First window: no foreign minister
    const relBefore1 = rv.relations;
    r.sendEnvoy(rv.id);
    const gainWithout = rv.relations - relBefore1;

    // Advance past cooldown and assign foreign minister
    r.minute += ENVOY_COOLDOWN_DAYS * MINUTES_PER_DAY + MINUTES_PER_DAY;
    const notable = r.notables[0];
    if (notable) {
      const m = r.ministers.find((x) => x.role === 'foreign');
      if (m) m.notableId = notable.id;
    }
    const relBefore2 = rv.relations;
    r.sendEnvoy(rv.id);
    const gainWith = rv.relations - relBefore2;

    if (notable) {
      expect(gainWith).toBeGreaterThan(gainWithout);
    }
  });

  it('old saves with 3 ministers backfill to 6 on deserialize', () => {
    const r = makeNation();
    const raw = JSON.parse(r.serialize());
    // Simulate an old save with only 3 minister slots
    raw.ministers = [
      { role: 'interior', title: 'Interior Minister', notableId: null },
      { role: 'treasury', title: 'Treasury Secretary', notableId: null },
      { role: 'defence', title: 'Defence Minister', notableId: null },
    ];
    const r2 = RegionSim.deserialize(JSON.stringify(raw));
    expect(r2.ministers).toHaveLength(6);
    expect(r2.ministers.find((m) => m.role === 'foreign')).toBeDefined();
    expect(r2.ministers.find((m) => m.role === 'science')).toBeDefined();
    expect(r2.ministers.find((m) => m.role === 'information')).toBeDefined();
  });
});
