import buildingsJson from '../data/buildings.json';
import traitsJson from '../data/traits.json';
import namesJson from '../data/names.json';
import townTechsJson from '../data/town_techs.json';

/** All content defs load from JSON so they are moddable without touching code (GDD §8.8). */

// ---- Resource kinds ----
// Founding resources are available from day 1. Era-1 resources unlock via the town tech tree.
export type ResourceKind =
  // Founding (day 1)
  | 'wood' | 'grain' | 'meal' | 'stone' | 'clothes' | 'weapons'
  // Raw — unlocked by town tech tree
  | 'clay' | 'coal' | 'iron_ore' | 'flax' | 'herbs'
  // Processed — unlocked by town tech tree
  | 'timber' | 'brick' | 'iron' | 'tools' | 'rope' | 'flour' | 'ale' | 'medicine'
  // Food variety — unlocked by respective techs; distinct types for the mood system
  | 'bread' | 'dairy' | 'produce' | 'game_meal' | 'fish_meal' | 'preserved';

export type Provides =
  // Existing
  | 'storage' | 'sleep' | 'cook' | 'recreation' | 'warmth' | 'craft' | 'burial'
  | 'hunt' | 'trade' | 'forestry' | 'granary' | 'medical' | 'fishing' | 'forge'
  // New — town expansion
  | 'civic' | 'ranching' | 'milling' | 'brewing' | 'preservation'
  | 'smithing' | 'sawmill' | 'kiln' | 'well' | 'watchtower' | 'warehouse'
  | 'herbalism' | 'apothecary' | 'mining' | 'education';

export type WorkKind =
  // Existing
  | 'build' | 'farm' | 'chop' | 'cook' | 'haul' | 'medic' | 'craft'
  | 'bury' | 'hunt' | 'plant' | 'fish' | 'forge'
  // New — town expansion
  | 'research' | 'ranch' | 'mine' | 'mill' | 'smelt' | 'store'
  // New — economy & defense
  | 'market' | 'guard' | 'evacuate';

export const WORK_KINDS: WorkKind[] = [
  'build', 'farm', 'chop', 'cook', 'haul', 'medic', 'craft',
  'bury', 'hunt', 'plant', 'fish', 'forge',
  'research', 'ranch', 'mine', 'mill', 'smelt', 'store',
  'market', 'guard', 'evacuate',
];

/** Jobs a settler trains into as a profession — rolled at birth and eligible to
 *  be their primary calling. The economy/defense jobs (`market`, `guard`,
 *  `evacuate`) are deliberately excluded: they're contextual work that only
 *  exists with the right building or during a raid, so handing someone one as a
 *  default profession would leave them idling on a phantom job. Keeping them out
 *  of the birth roll also keeps the seeded RNG sequence stable. */
export const SKILLED_WORK_KINDS: WorkKind[] = [
  'build', 'farm', 'chop', 'cook', 'haul', 'medic', 'craft',
  'bury', 'hunt', 'plant', 'fish', 'forge',
  'research', 'ranch', 'mine', 'mill', 'smelt', 'store',
];

// ---- Town focus (used by player and Notable Mayor post-flip) ----
export type TownFocus = 'balanced' | 'agricultural' | 'military' | 'trade' | 'industrial' | 'cultural';

// ---- Currency system ----
export type CurrencySymbol = '$' | '£' | '€' | 'CA$' | 'A$';
export const CURRENCY_SYMBOLS: CurrencySymbol[] = ['$', '£', '€', 'CA$', 'A$'];

// Headless harness (vitest/node) has no localStorage; fall back to a module var.
let currencyFallback: CurrencySymbol = '$';

export function getCurrencySymbol(): CurrencySymbol {
  if (typeof localStorage === 'undefined') return currencyFallback;
  return (localStorage.getItem('centuria-currency') ?? '$') as CurrencySymbol;
}

export function setCurrencySymbol(sym: CurrencySymbol): void {
  currencyFallback = sym;
  if (typeof localStorage !== 'undefined') localStorage.setItem('centuria-currency', sym);
}

export function formatCurrency(amount: number, decimals?: number): string {
  if (decimals !== undefined) {
    return `${getCurrencySymbol()}${amount.toFixed(decimals)}`;
  }
  return `${getCurrencySymbol()}${Math.round(amount)}`;
}

// ---- Design screens (game start / region flip / nation flip) ----
export interface TownDesign {
  currencySymbol: CurrencySymbol;
  difficulty: 'easy' | 'normal' | 'hard';
  /** Map site preference; worldgen picks the best matching start. */
  location: 'river-valley' | 'coastal' | 'highlands' | 'surprise';
  startingPop: 8 | 12 | 16;
}

export interface RegionDesign {
  expansionSpeed: 'cautious' | 'steady' | 'aggressive';
  tradeOpenness: 'protectionist' | 'balanced' | 'free-trade';
  taxRate: number; // 0.05–0.30
  servicesLevel: 0 | 1 | 2;
}

export interface NationDesign {
  economicSystem: 'laissez-faire' | 'mixed' | 'planned';
  militaryDoctrine: 'defensive' | 'professional' | 'expansionist';
  allianceStance: 'isolationist' | 'opportunist' | 'coalition-builder';
  /** If set and different from current, triggers a currency transition. */
  currencySymbol?: CurrencySymbol;
}

/** Difficulty scales the founding stores and seed money. */
export const DIFFICULTY_PRESETS = {
  easy: { stockMult: 1.5, startCash: 800 },
  normal: { stockMult: 1.0, startCash: 500 },
  hard: { stockMult: 0.6, startCash: 200 },
} as const;

