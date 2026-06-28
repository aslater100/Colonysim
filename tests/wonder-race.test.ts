import { describe, it, expect } from 'vitest';
import { RegionSim, REGION_BUILDINGS, REGION_MINUTES_PER_TICK } from '../src/sim/region';
import { RegionMap } from '../src/sim/worldgen';
import { Weather } from '../src/sim/weather';
import { Rng } from '../src/sim/rng';
import { MINUTES_PER_DAY, START_YEAR } from '../src/sim/defs';

/**
 * Spatial-4X Phase D slice 1b — the rival-AI Wonder build-race. Rivals now bid
 * for unclaimed Wonders through the player's own construction pipeline, gated on
 * the era, an idle host town, and a treasury that can pay up front (aiRng-only,
 * so the main RNG stream — and the player's run — is untouched). A finished rival
 * Wonder claims `wonderOwner` empire-wide and grants that empire the realm bonus,
 * and the race is first-to-break-ground (no two empires raise the same Wonder).
 */

const ticksPerDay = MINUTES_PER_DAY / REGION_MINUTES_PER_TICK;
function runDays(r: RegionSim, days: number): void {
  for (let i = 0; i < days * ticksPerDay; i++) r.tick();
}

type Priv = {
  maybeBuildRivalWonder: (f: unknown, knobs: unknown) => void;
  rivalWonderHost: (f: unknown) => { construction: { id: string } | null } | null;
  wonderClaimed: (id: string, except?: unknown) => boolean;
  wonderEraYear: (def: unknown) => number;
  wonderBonus: (t: { factionId: number }, sector: string) => number;
  updateConstruction: () => void;
};
const priv = (r: RegionSim) => r as unknown as Priv;

function colony(seed: number): RegionSim {
  const r = RegionSim.foundColony(new Rng(seed), new RegionMap(seed), new Weather(seed), {});
  r.treasury = 1_000_000;
  return r;
}

const byId = (id: string) => REGION_BUILDINGS.find((b) => b.id === id)!;
const MONUMENT = byId('centuria_monument');
const GRANARY = byId('great_granary');
const FOUNDRY = byId('great_foundry');

/** Wipe any Wonder progress so a controlled white-box drive starts from a clean
 *  slate (the warmup ticks can let other rivals self-fund the cheap early Wonders
 *  now that the AI cost is scaled down). */
function clearWonders(r: RegionSim) {
  for (const k of Object.keys(r.wonderOwner)) delete r.wonderOwner[k];
  for (const s of r.settlements) {
    if (s.construction && REGION_BUILDINGS.find((b) => b.id === s.construction!.id)?.unique) {
      s.construction = null;
    }
  }
}

/** Find a rival faction that holds at least one settlement, bootstrapping the
 *  world forward until one does. Game-years are compressed (60 days each), so a
 *  3-game-year warmup lands at 1922 — before the statecraft era (1930). The
 *  warmup is then wiped of Wonder progress so the controlled drive is isolated. */
function richRival(r: RegionSim, gold = 5000, gameYears = 3) {
  runDays(r, 60 * gameYears);
  const f = r.regionalFactions.find((x) => x.id !== r.playerFactionId && x.settlementIds.length > 0);
  expect(f, 'a rival should hold a settlement after warmup').toBeTruthy();
  clearWonders(r);
  f!.treasury = gold;
  return f!;
}

// ---- 1. The era / prereq gate (rivals lack a researched-node set) ----

describe('Wonder race — era gate', () => {
  it('maps each Wonder prereq to its tech era-year', () => {
    expect(priv(colony(1)).wonderEraYear(GRANARY)).toBe(START_YEAR); // no prereq
    expect(priv(colony(1)).wonderEraYear(FOUNDRY)).toBe(1922);       // mass_production
    expect(priv(colony(1)).wonderEraYear(MONUMENT)).toBe(1930);      // statecraft
  });
});

// ---- 2. "Claimed" = owned OR under construction by any empire ----

