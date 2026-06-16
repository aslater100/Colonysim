import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/sim';
import { RegionSim } from '../src/sim/region';
import type { CenturyReport } from '../src/sim/region';

/**
 * The four victory paths are the climax of the whole game, yet nothing
 * exercised `checkWinConditions` / `checkCenturyWins` — a silent break (a path
 * that can never fire) would ship unnoticed. These pin each path's trigger.
 *
 * A fresh year-1900 flip has a single player settlement and (elapsedYears=0) no
 * rival settlements, so the player holds the map — handy for territory paths.
 */
function region(seed = 1): RegionSim {
  const sim = new Simulation(seed);
  while (sim.settlers.length < 22) sim.spawnSettler(32, 34);
  sim.stock.wood = 200;
  sim.stock.meal = 200;
  return RegionSim.fromTown(sim, 8, 80, 80);
}

const checkWins = (r: RegionSim) => (r as unknown as { checkWinConditions(): void }).checkWinConditions();
const checkCenturyWins = (r: RegionSim) => (r as unknown as { checkCenturyWins(): void }).checkCenturyWins();

function report(grades: CenturyReport['grades']): CenturyReport {
  return {
    branch: null, pop: 100, towns: 1, gdp: 1, treasury: 1, co2ppm: 300,
    warmingC: 1, techs: 1, laws: 1, legitimacy: 50, grades, verdict: '',
  };
}

describe('Win conditions fire', () => {
  it('does not fire before any path is met', () => {
    const r = region(); // no era branch, not a nation
    checkWins(r);
    expect(r.winCondition).toBeNull();
  });

  it('solarpunk: a Garden-branch century wins', () => {
    const r = region();
    r.eraBranch = 'solarpunk';
    checkWins(r);
    expect(r.winCondition?.path).toBe('solarpunk');
  });

  it('unification: a proclaimed nation holding the map wins', () => {
    const r = region();
    r.nationProclaimed = true;
    // Stub the territory share (its computation is a separate concern) to isolate
    // the win-firing logic: 95% of the map under one banner.
    r.playerTerritoryControl = () => 0.95;
    checkWins(r);
    expect(r.winCondition?.path).toBe('unification');
  });

  it('unification needs the nation proclaimed, not just territory', () => {
    const r = region();
    r.playerTerritoryControl = () => 0.95; // holds the map…
    checkWins(r);
    expect(r.winCondition).toBeNull(); // …but never proclaimed a nation
  });

  it('legacy: three A-grade century categories win', () => {
    const r = region();
    r.centuryReport = report({ stewardship: 'A', prosperity: 'A', liberty: 'A', standing: 'C' });
    checkCenturyWins(r);
    expect(r.winCondition?.path).toBe('legacy');
  });

  it('domination: nation + majority territory + strongest military wins', () => {
    const r = region();
    r.nationProclaimed = true;
    r.centuryReport = report({ stewardship: 'B', prosperity: 'B', liberty: 'B', standing: 'B' }); // no legacy
    r.playerTerritoryControl = () => 0.6; // majority of the map
    r.faction(r.playerFactionId)!.militaryStrength = 999;
    for (const f of r.regionalFactions) if (f.id !== r.playerFactionId) f.militaryStrength = 1;
    checkCenturyWins(r);
    expect(r.winCondition?.path).toBe('domination');
  });

  it('domination is denied while a rival outguns the player', () => {
    const r = region();
    r.nationProclaimed = true;
    r.centuryReport = report({ stewardship: 'B', prosperity: 'B', liberty: 'B', standing: 'B' });
    r.playerTerritoryControl = () => 0.6;
    r.faction(r.playerFactionId)!.militaryStrength = 10;
    const rival = r.regionalFactions.find((f) => f.id !== r.playerFactionId)!;
    rival.militaryStrength = 50; // stronger than the player
    checkCenturyWins(r);
    expect(r.winCondition).toBeNull();
  });

  it('nation gate opens once a proclaimed state holds half the map', () => {
    const r = region();
    const gate = () => (r as unknown as { checkProclamationGate(): void }).checkProclamationGate();
    r.stateProclaimed = true;
    r.playerTerritoryControl = () => 0.4; // below the hegemon threshold
    gate();
    expect(r.proclamationReady).toBe(false);
    r.playerTerritoryControl = () => 0.5; // regional hegemon
    gate();
    expect(r.proclamationReady).toBe(true);
  });

  it('nation gate stays shut before statehood', () => {
    const r = region();
    r.playerTerritoryControl = () => 0.9; // holds the map but is not yet a state
    (r as unknown as { checkProclamationGate(): void }).checkProclamationGate();
    expect(r.proclamationReady).toBe(false);
  });

  it('the first achieved path is locked in (not overwritten)', () => {
    const r = region();
    r.eraBranch = 'solarpunk';
    checkWins(r);
    expect(r.winCondition?.path).toBe('solarpunk');
    // Now also satisfy unification — the recorded win must not change.
    r.nationProclaimed = true;
    checkWins(r);
    expect(r.winCondition?.path).toBe('solarpunk');
  });
});
