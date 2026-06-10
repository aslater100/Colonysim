import buildingsJson from '../data/buildings.json';
import traitsJson from '../data/traits.json';
import namesJson from '../data/names.json';

/** All content defs load from JSON so they are moddable without touching code (GDD §8.8). */

export type ResourceKind = 'wood' | 'grain' | 'meal' | 'stone';
export type Provides = 'storage' | 'sleep' | 'farm' | 'cook' | 'recreation' | 'wall';
export type WorkKind = 'build' | 'farm' | 'chop' | 'cook' | 'haul' | 'medic';
export const WORK_KINDS: WorkKind[] = ['build', 'farm', 'chop', 'cook', 'haul', 'medic'];

export interface BuildingDef {
  id: string;
  name: string;
  w: number;
  h: number;
  cost: Partial<Record<ResourceKind, number>>;
  buildWork: number; // settler-minutes at skill 5
  provides: Provides;
  capacity?: number;
  maxHp?: number; // only damageable structures define this
  desc: string;
}

export interface TraitDef {
  id: string;
  name: string;
  desc: string;
  workSpeed?: number; // multiplier
  moodBase?: number; // additive
  warmthDecay?: number; // multiplier
  foodDecay?: number; // multiplier
}

export const BUILDING_DEFS: BuildingDef[] = buildingsJson.buildings as BuildingDef[];
export const TRAIT_DEFS: TraitDef[] = traitsJson.traits as TraitDef[];
export const FIRST_NAMES: string[] = namesJson.first;
export const LAST_NAMES: string[] = namesJson.last;

export function buildingDef(id: string): BuildingDef {
  const def = BUILDING_DEFS.find((d) => d.id === id);
  if (!def) throw new Error(`unknown building def: ${id}`);
  return def;
}

export function traitDef(id: string): TraitDef {
  const def = TRAIT_DEFS.find((d) => d.id === id);
  if (!def) throw new Error(`unknown trait def: ${id}`);
  return def;
}

// ---- Time constants (GDD §8.6: Town tier ≈ 45 real seconds per game day at speed 1) ----
export const MINUTES_PER_TICK = 4;
export const TICKS_PER_SECOND = 8; // 32 game-minutes per real second => 45 s/day
export const MINUTES_PER_DAY = 1440;
export const DAYS_PER_SEASON = 15;
export const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'] as const;
export const DAYS_PER_YEAR = DAYS_PER_SEASON * SEASONS.length;
export const START_YEAR = 1900;

// ---- Tuning (centralized so the headless harness can sweep them) ----
export const TUNING = {
  needDecayPerHour: { food: 2.2, rest: 1.4, warmth: 4.0, recreation: 0.8, social: 0.6 },
  mealFoodValue: 70,
  rawGrainFoodValue: 35,
  sleepRestPerHour: { bed: 9, ground: 5 },
  recreationPerHour: 12,
  socialPerHour: 10,
  moodWeights: { food: 0.35, rest: 0.25, warmth: 0.15, recreation: 0.15, social: 0.1 },
  mentalBreakMoodThreshold: 20,
  mentalBreakChancePerPointPerDay: 0.015,
  starvationHealthPerHour: 2,
  freezingHealthPerHour: 3,
  healthRegenPerHour: 0.5,
  treeWood: 5,
  treeChopWork: 60,
  rockStone: 4,
  rockQuarryWork: 90,
  // Roads (design: docs/design/transportation.md §2)
  roadCost: { dirt: {}, plank: { wood: 1 }, gravel: { stone: 1 }, bridge: { wood: 4 } } as Record<
    string,
    Partial<Record<'wood' | 'stone', number>>
  >,
  roadWork: { dirt: 10, plank: 25, gravel: 40, bridge: 120 } as Record<string, number>,
  farmGrowDays: 10, // effective ~12 after fertility & weather drag
  farmYieldPerTile: 10,
  cookWorkPerMeal: 20,
  cookBatch: 4,
  // The spine: soft ceiling on town #1 (GDD §2.3)
  softCapPop: 60,
  softCapWorkPenaltyPer: 0.0075,
  softCapMoodPenaltyPer10: 1,
  hardCapPop: 150,
  // Raids & combat
  firstRaidDay: 11,
  raidIntervalDays: 8,
  raidWealthPerRaider: 400,
  raidMaxRaiders: 9,
  raidRampDays: 15, // raid size cap grows by 1 per this many days
  raidTimeoutHours: 18,
  raiderHealth: 55,
  combatDamagePerHour: 30, // + combat skill × 6
  combatDamagePerSkill: 6,
  fightMinCombat: 3, // settlers below this flee instead
  wallDamagePerHour: 50,
  // Medical
  woundBleedPerHour: 0.8,
  woundSelfHealHours: 24,
  infectionWindowHours: 12,
  infectionChance: 0.25,
  infectionHealthPerHour: 1.2,
  treatWork: 30,
  bedRestThreshold: 50,
  sickHealthPerHour: 0.5,
  sickWorkMult: 0.6,
  // Relationships
  friendThreshold: 15,
  bondPerHourTogether: 0.8,
};
