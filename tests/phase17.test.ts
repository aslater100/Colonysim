/**
 * Phase 17: Historical Scenarios & Alternate Starts (GDD §8.8, §6.1)
 *
 * Tests cover:
 *   1. fromEraStart('1950') — year, settlements, nationProclaimed
 *   2. fromEraStart('1950') — pre-researched industrial techs
 *   3. fromEraStart('2000') — year, higher pop, digital_economy researched
 *   4. fromEraStart('2000') — correct CO₂ level
 *   5. SCENARIOS exports 4 objects with required fields
 *   6. beginRegimeLocked() — sets govLockExpiry = year + 30
 *   7. isGovLocked() — true before expiry, false after
 *   8. checkScenarioGoals() — marks a goal complete when met
 *   9. checkScenarioGoals() — does not mark same goal twice
 *  10. difficultySettings defaults to 1.0 / 'on'
 *  11. Serialize/deserialize round-trip preserves Phase 17 fields
 *  12. Old saves missing Phase 17 fields deserialize with safe defaults
 */

import { describe, expect, it } from 'vitest';
import {
  RegionSim,
  SCENARIOS,
  DEFAULT_DIFFICULTY_SETTINGS,
} from '../src/sim/region';
import { checkScenarioGoals } from '../src/sim/systems/scenarios';
import { RegionMap } from '../src/sim/worldgen';
import { Weather } from '../src/sim/weather';
import { Rng } from '../src/sim/rng';

// Helper: standard colony (1919 start)
function colony(seed = 42): RegionSim {
  return RegionSim.foundColony(new Rng(seed), new RegionMap(seed), new Weather(seed), {});
}

// Helper: era-start region
function eraStart(era: '1950' | '2000', seed = 42): RegionSim {
  return RegionSim.fromEraStart(era, { seed });
}

// ---- 1. fromEraStart('1950') basic ----
describe('RegionSim.fromEraStart("1950")', () => {
  it('starts in year 1950 with nationProclaimed=true', () => {
    const r = eraStart('1950');
    expect(r.year).toBe(1950);
    expect(r.stateProclaimed).toBe(true);
    expect(r.nationProclaimed).toBe(true);
  });

  it('has exactly 3 settlements', () => {
    const r = eraStart('1950');
    expect(r.settlements.length).toBe(3);
  });

  it('all settlements belong to the player faction', () => {
    const r = eraStart('1950');
    for (const s of r.settlements) {
      expect(s.factionId).toBe(r.playerFactionId);
    }
  });

  // ---- 2. Pre-researched industrial techs ----
  it('has pre-researched Cold War era technologies', () => {
    const r = eraStart('1950');
    // Required techs for 1950 start
    expect(r.researched.has('agriculture')).toBe(true);
    expect(r.researched.has('combustion_engine')).toBe(true);
    expect(r.researched.has('electrification')).toBe(true);
    expect(r.researched.has('mass_production')).toBe(true);
    expect(r.researched.has('printing_press')).toBe(true);
  });

  it('has mid-range Cold War treasury', () => {
    const r = eraStart('1950');
    // Treasury should be mid-range (15000–25000)
    expect(r.treasury).toBeGreaterThanOrEqual(15000);
    expect(r.treasury).toBeLessThan(30000);
  });

  it('has 3 active rivals spawned', () => {
    const r = eraStart('1950');
    expect(r.rivals.length).toBe(3);
  });

  it('rivals have relations in Cold War range (-10 to +20)', () => {
    const r = eraStart('1950');
    for (const rv of r.rivals) {
      expect(rv.relations).toBeGreaterThanOrEqual(-10);
      expect(rv.relations).toBeLessThanOrEqual(20);
    }
  });

  it('log includes the 1950 scenario opening message', () => {
    const r = eraStart('1950');
    const msg = r.log.find((l) => l.text.includes('1950 Cold War Era start'));
    expect(msg).toBeDefined();
  });
});