describe('Wonder race — first-to-break-ground exclusion', () => {
  it('wonderClaimed sees ownership and in-progress builds (excepting one town)', () => {
    const r = colony(42);
    const home = r.settlements[0];
    expect(priv(r).wonderClaimed('great_granary')).toBe(false);

    home.construction = { id: 'great_granary', doneDay: 9_999 };
    expect(priv(r).wonderClaimed('great_granary')).toBe(true);
    expect(priv(r).wonderClaimed('great_granary', home)).toBe(false); // the host is excepted

    home.construction = null;
    r.wonderOwner['great_granary'] = 5; // owned by some rival
    expect(priv(r).wonderClaimed('great_granary')).toBe(true);
  });

  it('the player cannot start a Wonder a rival is already raising', () => {
    const r = colony(7);
    const rival = richRival(r);
    let host: { construction: { id: string } | null } | null = null;
    for (let i = 0; i < 500 && !(host = priv(r).rivalWonderHost(rival))?.construction; i++) {
      priv(r).maybeBuildRivalWonder(rival, r.aiKnobs());
    }
    const project = priv(r).rivalWonderHost(rival)!.construction!;
    expect(project, 'the rival should have broken ground').toBeTruthy();
    // The player's own town tries the SAME Wonder → rejected by the race.
    // Grant the prereq so the check reaches the empire-cap clause (not "requires …").
    const def = byId(project.id);
    if (def.prereq) r.researched.add(def.prereq);
    const check = r.cityBuildCheck(r.settlements[0], def);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/already stands/i);
  });
});

// ---- 3. The race fires end-to-end and grants the rival empire the bonus ----

describe('Wonder race — a rival completes a Wonder', () => {
  it('breaks ground (debiting the treasury), claims ownership, and lifts its empire', () => {
    const r = colony(11);
    const rival = richRival(r);
    const before = rival.treasury;
    let host: { construction: { id: string } | null } | null = null;
    for (let i = 0; i < 500 && !(host = priv(r).rivalWonderHost(rival))?.construction; i++) {
      priv(r).maybeBuildRivalWonder(rival, r.aiKnobs());
    }
    const project = priv(r).rivalWonderHost(rival)!.construction!;
    expect(project).toBeTruthy();
    expect(rival.treasury).toBeLessThan(before); // paid up front

    // Fast-forward the project to completion.
    priv(r).rivalWonderHost(rival)!.construction!.doneDay = 0;
    priv(r).updateConstruction();

    expect(r.wonderOwner[project.id]).toBe(rival.id);
    const def = byId(project.id);
    const sector = (def.empireSector === 'all' ? 'industry' : def.empireSector) as string;
    expect(priv(r).wonderBonus({ factionId: rival.id }, sector)).toBeGreaterThan(0);
    // The player gains nothing from a rival's Wonder.
    expect(priv(r).wonderBonus({ factionId: r.playerFactionId }, sector)).toBe(0);
  });
});

// ---- 4. The gates hold: broke rivals and pre-era prizes never break ground ----

describe('Wonder race — affordability + era gates hold', () => {
  it('a penniless rival never breaks ground, however many draws it makes', () => {
    const r = colony(3);
    const rival = richRival(r, 0); // no treasury
    for (let i = 0; i < 500; i++) priv(r).maybeBuildRivalWonder(rival, r.aiKnobs());
    expect(priv(r).rivalWonderHost(rival)!.construction).toBeNull();
  });

  it('a rival actually claims a Wonder in unattended autoplay (not inert)', () => {
    // Regression guard: a thriving rival should occasionally win the race in real
    // play. Seed 2024 is a known case; assert ≥1 Wonder ends up rival-owned.
    const r = RegionSim.create(2024);
    for (let i = 0; i < 110 * 60 * ticksPerDay; i++) r.tick();
    const owners = Object.values(r.wonderOwner);
    expect(owners.length).toBeGreaterThan(0);
    expect(owners.some((f) => f !== r.playerFactionId)).toBe(true);
  });

  it('a rich rival never reaches a Wonder before its era', () => {
    const r = colony(5);
    // Stop well before statecraft (1930): 3 bootstrap years lands us at 1922.
    const rival = richRival(r);
    expect(r.year).toBeLessThan(1930);
    let picked: string | null = null;
    for (let i = 0; i < 500; i++) {
      priv(r).maybeBuildRivalWonder(rival, r.aiKnobs());
      const c = priv(r).rivalWonderHost(rival)!.construction;
      if (c) { picked = c.id; break; }
    }
    expect(picked).toBeTruthy();
    expect(picked, 'the 1930 Monument is unreachable in 1922').not.toBe('centuria_monument');
  });
});
