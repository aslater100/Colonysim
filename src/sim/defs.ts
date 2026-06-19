import buildingsJson from '../data/buildings.json';
import traitsJson from '../data/traits.json';
import namesJson from '../data/names.json';
import townTechsJson from '../data/town_techs.json';
import roomsJson from '../data/rooms.json';
import stationsJson from '../data/stations.json';
import blueprintsJson from '../data/blueprints.json';

/** All content defs load from JSON so they are moddable without touching code (GDD §8.8). */

// ---- Resource kinds ----
// Founding resources are available from day 1. Era-1 resources unlock via the town tech tree.
export type ResourceKind =
  // Founding (day 1)
  | 'wood' | 'grain' | 'meal' | 'stone' | 'clothes' | 'weapons'
  // Raw — unlocked by town tech tree
  | 'clay' | 'coal' | 'iron_ore' | 'flax' | 'herbs'
  // Processed — Era 1
  | 'timber' | 'brick' | 'iron' | 'tools' | 'rope' | 'flour' | 'ale' | 'medicine'
  // Processed — Era 2 (Industrial)
  | 'coke' | 'petroleum'
  // Food variety — unlocked by respective techs; distinct types for the mood system
  | 'bread' | 'dairy' | 'produce' | 'game_meal' | 'fish_meal' | 'preserved';

/** Stable-ordered list of every ResourceKind. Index i matches Stockpile's Float32Array slot i. */
export const RESOURCE_KINDS: ResourceKind[] = [
  'wood', 'grain', 'meal', 'stone', 'clothes', 'weapons',
  'clay', 'coal', 'iron_ore', 'flax', 'herbs',
  'timber', 'brick', 'iron', 'tools', 'rope', 'flour', 'ale', 'medicine',
  'coke', 'petroleum',
  'bread', 'dairy', 'produce', 'game_meal', 'fish_meal', 'preserved',
];

export type Provides =
  // Existing
  | 'storage' | 'sleep' | 'cook' | 'recreation' | 'warmth' | 'craft' | 'burial'
  | 'hunt' | 'trade' | 'forestry' | 'granary' | 'medical' | 'fishing' | 'forge'
  // New — town expansion
  | 'civic' | 'ranching' | 'milling' | 'brewing' | 'preservation'
  | 'smithing' | 'sawmill' | 'kiln' | 'well' | 'watchtower' | 'warehouse'
  | 'herbalism' | 'apothecary' | 'mining' | 'education'
  // Era 2 — Industrial
  | 'coke_furnace';

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
  /** 8/12/16 are the classic settler counts; 25 and 50 match GDD population targets. */
  startingPop: 8 | 12 | 16 | 25 | 50;
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

/** Difficulty also drives the regional AI competitors (GDD §6.2): how often
 *  rivals act, how hard they expand and fight, how fast they research, and how
 *  ambitious (short-fused) their goals are. `easy` is the "story" pole — passive,
 *  slow, generous deadlines; `hard` is "brutal" — frequent, aggressive, fast.
 *  `goalYearsMult` stretches (>1) or compresses (<1) each goal's deadline, so a
 *  hard AI sets itself tighter, more aggressive timelines. */
export const AI_DIFFICULTY = {
  easy:   { updateFreq: 150, expandChance: 0.06, settlementCap: 8,  techMult: 0.7, raidMult: 0.4, goalYearsMult: 1.5, scoutChance: 0.06, aggressionBias: -20 },
  normal: { updateFreq: 90,  expandChance: 0.10, settlementCap: 12, techMult: 1.0, raidMult: 1.0, goalYearsMult: 1.0, scoutChance: 0.10, aggressionBias: 0 },
  hard:   { updateFreq: 45,  expandChance: 0.16, settlementCap: 16, techMult: 1.4, raidMult: 1.8, goalYearsMult: 0.7, scoutChance: 0.16, aggressionBias: 20 },
} as const;

export type AiDifficulty = keyof typeof AI_DIFFICULTY;

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
  /** Game-day the order last executed (for periodic throttling). */
  lastFiredDay?: number;
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
  /** Index of the selected choice (-1 = not yet chosen) */
  chosenIndex?: number;
}

