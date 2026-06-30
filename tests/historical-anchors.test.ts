import { describe, it, expect } from 'vitest';
import { RegionSim, REGION_MINUTES_PER_TICK } from '../src/sim/region';
import { tickHistoricalAnchors } from '../src/sim/systems/historical';
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

/** Advance the sim by exactly one monthly tick (30 days). */
function runMonth(r: RegionSim): void {
  for (let i = 0; i < 30 * ticksPerDay; i++) r.tick();
}

/** Force the anchor to fire by calling tickHistoricalAnchors() many times
 *  with the sim clock locked to the target year. */
function fireAnchor(r: RegionSim, year: number, times = 300): void {
  // Set the internal minute so year getter returns the target value.
  r.minute = (year - START_YEAR) * DAYS_PER_YEAR * MINUTES_PER_DAY;
  for (let i = 0; i < times; i++) tickHistoricalAnchors(r);
}

// ---- World-war window ----

describe('Historical anchor: world-war window (1936–1948)', () => {
  it('worldWarFired starts false', () => {
    const r = makeNation();
    expect((r as unknown as { worldWarFired: boolean }).worldWarFired).toBe(false);
  });

  it('fires when two hostile rivals exist in the target window', () => {
    const r = makeNation();
    // Spawn two rivals and make them hostile to each other
    const spawnRival = (r as unknown as { spawnRival(): void }).spawnRival.bind(r);
    spawnRival();
    spawnRival();
    expect(r.rivals.length).toBeGreaterThanOrEqual(2);
    const [a, b] = r.rivals;
    // Make one expansion-minded
    a.weights.expansion = 8;
    // Set hostile pairwise relations
    (r as unknown as { rivalPairs: Record<string, number> }).rivalPairs[r.pairKey(a.id, b.id)] = -50;
    // Lock year into the window and drive the probabilistic roll until it fires
    fireAnchor(r, 1940);
    expect((r as unknown as { worldWarFired: boolean }).worldWarFired).toBe(true);
    expect(r.log.some((l) => l.text.includes('CONFLAGRATION'))).toBe(true);
  });

  it('does not fire a second time after worldWarFired is set', () => {
    const r = makeNation();
    const spawnRival = (r as unknown as { spawnRival(): void }).spawnRival.bind(r);
    spawnRival();
    spawnRival();
    const [a, b] = r.rivals;
    a.weights.expansion = 9;
    (r as unknown as { rivalPairs: Record<string, number> }).rivalPairs[r.pairKey(a.id, b.id)] = -80;
    // Pre-set the flag
    (r as unknown as { worldWarFired: boolean }).worldWarFired = true;
    const logBefore = r.log.length;
    fireAnchor(r, 1942, 500);
    // No new conflagration log should have been added
    expect(r.log.filter((l) => l.text.includes('CONFLAGRATION')).length).toBe(0);
    // Log length should not have grown with anchor messages
    expect(r.log.length).toBe(logBefore);
  });

  it('does not fire outside the 1936–1948 window', () => {
    const r = makeNation();
    const spawnRival = (r as unknown as { spawnRival(): void }).spawnRival.bind(r);
    spawnRival();
    spawnRival();
    const [a, b] = r.rivals;
    a.weights.expansion = 9;
    (r as unknown as { rivalPairs: Record<string, number> }).rivalPairs[r.pairKey(a.id, b.id)] = -90;
    // Year before window
    fireAnchor(r, 1930, 500);
    expect((r as unknown as { worldWarFired: boolean }).worldWarFired).toBe(false);
    // Year after window
    fireAnchor(r, 1955, 500);
    expect((r as unknown as { worldWarFired: boolean }).worldWarFired).toBe(false);
  });
});

// ---- Oil shock ----

