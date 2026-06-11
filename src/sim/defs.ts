import buildingsJson from '../data/buildings.json';
import traitsJson from '../data/traits.json';
import namesJson from '../data/names.json';

/** All content defs load from JSON so they are moddable without touching code (GDD §8.8). */

export type ResourceKind = 'wood' | 'grain' | 'meal' | 'stone' | 'clothes' | 'weapons';
export type Provides =
  | 'storage' | 'sleep' | 'cook' | 'recreation' | 'warmth' | 'craft' | 'burial'
  | 'hunt' | 'trade' | 'forestry' | 'granary' | 'medical' | 'fishing' | 'forge';
export type WorkKind = 'build' | 'farm' | 'chop' | 'cook' | 'haul' | 'medic' | 'craft' | 'bury' | 'hunt' | 'plant' | 'fish' | 'forge';
export const WORK_KINDS: WorkKind[] = ['build', 'farm', 'chop', 'cook', 'haul', 'medic', 'craft', 'bury', 'hunt', 'plant', 'fish', 'forge'];

export interface UpgradeLevel {
  cost: Partial<Record<ResourceKind, number>>;
  capacityBonus: number;
  desc: string;
}

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
  upgrades?: UpgradeLevel[];
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
  // Economy buildings (PR B2)
  bakeWorkPerMeal: 12, // bakery: bigger ovens, faster meals
  bakeBatch: 8,
  huntTripWork: 240, // an abstract trip into the woods…
  huntMealYield: 3, // …comes back with game enough for a few meals
  fishTripWork: 180,
  fishMealYield: 4,
  fishRange: 8,
  plantWork: 20,
  saplingGrowDays: 8,
  foresterRadius: 6,
  // Meals spoil past what the stores can keep; granaries extend the larder.
  mealCapBase: 200,
  mealCapPerGranary: 150,
  clinicRegenMult: 2,
  // Market barter, fixed and deliberately lossy round-trip
  tradeRates: {
    'wood->grain': { give: 3, get: 2 },
    'stone->grain': { give: 2, get: 3 },
    'grain->wood': { give: 3, get: 2 },
    'grain->stone': { give: 4, get: 1 },
  } as Record<string, { give: number; get: number }>,
  // The spine: soft ceiling on town #1 (GDD §2.3)
  softCapPop: 60,
  softCapWorkPenaltyPer: 0.0075,
  softCapMoodPenaltyPer10: 1,
  hardCapPop: 150,
  // Population flows: a fed colony recovers its losses (0.1 death-spiral fix)
  immigrantFoodPerCapita: 8, // stores per settler before word spreads
  immigrantChancePerDay: 0.15,
  firstImmigrantDay: 12, // no arrivals until the colony has survived its first weeks
  immigrantStopPop: 100, // GDD §2.3: "wagons stop arriving — no room"
  birthChancePerCoupleDay: 0.006,
  birthMinPop: 4,
  // Burial
  buryWork: 45,
  unburiedMoodPenalty: 6,
  // Warmth: hearths and clothing make winter survivable by design
  hearthRadius: 5,
  warmthRegenWarmPerHour: 15, // beside a fire or indoors (≥16°C effective)
  clothesGrainCost: 2, // flax and straw, woven
  craftWorkPerClothes: 60,
  clothesWarmthC: 8,
  clothesWearDays: 30,
  // Raids & combat
  firstRaidDay: 11,
  raidIntervalDays: 8,
  raidWealthPerRaider: 400,
  raidMaxRaiders: 9,
  raidRampDays: 15, // raid size cap grows by 1 per this many days
  raidPopFactor: 0.5, // raiders never exceed half the living settlers
  raidTimeoutHours: 18,
  raiderHealth: 55,
  combatDamagePerHour: 30, // + combat skill × 6
  combatDamagePerSkill: 6,
  fightMinCombat: 3, // settlers below this flee instead
  wallCost: { wood: 3 },
  wallWork: 30,
  wallMaxHp: 80,
  wallDamagePerHour: 50,
  // Gates: a door in the palisade — settlers pass, raiders have to break it
  gateCost: { wood: 5 },
  gateWork: 45,
  gateMaxHp: 100,
  // Armed pawns: fighters grab a spear from the stores when the horn sounds
  spearWoodCost: 3,
  spearDamageBonus: 12,
  // Armoury: forged weapons cost wood, deal more damage than improvised spears
  forgeWoodCost: 4,        // wood per forged weapon
  forgeWorkPerWeapon: 90,  // settler-minutes at skill 5
  forgedWeaponBonus: 22,   // damage bonus (vs spearDamageBonus 12)
  // Spike traps: painted tiles that damage raiders on contact, one-shot
  trapWoodCost: 2,         // wood deducted immediately when painted
  trapDamage: 45,          // damage dealt when a raider triggers the trap
  // Animals: deer to hunt, wolves to fear
  deerStartCount: 8,
  deerMaxCount: 10,
  deerSpawnChancePerDay: 0.12,
  deerHealth: 40,
  deerFleeRadius: 3,
  huntRange: 4.5, // hunters shoot from outside the flee radius
  huntDamagePerHour: 30,
  wolfMealYield: 1,
  wolfFirstDay: 9,
  wolfPackChancePerDay: 0.06,
  wolfHealth: 60,
  wolfAggroRadius: 5,
  wolfDamagePerHour: 10,
  wolfStayDays: 2,
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
