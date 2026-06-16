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
export const START_YEAR = 1900;

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
};

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