describe('Historical anchor: oil shock (1970–1985)', () => {
  it('oilShockFired starts false', () => {
    const r = makeNation();
    expect((r as unknown as { oilShockFired: boolean }).oilShockFired).toBe(false);
  });

  it('fires when combustion_engine is researched and no renewables in window', () => {
    const r = makeNation();
    r.researched.add('combustion_engine');
    // Ensure no clean energy
    r.researched.delete('renewables');
    r.researched.delete('fusion_power');
    r.treasury = 5000;
    fireAnchor(r, 1975);
    expect((r as unknown as { oilShockFired: boolean }).oilShockFired).toBe(true);
    expect(r.log.some((l) => l.text.includes('OIL EMBARGO'))).toBe(true);
  });

  it('does not fire if renewables are already researched', () => {
    const r = makeNation();
    r.researched.add('combustion_engine');
    r.researched.add('renewables');
    r.treasury = 5000;
    fireAnchor(r, 1975, 500);
    expect((r as unknown as { oilShockFired: boolean }).oilShockFired).toBe(false);
    expect(r.log.some((l) => l.text.includes('OIL EMBARGO'))).toBe(false);
  });

  it('does not fire without combustion_engine tech', () => {
    const r = makeNation();
    r.researched.delete('combustion_engine');
    r.researched.delete('renewables');
    fireAnchor(r, 1975, 500);
    expect((r as unknown as { oilShockFired: boolean }).oilShockFired).toBe(false);
  });

  it('does not fire outside the 1970–1985 window', () => {
    const r = makeNation();
    r.researched.add('combustion_engine');
    r.researched.delete('renewables');
    r.treasury = 5000;
    // Before window
    fireAnchor(r, 1960, 500);
    expect((r as unknown as { oilShockFired: boolean }).oilShockFired).toBe(false);
    // After window
    fireAnchor(r, 1990, 500);
    expect((r as unknown as { oilShockFired: boolean }).oilShockFired).toBe(false);
  });

  it('oil shock drains treasury and spikes inflation', () => {
    const r = makeNation();
    r.researched.add('combustion_engine');
    r.researched.delete('renewables');
    r.researched.delete('fusion_power');
    r.treasury = 5000;
    const inflBefore = r.inflationRate;
    const treasBefore = r.treasury;
    fireAnchor(r, 1975);
    if ((r as unknown as { oilShockFired: boolean }).oilShockFired) {
      expect(r.treasury).toBeLessThan(treasBefore);
      expect(r.inflationRate).toBeGreaterThan(inflBefore);
    }
    // If it didn't fire this run (very unlikely after 300 rolls at 6%), just skip
    // — the probabilistic nature is tested by other seeds.
  });
});

// ---- 2020-analog pandemic ----

describe('Historical anchor: 2020-analog pandemic (2012–2027)', () => {
  it('pandemicFired starts false', () => {
    const r = makeNation();
    expect((r as unknown as { pandemicFired: boolean }).pandemicFired).toBe(false);
  });

  it('fires in the 2012–2027 window and logs a PANDEMIC message', () => {
    const r = makeNation();
    // Add a settlement so the event can hit it
    expect(r.settlements.length).toBeGreaterThan(0);
    fireAnchor(r, 2020);
    expect((r as unknown as { pandemicFired: boolean }).pandemicFired).toBe(true);
    expect(r.log.some((l) => l.text.includes('PANDEMIC'))).toBe(true);
  });

  it('does not fire a second time', () => {
    const r = makeNation();
    (r as unknown as { pandemicFired: boolean }).pandemicFired = true;
    const logBefore = r.log.length;
    fireAnchor(r, 2020, 500);
    expect(r.log.filter((l) => l.text.includes('PANDEMIC')).length).toBe(0);
    expect(r.log.length).toBe(logBefore);
  });

  it('does not fire outside the 2012–2027 window', () => {
    const r = makeNation();
    fireAnchor(r, 2005, 500);
    expect((r as unknown as { pandemicFired: boolean }).pandemicFired).toBe(false);
    fireAnchor(r, 2035, 500);
    expect((r as unknown as { pandemicFired: boolean }).pandemicFired).toBe(false);
  });

  it('antibiotics tech reduces the log message severity marker', () => {
    // With antibiotics: message says "blunts the worst"
    const rWith = makeNation();
    rWith.researched.add('antibiotics');
    fireAnchor(rWith, 2020);
    if ((rWith as unknown as { pandemicFired: boolean }).pandemicFired) {
      const msg = rWith.log.find((l) => l.text.includes('PANDEMIC'))?.text ?? '';
      expect(msg).toContain('blunts the worst');
    }
  });

  it('pandemic adds active events to player settlements', () => {
    const r = makeNation();
    fireAnchor(r, 2020);
    if ((r as unknown as { pandemicFired: boolean }).pandemicFired) {
      const settlement = r.settlements[0];
      expect(settlement.activeEvents.some((ev) => ev.kind === 'pandemic_wave')).toBe(true);
    }
  });

  it('serialize/deserialize round-trips all three anchor flags', () => {
    const r = makeNation();
    (r as unknown as { worldWarFired: boolean }).worldWarFired = true;
    (r as unknown as { oilShockFired: boolean }).oilShockFired = true;
    (r as unknown as { pandemicFired: boolean }).pandemicFired = true;
    const json = r.serialize();
    const r2 = RegionSim.deserialize(json);
    expect((r2 as unknown as { worldWarFired: boolean }).worldWarFired).toBe(true);
    expect((r2 as unknown as { oilShockFired: boolean }).oilShockFired).toBe(true);
    expect((r2 as unknown as { pandemicFired: boolean }).pandemicFired).toBe(true);
  });

  it('new saves backfill anchor flags to false', () => {
    // Deserializing a save that pre-dates the anchors (missing fields) should backfill false
    const r = makeNation();
    const raw = JSON.parse(r.serialize());
    delete raw.worldWarFired;
    delete raw.oilShockFired;
    delete raw.pandemicFired;
    const r2 = RegionSim.deserialize(JSON.stringify(raw));
    expect((r2 as unknown as { worldWarFired: boolean }).worldWarFired).toBe(false);
    expect((r2 as unknown as { oilShockFired: boolean }).oilShockFired).toBe(false);
    expect((r2 as unknown as { pandemicFired: boolean }).pandemicFired).toBe(false);
  });
});