// ---- Market automation ----
export interface TradeOrder {
  id: number;
  kind: 'sell' | 'buy';
  resource: ResourceKind;
  quantity: number;
  trigger: 'periodic' | 'threshold';
  periodDays?: number;
  thresholdMin?: number;
  thresholdMax?: number;
  enabled: boolean;
}

export interface TradeRecord {
  day: number;
  kind: 'sell' | 'buy';
  resource: ResourceKind;
  quantity: number;
  auto: boolean;
}

// ---- Interactive events ----
export interface PendingEvent {
  /** Key into the handler table — stored so text survives save/load. */
  id: string;
  title: string;
  text: string;
  choices: { label: string; desc: string }[];
}

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
  homeType?: 'communal' | 'military' | 'private' | 'neutral';
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
  housingPreference?: 'private' | 'communal' | 'military';
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

export interface TownTechDef {
  id: string;
  name: string;
  branch: string;
  prereqs: string[];
  /** Base research time in game days at researcher skill 5. */
  days: number;
  cost: Partial<Record<ResourceKind, number>>;
  /** Tech is locked before this calendar year. */
  minYear?: number;
  desc: string;
  /** Informational list of what this tech enables. */
  unlocks: string[];
}

export const TOWN_TECH_DEFS: TownTechDef[] = townTechsJson.techs as TownTechDef[];

export function townTechDef(id: string): TownTechDef {
  const def = TOWN_TECH_DEFS.find((d) => d.id === id);
  if (!def) throw new Error(`unknown town tech: ${id}`);
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
  // Below these floors, a settler drops their work to unwind/socialize even on
  // shift — above them, work wins. Without a hard floor, settlers in a busy
  // colony grind recreation/social to zero and break down (worked to death).
  recreationCritical: 25,
  socialCritical: 20,
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
  hardCapPop: 200,
  // Population flows: a fed colony recovers its losses (0.1 death-spiral fix)
  immigrantFoodPerCapita: 8, // stores per settler before word spreads
  immigrantChancePerDay: 0.15,
  firstImmigrantDay: 12, // no arrivals until the colony has survived its first weeks
  immigrantStopPop: 133, // GDD §2.3: "wagons stop arriving — overcrowding"
  birthChancePerCoupleDay: 0.006,
  birthMinPop: 4,
  // Town founding (economic gate)
  townFoundingMinCash: 2000,  // minimum cash balance required to found a town
  townFoundingCost: 1500,     // cost to launch founding expedition
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
  // Repair: settlers restore damaged walls/gates automatically
  wallRepairWork: 15,   // settler-minutes to fully repair one section
  wallRepairCost: { wood: 1 }, // materials consumed per repair job
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
  // ---- Town expansion (Phase 0 foundations) ----
  // Food variety mood bonuses
  foodVarietyBonus3: 3,   // mood bonus with 3+ distinct food types in last 7 days
  foodVarietyBonus4: 6,   // mood bonus with 4+ distinct food types
  foodVarietyPenalty: 2,  // mood penalty for eating same type 3+ days running
  // Animal husbandry
  livestockGrowthPerTend: 1,
  livestockMaxPerBuilding: 8,
  ranchMealPerHeadPerDay: 0.5,
  dairyPerHeadPerDay: 0.3,
  tendWork: 90,
  // Production chains
  sawmillWoodPerTimber: 2,    // 2 wood → 1 timber
  kilnClayPerBrick: 2,        // 3 clay → 2 brick (net ratio)
  smeltOrePerIron: 2,         // 2 iron_ore + 1 coal → 1 iron
  smithIronPerTools: 2,       // 2 iron → 1 tools
  toolsBuildSpeedBonus: 0.2,  // 20% faster build work while tools in stock
  millGrainPerFlour: 1,       // 1 grain → 1.2 flour equivalent (ratio applied in cook)
  brewGrainPerAle: 2,         // 2 grain → 1 ale
  herbsHealBonus: 0.5,        // apothecary adds 50% regen on top of clinic base
  herbsPerHarvest: 3,
  herbGrowDays: 6,
  // Town research
  researchWorkBase: 1440,     // settler-minutes for a 10-day tech at skill 5 (10 × 144)
  // Well / water
  wellInfectionReduction: 0.1,
  // Watchtower
  watchtowerWarningDays: 1,   // extra days of warning before raid arrives
  // Market trading
  marketPriceRecalcDays: 1,   // recalc price modifiers at most once per N game-days
  marketPriceFloor: 0.25,     // minimum price multiplier
  marketPriceCap: 4.0,        // maximum price multiplier
  // Guard defense
  guardDetectionRange: 5,     // tiles; guards see enemies at this distance
  guardPostRange: 3,          // tiles; guard stays within this radius of post when garrisoned
  // Warehouse / storage
  warehouseBaseCap: 500,
  // Production chains
  flaxGrowDays: 8,
  flaxYieldPerTile: 3,
  sawmillWorkPerTimber: 90,
  kilnWorkPerBrick: 90,
  smeltWorkPerIron: 120,
  smithWorkPerTools: 90,
  mineWorkPerCharge: 120,
  mineClayPerCharge: 3,
  mineIronOrePerCharge: 2,
  mineCoalPerCharge: 1,
  mineChargesInit: 20,
  // Herb and medicine
  apothecaryHealMult: 1.5,
  medicineHerbCost: 2,
  medicineWorkCost: 90,
  // Tech mechanics
  cropRotationYieldBonus: 0.2,
  combatTrainingBonus: 2,
  repeatingArmsDamageBonus: 10,
  literacySkillCapBonus: 2,
  schoolhouseResearchBonus: 0.25,
  // Town identity
  prestigePerBuilding: 2,
  prestigePerRaidSurvived: 2,
  festivalCooldownDays: 30,
  festivalMealCost: 20,
  festivalWoodCost: 5,
  festivalMoodBonus: 15,
  festivalMoodDays: 3,
};