export interface EventDef {
  id: string;
  title: string;
  text: (sim: any) => string; // parameterized by simulation state
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
  requiredTech?: string; // tech id that must be researched before placing
  requiredEra?: number; // minimum game era (1–4) before this building is placeable
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

const _buildingDefById = new Map(BUILDING_DEFS.map((d) => [d.id, d]));
const _traitDefById = new Map(TRAIT_DEFS.map((d) => [d.id, d]));

export function buildingDef(id: string): BuildingDef {
  const def = _buildingDefById.get(id);
  if (!def) throw new Error(`unknown building def: ${id}`);
  return def;
}

export function traitDef(id: string): TraitDef {
  const def = _traitDefById.get(id);
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
  /** Tech is locked until the specified game era is reached. */
  requiredEra?: number;
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

// ---- Town-tier interactive events ----
export const TOWN_EVENT_DEFS: EventDef[] = [
  {
    id: 'bandits',
    title: 'Bandits at the Gate',
    text: () => 'A group of bandits demands tribute. Pay them off or stand your ground?',
    choices: [
      { label: 'Pay tribute', desc: '10 grain lost, but avoid conflict' },
      { label: 'Stand firm', desc: 'Keep resources, but risk militia casualties' },
    ],
  },
  {
    id: 'refugees',
    title: 'Refugees Seeking Shelter',
    text: () => 'A group of refugees asks to join your colony. Accept them or turn them away?',
    choices: [
      { label: 'Welcome them', desc: '+4 settlers, +1 food consumption' },
      { label: 'Turn them away', desc: 'Keep morale stable, avoid extra mouths' },
    ],
  },
  {
    id: 'plague',
    title: 'Sickness Spreads',
    text: () => 'A contagious illness breaks out. Quarantine the sick or treat them freely?',
    choices: [
      { label: 'Quarantine', desc: 'Slow the spread, but hurt morale' },
      { label: 'Treat freely', desc: 'Keep morale high, but sickness lingers' },
    ],
  },
  {
    id: 'fire',
    title: 'Fire in Camp',
    text: () => 'A building catches fire! Evacuate nearby or try to extinguish it?',
    choices: [
      { label: 'Evacuate', desc: 'Everyone stays safe, but building is lost' },
      { label: 'Fight fire', desc: 'Chance to save the building, but risk casualties' },
    ],
  },
  {
    id: 'trader',
    title: 'Merchant Caravan',
    text: () => 'A well-supplied merchant caravan passes through. Trade with them?',
    choices: [
      { label: 'Trade 5 wood', desc: 'Get 8 grain' },
      { label: 'Decline', desc: 'Keep your resources' },
    ],
  },
  {
    id: 'harvest',
    title: 'Bumper Harvest',
    text: () => 'The fields yield an exceptional crop! How to use it?',
    choices: [
      { label: 'Store it all', desc: '+20 grain to reserves' },
      { label: 'Celebrate', desc: '+10 grain, all settlers +2 mood' },
    ],
  },
  {
    id: 'ore_discovery',
    title: 'Ore Discovery',
    text: () => 'Diggers strike a rich vein! How to proceed?',
    choices: [
      { label: 'Mine aggressively', desc: '+20 iron ore, but settlers tire quickly' },
      { label: 'Steady pace', desc: '+10 iron ore, sustainable' },
    ],
  },
  {
    id: 'settlement_feud',
    title: 'Settlement Conflict',
    text: () => 'Two families nearly come to blows over land. How to resolve it?',
    choices: [
      { label: 'Mediate fairly', desc: 'Morale stable, mood penalties fade' },
      { label: 'Ignore it', desc: 'Conflict lingers, mood penalties persist' },
    ],
  },
];

export function townEventDef(id: string): EventDef | undefined {
  return TOWN_EVENT_DEFS.find((d) => d.id === id);
}

// ---- Rooms & workstations (Songs-of-Syx build model: walls + floors + designated
// rooms whose output is the sum of the workstations inside them) ----

/** A room TYPE the player paints over a floored area. Numeric id = array index + 1. */
export interface RoomTypeDef {
  id: string;
  name: string;
  desc: string;
  /** Needs walls all round to function (homes, libraries) vs open yards (mills). */
  enclosedRequired?: boolean;
}

/** Passive capacity a `capacity` station contributes to its room. */
export type CapacityKind = 'sleep' | 'recreation' | 'education' | 'medical' | 'storage' | 'burial' | 'watch' | 'well' | 'trade' | 'drill' | 'faith';

/** A recipe a `craft` station runs: inputs → outputs over `work` settler-minutes. */
export interface StationRecipe {
  inputs: Partial<Record<ResourceKind, number>>;
  outputs: Partial<Record<ResourceKind, number>>;
  work: number;
}

/** A workstation placed inside a room. Numeric typeId = array index + 1. */
export interface StationDef {
  id: string;
  name: string;
  /** Room type ids this station may be placed in. */
  roomTypes: string[];
  w: number;
  h: number;
  cost: Partial<Record<ResourceKind, number>>;
  buildWork: number;
  kind: 'craft' | 'capacity';
  recipe?: StationRecipe;
  capacity?: { kind: CapacityKind; amount: number };
}

export const ROOM_DEFS: RoomTypeDef[] = (roomsJson.rooms as RoomTypeDef[]);
export const STATION_DEFS: StationDef[] = (stationsJson.stations as StationDef[]);

// String id ↔ numeric layer id. 0 is reserved for "none" in the Uint8 tile layers.
export const ROOM_TYPE_ID = new Map(ROOM_DEFS.map((d, i) => [d.id, i + 1] as const));
export const STATION_TYPE_ID = new Map(STATION_DEFS.map((d, i) => [d.id, i + 1] as const));

const _roomDefById = new Map(ROOM_DEFS.map((d) => [d.id, d]));
const _stationDefById = new Map(STATION_DEFS.map((d) => [d.id, d]));

export function roomDef(id: string): RoomTypeDef {
  const def = _roomDefById.get(id);
  if (!def) throw new Error(`unknown room type: ${id}`);
  return def;
}

export function stationDef(id: string): StationDef {
  const def = _stationDefById.get(id);
  if (!def) throw new Error(`unknown station def: ${id}`);
  return def;
}

/** Numeric room-type id → def (for fast tile-layer lookups). 1-based; 0 = none. */
export const ROOM_DEF_BY_NUM: (RoomTypeDef | null)[] = [null, ...ROOM_DEFS];
/** Numeric station-type id → def. 1-based; 0 = none. */
export const STATION_DEF_BY_NUM: (StationDef | null)[] = [null, ...STATION_DEFS];

/** A pre-built room template: walls + floor + designation + stations in one click. */
export interface BlueprintDef {
  id: string;
  name: string;
  desc: string;
  w: number;
  h: number;
  /** Filled rectangles [x0,y0,x1,y1] of wall tiles, relative to top-left origin. */
  wallRects: [number, number, number, number][];
  /** Filled rectangle [x0,y0,x1,y1] of floor + room-designation tiles. */
  floorRect: [number, number, number, number];
  roomType: string;
  stations: Array<{ type: string; x: number; y: number }>;
}

export const BLUEPRINT_DEFS: BlueprintDef[] = blueprintsJson.blueprints as BlueprintDef[];

// Validate cross-references once at load (cheap; catches data typos in CI).
for (const s of STATION_DEFS) {
  for (const rt of s.roomTypes) {
    if (!ROOM_TYPE_ID.has(rt)) throw new Error(`station ${s.id} references unknown room type ${rt}`);
  }
  if (s.kind === 'craft' && !s.recipe) throw new Error(`craft station ${s.id} has no recipe`);
  if (s.kind === 'capacity' && !s.capacity) throw new Error(`capacity station ${s.id} has no capacity`);
}

// ---- Time constants (GDD §8.6: Town tier ≈ 45 real seconds per game day at speed 1) ----
export const MINUTES_PER_TICK = 4;
export const TICKS_PER_SECOND = 8; // 32 game-minutes per real second => 45 s/day
export const MINUTES_PER_DAY = 1440;
export const DAYS_PER_SEASON = 15;
export const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'] as const;
export const DAYS_PER_YEAR = DAYS_PER_SEASON * SEASONS.length;
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;
export const DAYS_PER_MONTH = 5; // ~60 days/year ÷ 12 months
export const START_YEAR = 1919;

// ---- Stockpile / capacity constants ----
/** Raw-good storage per stockpile zone tile. */
export const CAPACITY_PER_TILE = 50;
/** Food/rest need below which a working settler abandons their task to eat/sleep. */
export const NEED_INTERRUPT_THRESHOLD = 20;

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
  /** Cook trigger: start cooking when meals < settlers × this. */
  cookTriggerMult: 8,
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
  // Rope: flax fibre twisted at the tailor (textile_farming); feeds advanced upgrades
  ropeFlaxCost: 2,
  ropeWorkCost: 70,
  ropeTarget: 12,        // tailor spins rope up to this stock when flax is plentiful
  // Preserved food: surplus meals salted/smoked into shelf-stable rations (food_preservation tech)
  preservedMealCost: 3,  // meals consumed per batch
  preservedYield: 2,     // preserved produced per batch
  preserveWorkCost: 60,
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
  // Armoury: forged weapons consume timber (sawmill feeds the armoury), deal more damage than improvised spears
  forgeTimberCost: 1,      // timber per forged weapon
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
  // Coke furnace (GDD: 3 coal → 1 coke/12s)
  cokeCoalCost: 3,            // coal consumed per coke batch
  cokeWorkCost: 120,          // settler-minutes per coke unit
  cokeCap: 60,                // stop producing coke above this stock level
  // Smelter (GDD: 3 ore + 1 coke → 1 iron/12s; coke replaced raw coal as fuel)
  smeltOrePerIron: 3,         // 3 iron_ore + 1 coke → 1 iron (GDD spec)
  smeltCokePerIron: 1,        // coke consumed per iron bar
  smithIronPerTools: 2,       // 2 iron → 1 tools
  toolsBuildSpeedBonus: 0.2,  // 20% faster build work while tools in stock
  ropeBuildSpeedBonus: 0.1,   // 10% faster build work from rope scaffolding (stacks with tools)
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
  // Market trading — dynamic supply/demand pricing
  marketPriceRecalcDays: 1,   // recalc price modifiers at most once per N game-days
  marketPriceFloor: 0.25,     // minimum price multiplier
  marketPriceCap: 4.0,        // maximum price multiplier
  marketSellElasticity: 0.012,  // how far one sold unit pushes a resource's price down
  marketBuyElasticity: 0.012,   // how far one bought unit pushes a resource's price up
  marketRecoveryPerDay: 0.15,   // fraction of the gap back to 1.0 that prices heal each day
  // Town-tier inflation (gated by the Banking tech → dynamicPricing mechanic)
  inflationCashAnchor: 90,      // target cash per capita; above this, inflation builds
  inflationDriftPerDay: 0.05,   // fraction of the gap to target inflation closed each day
  inflationMin: -0.1,           // deflation floor (−10%)
  inflationMax: 0.4,            // inflation ceiling (+40%)
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
  // Era system — warning thresholds (GDD Quick Reference Card §5)
  warnCoalYellow: 5,          // coal stock triggers yellow alert
  warnFoodYellow: 20,         // total meals triggers yellow alert
  warnUnemployYellow: 0.20,   // idle fraction triggers yellow alert
  warnUnemployRed: 0.50,      // idle fraction triggers red alert
  // Era 1 → 2 unlock requirements (GDD §3.1: industrial revolution milestone)
  era2ToolsRequired: 20,      // tools in stock
  era2IronRequired: 10,       // iron bars in stock
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
  // ---- Cost scaling with nation development & size (region tier) ----
  // Sinks were flat 1900-era constants while income climbed with the value
  // chain. These let money/research costs rise with the nation, grounded in:
  //  · Baumol's cost disease  — public works track the economy's wage level.
  //  · Wagner's law           — public spending grows as a share of GDP.
  //  · "Ideas harder to find" — research effort must rise to keep advancing.
  // All factors floor at 1.0, so a fresh 1900 state (and existing tests) are
  // unchanged. Exponents are sub-linear: growth still buys some real progress.
  baumolBaseGdpPerCapita: 6, // £/capita/month of a fresh GDD-era state → devFactor 1
  baumolExp: 0.7, // money build-cost elasticity to wage/output level (<1)
  wagnerExp: 1.15, // upkeep outpaces build cost (public-sector share rises)
  researchBaseRate: 2, // ≈ a young state's raw RP/day, with headroom so early game is unscaled
  researchScaleExp: 0.6, // RP-cost growth vs. nation size (<1: net speedup remains)
  // Market stalls: each stall generates passive gold income from passing trade
  goldPerMarketStallPerDay: 2,
  // ---- Macro / region-economy dials (GDD §13.3) ----
  // Minsky financial-instability parameters: control how quickly over-leverage
  // destabilises the credit cycle. Tune these for campaign difficulty or testing.
  /** Debt-service/GDP ratio above which the credit cycle becomes fragile. */
  leverageFragility: 0.18,
  /** Private leverage ratio above which confidence erodes (Minsky moment threshold). */
  leverageFragile: 1.5,
  /** Confidence erosion per unit of private leverage above leverageFragile. */
  fragilityGain: 140,
};

// ---- Faction system (GDD §7.3: political depth) ----
/** Factions are political movements that rise and fall throughout the game.
 *  They compete for influence, affecting laws, research, morale, and economic priorities.
 *  Each faction has ambitions (long-term goals), rivalries, and can take actions.
 *  Period-appropriate emergence prevents anachronistic factions. */

export type FactionId = 'oligarchs' | 'industrialists' | 'liberals' | 'communists' | 'socialists'
                       | 'nationalists' | 'oil_barons' | 'technocrats' | 'environmentalists' | 'water_barons'
                       | 'monarchists' | 'conservatives' | 'free_traders' | 'merchant_guilds' | 'labor_unions'
                       | 'scientists' | 'bureaucrats' | 'military_industrial' | 'militarists' | 'theocrats'
                       | 'pacifists' | 'humanitarians' | 'information_brokers';

/** Faction ambitions: what they're working towards. Rivalries are inferred from opposing goals. */
export interface FactionAmbition {
  id: string;
  name: string;
  description: string; // What the faction is trying to accomplish
  /** Laws they want passed to achieve this ambition */
  targetLaws: string[];
  /** Tech they want researched */
  targetTech?: string[];
  /** If player blocks this ambition, faction loses 15 strength. If achieved, gains 25. */
  reward: number;
}

/** Actions a faction can take based on strength and ambition progress */
export type FactionAction =
  | 'demand_law'          // Demand player pass a specific law
  | 'sabotage_rival'      // Undermine a rival faction (reduce their strength)
  | 'strike'              // Workers strike; morale drops if ignored
  | 'bribery'             // Offer deals to player
  | 'propaganda'          // Sway public opinion (boost own morale, cut rivals)
  | 'assassination'       // Eliminate rivals via violence (rare, high-strength only)
  | 'alliance'            // Form alliance with another faction
  | 'boycott'             // Economic boycott of player policies;

export interface FactionDef {
  id: FactionId;
  name: string;
  desc: string;
  minYear: number; // First year this faction can emerge
  maxYear?: number; // Last year this faction is relevant (optional; omit for 2100+)
  /** Values [0-1]: how much this faction boosts/cuts research for each tech category. */
  techModifiers: {
    infrastructure?: number;
    military?: number;
    agriculture?: number;
    industry?: number;
    energy?: number;
    culture?: number;
    finance?: number;
  };
  /** Laws this faction strongly opposes (blocks if strength > threshold). */
  opposes: string[];
  /** Laws this faction promotes (auto-enables if strength > threshold). */
  promotes: string[];
  /** Morale modifiers: how much this faction's strength affects settler happiness. */
  moraleMod: number;
  /** How government type availability is affected */
  govRestrictions?: string[];
  /** Military strength bonus when this faction is dominant. */
  militaryBonus: number;
  /** Economic sector productivity modifier (% per strength point). */
  economicFocus?: string;
  /** Other factions this one naturally rivals (opposing ideologies) */
  rivals: FactionId[];
  /** Other factions this one naturally allies with (shared goals) */
  allies: FactionId[];
  /** 2-3 core ambitions this faction pursues */
  ambitions: FactionAmbition[];
  /** Available actions this faction can take (based on era/strength) */
  availableActions: FactionAction[];
}

export interface FactionDef {
  id: FactionId;
  name: string;
  desc: string;
  minYear: number; // First year this faction can emerge
  maxYear?: number; // Last year this faction is relevant (optional; omit for 2100+)
  /** Values [0-1]: how much this faction boosts/cuts research for each tech category. */
  techModifiers: {
    infrastructure?: number;
    military?: number;
    agriculture?: number;
    industry?: number;
    energy?: number; // oil_barons -1.5, environmentalists +1.5 for renewables
    culture?: number;
    finance?: number;
  };
  /** Laws this faction strongly opposes (blocks if strength > threshold). */
  opposes: string[]; // e.g., oligarchs oppose 'universal_suffrage'
  /** Laws this faction promotes (auto-enables if strength > threshold). */
  promotes: string[];
  /** Morale modifiers: how much this faction's strength affects settler happiness. */
  moraleMod: number; // e.g., communists +20 if strong, -20 if weak
  /** How government type availability is affected: e.g. oligarchs restrict democracy */
  govRestrictions?: string[]; // gov types oligarchs disallow
  /** Military strength bonus when this faction is dominant. */
  militaryBonus: number;
  /** Economic sector productivity modifier (% per strength point). */
  economicFocus?: string; // 'agriculture', 'manufacturing', 'finance', 'tech'
}

export const FACTION_DEFS: FactionDef[] = [
  {
    id: 'oligarchs',
    name: 'Oligarchs',
    desc: 'Wealthy merchants controlling finance. Hoard wealth, resist democracy.',
    minYear: 1800,
    techModifiers: { finance: 1.2, infrastructure: 0.9 },
    opposes: ['universal_suffrage', 'labor_law', 'progressive_tax'],
    promotes: ['income_tax'],
    moraleMod: -15,
    govRestrictions: ['democracy'],
    militaryBonus: 5,
    economicFocus: 'finance',
    rivals: ['communists', 'labor_unions', 'humanitarians'],
    allies: ['monarchists', 'conservatives', 'free_traders'],
    ambitions: [
      { id: 'wealth_hoarding', name: 'Wealth Accumulation', description: 'Prevent progressive taxation and worker protections', targetLaws: [], reward: 25 },
      { id: 'block_democracy', name: 'Preserve Aristocracy', description: 'Prevent universal suffrage from spreading', targetLaws: [], reward: 30 },
      { id: 'dominate_finance', name: 'Financial Dominance', description: 'Control banking and trade', targetLaws: [], reward: 20 },
    ],
    availableActions: ['demand_law', 'sabotage_rival', 'bribery', 'propaganda', 'alliance'],
  },
  {
    id: 'monarchists',
    name: 'Monarchists',
    desc: 'Aristocratic reactionaries defending traditional hierarchy and hereditary rule.',
    minYear: 1800,
    maxYear: 1950,
    techModifiers: { culture: 0.8, military: 1.1 },
    opposes: ['universal_suffrage', 'labor_law', 'democracy'],
    promotes: ['hereditary_rule'],
    moraleMod: -10,
    govRestrictions: ['democracy', 'republic'],
    militaryBonus: 15,
    rivals: ['liberals', 'communists', 'labor_unions'],
    allies: ['oligarchs', 'conservatives', 'theocrats'],
    ambitions: [
      { id: 'restore_monarchy', name: 'Restore Monarchy', description: 'Prevent democracy and establish hereditary rule', targetLaws: [], reward: 35 },
      { id: 'noble_privilege', name: 'Noble Privilege', description: 'Maintain aristocratic advantages', targetLaws: [], reward: 25 },
    ],
    availableActions: ['demand_law', 'sabotage_rival', 'propaganda', 'alliance'],
  },
  {
    id: 'conservatives',
    name: 'Conservatives',
    desc: 'Status quo defenders opposing rapid change and upheaval.',
    minYear: 1800,
    techModifiers: { culture: 0.7, infrastructure: 1.0 },
    opposes: [],
    promotes: [],
    moraleMod: 0,
    militaryBonus: 0,
    rivals: ['liberals', 'communists', 'technocrats'],
    allies: ['oligarchs', 'monarchists', 'free_traders'],
    ambitions: [
      { id: 'status_quo', name: 'Preserve Order', description: 'Resist revolutionary movements', targetLaws: [], reward: 20 },
      { id: 'block_radicalism', name: 'Block Radicalism', description: 'Prevent communists and anarchists from gaining power', targetLaws: [], reward: 25 },
    ],
    availableActions: ['sabotage_rival', 'propaganda', 'alliance'],
  },
  {
    id: 'industrialists',
    name: 'Industrialists',
    desc: 'Factory owners pushing mass production and fossil fuels for profit.',
    minYear: 1850,
    maxYear: 2000,
    techModifiers: { industry: 1.4, energy: -0.8, agriculture: 0.7 },
    opposes: ['environmental_protection', 'renewable_energy'],
    promotes: ['coal_power', 'mass_manufacturing'],
    moraleMod: 5,
    militaryBonus: 10,
    economicFocus: 'manufacturing',
    rivals: ['environmentalists', 'labor_unions', 'scientists'],
    allies: ['oligarchs', 'nationalists', 'military_industrial'],
    ambitions: [
      { id: 'coal_dominance', name: 'Coal Dominance', description: 'Lock in coal and fossil fuels as primary energy', targetLaws: [], reward: 30 },
      { id: 'maximize_output', name: 'Maximum Output', description: 'Maximize factory production and profits', targetLaws: [], reward: 25 },
      { id: 'exploit_labor', name: 'Labor Exploitation', description: 'Suppress worker rights and keep wages low', targetLaws: [], reward: 20 },
    ],
    availableActions: ['demand_law', 'sabotage_rival', 'bribery', 'propaganda', 'alliance', 'strike'],
  },
  {
    id: 'liberals',
    name: 'Liberals',
    desc: 'Progressive intellectuals pushing democracy, rights, and individual freedoms.',
    minYear: 1850,
    techModifiers: { culture: 1.3, infrastructure: 1.1 },
    opposes: ['autocracy', 'censorship', 'monarchy'],
    promotes: ['universal_suffrage', 'freedom_of_speech'],
    moraleMod: 10,
    militaryBonus: 0,
    rivals: ['monarchists', 'conservatives', 'theocrats'],
    allies: ['communists', 'labor_unions', 'scientists'],
    ambitions: [
      { id: 'establish_democracy', name: 'Establish Democracy', description: 'Achieve universal suffrage and democratic rule', targetLaws: [], reward: 35 },
      { id: 'civil_liberties', name: 'Civil Liberties', description: 'Guarantee freedom of speech and assembly', targetLaws: [], reward: 30 },
      { id: 'secular_governance', name: 'Secular Governance', description: 'Separate church and state', targetLaws: [], reward: 25 },
    ],
    availableActions: ['demand_law', 'sabotage_rival', 'propaganda', 'alliance'],
  },
  {
    id: 'communists',
    name: 'Communists',
    desc: 'Revolutionary idealists demanding radical equality and state control.',
    minYear: 1870,
    techModifiers: { agriculture: 1.2, culture: 1.3, industry: 1.0 },
    opposes: ['private_property', 'capitalism', 'oligarchy'],
    promotes: ['wealth_redistribution', 'labor_law'],
    moraleMod: 20,
    govRestrictions: ['monarchy'],
    militaryBonus: 15,
    rivals: ['oligarchs', 'monarchists', 'free_traders', 'conservatives'],
    allies: ['labor_unions', 'scientists', 'humanitarians'],
    ambitions: [
      { id: 'workers_revolution', name: "Workers' Revolution", description: 'Overthrow class system and establish equality', targetLaws: [], reward: 40 },
      { id: 'seize_means', name: 'Seize Means of Production', description: 'Nationalize factories and eliminate private property', targetLaws: [], reward: 35 },
      { id: 'permanent_equality', name: 'Establish Communism', description: 'Create a classless, stateless society', targetLaws: [], reward: 50 },
    ],
    availableActions: ['demand_law', 'sabotage_rival', 'strike', 'propaganda', 'alliance', 'assassination'],
  },
  {
    id: 'labor_unions',
    name: 'Labor Unions',
    desc: 'Worker collectives demanding fair wages, safety, and rights (reformist, not revolutionary).',
    minYear: 1880,
    techModifiers: { culture: 1.1, industry: 0.9 },
    opposes: ['child_labor', 'unsafe_conditions'],
    promotes: ['labor_law', 'workplace_safety'],
    moraleMod: 15,
    militaryBonus: 5,
    rivals: ['oligarchs', 'industrialists', 'military_industrial'],
    allies: ['communists', 'socialists', 'scientists', 'humanitarians'],
    ambitions: [
      { id: 'fair_wages', name: 'Living Wages', description: 'Ensure workers earn enough to live decently', targetLaws: [], reward: 25 },
      { id: 'worker_rights', name: 'Worker Rights', description: 'Win collective bargaining and labor protections', targetLaws: [], reward: 30 },
      { id: 'safe_conditions', name: 'Safe Conditions', description: 'Eliminate workplace hazards and child labor', targetLaws: [], reward: 28 },
    ],
    availableActions: ['demand_law', 'strike', 'sabotage_rival', 'propaganda', 'alliance'],
  },
  {
    id: 'socialists',
    name: 'Socialists',
    desc: 'Reformers advocating worker protections and gradual wealth redistribution.',
    minYear: 1890,
    techModifiers: { culture: 1.1, agriculture: 1.1 },
    opposes: ['oligarchy', 'exploitation'],
    promotes: ['labor_law', 'welfare_state'],
    moraleMod: 15,
    militaryBonus: 5,
    rivals: ['oligarchs', 'industrialists', 'conservatives'],
    allies: ['communists', 'labor_unions', 'humanitarians'],
    ambitions: [
      { id: 'welfare_state', name: 'Welfare State', description: 'Create universal health, education, and social safety net', targetLaws: [], reward: 35 },
      { id: 'redistribute_wealth', name: 'Redistribute Wealth', description: 'Tax the rich and support the poor', targetLaws: [], reward: 30 },
      { id: 'worker_dignity', name: 'Worker Dignity', description: 'Ensure all workers have rights and protections', targetLaws: [], reward: 28 },
    ],
    availableActions: ['demand_law', 'propaganda', 'alliance', 'sabotage_rival'],
  },
  {
    id: 'nationalists',
    name: 'Nationalists',
    desc: 'Militarist patriots prioritizing territorial expansion and military strength.',
    minYear: 1800,
    techModifiers: { military: 1.5, culture: 0.8, agriculture: 0.9 },
    opposes: ['pacifism', 'free_trade'],
    promotes: ['military_doctrine'],
    moraleMod: 5,
    militaryBonus: 25,
    economicFocus: 'military',
    rivals: ['pacifists', 'free_traders', 'humanitarians'],
    allies: ['monarchists', 'militarists', 'oil_barons'],
    ambitions: [
      { id: 'territorial_expansion', name: 'Territorial Expansion', description: 'Expand borders and military might', targetLaws: [], reward: 35 },
      { id: 'military_dominance', name: 'Military Dominance', description: 'Become the strongest military power', targetLaws: [], reward: 40 },
      { id: 'national_glory', name: 'National Glory', description: 'Make the nation a world power', targetLaws: [], reward: 30 },
    ],
    availableActions: ['demand_law', 'sabotage_rival', 'propaganda', 'alliance', 'assassination'],
  },
  {
    id: 'militarists',
    name: 'Militarists',
    desc: 'War hawks profiting from military-industrial expansion and weapons sales.',
    minYear: 1880,
    techModifiers: { military: 1.4, industry: 1.2 },
    opposes: ['pacifism', 'disarmament'],
    promotes: ['military_buildup'],
    moraleMod: -5,
    militaryBonus: 20,
    rivals: ['pacifists', 'humanitarians', 'scientists'],
    allies: ['nationalists', 'oligarchs', 'industrialists'],
    ambitions: [
      { id: 'weapons_proliferation', name: 'Weapons Trade', description: 'Profit from weapons manufacturing and sales', targetLaws: [], reward: 30 },
      { id: 'permanent_war', name: 'Perpetual Conflict', description: 'Maintain constant military threats to boost spending', targetLaws: [], reward: 35 },
      { id: 'military_industrial', name: 'Military-Industrial Complex', description: 'Merge military and industry for profit', targetLaws: [], reward: 40 },
    ],
    availableActions: ['demand_law', 'bribery', 'sabotage_rival', 'propaganda', 'alliance'],
  },
  {
    id: 'oil_barons',
    name: 'Oil Barons',
    desc: 'Fossil fuel magnates blocking renewables to protect billion-dollar investments.',
    minYear: 1850,
    maxYear: 2050,
    techModifiers: { energy: -1.5, industry: 1.3 },
    opposes: ['renewable_energy', 'carbon_tax'],
    promotes: ['fossil_fuels'],
    moraleMod: -5,
    militaryBonus: 0,
    economicFocus: 'energy',
    rivals: ['environmentalists', 'scientists', 'humanitarians'],
    allies: ['oligarchs', 'industrialists', 'nationalists'],
    ambitions: [
      { id: 'petrol_forever', name: 'Petrol Forever', description: 'Lock in fossil fuels as permanent energy source', targetLaws: [], reward: 40 },
      { id: 'block_renewables', name: 'Block Renewables', description: 'Sabotage solar, wind, and green energy research', targetLaws: [], reward: 35 },
      { id: 'climate_denial', name: 'Climate Denial', description: 'Suppress climate science and environmental warnings', targetLaws: [], reward: 30 },
    ],
    availableActions: ['demand_law', 'bribery', 'sabotage_rival', 'propaganda', 'alliance', 'assassination'],
  },
  {
    id: 'free_traders',
    name: 'Free Traders',
    desc: 'Laissez-faire capitalists opposing taxes, regulation, and government control.',
    minYear: 1850,
    techModifiers: { finance: 1.2, industry: 1.0 },
    opposes: ['trade_tariffs', 'wealth_tax', 'regulation'],
    promotes: ['free_trade', 'deregulation'],
    moraleMod: 0,
    militaryBonus: 0,
    rivals: ['nationalists', 'labor_unions', 'communists'],
    allies: ['oligarchs', 'conservatives', 'merchant_guilds'],
    ambitions: [
      { id: 'free_markets', name: 'Free Markets', description: 'Eliminate all trade tariffs and regulations', targetLaws: [], reward: 35 },
      { id: 'deregulation', name: 'Deregulation', description: 'Remove government oversight of business', targetLaws: [], reward: 30 },
      { id: 'tax_reduction', name: 'Tax Reduction', description: 'Cut taxes to minimum', targetLaws: [], reward: 25 },
    ],
    availableActions: ['demand_law', 'bribery', 'propaganda', 'alliance'],
  },
  {
    id: 'merchant_guilds',
    name: 'Merchant Guilds',
    desc: 'Old-order trade associations clinging to guild privileges — a pre-war relic dissolving into modern chambers of commerce.',
    minYear: 1919,
    maxYear: 1925,
    techModifiers: { finance: 1.1, infrastructure: 1.1 },
    opposes: [],
    promotes: ['free_trade', 'markets'],
    moraleMod: 5,
    militaryBonus: 0,
    rivals: ['labor_unions', 'nationalists'],
    allies: ['oligarchs', 'free_traders', 'industrialists'],
    ambitions: [
      { id: 'trade_monopoly', name: 'Trade Monopoly', description: 'Control merchant routes and market access', targetLaws: [], reward: 30 },
      { id: 'market_dominance', name: 'Market Dominance', description: 'Become the dominant merchant faction', targetLaws: [], reward: 25 },
    ],
    availableActions: ['bribery', 'sabotage_rival', 'alliance'],
  },
  {
    id: 'scientists',
    name: 'Scientists',
    desc: 'Research-driven intellectuals pursuing knowledge and technological progress.',
    minYear: 1900,
    techModifiers: { industry: 1.2, infrastructure: 1.3, culture: 1.3, energy: 1.2 },
    opposes: ['anti_science', 'obscurantism'],
    promotes: ['education', 'research_funding'],
    moraleMod: 5,
    militaryBonus: 5,
    rivals: ['theocrats', 'conservatives', 'oil_barons'],
    allies: ['liberals', 'technocrats', 'environmentalists'],
    ambitions: [
      { id: 'universal_education', name: 'Universal Education', description: 'Make education accessible to all', targetLaws: [], reward: 35 },
      { id: 'research_dominance', name: 'Research Dominance', description: 'Lead scientific and technological advancement', targetLaws: [], reward: 40 },
      { id: 'technology_future', name: 'Technology Future', description: 'Shape the future through innovation', targetLaws: [], reward: 45 },
    ],
    availableActions: ['demand_law', 'propaganda', 'alliance', 'sabotage_rival'],
  },
  {
    id: 'technocrats',
    name: 'Technocrats',
    desc: 'Engineer-administrators obsessed with efficiency, automation, and optimization.',
    minYear: 1950,
    techModifiers: { industry: 1.4, infrastructure: 1.3, culture: 0.7 },
    opposes: ['inefficiency', 'tradition'],
    promotes: ['automation', 'computing'],
    moraleMod: 0,
    militaryBonus: 10,
    rivals: ['conservatives', 'humanitarians', 'labor_unions'],
    allies: ['scientists', 'oligarchs', 'militarists'],
    ambitions: [
      { id: 'total_automation', name: 'Total Automation', description: 'Replace all manual labor with machines', targetLaws: [], reward: 40 },
      { id: 'optimization', name: 'Perfect Optimization', description: 'Maximize efficiency in every system', targetLaws: [], reward: 35 },
      { id: 'technological_society', name: 'Technological Society', description: 'Reshape society around technology', targetLaws: [], reward: 45 },
    ],
    availableActions: ['demand_law', 'propaganda', 'alliance', 'sabotage_rival'],
  },
  {
    id: 'environmentalists',
    name: 'Environmentalists',
    desc: 'Green activists fighting climate change and protecting ecosystems.',
    minYear: 1950,
    techModifiers: { energy: 1.5, agriculture: 1.2, culture: 1.2 },
    opposes: ['pollution', 'fossil_fuels'],
    promotes: ['renewable_energy', 'environmental_protection'],
    moraleMod: 10,
    militaryBonus: -5,
    rivals: ['oil_barons', 'industrialists', 'military_industrial'],
    allies: ['scientists', 'humanitarians', 'pacifists'],
    ambitions: [
      { id: 'green_transition', name: 'Green Transition', description: 'Convert entire economy to renewables', targetLaws: [], reward: 45 },
      { id: 'stop_climate', name: 'Stop Climate Change', description: 'Reduce CO2 emissions below 350ppm', targetLaws: [], reward: 50 },
      { id: 'rewild_earth', name: 'Rewild Earth', description: 'Restore ecosystems and protect wilderness', targetLaws: [], reward: 40 },
    ],
    availableActions: ['demand_law', 'sabotage_rival', 'propaganda', 'alliance', 'strike'],
  },
  {
    id: 'theocrats',
    name: 'Theocrats',
    desc: 'Religious authorities wielding moral power and enforcing religious law.',
    minYear: 1800,
    techModifiers: { culture: 0.9 },
    opposes: ['secular_governance', 'contraception', 'divorce'],
    promotes: ['religious_law', 'religious_education'],
    moraleMod: 10,
    militaryBonus: 5,
    rivals: ['scientists', 'liberals', 'humanitarians'],
    allies: ['monarchists', 'conservatives', 'nationalists'],
    ambitions: [
      { id: 'religious_law', name: 'Religious Law', description: 'Impose religious doctrine on government', targetLaws: [], reward: 35 },
      { id: 'moral_society', name: 'Moral Society', description: 'Enforce religious morality on all citizens', targetLaws: [], reward: 40 },
      { id: 'religious_dominance', name: 'Religious Dominance', description: 'Make religion the foundation of society', targetLaws: [], reward: 45 },
    ],
    availableActions: ['demand_law', 'propaganda', 'alliance', 'sabotage_rival'],
  },
  {
    id: 'pacifists',
    name: 'Pacifists',
    desc: 'Peace activists opposing military spending and violent conflict.',
    minYear: 1900,
    techModifiers: { culture: 1.2 },
    opposes: ['military_buildup', 'war'],
    promotes: ['disarmament', 'peace_treaties'],
    moraleMod: 8,
    militaryBonus: -20,
    rivals: ['nationalists', 'militarists', 'military_industrial'],
    allies: ['humanitarians', 'environmentalists', 'liberals'],
    ambitions: [
      { id: 'disarmament', name: 'Global Disarmament', description: 'Reduce military spending to minimum', targetLaws: [], reward: 40 },
      { id: 'permanent_peace', name: 'Permanent Peace', description: 'End all wars and military conflicts', targetLaws: [], reward: 50 },
      { id: 'conflict_prevention', name: 'Conflict Prevention', description: 'Build diplomatic systems to prevent war', targetLaws: [], reward: 45 },
    ],
    availableActions: ['demand_law', 'propaganda', 'alliance', 'sabotage_rival', 'strike'],
  },
  {
    id: 'humanitarians',
    name: 'Humanitarians',
    desc: 'Social welfare advocates fighting poverty, illness, and human suffering.',
    minYear: 1919,
    techModifiers: { culture: 1.3, agriculture: 1.1 },
    opposes: ['poverty', 'disease', 'inequality'],
    promotes: ['welfare_state', 'public_health', 'education'],
    moraleMod: 15,
    militaryBonus: -5,
    rivals: ['oligarchs', 'militarists', 'theocrats'],
    allies: ['communists', 'socialists', 'scientists'],
    ambitions: [
      { id: 'end_poverty', name: 'End Poverty', description: 'Guarantee food, housing, and healthcare for all', targetLaws: [], reward: 50 },
      { id: 'universal_healthcare', name: 'Universal Healthcare', description: 'Provide free healthcare to all citizens', targetLaws: [], reward: 45 },
      { id: 'human_dignity', name: 'Human Dignity', description: 'Ensure every person has dignity and respect', targetLaws: [], reward: 55 },
    ],
    availableActions: ['demand_law', 'propaganda', 'alliance', 'strike'],
  },
  {
    id: 'information_brokers',
    name: 'Information Brokers',
    desc: 'Media/tech monopolies controlling information, narrative, and surveillance.',
    minYear: 1980,
    techModifiers: { infrastructure: 1.3, industry: 1.2 },
    opposes: ['privacy', 'transparency'],
    promotes: ['surveillance', 'data_control'],
    moraleMod: -10,
    militaryBonus: 5,
    rivals: ['humanitarians', 'liberals', 'pacifists'],
    allies: ['oligarchs', 'technocrats', 'military_industrial'],
    ambitions: [
      { id: 'information_monopoly', name: 'Information Monopoly', description: 'Control all media and information', targetLaws: [], reward: 40 },
      { id: 'surveillance_state', name: 'Surveillance State', description: 'Monitor and track all citizens', targetLaws: [], reward: 45 },
      { id: 'narrative_control', name: 'Narrative Control', description: 'Shape public opinion and belief', targetLaws: [], reward: 50 },
    ],
    availableActions: ['propaganda', 'sabotage_rival', 'bribery', 'alliance'],
  },
  {
    id: 'water_barons',
    name: 'Water Barons',
    desc: 'Corporate interests controlling water resources and privatizing utilities.',
    minYear: 1960,
    techModifiers: { agriculture: 0.7, industry: 1.1 },
    opposes: ['public_utilities', 'universal_water_access'],
    promotes: ['water_privatization', 'infrastructure'],
    moraleMod: -10,
    militaryBonus: 0,
    rivals: ['humanitarians', 'environmentalists', 'socialists'],
    allies: ['oligarchs', 'industrialists', 'free_traders'],
    ambitions: [
      { id: 'water_monopoly', name: 'Water Monopoly', description: 'Privatize all water sources and control access', targetLaws: [], reward: 45 },
      { id: 'water_profit', name: 'Water Profit', description: 'Monetize water and maximize profits', targetLaws: [], reward: 40 },
      { id: 'water_dependency', name: 'Water Dependency', description: 'Make citizens depend on corporate water', targetLaws: [], reward: 50 },
    ],
    availableActions: ['demand_law', 'bribery', 'sabotage_rival', 'propaganda', 'alliance'],
  },
];

export function factionDef(id: FactionId): FactionDef | undefined {
  return FACTION_DEFS.find((f) => f.id === id);
}

/** Return factions that are active (within their minYear...maxYear window) for a given year. */
export function activeFactions(year: number): FactionDef[] {
  return FACTION_DEFS.filter((f) => year >= f.minYear && (!f.maxYear || year <= f.maxYear));
}

// ---- Parcel / land-expansion tuning (Track B Phase 2–3) ----
// The price of expanding the realm one cell at a time. Cost grows with
// distance from the founding town, the terrain's difficulty, and how much
// land the player already holds (each new parcel is dearer than the last):
//   cost = BASE × (1 + dist × DISTANCE_SCALE)
//             × terrain_difficulty
//             × (1 + owned × EXPANSION_PREMIUM)
export const PARCEL_TUNING = {
  /** Floor cost of the cheapest possible parcel (adjacent, easy terrain, first buy). */
  baseCost: 250,
  /** Added cost per cell of distance from the home parcel. */
  distanceScale: 0.35,
  /** Added cost per parcel already owned (expansion gets pricier). */
  expansionPremium: 0.18,
  /** Terrain difficulty multipliers by biome (mirrors RegionMap.cellCost shape). */
  terrainMult: {
    plains: 1.0,
    forest: 1.2,
    hills: 1.5,
    marsh: 1.4,
    mountains: 2.2,
    river: 1.3,
    lake: 3.0,
    sea: 3.0,
  } as Record<string, number>,
  // ── Phase 3 expansion techs ────────────────────────────────────────────────
  // The cost formula and frontier rules above are gated/boosted by three
  // region-tier techs. Effects live here so the sim and the (future) purchase
  // UI quote identical numbers.
  /** `road_building`: trunk roads cut the price of every acquisition. */
  roadDiscount: 0.8,
  /** Frontier cells a purchase reveals (von Neumann ring) without `cartography`. */
  revealRadius: 1,
  /** With `cartography`, a purchase surveys a wider Chebyshev block of frontier. */
  cartographyRevealRadius: 2,
} as const;

/** Pure parcel price — base × distance × terrain × holdings premium × discount.
 *  Shared by ParcelManager (classic sim) and TownCore so both quote identical
 *  numbers from one formula. */
export function parcelCost(opts: {
  cellX: number; cellY: number; homeCellX: number; homeCellY: number;
  biome: string; ownedCount: number; roadDiscount?: boolean;
}): number {
  const d = Math.hypot(opts.cellX - opts.homeCellX, opts.cellY - opts.homeCellY);
  const terrain = PARCEL_TUNING.terrainMult[opts.biome] ?? 1;
  const discount = opts.roadDiscount ? PARCEL_TUNING.roadDiscount : 1;
  return Math.round(
    PARCEL_TUNING.baseCost *
    (1 + d * PARCEL_TUNING.distanceScale) *
    terrain *
    (1 + opts.ownedCount * PARCEL_TUNING.expansionPremium) *
    discount,
  );
}

/** Region-tier tech ids that drive parcel expansion (kept in one place so the
 *  sim, the tech tree data, and the purchase UI never drift apart). */
export const EXPANSION_TECHS = {
  /** Survey distant land so non-adjacent (but explored) parcels can be bought. */
  landSurvey: 'land_survey',
  /** Trunk roads discount every acquisition (`PARCEL_TUNING.roadDiscount`). */
  roadBuilding: 'road_building',
  /** Charting reveals a wider frontier ring around each new holding. */
  cartography: 'cartography',
} as const;