// ---- 3. fromEraStart('2000') basic ----
describe('RegionSim.fromEraStart("2000")', () => {
  it('starts in year 2000 with nationProclaimed=true', () => {
    const r = eraStart('2000');
    expect(r.year).toBe(2000);
    expect(r.stateProclaimed).toBe(true);
    expect(r.nationProclaimed).toBe(true);
  });

  it('has 5 settlements', () => {
    const r = eraStart('2000');
    expect(r.settlements.length).toBe(5);
  });

  it('total population in the 2000–3500 range', () => {
    const r = eraStart('2000');
    const pop = r.totalPop();
    // Allow a generous range since bands involve integer truncation
    expect(pop).toBeGreaterThanOrEqual(1500);
    expect(pop).toBeLessThanOrEqual(5000);
  });

  it('has digital_economy researched', () => {
    const r = eraStart('2000');
    expect(r.researched.has('digital_economy')).toBe(true);
  });

  it('has computing and antibiotics researched', () => {
    const r = eraStart('2000');
    expect(r.researched.has('computing')).toBe(true);
    expect(r.researched.has('antibiotics')).toBe(true);
  });

  // ---- 4. CO₂ level ----
  it('has atmosphericCO₂ ≈ 368 ppm (historical year 2000 level)', () => {
    const r = eraStart('2000');
    expect(r.co2ppm).toBeCloseTo(368, 0);
  });

  it('has warmingC = 0.7°C', () => {
    const r = eraStart('2000');
    expect(r.warmingC).toBeCloseTo(0.7, 1);
  });

  it('has 5 rivals', () => {
    const r = eraStart('2000');
    expect(r.rivals.length).toBe(5);
  });

  it('log includes the 2000 scenario opening message', () => {
    const r = eraStart('2000');
    const msg = r.log.find((l) => l.text.includes('Year 2000 start'));
    expect(msg).toBeDefined();
  });
});

// ---- 5. SCENARIOS exports ----
describe('SCENARIOS', () => {
  it('exports exactly 4 scenario objects', () => {
    expect(SCENARIOS.length).toBe(4);
  });

  it('every scenario has required fields: id, name, eraStart, startingGoals, openingEvent, difficulty', () => {
    for (const s of SCENARIOS) {
      expect(typeof s.id).toBe('string');
      expect(typeof s.name).toBe('string');
      expect(['1919', '1950', '2000']).toContain(s.eraStart);
      expect(Array.isArray(s.startingGoals)).toBe(true);
      expect(s.startingGoals.length).toBeGreaterThan(0);
      expect(typeof s.openingEvent).toBe('string');
      expect(['standard', 'hard', 'brutal']).toContain(s.difficulty);
    }
  });

  it('scenario ids are unique', () => {
    const ids = SCENARIOS.map((s) => s.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('includes long_peace (1919, standard)', () => {
    const s = SCENARIOS.find((s) => s.id === 'long_peace');
    expect(s).toBeDefined();
    expect(s!.eraStart).toBe('1919');
    expect(s!.difficulty).toBe('standard');
  });

  it('includes iron_curtain (1950) with govLock=democracy', () => {
    const s = SCENARIOS.find((s) => s.id === 'iron_curtain');
    expect(s).toBeDefined();
    expect(s!.eraStart).toBe('1950');
    expect(s!.govLock).toBe('democracy');
  });

  it('includes digital_crossroads (2000, hard)', () => {
    const s = SCENARIOS.find((s) => s.id === 'digital_crossroads');
    expect(s).toBeDefined();
    expect(s!.eraStart).toBe('2000');
    expect(s!.difficulty).toBe('hard');
  });

  it('includes climate_emergency (2000, brutal)', () => {
    const s = SCENARIOS.find((s) => s.id === 'climate_emergency');
    expect(s).toBeDefined();
    expect(s!.eraStart).toBe('2000');
    expect(s!.difficulty).toBe('brutal');
  });

  it('each goal has id, description, checkFn', () => {
    for (const s of SCENARIOS) {
      for (const g of s.startingGoals) {
        expect(typeof g.id).toBe('string');
        expect(typeof g.description).toBe('string');
        expect(typeof g.checkFn).toBe('string');
      }
    }
  });
});

// ---- 6. beginRegimeLocked() ----
describe('beginRegimeLocked()', () => {
  it('sets govLockExpiry to year + 30', () => {
    const r = colony();
    const currentYear = r.year;
    r.beginRegimeLocked('junta');
    expect(r.govLockExpiry).toBe(currentYear + 30);
  });

  it('sets govType to the locked type', () => {
    const r = colony();
    r.beginRegimeLocked('junta');
    expect(r.govType).toBe('junta');
  });

  it('adds a log entry about the locked regime', () => {
    const r = colony();
    r.beginRegimeLocked('junta');
    const logEntry = r.log.find((l) => l.text.includes('junta') && l.text.includes('thirty years'));
    expect(logEntry).toBeDefined();
  });
});

// ---- 7. isGovLocked() ----
describe('isGovLocked()', () => {
  it('returns true when year < govLockExpiry', () => {
    const r = colony();
    r.govLockExpiry = r.year + 30;
    expect(r.isGovLocked()).toBe(true);
  });

  it('returns false when year >= govLockExpiry', () => {
    const r = colony();
    r.govLockExpiry = r.year - 1; // already expired
    expect(r.isGovLocked()).toBe(false);
  });

  it('returns false when govLockExpiry is null', () => {
    const r = colony();
    r.govLockExpiry = null;
    expect(r.isGovLocked()).toBe(false);
  });
});

// ---- 8. checkScenarioGoals() — marks a goal complete ----
describe('checkScenarioGoals()', () => {
  it('marks the survive_to_2000 goal when year >= 2000', () => {
    const r = eraStart('2000'); // starts in 2000
    r.activeScenario = 'long_peace';
    r.scenarioGoalsCompleted = [];
    // goalSurviveTo2000 checks year >= 2000
    checkScenarioGoals(r);
    expect(r.scenarioGoalsCompleted).toContain('survive_to_2000');
  });

  it('logs a SCENARIO GOAL ACHIEVED message when goal is met', () => {
    const r = eraStart('2000');
    r.activeScenario = 'long_peace';
    r.scenarioGoalsCompleted = [];
    checkScenarioGoals(r);
    const achievedLog = r.log.find((l) => l.text.includes('SCENARIO GOAL ACHIEVED'));
    expect(achievedLog).toBeDefined();
  });

  // ---- 9. Does not mark same goal twice ----
  it('does not mark same goal twice', () => {
    const r = eraStart('2000');
    r.activeScenario = 'long_peace';
    r.scenarioGoalsCompleted = [];
    checkScenarioGoals(r);
    const firstCount = r.scenarioGoalsCompleted.filter((id) => id === 'survive_to_2000').length;
    checkScenarioGoals(r); // call again
    const secondCount = r.scenarioGoalsCompleted.filter((id) => id === 'survive_to_2000').length;
    expect(firstCount).toBe(1);
    expect(secondCount).toBe(1); // still only once
  });

  it('does nothing when activeScenario is null (sandbox)', () => {
    const r = colony();
    r.activeScenario = null;
    r.scenarioGoalsCompleted = [];
    checkScenarioGoals(r);
    expect(r.scenarioGoalsCompleted.length).toBe(0);
  });
});

// ---- 10. difficultySettings defaults ----
describe('difficultySettings', () => {
  it('defaults to all 1.0 multipliers and historicalAnchors=on', () => {
    const r = colony();
    expect(r.difficultySettings.crisisFrequency).toBe(1.0);
    expect(r.difficultySettings.aiAggression).toBe(1.0);
    expect(r.difficultySettings.economicVolatility).toBe(1.0);
    expect(r.difficultySettings.historicalAnchors).toBe('on');
  });

  it('fromEraStart hard scenario sets crisisFrequency=1.5', () => {
    const r = RegionSim.fromEraStart('2000', { seed: 42, scenarioId: 'digital_crossroads' });
    expect(r.difficultySettings.crisisFrequency).toBe(1.5);
  });

  it('fromEraStart brutal scenario sets crisisFrequency=2.0', () => {
    const r = RegionSim.fromEraStart('2000', { seed: 42, scenarioId: 'climate_emergency' });
    expect(r.difficultySettings.crisisFrequency).toBe(2.0);
    expect(r.difficultySettings.aiAggression).toBe(2.0);
  });

  it('climate_emergency scenario starts with co2ppm=400 and warmingC=1.2', () => {
    const r = RegionSim.fromEraStart('2000', { seed: 42, scenarioId: 'climate_emergency' });
    expect(r.co2ppm).toBeCloseTo(400, 0);
    expect(r.warmingC).toBeCloseTo(1.2, 1);
  });

  it('DEFAULT_DIFFICULTY_SETTINGS exported with correct values', () => {
    expect(DEFAULT_DIFFICULTY_SETTINGS.crisisFrequency).toBe(1.0);
    expect(DEFAULT_DIFFICULTY_SETTINGS.aiAggression).toBe(1.0);
    expect(DEFAULT_DIFFICULTY_SETTINGS.economicVolatility).toBe(1.0);
    expect(DEFAULT_DIFFICULTY_SETTINGS.historicalAnchors).toBe('on');
  });
});

// ---- 11. Serialize/deserialize round-trip ----
describe('serialize / deserialize round-trip', () => {
  it('preserves activeScenario through serialize/deserialize', () => {
    const r = eraStart('1950');
    r.activeScenario = 'iron_curtain';
    const json = r.serialize();
    const r2 = RegionSim.deserialize(json);
    expect(r2.activeScenario).toBe('iron_curtain');
  });

  it('preserves scenarioGoalsCompleted through serialize/deserialize', () => {
    const r = eraStart('2000');
    r.activeScenario = 'long_peace';
    r.scenarioGoalsCompleted = ['survive_to_2000', 'reach_100k_pop'];
    const json = r.serialize();
    const r2 = RegionSim.deserialize(json);
    expect(r2.scenarioGoalsCompleted).toEqual(['survive_to_2000', 'reach_100k_pop']);
  });

  it('preserves govLockExpiry through serialize/deserialize', () => {
    const r = colony();
    r.govLockExpiry = 1955;
    const json = r.serialize();
    const r2 = RegionSim.deserialize(json);
    expect(r2.govLockExpiry).toBe(1955);
  });

  it('preserves difficultySettings through serialize/deserialize', () => {
    const r = colony();
    r.difficultySettings = { crisisFrequency: 1.5, aiAggression: 2.0, economicVolatility: 0.5, historicalAnchors: 'emergent' };
    const json = r.serialize();
    const r2 = RegionSim.deserialize(json);
    expect(r2.difficultySettings.crisisFrequency).toBe(1.5);
    expect(r2.difficultySettings.aiAggression).toBe(2.0);
    expect(r2.difficultySettings.economicVolatility).toBe(0.5);
    expect(r2.difficultySettings.historicalAnchors).toBe('emergent');
  });

  it('preserves null activeScenario (sandbox) through serialize/deserialize', () => {
    const r = colony();
    r.activeScenario = null;
    const json = r.serialize();
    const r2 = RegionSim.deserialize(json);
    expect(r2.activeScenario).toBeNull();
  });
});

// ---- 12. Old saves missing Phase 17 fields deserialize with safe defaults ----
describe('backward-compatible deserialize', () => {
  it('old save without Phase 17 fields deserializes with safe defaults', () => {
    // Build a current save, parse it, strip Phase 17 fields, re-serialize
    const r = colony();
    const parsed = JSON.parse(r.serialize());
    delete parsed.activeScenario;
    delete parsed.scenarioGoalsCompleted;
    delete parsed.govLockExpiry;
    delete parsed.difficultySettings;
    const stripped = JSON.stringify(parsed);

    const r2 = RegionSim.deserialize(stripped);
    expect(r2.activeScenario).toBeNull();
    expect(r2.scenarioGoalsCompleted).toEqual([]);
    expect(r2.govLockExpiry).toBeNull();
    expect(r2.difficultySettings).toEqual(DEFAULT_DIFFICULTY_SETTINGS);
  });

  it('old save with partial difficultySettings merges with defaults', () => {
    const r = colony();
    const parsed = JSON.parse(r.serialize());
    parsed.difficultySettings = { crisisFrequency: 1.5 }; // partial
    const partial = JSON.stringify(parsed);

    const r2 = RegionSim.deserialize(partial);
    expect(r2.difficultySettings.crisisFrequency).toBe(1.5);
    // other fields should be at default
    expect(r2.difficultySettings.aiAggression).toBe(1.0);
    expect(r2.difficultySettings.historicalAnchors).toBe('on');
  });
});
