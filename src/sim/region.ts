/**
 * RegionSim — the aggregate simulation that takes over at the flip (GDD §2.4).
 *
 * The moment town #2 is founded, individual settlers become cohort statistics
 * and a small cast of Notables carries the attachment forward. Settlements
 * grow, age, migrate, and get raided as populations, not agents — this is the
 * performance answer that lets the game scale to a State and beyond.
 */
import { Rng } from './rng';
import { MINUTES_PER_DAY, DAYS_PER_SEASON, DAYS_PER_YEAR, SEASONS, START_YEAR } from './defs';
import type { Simulation, Settler, LogEntry } from './sim';
import { RegionMap } from './worldgen';
import type { TownSite } from './worldgen';
import { Weather } from './weather';
import techTreeJson from '../data/techtree.json';

export interface TechNode {
  id: string;
  name: string;
  tree: 'tech' | 'civics';
  cost: number;
  prereqs: string[];
  era: number;
  requiresState?: boolean;
  desc: string;
}

export const TECH_TREE: TechNode[] = techTreeJson.nodes as TechNode[];

/** Region-tier clock runs faster: 30 game-minutes per tick (GDD §8.6). */
export const REGION_MINUTES_PER_TICK = 30;

export const AGE_BANDS = ['0-14', '15-29', '30-49', '50-69', '70+'] as const;
const BAND_SPAN_YEARS = [15, 15, 20, 20, 15];
const BASE_MORTALITY_PER_YEAR = [0.015, 0.006, 0.009, 0.03, 0.12]; // 1900 frontier rates

export interface Cohorts {
  bands: number[]; // population count per age band (fractional internally)
}

export interface Settlement {
  id: number;
  name: string;
  x: number; // region coords 0..100
  y: number;
  foundedDay: number;
  cohorts: Cohorts;
  food: number;
  wood: number;
  satisfaction: number; // 0–100
  housing: number; // capacity
  landQuality: number; // = site fertility: the land budgets the farms
  site: TownSite;
  lastRaidDay: number;
  lastFloodDay: number;
  strikeUntil: number; // day; > now means production strike
  grievance: number; // 0–100 pressure gauge (GDD §5.5 unrest ladder)
  prices: MarketPrices; // local market, £/unit (GDD §5.2 first slice)
}

/** Local markets (GDD §5.2, first slice): each town prices the two goods
 *  it actually stocks. Traders arbitrage the gaps along the route network —
 *  regional price convergence emerges from the rule, not from script. */
export type TradeGood = 'food' | 'wood';
export const TRADE_GOODS: TradeGood[] = ['food', 'wood'];
export type MarketPrices = Record<TradeGood, number>;
export const BASE_PRICE: MarketPrices = { food: 0.08, wood: 0.12 };
export function defaultPrices(): MarketPrices {
  return { ...BASE_PRICE };
}

/** Provisional government lean chosen at the Incorporation ceremony. */
export type GovLean = 'council' | 'mayor' | 'compact';

// ---- Faction politics (GDD §5.3) ----

export type FactionId = 'workers' | 'landowners' | 'merchants';

export interface Faction {
  id: FactionId;
  name: string;
  power: number;   // 0–100: how much economic/social weight they carry
  support: number; // 0–100: how much they back the current regime
  demand: string;  // what they want (text hint for the player)
}

/** One-time permanent statute acts funded with political capital (GDD §5.3). */
export interface RegionLaw {
  id: string;
  name: string;
  cost: number;       // political capital
  prereqs: string[];  // tech/civics node ids
  requiresState: boolean;
  requiresNation?: boolean; // gates nation-tier laws behind Proclamation
  domain: 'economic' | 'social' | 'security' | 'information';
  desc: string;
}

export const REGION_LAWS: RegionLaw[] = [
  // ---- State-tier laws (unlock at Incorporation) ----
  {
    id: 'workers_charter',
    name: 'Workers Charter',
    cost: 30,
    prereqs: [],
    requiresState: true,
    domain: 'social',
    desc: 'Fund services. Services +1. Workers support +20, Merchants/Landowners −10.',
  },
  {
    id: 'merchants_charter',
    name: "Merchants' Charter",
    cost: 25,
    prereqs: [],
    requiresState: true,
    domain: 'economic',
    desc: 'Lower trade levy 5%→3%. Merchants support +25, Workers −5.',
  },
  {
    id: 'estate_tax',
    name: 'Estate Tax',
    cost: 35,
    prereqs: ['income_tax'],
    requiresState: true,
    domain: 'economic',
    desc: 'Monthly levy on land wealth adds £0.1/citizen. Landowners −25, Workers +10.',
  },
  {
    id: 'conscription_act',
    name: 'Conscription Act',
    cost: 20,
    prereqs: [],
    requiresState: true,
    domain: 'security',
    desc: 'Mandatory service. Militia +1. Workers support −5.',
  },
  // ---- Nation-tier laws (unlock at Proclamation) ----
  {
    id: 'progressive_tax',
    name: 'Progressive Taxation',
    cost: 40,
    prereqs: ['income_tax'],
    requiresState: true,
    requiresNation: true,
    domain: 'economic',
    desc: 'Graduated bands on higher incomes. Additional revenue: +2% of GDP/month. Workers +15, Landowners −10, Merchants −10.',
  },
  {
    id: 'welfare_benefits',
    name: 'Welfare Benefits',
    cost: 35,
    prereqs: ['labor_law'],
    requiresState: true,
    requiresNation: true,
    domain: 'social',
    desc: 'Unemployment and relief payments. Satisfaction +5 in all towns. Treasury −£1/month per 100 citizens.',
  },
  {
    id: 'national_education_act',
    name: 'National Education Act',
    cost: 45,
    prereqs: ['public_education', 'statecraft'],
    requiresState: true,
    requiresNation: true,
    domain: 'social',
    desc: 'Universal state schooling funded by the treasury. Research rate +30%. Workers +10.',
  },
  {
    id: 'central_bank_charter',
    name: 'Central Bank Charter',
    cost: 50,
    prereqs: ['statecraft', 'income_tax'],
    requiresState: true,
    requiresNation: true,
    domain: 'economic',
    desc: 'A national bank holds reserves and smooths the boom-bust. Treasury earns 0.5% interest/month.',
  },
  {
    id: 'military_reform',
    name: 'Military Reform',
    cost: 30,
    prereqs: ['statecraft'],
    requiresState: true,
    requiresNation: true,
    domain: 'security',
    desc: 'Professional officer corps replaces frontier militias. Militia effectiveness +20%.',
  },
  {
    id: 'press_freedom_act',
    name: 'Press Freedom Act',
    cost: 25,
    prereqs: ['free_press'],
    requiresState: true,
    requiresNation: true,
    domain: 'information',
    desc: 'Constitutional press rights. Legitimacy decay −30% slower. Merchants +10.',
  },
  {
    id: 'healthcare_act',
    name: 'Healthcare Act',
    cost: 40,
    prereqs: ['public_education'],
    requiresState: true,
    requiresNation: true,
    domain: 'social',
    desc: 'State-funded clinics in every settlement. Settlement mortality −15%. Workers +10.',
  },
  {
    id: 'land_reform',
    name: 'Land Reform',
    cost: 50,
    prereqs: ['universal_suffrage'],
    requiresState: true,
    requiresNation: true,
    domain: 'economic',
    desc: 'Redistribution of concentrated landholdings. Food production +5%. Workers +20, Landowners −30.',
  },
];

export const GOV_LEANS: Record<GovLean, { name: string; desc: string }> = {
  council: {
    name: 'Council of Towns',
    desc: 'Every town a voice. +6 satisfaction everywhere, but consensus is slow: −15% tax collection.',
  },
  mayor: {
    name: 'The Iron Mayor',
    desc: 'One strong hand. +20% tax collection, +20% militia — and −6 satisfaction (people grumble).',
  },
  compact: {
    name: 'Merchant Compact',
    desc: 'Commerce rules. +15% income per worker, but services cost +25% (everything is invoiced).',
  },
};

// ---- Nation-tier: government types & ministers (GDD §9) ----

export type GovType = 'democracy' | 'republic' | 'junta' | 'monarchy';

/** The four domains of national policy — each gov type gets a different mix. */
export type PolicyDomain = 'economic' | 'social' | 'security' | 'diplomatic';

export interface GovTypeDef {
  id: GovType;
  name: string;
  legitimacySource: string;
  electionsRequired: boolean;
  taxCap: number;
  militiaBonus: number;
  startingLegitimacy: number;
  /** Ordered list of policy slot domains granted by this government type. */
  policySlots: PolicyDomain[];
}

export const GOV_TYPES: GovTypeDef[] = [
  {
    id: 'democracy',
    name: 'Constitutional Democracy',
    legitimacySource: 'Elections won and popular approval',
    electionsRequired: true,
    taxCap: 25,
    militiaBonus: 0,
    startingLegitimacy: 80,
    policySlots: ['economic', 'social', 'security', 'diplomatic'],
  },
  {
    id: 'republic',
    name: 'Presidential Republic',
    legitimacySource: 'Elections and executive performance',
    electionsRequired: true,
    taxCap: 28,
    militiaBonus: 0,
    startingLegitimacy: 78,
    policySlots: ['economic', 'economic', 'security', 'diplomatic'],
  },
  {
    id: 'junta',
    name: 'Military Junta',
    legitimacySource: 'Faction loyalty and military strength',
    electionsRequired: false,
    taxCap: 30,
    militiaBonus: 2,
    startingLegitimacy: 70,
    policySlots: ['security', 'security', 'economic'],
  },
  {
    id: 'monarchy',
    name: 'Absolute Monarchy',
    legitimacySource: 'Dynasty, Notable longevity, and tradition',
    electionsRequired: false,
    taxCap: 22,
    militiaBonus: 1,
    startingLegitimacy: 75,
    policySlots: ['economic', 'security', 'social'],
  },
];

export type MinisterRoleId = 'interior' | 'treasury' | 'defence';

export interface MinisterAssignment {
  role: MinisterRoleId;
  title: string;
  notableId: number | null;
}

export const MINISTER_ROLES: { id: MinisterRoleId; title: string; bonus: string }[] = [
  { id: 'interior', title: 'Interior Minister', bonus: 'services 15% more effective' },
  { id: 'treasury', title: 'Treasury Secretary', bonus: 'tax collection +10%' },
  { id: 'defence', title: 'Defence Minister', bonus: 'militia 20% stronger' },
];

// ---- Nation-tier: policy slots (GDD §5.3) ----

/** Ongoing focus cards socketed into government policy slots. Unlike laws (one-time
 *  permanent), policies can be swapped for a political-capital cost. Each card
 *  applies a continuous bonus while slotted. */
export interface PolicyCard {
  id: string;
  name: string;
  domain: PolicyDomain;
  prereqs: string[];
  desc: string;
  upkeep: number; // £/month treasury cost while active
}

export const POLICY_CARDS: PolicyCard[] = [
  {
    id: 'free_trade', name: 'Free Trade', domain: 'economic', prereqs: [], upkeep: 0,
    desc: 'Open markets. Trade levy removed (0%), caravan throughput +15%.',
  },
  {
    id: 'protectionism', name: 'Protectionism', domain: 'economic', prereqs: ['income_tax'], upkeep: 0,
    desc: 'Tariff barriers. Treasury +£3/month.',
  },
  {
    id: 'public_investment', name: 'Public Investment', domain: 'economic', prereqs: ['statecraft'], upkeep: 2,
    desc: 'State-funded infrastructure bonds. Route conditions +2/month. Cost £2/month.',
  },
  {
    id: 'welfare_state', name: 'Welfare State', domain: 'social', prereqs: ['labor_law'], upkeep: 3,
    desc: 'Universal safety net. Satisfaction +6 everywhere. Cost £3/month.',
  },
  {
    id: 'public_health_policy', name: 'Public Health', domain: 'social', prereqs: ['public_education'], upkeep: 2,
    desc: 'State-funded clinics. Population mortality −20%. Cost £2/month.',
  },
  {
    id: 'standing_army', name: 'Standing Army', domain: 'security', prereqs: [], upkeep: 3,
    desc: 'Professional soldiers. Militia strength +2. Cost £3/month.',
  },
  {
    id: 'border_constabulary', name: 'Border Constabulary', domain: 'security', prereqs: ['labor_law'], upkeep: 1,
    desc: 'Trained officers ease tensions. Grievance 25% slower. Cost £1/month.',
  },
  {
    id: 'open_borders', name: 'Open Borders', domain: 'diplomatic', prereqs: ['universal_suffrage'], upkeep: 0,
    desc: 'Welcoming newcomers. Migration flows +30%.',
  },
  {
    id: 'isolationism', name: 'Isolationism', domain: 'diplomatic', prereqs: [], upkeep: 0,
    desc: 'Self-reliance. Regional incident frequency −35%.',
  },
];

/** Political capital cost to swap a policy card out of an occupied slot. */
export const POLICY_SWAP_COST = 20;

// ---- Rival nations & diplomacy (GDD §5.4, §6.2–6.4) ----

/** Personality weights 0–10 (GDD §6.3): they drive treaty appetite,
 *  hostility, and how the rival values what you offer. */
export interface RivalPersonality {
  expansion: number;
  commerce: number;
  ideology: number;
  honor: number;
  risk: number;
  grudge: number;
}

export type RivalArchetype =
  | 'hegemon' | 'trading_republic' | 'hermit_kingdom' | 'crusader_state' | 'opportunist';

/** The GDD §6.3 archetypes, verbatim as presets over the weights. */
export const RIVAL_ARCHETYPES: Record<RivalArchetype, { name: string; weights: RivalPersonality }> = {
  hegemon: { name: 'the Hegemon', weights: { expansion: 9, commerce: 4, ideology: 5, honor: 4, risk: 7, grudge: 5 } },
  trading_republic: { name: 'the Trading Republic', weights: { expansion: 3, commerce: 9, ideology: 3, honor: 7, risk: 3, grudge: 3 } },
  hermit_kingdom: { name: 'the Hermit Kingdom', weights: { expansion: 2, commerce: 2, ideology: 6, honor: 6, risk: 2, grudge: 8 } },
  crusader_state: { name: 'the Crusader State', weights: { expansion: 6, commerce: 3, ideology: 9, honor: 5, risk: 6, grudge: 6 } },
  opportunist: { name: 'the Opportunist', weights: { expansion: 6, commerce: 6, ideology: 2, honor: 2, risk: 9, grudge: 4 } },
};

export type TreatyKind = 'non_aggression' | 'trade_agreement' | 'defensive_pact';

/** First slice of the GDD §5.4 treaty table. `baseAsk` is the relations
 *  level the rival wants before personality adjusts the price. */
export const TREATY_DEFS: Record<TreatyKind, { name: string; baseAsk: number; desc: string }> = {
  non_aggression: {
    name: 'Non-Aggression Pact', baseAsk: -5,
    desc: 'Fenced borders: no sponsored raids or border incidents from this power.',
  },
  trade_agreement: {
    name: 'Trade Agreement', baseAsk: 15,
    desc: 'Monthly export earnings scaled to GDP; relations warm with the traffic.',
  },
  defensive_pact: {
    name: 'Defensive Pact', baseAsk: 45,
    desc: 'Allied arms: militia +15% when raiders strike.',
  },
};

// ---- The negotiation engine (GDD §6.3): every treaty is a basket ----

/** A multi-item offer on the table. Gold flows both ways; treaties are
 *  mutual ink; a border settlement fixes the frontier for good. */
export interface DealBasket {
  treaties: TreatyKind[];
  goldToThem: number;
  goldToYou: number;
  borderSettlement: boolean;
}

/** The AI's reading of a basket, in diplomatic points — computed from its
 *  own situation and personality, never a single accept/reject (GDD §6.3). */
export interface DealVerdict {
  accept: boolean;
  /** points flowing to the rival, by its own valuation */
  get: number;
  /** points it must give up, reputation premium applied */
  cost: number;
  /** a sweetened basket it would sign, when the offer is within 30% */
  counter: DealBasket | null;
  /** truthful but vague — why they walk, when they walk */
  reason: string;
}

/** A rival's counter-offer, waiting on the player's signature. */
export interface DealCounter {
  rivalId: number;
  basket: DealBasket;
  expiresDay: number;
}

/** £ → diplomatic points: the chancery's exchange rate. */
export const GOLD_PER_POINT = 8;
export const DEAL_COUNTER_DAYS = 90;

// Rivals run richer regimes than the player's four (GDD §6.3: "the 1930s
// should produce at least one neighboring autocracy organically"). Blocs are
// the coarse ideology axis that feeds relations — yours and theirs.
export type RegimeBloc = 'liberal' | 'autocratic' | 'traditional' | 'revolutionary';

export interface RivalRegimeDef {
  id: string;
  name: string;
  bloc: RegimeBloc;
  eraFrom: number; // the year this form of rule first appears in the world
}

export const RIVAL_REGIMES: RivalRegimeDef[] = [
  { id: 'parliamentary', name: 'Parliamentary Democracy', bloc: 'liberal', eraFrom: 1900 },
  { id: 'merchant_republic', name: 'Merchant Republic', bloc: 'liberal', eraFrom: 1900 },
  { id: 'const_monarchy', name: 'Constitutional Monarchy', bloc: 'traditional', eraFrom: 1900 },
  { id: 'abs_monarchy', name: 'Absolute Monarchy', bloc: 'traditional', eraFrom: 1900 },
  { id: 'theocracy', name: 'Theocracy', bloc: 'traditional', eraFrom: 1900 },
  { id: 'junta', name: 'Military Junta', bloc: 'autocratic', eraFrom: 1900 },
  { id: 'peoples_republic', name: "People's Republic", bloc: 'revolutionary', eraFrom: 1917 },
  { id: 'one_party', name: 'One-Party State', bloc: 'autocratic', eraFrom: 1920 },
  { id: 'fascist', name: 'Fascist State', bloc: 'autocratic', eraFrom: 1925 },
  { id: 'corporate', name: 'Corporate State', bloc: 'autocratic', eraFrom: 1930 },
];

/** Ideology distance at bloc altitude (GDD §5.4): kin warm to kin, and the
 *  century's three-way quarrel — liberal, autocrat, revolutionary — runs cold. */
export function blocAffinity(a: RegimeBloc, b: RegimeBloc): number {
  if (a === b) return 12;
  const pair = [a, b].sort().join(':');
  if (pair === 'autocratic:liberal' || pair === 'liberal:revolutionary' || pair === 'revolutionary:traditional') return -14;
  return -4;
}

export interface RivalNation {
  id: number;
  name: string;
  leader: string;
  archetype: RivalArchetype;
  weights: RivalPersonality;
  regime: string;   // RivalRegimeDef id; distance feeds relations
  agenda: string;   // discoverable long-term goal — legible in hindsight
  compass: 'north' | 'east' | 'south' | 'west'; // which map edge they loom over
  pop: number;      // abstract: they are nation-scale already (GDD §6.4)
  relations: number; // −100..+100 ledger (GDD §5.4)
  treaties: TreatyKind[];
  /** A surveyed, signed frontier: no border friction, no border CB (§5.4). */
  borderSettled: boolean;
  emergedYear: number;
  /** Accumulated story beats — wars, revolutions, pacts. A nation's bio. */
  history: string[];
  lastEnvoyDay: number;
  lastGiftDay: number;
}

/** A war between two rival powers — the player reads about it, and sells into it. */
export interface ForeignWar {
  a: number; // rival ids
  b: number;
  startedDay: number;
  endsDay: number;
}

/** An AI-initiated treaty offer, waiting in the diplomacy panel. */
export interface TreatyOffer {
  rivalId: number;
  kind: TreatyKind;
  expiresDay: number;
}

export const ENVOY_COST = 15;
export const GIFT_COST = 40;
export const ENVOY_COOLDOWN_DAYS = 90;
export const GIFT_COOLDOWN_DAYS = 60;
/** The world proclaims its first foreign nation in this band (GDD §6.2). */
export const RIVAL_EMERGENCE_YEAR = 1922;
export const MAX_RIVALS = 6;
/** Each treaty the player breaks raises every future ask (GDD §5.4 reputation). */
export const TREATY_BREACH_PENALTY = 15;

// ---- War (GDD §7): casus belli → mobilization → war score → negotiated peace ----

/** Why we fight (GDD §7.1): CB quality sets home-front war support at declaration. */
export type CasusBelli = 'sponsored_raids' | 'border_dispute' | 'fabricated';

export const CASUS_BELLI_DEFS: Record<CasusBelli, { name: string; support: number; desc: string }> = {
  sponsored_raids: {
    name: 'Sponsored Raids', support: 80,
    desc: 'Their rifles armed the raiders at your gates — a war the public already wants.',
  },
  border_dispute: {
    name: 'Border Dispute', support: 60,
    desc: 'Disputed surveys and seized caravans: a grievance the home front understands.',
  },
  fabricated: {
    name: 'Fabricated Incident', support: 40,
    desc: 'A staged provocation. Legitimacy −10 at home, and every chancery prices the lie like a broken seal.',
  },
};

/** Mobilization levels (GDD §7.2): war is a stimulus first and a drain after. */
export type Mobilization = 'peacetime' | 'partial' | 'total';

export const MOBILIZATION_DEFS: Record<Mobilization, {
  name: string;
  power: number;        // combat power multiplier
  gdpMult: number;      // armaments stimulus while it lasts
  upkeepPerPop: number; // £/person/month war spending
  satMonthly: number;   // rationing and absence bite the towns
  desc: string;
}> = {
  peacetime: {
    name: 'Peacetime', power: 1.0, gdpMult: 1.0, upkeepPerPop: 0, satMonthly: 0,
    desc: 'Volunteers only.',
  },
  partial: {
    name: 'Partial', power: 1.6, gdpMult: 1.05, upkeepPerPop: 0.03, satMonthly: -1,
    desc: '15% of manufacturing turns to armaments — full order books, fuller graveyards.',
  },
  total: {
    name: 'Total', power: 2.3, gdpMult: 1.1, upkeepPerPop: 0.06, satMonthly: -3,
    desc: 'Mass conscription and rationing. The whole economy is the war.',
  },
};

/** Peace terms priced in war score (GDD §7.4). */
export type PeaceTerm = 'status_quo' | 'reparations' | 'border_province' | 'regime_change';

export const PEACE_TERMS: Record<PeaceTerm, { name: string; score: number; desc: string }> = {
  status_quo: { name: 'Status Quo', score: 0, desc: 'The guns fall silent; the maps stay as they were.' },
  reparations: { name: 'Reparations', score: 30, desc: "They pay the war's bill in gold tranches." },
  border_province: { name: 'Annex Border Province', score: 55, desc: 'The frontier moves. Their revanchists will remember for fifty years.' },
  regime_change: { name: 'Regime Change', score: 80, desc: 'Their government falls; a friendlier one signs the instrument.' },
};

/** Occupied marches are administered with a light hand or a heavy one —
 *  brutality is cheaper now, costlier forever (GDD §7.4). */
export type OccupationPolicy = 'conciliatory' | 'brutal';

export const OCCUPATION_DEFS: Record<OccupationPolicy, {
  name: string;
  yield: number;      // £/march/month of partial output
  garrison: number;   // £/march/month the garrison costs
  resistance: number; // resistance points accrued per month
  desc: string;
}> = {
  conciliatory: {
    name: 'Conciliatory', yield: 6, garrison: 4, resistance: 2,
    desc: 'Partial output, a light hand: resistance builds slowly.',
  },
  brutal: {
    name: 'Brutal', yield: 10, garrison: 3, resistance: 6,
    desc: 'Squeeze the marches. Cheaper now — costlier forever.',
  },
};

/** A front only runs so deep at this altitude. */
export const MAX_OCCUPIED_MARCHES = 3;
/** Each occupied march discounts the peace table: the flag already flies. */
export const OCCUPATION_SCORE_DISCOUNT = 6;
/** Blockade upkeep: gunboats and requisitioned merchantmen, £/pop/month. */
export const BLOCKADE_UPKEEP_PER_POP = 0.02;

export interface PlayerWar {
  rivalId: number;
  cb: CasusBelli;
  defensive: boolean;  // they declared it — the home front rallies harder
  startedDay: number;
  support: number;     // 0–100 home-front consent (GDD §7.1, §7.4)
  score: number;       // −100..+100 war score (GDD §7.4)
  mobilization: Mobilization;
  casualties: number;  // running total — the demographic scar (GDD §7.3)
  /** Trade interdiction made of warships (GDD §7.3): strangles them, and you. */
  blockade: boolean;
  /** Co-belligerents fighting beside you — called-in defensive pacts. */
  allies: number[];
  /** Powers honoring their alliance with the enemy. */
  enemyAllies: number[];
  /** Enemy marches under military administration (GDD §7.4). */
  occupied: number;
  /** 0–100 resistance in the occupied marches. */
  resistance: number;
  occupationPolicy: OccupationPolicy;
  /** Once brutal, always remembered — the record follows the peace. */
  brutality: boolean;
}

/** Regime × war (GDD §7.5): below this floor the war eats the regime;
 *  15 below it, the home front breaks and the war ends on dictated terms. */
export const WAR_SUPPORT_FLOOR: Record<GovType, number> = {
  democracy: 45, republic: 45, monarchy: 35, junta: 25,
};

const RIVAL_NAMES = [
  'Vasterholm', 'Karelia', 'Tyrennia', 'Meridia', 'Vossland', 'Cantara',
  'Drovny', 'Ilvermoor', 'Skarov', 'Aldenne',
];
const RIVAL_LEADERS = [
  'Chancellor Aldric', 'Doge Maren', 'King Osric III', 'Marshal Veka',
  'First Citizen Roux', 'Queen Ilsabet', 'Patriarch Symeon', 'General Brandt',
  'Premier Olenka', 'Lord Protector Hale',
];
const RIVAL_AGENDAS: Record<RivalArchetype, string> = {
  hegemon: 'unite the river basins under one crown',
  trading_republic: 'corner the coastal carrying trade',
  hermit_kingdom: 'keep the mountain passes closed',
  crusader_state: 'spread the one true creed',
  opportunist: 'profit from every war but fight in none',
};
/** Founding backstories — every power arrives mid-sentence in its own story. */
const RIVAL_ORIGINS = [
  'forged in the wreck of the old empire',
  'unified after thirty years of civil war',
  'grown rich on the carrying trade long before it raised a flag',
  'carved out by settlers who crossed the ranges a generation before yours',
  'an ancient kingdom that finally wrote itself a constitution',
  'born of a miners\' revolt that never disbanded',
  'stitched together from feuding duchies by one ruthless marriage',
  'a garrison province that outlived the army that planted it',
];
const COMPASS_FLAVOR: Record<RivalNation['compass'], string> = {
  north: 'beyond the northern ranges',
  east: 'across the eastern marches',
  south: 'down the southern coast',
  west: 'over the western sea',
};

export type NotableRole = 'Mayor' | 'Doctor' | 'Captain' | 'Granger' | 'Forewoman' | 'Reeve';

export interface Notable {
  id: number;
  name: string;
  age: number;
  traits: string[];
  role: NotableRole;
  settlementId: number;
  bio: string[]; // accumulated story beats
  alive: boolean;
}

export interface Expedition {
  fromId: number;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  pop: number;
  food: number;
  wood: number;
  departDay: number;
  arrivesDay: number;
  name: string;
  site: TownSite;
}

/**
 * Routes (Milestone 6b, docs/design/transportation.md §3): first-class
 * links between settlements, laid along a real A* corridor through the
 * terrain. Everything that moves between towns rides this network.
 */
export type RouteKind = 'trail' | 'road' | 'rail' | 'highway' | 'maglev';

/** Every kind the treasury can buy — everything but the free founding trail. */
export type BuiltRouteKind = Exclude<RouteKind, 'trail'>;

export interface Route {
  a: number; // settlement ids
  b: number;
  kind: RouteKind;
  condition: number; // 0–100; capacity scales with it
  path: { x: number; y: number }[]; // region cells, computed once by A*
  terrainCost: number; // summed cell costs — what the land charges
  freight: number; // food moved last caravan season (the overlay number)
}

export const ROUTE_SPECS: Record<RouteKind, {
  capacity: number; // food-equivalent per month at condition 100
  speed: number;
  buildPerCost: number; // £ per point of terrain cost
  maintPerCell: number; // £ per path cell per month
}> = {
  trail: { capacity: 60, speed: 1.0, buildPerCost: 0, maintPerCell: 0 },
  road: { capacity: 200, speed: 1.7, buildPerCost: 2, maintPerCell: 0.2 },
  rail: { capacity: 1200, speed: 4.0, buildPerCost: 8, maintPerCell: 0.5 },
  highway: { capacity: 900, speed: 2.2, buildPerCost: 3, maintPerCell: 0.15 },
  maglev: { capacity: 3000, speed: 8.0, buildPerCost: 14, maintPerCell: 0.2 },
};

/** Links only ever upgrade (you don't tear up track) — but note the asphalt
 *  trap: a highway *replaces* rail at lower capacity and upkeep. The player
 *  who over-built rail keeps paying £0.5/cell or writes the steel off —
 *  the stranded-asset lesson, rehearsed early (transportation.md §5).
 *  Maglev inverts the trade: the dearest guideway in the game, then almost
 *  nothing to run — capex vs. opex is the speculative era's whole question. */
const KIND_RANK: Record<RouteKind, number> = { trail: 0, road: 1, rail: 2, highway: 3, maglev: 4 };

/** Railworks (M6c, transportation.md §5): the rail boom opens ~1912 —
 *  deliberately the best value in the game during its window. */
export const RAIL_ERA_YEAR = 1912;

/** The asphalt age (transportation.md §5): cheap paved highways from 1945
 *  erode rail's monopoly — less throughput than steel, a third the upkeep. */
export const HIGHWAY_ERA_YEAR = 1945;

/** The speculative era (transportation.md §5): maglev/automated freight
 *  from 2005 — colossal to build, nearly free to run once it floats. */
export const MAGLEV_ERA_YEAR = 2005;

/** A rotted route is still a walkable track — people keep using it. */
const ROUTE_CONDITION_FLOOR = 15;

const TOWN_NAMES = [
  'Eastvale', 'Norwick', 'Millbrook', 'Ashford', 'Redfort', 'Larkspur',
  'Coldwater', 'Hartsfield', 'Brindle', 'Ostmark', 'Fenwick', 'Sorrel',
];

export const ROLE_BONUS_DESC: Record<NotableRole, string> = {
  Mayor: '+5 satisfaction',
  Doctor: '−15% mortality',
  Captain: '+25% militia',
  Granger: '+10% food production',
  Forewoman: '+10% wood production',
  Reeve: '+10% immigration appeal',
};

/** Hard cap on settlements per region — see docs/design/map-scale.md. */
export const MAX_SETTLEMENTS = 9;

export class RegionSim {
  rng: Rng;
  minute: number;
  map: RegionMap;
  weather: Weather;
  settlements: Settlement[] = [];
  notables: Notable[] = [];
  expeditions: Expedition[] = [];
  routes: Route[] = [];
  log: LogEntry[] = [];
  stateProclaimed = false;
  /** charter done, waiting on the player's ceremony choices */
  ceremonyPending = false;
  charterProgress = 0; // 0–100, fills once eligible; the civics gate of the slice
  // ---- State-tier systems (switch on at Incorporation, GDD §2.5) ----
  stateName = '';
  govLean: GovLean | null = null;
  treasury = 0;
  taxRate = 0.1; // 0–0.3
  servicesLevel = 1; // 0–2: health & schools — satisfaction + mortality
  militiaLevel = 1; // 0–2: funded defense
  gdpLastMonth = 0;
  gameOver = false;
  /** Research: nodes that have been completed (ids). Start nodes (cost 0) pre-seeded. */
  researched: string[] = ['steam_power', 'common_law'];
  /** The node currently being invested in, or null if idle. */
  activeResearch: string | null = null;
  /** Accumulated research points invested in activeResearch. */
  researchProgress = 0;
  // ---- Elections & faction politics (GDD §5.3) ----
  /** Currency earned at elections; spent to enact laws. */
  politicalCapital = 0;
  /** Absolute day of the next election; −1 until both State and suffrage exist. */
  nextElectionDay = -1;
  /** Game year of the most recent election (for the UI). */
  lastElectionYear = -1;
  /** Computed each month; live display of faction power/support. */
  factions: Faction[] = [];
  /** Law ids that have been enacted (one-time, permanent). */
  passedLaws: string[] = [];
  /** Trade levy taken from merchant turnover; default 5%, reducible by law. */
  tradeLevyRate = 0.05;
  /** Estate Tax law active: monthly wealth levy. */
  estateTaxActive = false;
  // ---- Nation-tier: Constitutional Convention & Proclamation (GDD §2.2) ----
  nationProclaimed = false;
  nationName = '';
  govType: GovType | null = null;
  /** 0–100: regime's right to rule; distinct from approval (GDD §5.3). */
  legitimacy = 0;
  ministers: MinisterAssignment[] = MINISTER_ROLES.map((r) => ({ role: r.id, title: r.title, notableId: null }));
  /** Active policy card id per slot (null = empty). Length matches govType.policySlots. */
  activePolicies: (string | null)[] = [];
  // ---- Rival nations & diplomacy (GDD §5.4, §6.2–6.4) ----
  rivals: RivalNation[] = [];
  /** AI-initiated treaty offers awaiting the player's signature. */
  offers: TreatyOffer[] = [];
  /** Counter-offers from the bargaining table, awaiting signature (§6.3). */
  counters: DealCounter[] = [];
  /** Treaties the player has torn up — priced into every future ask. */
  treatiesBroken = 0;
  /** Foreign wars move prices (GDD §6.4): exports boom while this runs. */
  warBoomUntil = -1;
  /** Last month's trade-agreement export earnings (for the UI). */
  exportEarningsLastMonth = 0;
  /** Pairwise relations between rivals, keyed `minId:maxId` — the world has
   *  its own ledger, and the player only reads about it (GDD §6.4). */
  rivalPairs: Record<string, number> = {};
  /** Alliances between rival pairs (pair keys): the world choosing sides. */
  alliances: string[] = [];
  /** Active wars between rival powers. */
  foreignWars: ForeignWar[] = [];
  /** The nation's own war, if any — one front at a time at this altitude (GDD §7). */
  playerWar: PlayerWar | null = null;
  private droughtAnnounced = false;
  private railAnnounced = false;
  private highwayAnnounced = false;
  private maglevAnnounced = false;
  private nextId = 1000;
  private nextEventDay: number;
  private townNamePool: string[];

  constructor(rng: Rng, minute: number, map: RegionMap, weather: Weather) {
    this.rng = rng;
    this.minute = minute;
    this.map = map;
    this.weather = weather;
    this.nextEventDay = this.day + 4 + rng.int(4);
    this.townNamePool = [...TOWN_NAMES];
  }

  // ---- time (mirrors town sim) ----
  get day(): number {
    return Math.floor(this.minute / MINUTES_PER_DAY);
  }
  get seasonIndex(): number {
    return Math.floor((this.day % DAYS_PER_YEAR) / DAYS_PER_SEASON);
  }
  get season(): string {
    return SEASONS[this.seasonIndex];
  }
  get year(): number {
    return START_YEAR + Math.floor(this.day / DAYS_PER_YEAR);
  }
  get dateLabel(): string {
    const dayOfSeason = (this.day % DAYS_PER_YEAR) % DAYS_PER_SEASON + 1;
    return `${this.season} ${dayOfSeason}, ${this.year}`;
  }

  totalPop(): number {
    return Math.round(
      this.settlements.reduce((s, t) => s + this.popOf(t), 0) +
      this.expeditions.reduce((s, e) => s + e.pop, 0),
    );
  }

  popOf(t: Settlement): number {
    return t.cohorts.bands.reduce((a, b) => a + b, 0);
  }

  workersOf(t: Settlement): number {
    return t.cohorts.bands[1] + t.cohorts.bands[2] + t.cohorts.bands[3] * 0.6;
  }

  settlement(id: number): Settlement | undefined {
    return this.settlements.find((s) => s.id === id);
  }

  notablesAt(id: number): Notable[] {
    return this.notables.filter((n) => n.alive && n.settlementId === id);
  }

  private roleMult(t: Settlement, role: NotableRole): number {
    return this.notablesAt(t.id).some((n) => n.role === role) ? 1 : 0;
  }

  // ---- the route network (M6b: transportation.md §3) ----
  routeBetween(aId: number, bId: number): Route | undefined {
    return this.routes.find((r) => (r.a === aId && r.b === bId) || (r.a === bId && r.b === aId));
  }

  /** Throughput a route can actually carry: capacity scales with condition. */
  effectiveCapacity(r: Route): number {
    return ROUTE_SPECS[r.kind].capacity * (r.condition / 100);
  }

  /** A trail is blazed automatically when a settlement is founded. */
  private blazeTrail(fromId: number, toId: number): void {
    const a = this.settlement(fromId);
    const b = this.settlement(toId);
    if (!a || !b || this.routeBetween(fromId, toId)) return;
    const c = this.corridorBetween(a, b);
    // no land corridor (water between): the chord stands in — peddler boats
    const path = c ? c.path : [this.map.coordToCell(a.x, a.y), this.map.coordToCell(b.x, b.y)];
    this.routes.push({
      a: fromId, b: toId, kind: 'trail', condition: 100,
      path, terrainCost: c ? c.cost : path.length * 2, freight: 0,
    });
  }

  /** Corridors between fixed towns never change — cache them (the UI
   *  prices roads every frame). */
  private corridorCache = new Map<string, { path: { x: number; y: number }[]; cost: number } | null>();

  private corridorBetween(a: Settlement, b: Settlement): { path: { x: number; y: number }[]; cost: number } | null {
    const key = a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
    let c = this.corridorCache.get(key);
    if (c === undefined) {
      const ac = this.map.coordToCell(a.x, a.y);
      const bc = this.map.coordToCell(b.x, b.y);
      c = this.map.corridor(ac.x, ac.y, bc.x, bc.y);
      this.corridorCache.set(key, c);
    }
    return c;
  }

  /** Price a built link between two towns: the terrain's itemized bill. */
  linkCost(aId: number, bId: number, kind: BuiltRouteKind): { total: number; cells: number; breakdown: string } | null {
    const a = this.settlement(aId);
    const b = this.settlement(bId);
    if (!a || !b) return null;
    const c = this.corridorBetween(a, b);
    if (!c) return null;
    const counts: Record<string, number> = {};
    for (const p of c.path) {
      const biome = this.map.at(p.x, p.y).biome;
      const label = biome === 'river' ? 'river crossing' : biome;
      counts[label] = (counts[label] ?? 0) + 1;
    }
    const breakdown = Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ');
    return { total: Math.ceil(c.cost * ROUTE_SPECS[kind].buildPerCost), cells: c.path.length, breakdown };
  }

  roadCost(aId: number, bId: number): { total: number; cells: number; breakdown: string } | null {
    return this.linkCost(aId, bId, 'road');
  }

  railCost(aId: number, bId: number): { total: number; cells: number; breakdown: string } | null {
    return this.linkCost(aId, bId, 'rail');
  }

  highwayCost(aId: number, bId: number): { total: number; cells: number; breakdown: string } | null {
    return this.linkCost(aId, bId, 'highway');
  }

  maglevCost(aId: number, bId: number): { total: number; cells: number; breakdown: string } | null {
    return this.linkCost(aId, bId, 'maglev');
  }

  /** Query whether a tech/civics node has been researched. */
  has(id: string): boolean {
    return this.researched.includes(id);
  }

  /** Research points generated per day; scales with population and boosts from nodes. */
  researchRate(): number {
    const base = this.settlements.length * 0.5 + this.totalPop() * 0.004;
    let mult = 1;
    if (this.has('public_education')) mult *= 1.5;
    if (this.has('electrical_grid')) mult *= 1.25;
    if (this.has('computing')) mult *= 1.25;
    if (this.passedLaws.includes('national_education_act')) mult *= 1.3;
    return base * mult;
  }

  /** Nodes that can be started right now: prereqs met, era reached, not yet done. */
  availableToResearch(): TechNode[] {
    return TECH_TREE.filter(
      (n) =>
        n.cost > 0 &&
        !this.has(n.id) &&
        n.prereqs.every((p) => this.has(p)) &&
        this.year >= n.era &&
        (!n.requiresState || this.stateProclaimed),
    );
  }

  /** Set the active research target; resets progress. Returns false if not available. */
  startResearch(id: string): boolean {
    if (!this.availableToResearch().find((n) => n.id === id)) return false;
    this.activeResearch = id;
    this.researchProgress = 0;
    return true;
  }

  /** Cancel the active research (progress is lost). */
  cancelResearch(): void {
    this.activeResearch = null;
    this.researchProgress = 0;
  }

  /** Called once per game-day; drains the rate into the active node. */
  private tickResearch(): void {
    if (!this.activeResearch) return;
    const node = TECH_TREE.find((n) => n.id === this.activeResearch);
    if (!node) { this.activeResearch = null; return; }
    this.researchProgress += this.researchRate();
    if (this.researchProgress >= node.cost) {
      this.researched.push(this.activeResearch);
      const label = node.tree === 'tech' ? 'Technology' : 'Civics';
      this.addLog(`${label} breakthrough: "${node.name}". ${node.desc.split('.')[0]}.`, 'good');
      this.activeResearch = null;
      this.researchProgress = 0;
    }
  }

  /** The Railworks gate: steel needs both a State and the 1912 era.
   *  Industrial Steel research unlocks rail five years early. */
  railUnlocked(): boolean {
    const threshold = this.has('steel_industry') ? RAIL_ERA_YEAR - 5 : RAIL_ERA_YEAR;
    return this.stateProclaimed && this.year >= threshold;
  }

  /** The asphalt gate: paving plants need a State and the 1945 era.
   *  Asphalt Paving research unlocks highways five years early. */
  highwayUnlocked(): boolean {
    const threshold = this.has('asphalt') ? HIGHWAY_ERA_YEAR - 5 : HIGHWAY_ERA_YEAR;
    return this.stateProclaimed && this.year >= threshold;
  }

  /** The speculative gate: superconductors need a State and the 2005 era.
   *  Maglev Trains research floats the freight five years early. */
  maglevUnlocked(): boolean {
    const threshold = this.has('maglev') ? MAGLEV_ERA_YEAR - 5 : MAGLEV_ERA_YEAR;
    return this.stateProclaimed && this.year >= threshold;
  }

  /** Built links are State works, paid from the treasury; links only upgrade. */
  private buildLink(aId: number, bId: number, kind: BuiltRouteKind): boolean {
    if (!this.stateProclaimed) return false;
    if (kind === 'rail' && !this.railUnlocked()) return false;
    if (kind === 'highway' && !this.highwayUnlocked()) return false;
    if (kind === 'maglev' && !this.maglevUnlocked()) return false;
    const existing = this.routeBetween(aId, bId);
    if (existing && KIND_RANK[existing.kind] >= KIND_RANK[kind]) return false;
    const a = this.settlement(aId);
    const b = this.settlement(bId);
    const cost = this.linkCost(aId, bId, kind);
    if (!a || !b || !cost || this.treasury < cost.total) return false;
    const c = this.corridorBetween(a, b)!;
    const wasRail = existing?.kind === 'rail';
    this.treasury -= cost.total;
    if (existing) {
      existing.kind = kind;
      existing.condition = 100;
      existing.path = c.path;
      existing.terrainCost = c.cost;
    } else {
      this.routes.push({ a: aId, b: bId, kind, condition: 100, path: c.path, terrainCost: c.cost, freight: 0 });
    }
    this.addLog(
      kind === 'road'
        ? `A wagon road opens between ${a.name} and ${b.name} — £${cost.total} of grading and bridgework.`
        : kind === 'rail'
          ? `Steel rails link ${a.name} and ${b.name} — £${cost.total} of cuttings, trestles, and track. The whistle carries for miles.`
          : kind === 'highway'
            ? `Fresh asphalt runs from ${a.name} to ${b.name} — £${cost.total} of paving${wasRail ? '. The old rail bed goes quiet' : ''}.`
            : `A maglev guideway hums between ${a.name} and ${b.name} — £${cost.total} of pylons and superconductors. The freight drives itself now.`,
      'good',
    );
    return true;
  }

  buildRoad(aId: number, bId: number): boolean {
    return this.buildLink(aId, bId, 'road');
  }

  buildRail(aId: number, bId: number): boolean {
    return this.buildLink(aId, bId, 'rail');
  }

  buildHighway(aId: number, bId: number): boolean {
    return this.buildLink(aId, bId, 'highway');
  }

  buildMaglev(aId: number, bId: number): boolean {
    return this.buildLink(aId, bId, 'maglev');
  }

  /** Putting a storm-damaged link back in order: crews priced by what the
   *  land charged to build it and how much of it is down. */
  repairCost(r: Route): number {
    return Math.max(1, Math.ceil(((100 - r.condition) / 100) * r.terrainCost * ROUTE_SPECS[r.kind].buildPerCost * 0.5));
  }

  /** The repair half of the storm loop (M6c): pay now, or let maintenance
   *  crawl it back over months while the caravans squeeze through. */
  repairRoute(aId: number, bId: number): boolean {
    if (!this.stateProclaimed) return false;
    const r = this.routeBetween(aId, bId);
    if (!r || r.kind === 'trail' || r.condition >= 99) return false;
    const cost = this.repairCost(r);
    if (this.treasury < cost) return false;
    this.treasury -= cost;
    r.condition = 100;
    const a = this.settlement(aId)?.name ?? '?';
    const b = this.settlement(bId)?.name ?? '?';
    this.addLog(`Repair gangs put the ${r.kind} between ${a} and ${b} back in order — £${cost}.`, 'good');
    return true;
  }

  /** Shortest hop-path through the route graph; null when unconnected.
   *  `usable` narrows the graph (e.g. militia relief rides built links only). */
  private routePath(fromId: number, toId: number, usable: (r: Route) => boolean = () => true): Route[] | null {
    if (fromId === toId) return [];
    const prev = new Map<number, { via: Route; from: number }>();
    const seen = new Set([fromId]);
    const queue = [fromId];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const r of this.routes) {
        if (!usable(r)) continue;
        const other = r.a === cur ? r.b : r.b === cur ? r.a : -1;
        if (other < 0 || seen.has(other)) continue;
        seen.add(other);
        prev.set(other, { via: r, from: cur });
        if (other === toId) {
          const out: Route[] = [];
          let k = toId;
          while (k !== fromId) {
            const p = prev.get(k)!;
            out.push(p.via);
            k = p.from;
          }
          return out.reverse();
        }
        queue.push(other);
      }
    }
    return null;
  }

  /** The GDD §2.2 connection requirement, made real by the route graph. */
  connectedToAll(): boolean {
    if (this.settlements.length < 2) return true;
    const start = this.settlements[0].id;
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const r of this.routes) {
        const other = r.a === cur ? r.b : r.b === cur ? r.a : -1;
        if (other < 0 || seen.has(other)) continue;
        seen.add(other);
        queue.push(other);
      }
    }
    return this.settlements.every((t) => seen.has(t.id));
  }

  /** A relief line (M6c): a built link — road or rail, in any state — to a
   *  larger town means reinforcements can ride in when raiders strike. */
  reliefLine(t: Settlement): boolean {
    const pop = this.popOf(t);
    return this.settlements.some(
      (o) => o !== t && this.popOf(o) > pop && this.routePath(t.id, o.id, (r) => r.kind !== 'trail') !== null,
    );
  }

  /** Storms wear routes down; footfall keeps trails open, roads need £.
   *  M6c adds the washout: a big storm can take a whole crossing out. */
  private weatherRoutes(): void {
    const storm = this.weather.forDay(this.day).sky === 'storm';
    for (const r of this.routes) {
      if (storm) {
        r.condition = Math.max(ROUTE_CONDITION_FLOOR, r.condition - (r.kind === 'trail' ? 2 : 0.5));
      } else if (r.kind === 'trail') {
        r.condition = Math.min(100, r.condition + 0.1);
      }
    }
    if (storm && this.routes.length > 0 && this.rng.chance(0.12)) {
      const r = this.routes[this.rng.int(this.routes.length)];
      if (r.kind !== 'trail' && r.condition > 40) {
        r.condition = Math.max(ROUTE_CONDITION_FLOOR, r.condition - 45);
        const a = this.settlement(r.a)?.name ?? '?';
        const b = this.settlement(r.b)?.name ?? '?';
        this.addLog(
          `Storm washout: the ${r.kind} between ${a} and ${b} is cut — ` +
          `${r.kind === 'rail' ? 'a trestle is down' : r.kind === 'maglev' ? 'a guideway pylon is down' : 'a bridge is out'}. Repairs would cost £${this.repairCost(r)}.`,
          'bad',
        );
      }
    }
  }

  /** What a link's road gangs (or drone crews) bill per month — Automated
   *  Freight research swaps the work crews for machines at 60% the cost. */
  maintBill(r: Route): number {
    const automation = this.has('automated_logistics') ? 0.6 : 1;
    return r.path.length * ROUTE_SPECS[r.kind].maintPerCell * automation;
  }

  /** Monthly upkeep on built links from the treasury — an unmaintained
   *  empire rots. Rail crews cost more than road gangs. */
  private maintainRoutes(): void {
    const investmentBonus = this.policyActive('public_investment') ? 2 : 0;
    let rotting = false;
    for (const r of this.routes) {
      if (r.kind === 'trail') continue;
      const bill = this.maintBill(r);
      if (this.treasury >= bill) {
        this.treasury -= bill;
        r.condition = Math.min(100, r.condition + 8 + investmentBonus);
      } else {
        r.condition = Math.max(ROUTE_CONDITION_FLOOR, r.condition - 6);
        rotting = true;
      }
    }
    if (rotting && this.rng.chance(0.3)) {
      this.addLog('No coin for the road and rail gangs — the built routes are rutting over.', 'bad');
    }
  }

  // ---- THE FLIP: build the region from the founding town (GDD §2.4) ----
  static fromTown(sim: Simulation, expeditionPop: number, expeditionFood: number, expeditionWood: number): RegionSim {
    // The region inherits the town's world: same map, same weather, one truth.
    const region = new RegionSim(sim.rng, sim.minute, sim.regionMap, sim.weather);
    region.log = [...sim.log];

    // Town #1 cohortifies: real settler ages, minus those leaving on the expedition.
    const stayers = sim.settlers.length - expeditionPop;
    const bands = [0, 0, 0, 0, 0];
    for (const s of sim.settlers) {
      const band = s.age < 15 ? 0 : s.age < 30 ? 1 : s.age < 50 ? 2 : s.age < 70 ? 3 : 4;
      bands[band]++;
    }
    // remove expedition members from the working bands first
    let toRemove = expeditionPop;
    for (const b of [1, 2, 3, 0, 4]) {
      const take = Math.min(bands[b], toRemove);
      bands[b] -= take;
      toRemove -= take;
      if (toRemove <= 0) break;
    }
    const homeCoord = region.map.cellToCoord(sim.site.cellX, sim.site.cellY);
    const home: Settlement = {
      id: region.nextId++,
      name: 'Founder\'s Rest',
      x: homeCoord.rx,
      y: homeCoord.ry,
      foundedDay: 0,
      cohorts: { bands },
      food: Math.max(0, sim.stock.meal + sim.stock.grain * 0.5 - expeditionFood),
      wood: Math.max(0, sim.stock.wood - expeditionWood),
      satisfaction: Math.round(sim.avgMood()),
      housing: Math.max(stayers + 6, sim.builtOf('sleep').length * 6 + 8),
      landQuality: sim.site.fertility,
      site: sim.site,
      lastRaidDay: -99,
      lastFloodDay: -99,
      strikeUntil: -1,
      grievance: 0,
      prices: defaultPrices(),
    };
    region.settlements.push(home);

    // The Notables carve-out: the most story-laden settlers stay individuals.
    const scored = [...sim.settlers].sort((a, b) => region.storyScore(sim, b) - region.storyScore(sim, a));
    const roles: NotableRole[] = ['Mayor', 'Doctor', 'Captain', 'Granger', 'Forewoman', 'Reeve'];
    const count = Math.min(10, scored.length);
    for (let i = 0; i < count; i++) {
      const s = scored[i];
      const role = roles[i % roles.length];
      region.notables.push({
        id: region.nextId++,
        name: s.name,
        age: s.age,
        traits: [...s.traits],
        role,
        settlementId: home.id,
        bio: [`Founding settler, 1900.`, `Named ${role} at the flip.`],
        alive: true,
      });
    }

    region.addLog(
      `The colony has outgrown one valley. ${expeditionPop} settlers strike out to found a second town — ` +
      `from this day, the story is told in towns and Notables, not head-counts.`,
      'good',
    );

    // Expedition en route: scouts have read the land for the best nearby site.
    region.launchExpedition(home, expeditionPop, expeditionFood, expeditionWood);
    return region;
  }

  /** Site selection and travel time come from the terrain, not dice. */
  private launchExpedition(from: Settlement, pop: number, food: number, wood: number): boolean {
    const fromCell = this.map.coordToCell(from.x, from.y);
    const claimed = this.settlements
      .map((s) => this.map.coordToCell(s.x, s.y))
      .concat(this.expeditions.map((e) => this.map.coordToCell(e.targetX, e.targetY)));
    const site = this.map.bestSiteNear(fromCell.x, fromCell.y, claimed);
    if (!site) return false;
    const target = this.map.cellToCoord(site.cellX, site.cellY);
    const travel = this.map.travelDays(fromCell.x, fromCell.y, site.cellX, site.cellY);
    const name = this.townNamePool.length > 0
      ? this.townNamePool.splice(this.rng.int(this.townNamePool.length), 1)[0]
      : `New Town ${this.settlements.length + 1}`;
    this.expeditions.push({
      fromId: from.id,
      x: from.x,
      y: from.y,
      targetX: target.rx,
      targetY: target.ry,
      pop,
      food,
      wood,
      departDay: this.day,
      arrivesDay: this.day + travel,
      name,
      site,
    });
    return true;
  }

  private storyScore(sim: Simulation, s: Settler): number {
    const skillTotal = Object.values(s.skills).reduce((a, b) => a + b, 0) + s.combat;
    return skillTotal + sim.friendsOf(s).length * 5;
  }

  // ---- main loop: one tick = 30 game-minutes ----
  tick(): void {
    if (this.gameOver) return;
    const prevDay = this.day;
    this.minute += REGION_MINUTES_PER_TICK;
    if (this.day !== prevDay) this.dailyUpdate();
  }

  private dailyUpdate(): void {
    const seasonMult = [1.25, 1.35, 1.0, 0.15][this.seasonIndex];
    const weatherMult = this.weather.growthMult(this.day);
    const drought = this.weather.isDrought(this.day);
    const floodRisk = this.weather.isFloodRisk(this.day);
    for (const t of this.settlements) {
      const pop = this.popOf(t);
      if (pop <= 0) continue;
      const workers = this.workersOf(t);
      // Production & consumption: the land budgets the farms, the sky pays or
      // withholds, and the river feeds you whatever the weather (fishing).
      const granger = 1 + 0.1 * this.roleMult(t, 'Granger');
      const forewoman = 1 + 0.1 * this.roleMult(t, 'Forewoman');
      const strike = this.day < t.strikeUntil ? 0.6 : 1;
      t.food += workers * 1.15 * seasonMult * t.landQuality * weatherMult * granger * strike;
      if (t.site.river || t.site.coastal) t.food += workers * 0.18; // the fishery
      t.food -= pop * 0.75;
      t.wood += workers * 0.25 * (0.5 + t.site.forest) * forewoman * strike;
      // Floods hit river towns' stores and fields
      if (floodRisk && t.site.river && this.day - t.lastFloodDay > 25) {
        t.lastFloodDay = this.day;
        t.food *= 0.85;
        t.satisfaction -= 6;
        this.addLog(`The river floods at ${t.name} — stores spoiled, fields under water.`, 'bad');
      }
      // Housing grows when wood allows
      if (t.housing < pop + 4 && t.wood >= 20) {
        t.wood -= 20;
        t.housing += 3;
      }
      // Satisfaction: food security, crowding, raid fear, mayor — plus,
      // after Incorporation, the politics of taxes and services
      const foodDays = t.food / Math.max(1, pop * 0.75);
      const stateTerms = this.stateProclaimed
        ? -this.taxRate * 40 +
          this.servicesLevel * 4 +
          (this.govLean === 'council' ? 6 : this.govLean === 'mayor' ? -6 : 0) -
          (this.day < t.strikeUntil ? 5 : 0) +
          (this.policyActive('welfare_state') ? 6 : 0) +
          (this.passedLaws.includes('welfare_benefits') ? 5 : 0)
        : 0;
      // Land Reform (nation law) boosts food production 5%
      if (this.passedLaws.includes('land_reform')) t.food += workers * 1.15 * seasonMult * t.landQuality * weatherMult * granger * strike * 0.05;
      const target =
        50 +
        Math.min(20, foodDays * 1.5) -
        Math.max(0, (pop - t.housing) * 2) -
        (this.day - t.lastRaidDay < 10 ? 10 : 0) +
        5 * this.roleMult(t, 'Mayor') +
        (this.has('universal_suffrage') ? 3 : 0) +
        stateTerms;
      t.satisfaction += (Math.max(0, Math.min(100, target)) - t.satisfaction) * 0.08;
      // Grievance: heavy taxes build pressure daily; services and contentment vent it.
      // Labor Standards research slows buildup 30%; Border Constabulary policy adds another 25%.
      if (this.stateProclaimed) {
        const laborFactor = this.has('labor_law') ? 0.7 : 1;
        const constabFactor = this.policyActive('border_constabulary') ? 0.75 : 1;
        const pressure =
          (Math.max(0, this.taxRate - 0.15) * 35 - this.servicesLevel * 0.4 - Math.max(0, t.satisfaction - 55) * 0.05) * laborFactor * constabFactor;
        t.grievance = Math.max(0, Math.min(100, t.grievance + pressure));
      }
      this.updateMarket(t);
      // Starvation
      if (t.food < 0) {
        const starved = Math.min(pop * 0.02, -t.food / 10);
        this.removePop(t, starved);
        t.food = 0;
        if (starved > 0.5 && this.rng.chance(0.2)) {
          this.addLog(`Hunger stalks ${t.name} — the granary is empty.`, 'bad');
        }
      }
    }
    // Drought is regional news: announce on onset, during growing seasons
    if (drought && !this.droughtAnnounced && this.seasonIndex < 3) {
      this.droughtAnnounced = true;
      this.addLog('Drought grips the region. Every town\'s fields slow; river towns lean on the fishery.', 'bad');
    } else if (!drought) {
      this.droughtAnnounced = false;
    }
    this.weatherRoutes();
    // The rail era arrives (M6c): one announcement, the year the gate opens
    if (!this.railAnnounced && this.railUnlocked()) {
      this.railAnnounced = true;
      this.addLog(
        `RAILWORKS: ${this.stateName} charters its first railway engineers. ` +
        `Steel rails can now be laid between the towns — the age of steam begins.`,
        'good',
      );
    }
    if (!this.highwayAnnounced && this.highwayUnlocked()) {
      this.highwayAnnounced = true;
      this.addLog(
        `THE ASPHALT AGE: ${this.stateName} opens its first paving plant. Cheap highways ` +
        `now rival the railways — the steel monopolies grumble.`,
        'good',
      );
    }
    if (!this.maglevAnnounced && this.maglevUnlocked()) {
      this.maglevAnnounced = true;
      this.addLog(
        `THE FLOATING FREIGHT: ${this.stateName} energizes its first superconducting guideway. ` +
        `Maglev lines cost a fortune to raise and almost nothing to run — the hauliers' unions read the writing on the wall.`,
        'good',
      );
    }
    this.tickResearch();
    this.checkElection();
    if (this.day % 30 === 0) this.monthlyUpdate();
    if (this.day >= this.nextEventDay) {
      this.fireEvent();
      // Isolationism policy reduces incident frequency by 35%
      const eventGap = this.policyActive('isolationism') ? 7 + this.rng.int(8) : 4 + this.rng.int(5);
      this.nextEventDay = this.day + eventGap;
    }
    this.updateExpeditions();
    this.updateCharter();
    if (this.totalPop() <= 0) {
      this.gameOver = true;
      this.addLog('The last settlement is empty. (Failure state: depopulation.)', 'bad');
    }
  }

  private monthlyUpdate(): void {
    for (const t of this.settlements) {
      const b = t.cohorts.bands;
      // Births from fertile bands
      const births = (b[1] + b[2] * 0.6) * 0.011;
      b[0] += births;
      // Aging: a band-span fraction graduates each month
      for (let i = AGE_BANDS.length - 2; i >= 0; i--) {
        const moved = b[i] / (BAND_SPAN_YEARS[i] * 12);
        b[i] -= moved;
        b[i + 1] += moved;
      }
      // Mortality: doctor, services, Public Health policy, and Healthcare Act law all help
      const doctor = this.roleMult(t, 'Doctor') ? 0.85 : 1;
      // Interior Minister makes services 15% more effective (GDD §8.7)
      const interiorBonus = this.ministerFor('interior') ? 1.15 : 1;
      const services = this.stateProclaimed ? 1 - 0.05 * this.servicesLevel * interiorBonus : 1;
      const healthPolicy = this.policyActive('public_health_policy') ? 0.8 : 1;
      const healthcareLaw = this.passedLaws.includes('healthcare_act') ? 0.85 : 1;
      for (let i = 0; i < b.length; i++) {
        b[i] -= b[i] * (BASE_MORTALITY_PER_YEAR[i] / 12) * doctor * services * healthPolicy * healthcareLaw;
      }
      // Immigration: the frontier draws people to fed, content towns
      const reeve = 1 + 0.1 * this.roleMult(t, 'Reeve');
      const openBorders = this.policyActive('open_borders') ? 1.3 : 1;
      if (t.satisfaction > 55 && t.food > this.popOf(t) * 2) {
        const arrivals = (this.popOf(t) * 0.02 + 2) * reeve * openBorders;
        b[1] += arrivals * 0.6;
        b[2] += arrivals * 0.3;
        b[0] += arrivals * 0.1;
      }
    }
    this.migrate();
    this.caravans();
    this.traders();
    this.ageNotables();
    if (this.stateProclaimed) this.monthlyEconomy();
    if (this.stateProclaimed) this.updateFactions();
    this.updateDiplomacy();
  }

  // ---- local markets & trade (GDD §5.2, first slice) ----
  /** A month's worth of demand: what this town wants on hand. */
  private monthNeed(t: Settlement, g: TradeGood): number {
    const pop = this.popOf(t);
    return Math.max(1, g === 'food' ? pop * 0.75 * 30 : pop * 0.1 * 30);
  }

  private stockOf(t: Settlement, g: TradeGood): number {
    return g === 'food' ? t.food : t.wood;
  }

  private addStock(t: Settlement, g: TradeGood, v: number): void {
    if (g === 'food') t.food += v;
    else t.wood += v;
  }

  /** The GDD §5.2 price rule, verbatim at this altitude:
   *  Δp = p × 0.05 × (demand − supply) / max(supply, ε), clamped ±2%/day. */
  private updateMarket(t: Settlement): void {
    for (const g of TRADE_GOODS) {
      const supply = Math.max(1, this.stockOf(t, g));
      const demand = this.monthNeed(t, g);
      const raw = t.prices[g] * 0.05 * ((demand - supply) / supply);
      const delta = Math.max(-t.prices[g] * 0.02, Math.min(t.prices[g] * 0.02, raw));
      t.prices[g] = Math.max(BASE_PRICE[g] * 0.25, Math.min(BASE_PRICE[g] * 4, t.prices[g] + delta));
    }
  }

  /** Traders run the routes once a month, after the relief caravans: buy
   *  where a good is cheap, sell where it is dear, whenever the margin
   *  beats the freight. Convergence emerges; nobody scripts it. The State,
   *  once it exists, takes a levy on the turnover. Public so tests can
   *  run a trade season directly (same deal as caravans). */
  tradeValueLastMonth = 0;

  traders(): void {
    if (this.settlements.length < 2) return;
    let turnover = 0;
    for (const g of TRADE_GOODS) {
      // dearest market first: traders chase the widest margin
      const dear = [...this.settlements].sort((a, b) => b.prices[g] - a.prices[g]);
      for (const buyer of dear) {
        const seller = [...this.settlements]
          .filter((s) => s !== buyer)
          .sort((a, b) => a.prices[g] - b.prices[g])[0];
        if (!seller) continue;
        const legs = this.routePath(seller.id, buyer.id);
        if (!legs || legs.length === 0) continue; // traders need a route
        const freightRate = 0.01 * legs.length; // £/unit per hop on the wagon
        const margin = buyer.prices[g] - seller.prices[g];
        if (margin <= freightRate * 1.5) continue; // not worth the trip
        const surplus = this.stockOf(seller, g) - this.monthNeed(seller, g);
        const capLeft = Math.min(...legs.map((r) => this.effectiveCapacity(r) - r.freight));
        const volume = Math.min(surplus * 0.25, capLeft, 80);
        if (volume < 1) continue;
        this.addStock(seller, g, -volume);
        this.addStock(buyer, g, volume * 0.95); // handling and spillage
        for (const r of legs) r.freight += volume;
        turnover += volume * (seller.prices[g] + buyer.prices[g]) / 2;
        if (volume > 30 && this.rng.chance(0.25)) {
          this.addLog(`${g === 'food' ? 'Grain' : 'Timber'} is dear in ${buyer.name} — traders run the route from ${seller.name}.`, 'info');
        }
      }
    }
    this.tradeValueLastMonth = turnover;
    if (this.stateProclaimed && turnover > 0) {
      // Free Trade policy removes the levy entirely; otherwise use the configured rate
      const effectiveLevyRate = this.policyActive('free_trade') ? 0 : this.tradeLevyRate;
      this.treasury += turnover * effectiveLevyRate;
    }
  }

  /** Grain caravans ride the route network (M6b): surplus towns provision
   *  hungry ones, but every leg clamps to its route's remaining capacity —
   *  a famine behind a goat trail is now possible, and fixable with money.
   *  Public so tests and the harness can run a caravan season directly. */
  caravans(): void {
    if (this.settlements.length < 2) return;
    for (const r of this.routes) r.freight = 0;
    for (const needy of this.settlements) {
      const need = this.popOf(needy) * 0.75 * 20 - needy.food; // 20-day buffer target
      if (need <= 0) continue;
      const donor = [...this.settlements]
        .filter((t) => t !== needy && t.food > this.popOf(t) * 0.75 * 60)
        .sort((a, b) => b.food - a.food)[0];
      if (!donor) continue;
      const surplus = donor.food - this.popOf(donor) * 0.75 * 60;
      const legs = this.routePath(donor.id, needy.id);
      if (legs && legs.length > 0) {
        const cap = Math.min(...legs.map((r) => this.effectiveCapacity(r) - r.freight));
        const sent = Math.max(0, Math.min(need, surplus, cap));
        if (sent <= 0) continue;
        donor.food -= sent;
        needy.food += sent * 0.9; // the road takes its tithe
        for (const r of legs) r.freight += sent;
        if (sent < Math.min(need, surplus) - 1 && this.rng.chance(0.4)) {
          this.addLog(`The route to ${needy.name} is choked — wagons turn back with grain still wanted.`, 'bad');
        } else if (sent > 40 && this.rng.chance(0.4)) {
          this.addLog(`Grain caravans roll from ${donor.name} to ${needy.name}.`, 'info');
        }
      } else {
        // No route at all: smugglers and peddlers move a trickle, at a price
        const sent = Math.min(need, surplus);
        if (sent <= 0) continue;
        donor.food -= sent;
        needy.food += sent * 0.3;
        if (this.rng.chance(0.3)) {
          this.addLog(`Peddlers carry what they can to ${needy.name} — no road reaches it.`, 'bad');
        }
      }
    }
  }

  /** The money layer that arrives with Statehood (GDD §2.5). */
  private monthlyEconomy(): void {
    const incomeMult = this.govLean === 'compact' ? 1.15 : 1;
    const collection = this.govLean === 'council' ? 0.85 : this.govLean === 'mayor' ? 1.2 : 1;
    const serviceCost = this.govLean === 'compact' ? 1.25 : 1;
    let gdp = 0;
    for (const t of this.settlements) {
      const strike = this.day < t.strikeUntil ? 0.6 : 1;
      gdp += this.workersOf(t) * 1.2 * (0.8 + t.landQuality * 0.2) * incomeMult * strike;
    }
    gdp += this.tradeValueLastMonth; // commerce counts (GDD §5.2)
    // War economy (GDD §7.2): armaments demand is a stimulus first…
    const warMob = this.playerWar ? MOBILIZATION_DEFS[this.playerWar.mobilization] : null;
    if (warMob) gdp *= warMob.gdpMult;
    this.gdpLastMonth = gdp;
    // Treasury Secretary bonus: +10% tax collection (GDD §8.7)
    const treasuryMult = this.ministerFor('treasury') ? 1.1 : 1;
    const revenue = gdp * this.taxRate * collection * treasuryMult;
    const pop = this.totalPop();
    const spending =
      pop * 0.05 * this.servicesLevel * serviceCost +
      pop * 0.03 * this.militiaLevel +
      this.settlements.length * 5 + // administration
      this.policyUpkeep() + // active policy running costs
      (this.passedLaws.includes('welfare_benefits') ? pop * 0.01 : 0) + // welfare relief payments
      (warMob ? pop * warMob.upkeepPerPop : 0) + // …and the drain runs concurrently (GDD §7.2)
      (this.playerWar?.blockade ? pop * BLOCKADE_UPKEEP_PER_POP : 0); // coal and crews for the gunboats
    // Income Tax (civic research): a progressive levy adds 3% of GDP on top
    const incomeTaxBonus = this.has('income_tax') ? this.gdpLastMonth * 0.03 : 0;
    // Estate Tax law: a wealth levy on the land
    const estateLevyBonus = this.estateTaxActive ? this.totalPop() * 0.1 : 0;
    // Progressive Taxation law: graduated bands yield 2% extra of GDP
    const progressiveTaxBonus = this.passedLaws.includes('progressive_tax') ? this.gdpLastMonth * 0.02 : 0;
    // Protectionism policy: tariff wall adds flat £3/month
    const protectionismBonus = this.policyActive('protectionism') ? 3 : 0;
    // Central Bank Charter law: treasury reserves earn 0.5% interest/month
    const bankInterest = this.passedLaws.includes('central_bank_charter') ? this.treasury * 0.005 : 0;
    // Trade agreements (GDD §5.4): export earnings per signed rival, scaled to
    // GDP and the rival's commerce appetite. Foreign wars make buyers pay more.
    const warBoom = this.day < this.warBoomUntil ? 1.5 : 1;
    this.exportEarningsLastMonth = this.rivals.reduce(
      (s, rv) =>
        rv.treaties.includes('trade_agreement')
          ? s + Math.min(12, this.gdpLastMonth * 0.025) * (0.5 + rv.weights.commerce / 10) * warBoom
          : s,
      0,
    );
    // Your own war contests the lanes (GDD §7.3) — and your own blockade
    // requisitions the merchantmen that would have carried the exports
    if (this.playerWar) this.exportEarningsLastMonth *= this.playerWar.blockade ? 0.6 : 0.7;
    this.treasury += revenue - spending + incomeTaxBonus + estateLevyBonus +
      progressiveTaxBonus + protectionismBonus + bankInterest + this.exportEarningsLastMonth;
    if (this.treasury < 0) {
      this.treasury = 0;
      if (this.servicesLevel > 0) {
        this.servicesLevel--;
        this.addLog('The treasury is empty — services are cut back. The towns notice.', 'bad');
      }
    }
    this.maintainRoutes();
    this.tickLegitimacy();
    // Strikes: pressure vents when grievance boils over
    for (const t of this.settlements) {
      if (t.grievance > 60 && this.day >= t.strikeUntil && this.rng.chance(0.5)) {
        t.strikeUntil = this.day + 15;
        t.grievance -= 40; // the strike itself is the release valve
        this.addLog(`Strike in ${t.name}! Workers down tools over taxes and conditions.`, 'bad');
      }
    }
  }

  private migrate(): void {
    if (this.settlements.length < 2) return;
    const ranked = [...this.settlements].sort((a, b) => b.satisfaction - a.satisfaction);
    const best = ranked[0];
    const worst = ranked[ranked.length - 1];
    if (best.satisfaction - worst.satisfaction > 15 && this.popOf(worst) > 10) {
      // movers ride the network too: without a route, only a trickle walks out
      const connected = this.routePath(worst.id, best.id) !== null;
      const movers = this.popOf(worst) * 0.02 * (connected ? 1 : 0.3);
      this.removePop(worst, movers);
      best.cohorts.bands[1] += movers * 0.7;
      best.cohorts.bands[2] += movers * 0.3;
    }
  }

  private ageNotables(): void {
    for (const n of this.notables) {
      if (!n.alive) continue;
      n.age += 1 / 12;
      const annualRisk = n.age > 75 ? 0.12 : n.age > 60 ? 0.03 : 0.004;
      if (this.rng.chance(annualRisk / 12)) {
        n.alive = false;
        n.bio.push(`Died ${this.year}, aged ${Math.floor(n.age)}.`);
        this.addLog(`${n.name}, ${n.role} of ${this.settlement(n.settlementId)?.name ?? 'the colony'}, has died, aged ${Math.floor(n.age)}.`, 'bad');
        this.mintNotable(n.role, n.settlementId);
      }
    }
  }

  /** New Notables rise from the cohorts when a role falls vacant (GDD §2.4). */
  private mintNotable(role: NotableRole, settlementId: number): void {
    const t = this.settlement(settlementId);
    if (!t || this.popOf(t) < 10) return;
    const first = ['Edda', 'Tomas', 'Sela', 'Bruno', 'Petra', 'Anders', 'Ivy', 'Casimir'][this.rng.int(8)];
    const last = ['Weller', 'Stroud', 'Halvorsen', 'Quint', 'Mercer', 'Dunmore'][this.rng.int(6)];
    const n: Notable = {
      id: this.nextId++,
      name: `${first} ${last}`,
      age: 25 + this.rng.int(20),
      traits: [],
      role,
      settlementId,
      bio: [`Rose to ${role} of ${t.name}, ${this.year}.`],
      alive: true,
    };
    this.notables.push(n);
    this.addLog(`${n.name} rises to ${role} of ${t.name}.`, 'info');
  }

  /** The region's incident deck. Wider than the original five (the GDD's
   *  "more event variety"): the network, the Notables, and the State all
   *  show up in the stream of small history. */
  private fireEvent(): void {
    const t = this.settlements[this.rng.int(this.settlements.length)];
    if (!t || this.popOf(t) < 1) return;
    // The deck keeps the original 45/55 bad-to-good balance — immigration
    // (wagon trains) stays generous because statehood paces on population.
    const roll = this.rng.next();
    if (roll < 0.22) this.eventRaid(t);
    else if (roll < 0.32) this.eventFever(t);
    else if (roll < 0.44) this.eventHarvest(t);
    else if (roll < 0.62) this.eventWagonTrain(t);
    else if (roll < 0.68) this.eventBandits(t);
    else if (roll < 0.76) this.eventNotableBeat(t);
    else if (roll < 0.83) this.eventFire(t);
    else if (roll < 0.9) this.eventProspectors(t);
    else this.eventFair(t);
  }

  /** Raid, resolved abstractly by militia strength (GDD §7: abstraction rises with tier). */
  private eventRaid(t: Settlement): void {
    let strength = 2 + this.rng.int(Math.max(2, Math.floor(this.totalPop() / 40)));
    // Raid sponsorship is deniable (GDD §6.4): a hostile power arms the raiders
    const sponsor = this.hostileRivals()[0];
    const sponsored = sponsor !== undefined && this.rng.chance(0.5);
    if (sponsored) strength *= 1.3;
    const captain = 1 + 0.25 * this.roleMult(t, 'Captain');
    // Defence Minister adds 20% militia effectiveness (GDD §8.7)
    const defenceBonus = this.ministerFor('defence') ? 1.2 : 1;
    // Military Reform law: professional officers +20%; Standing Army policy: +2 effective militia
    const militaryReformBonus = this.passedLaws.includes('military_reform') ? 1.2 : 1;
    const standingArmyBonus = this.policyActive('standing_army') ? 2 : 0;
    const funded = this.stateProclaimed
      ? (1 + 0.2 * (this.militiaLevel + standingArmyBonus) + (this.govLean === 'mayor' ? 0.2 : 0)) * defenceBonus * militaryReformBonus
      : 1;
    // M6c: the network is defense — a built link to a bigger town brings relief
    const relief = this.reliefLine(t);
    // A Defensive Pact (GDD §5.4) puts allied arms behind the militia
    const pact = this.rivals.some((rv) => rv.treaties.includes('defensive_pact'));
    const militia = this.workersOf(t) * 0.12 * captain * funded * (relief ? 1.25 : 1) * (pact ? 1.15 : 1);
    t.lastRaidDay = this.day;
    const foreignArms = sponsored ? ` The dead carried rifles of foreign make — ${sponsor!.name}'s hand, deniably.` : '';
    if (militia >= strength) {
      this.addLog(
        (relief
          ? `Raiders struck ${t.name} and were driven off — relief militia rode in along the line.`
          : `Raiders struck ${t.name} and were driven off by the militia.`) + foreignArms,
        'good',
      );
    } else {
      const losses = Math.min(this.popOf(t) * 0.06, strength - militia);
      this.removePop(t, losses);
      t.food *= 0.85;
      this.addLog(`Raiders overran ${t.name}'s pickets — ${Math.max(1, Math.round(losses))} lost, stores plundered.` + foreignArms, 'bad');
    }
  }

  private eventFever(t: Settlement): void {
    const sick = Math.round(this.popOf(t) * 0.05);
    t.cohorts.bands[4] *= 0.92;
    t.cohorts.bands[0] *= 0.97;
    t.satisfaction -= 5;
    this.addLog(`Fever in ${t.name} — ${sick} bedridden; the old and the young suffer worst.`, 'bad');
  }

  private eventHarvest(t: Settlement): void {
    t.food += this.workersOf(t) * 4;
    this.addLog(`A bumper harvest in ${t.name}.`, 'good');
  }

  private eventWagonTrain(t: Settlement): void {
    const wave = 3 + this.rng.int(6);
    t.cohorts.bands[1] += wave * 0.7;
    t.cohorts.bands[2] += wave * 0.3;
    this.addLog(`A wagon train of ${wave} arrives at ${t.name}, drawn by word of the frontier.`, 'good');
  }

  private eventFair(t: Settlement): void {
    t.satisfaction = Math.min(100, t.satisfaction + 6);
    this.addLog(`${t.name} holds a harvest fair. Spirits lift.`, 'good');
  }

  /** Highwaymen work the routes — but they rob freight, not subsistence:
   *  a quiet trail carries nothing worth taking, and a kept road or rail
   *  gives no cover. Maintenance money buys safety, not just throughput. */
  private eventBandits(t: Settlement): void {
    const mine = this.routes.filter((r) => (r.a === t.id || r.b === t.id) && r.freight > 0);
    if (mine.length === 0) return this.eventFair(t); // no caravan traffic, nothing to rob
    const worst = mine.reduce((a, b) => (a.condition <= b.condition ? a : b));
    const otherName = this.settlement(worst.a === t.id ? worst.b : worst.a)?.name ?? 'the hills';
    if (worst.kind !== 'trail' && worst.condition > 60) {
      this.addLog(`Highwaymen tried the ${worst.kind} to ${otherName}, but the patrolled grade gave no cover. They hang at ${t.name}.`, 'good');
      return;
    }
    const toll = Math.min(t.food * 0.05, 15 + this.rng.int(10));
    t.food = Math.max(0, t.food - toll);
    t.satisfaction -= 2;
    this.addLog(`Highwaymen prey on the ${worst.kind} to ${otherName} — ${Math.round(toll)} food taken from ${t.name}'s wagons.`, 'bad');
  }

  /** A Notable's small hour: the attachment engine accrues bio beats (GDD §2.4). */
  private eventNotableBeat(t: Settlement): void {
    const locals = this.notablesAt(t.id);
    if (locals.length === 0) return this.eventFair(t);
    const n = locals[this.rng.int(locals.length)];
    const beat: Record<NotableRole, { text: string; apply: () => void }> = {
      Mayor: {
        text: `${n.name} settles a boundary feud on the courthouse steps of ${t.name}.`,
        apply: () => { t.grievance = Math.max(0, t.grievance - 8); t.satisfaction += 3; },
      },
      Doctor: {
        text: `${n.name} rides three days vaccinating the outlying farms of ${t.name}.`,
        apply: () => { t.satisfaction += 3; },
      },
      Captain: {
        text: `${n.name} drills ${t.name}'s militia on the green till dusk.`,
        apply: () => { t.lastRaidDay = Math.min(t.lastRaidDay, this.day - 10); },
      },
      Granger: {
        text: `${n.name} takes the county prize for winter wheat — ${t.name}'s granary swells.`,
        apply: () => { t.food += this.workersOf(t) * 2; },
      },
      Forewoman: {
        text: `${n.name} fells the giant deadfall above ${t.name} — a season's lumber in a week.`,
        apply: () => { t.wood += this.workersOf(t) * 1.5; },
      },
      Reeve: {
        text: `${n.name} writes home glowing letters about ${t.name}; they get printed back east.`,
        apply: () => { t.cohorts.bands[1] += 2; },
      },
    };
    const b = beat[n.role];
    b.apply();
    n.bio.push(`${b.text.replace(`${n.name} `, '')} (${this.year})`);
    this.addLog(b.text, 'good');
  }

  /** Fire: wood-built towns burn; a funded State has a brigade. */
  private eventFire(t: Settlement): void {
    const brigade = this.stateProclaimed && this.servicesLevel >= 1;
    const woodLost = t.wood * (brigade ? 0.08 : 0.2);
    t.wood = Math.max(0, t.wood - woodLost);
    t.housing = Math.max(this.popOf(t) * 0.5, t.housing - (brigade ? 1 : 4));
    t.satisfaction -= brigade ? 2 : 6;
    this.addLog(
      brigade
        ? `Fire in ${t.name}'s mill row — the brigade holds it to one block.`
        : `Fire tears through ${t.name} — timber and homes lost before the rain came.`,
      'bad',
    );
  }

  /** Prospectors: the land pays out a little — coin for a State, timber rights before one. */
  private eventProspectors(t: Settlement): void {
    if (this.stateProclaimed) {
      const find = 15 + this.rng.int(20);
      this.treasury += find;
      this.addLog(`Prospectors file a claim in the hills above ${t.name} — £${find} in fees and assay to the treasury.`, 'good');
    } else {
      const timber = 20 + this.rng.int(15);
      t.wood += timber;
      this.addLog(`Prospectors trade timber rights at ${t.name} — ${timber} wood for the stores.`, 'good');
    }
  }

  // ---- expeditions & expansion ----
  canFoundTown(fromId: number): { ok: boolean; reason: string } {
    const t = this.settlement(fromId);
    if (!t) return { ok: false, reason: 'no settlement' };
    if (this.settlements.length + this.expeditions.length >= MAX_SETTLEMENTS) {
      return { ok: false, reason: 'region fully settled (see map-scale design)' };
    }
    if (this.popOf(t) < 24) return { ok: false, reason: `needs 24 pop (has ${Math.floor(this.popOf(t))})` };
    if (t.food < 80) return { ok: false, reason: `needs 80 food (has ${Math.floor(t.food)})` };
    if (t.wood < 80) return { ok: false, reason: `needs 80 wood (has ${Math.floor(t.wood)})` };
    const fromCell = this.map.coordToCell(t.x, t.y);
    const claimed = this.settlements
      .map((s) => this.map.coordToCell(s.x, s.y))
      .concat(this.expeditions.map((e) => this.map.coordToCell(e.targetX, e.targetY)));
    if (!this.map.bestSiteNear(fromCell.x, fromCell.y, claimed)) {
      return { ok: false, reason: 'no viable land within reach' };
    }
    return { ok: true, reason: '' };
  }

  foundTown(fromId: number): boolean {
    const check = this.canFoundTown(fromId);
    const t = this.settlement(fromId);
    if (!check.ok || !t) return false;
    if (!this.launchExpedition(t, 8, 80, 80)) return false;
    this.removePop(t, 8);
    t.food -= 80;
    t.wood -= 80;
    const e = this.expeditions[this.expeditions.length - 1];
    const days = e.arrivesDay - this.day;
    this.addLog(
      `An expedition of 8 sets out from ${t.name} for ${e.name} — ${days} days through ` +
      `${e.site.roughness > 0.5 ? 'hard country' : 'open country'}` +
      `${e.site.river ? ', bound for a river site' : ''}${e.site.coastal ? ', on the coast' : ''}.`,
      'info',
    );
    return true;
  }

  private updateExpeditions(): void {
    for (const e of [...this.expeditions]) {
      const totalDays = Math.max(1, e.arrivesDay - e.departDay);
      const f = Math.min(1, (this.day - e.departDay) / totalDays);
      e.x = e.x + (e.targetX - e.x) * Math.min(1, f * 0.5 + 0.1);
      e.y = e.y + (e.targetY - e.y) * Math.min(1, f * 0.5 + 0.1);
      if (this.day >= e.arrivesDay) {
        const town: Settlement = {
          id: this.nextId++,
          name: e.name,
          x: e.targetX,
          y: e.targetY,
          foundedDay: this.day,
          cohorts: { bands: [e.pop * 0.1, e.pop * 0.55, e.pop * 0.35, 0, 0] },
          food: e.food,
          wood: e.wood,
          satisfaction: 60,
          housing: e.pop + 4,
          landQuality: e.site.fertility,
          site: e.site,
          lastRaidDay: -99,
          lastFloodDay: -99,
          strikeUntil: -1,
          grievance: 0,
          prices: defaultPrices(),
        };
        this.settlements.push(town);
        this.expeditions = this.expeditions.filter((o) => o !== e);
        const flavor = e.site.river ? 'on the riverbank' : e.site.coastal ? 'by the sea' : e.site.fertility > 1 ? 'in good black soil' : 'on thin ground';
        this.addLog(`${town.name} is founded ${flavor} — the ${this.ordinal(this.settlements.length)} town of the colony.`, 'good');
        // the expedition's tracks become the new town's trail home
        this.blazeTrail(e.fromId, town.id);
        // A founder steps up
        this.mintNotable('Reeve', town.id);
      }
    }
  }

  private ordinal(n: number): string {
    return n === 2 ? 'second' : n === 3 ? 'third' : `${n}th`;
  }

  // ---- the State gate (GDD §2.2) ----
  charterEligible(): boolean {
    // GDD §2.2: 3 towns, 500 citizens — and all of them connected by routes
    return this.settlements.length >= 3 && this.totalPop() >= 500 && this.connectedToAll();
  }

  private updateCharter(): void {
    if (this.stateProclaimed || this.ceremonyPending) return;
    if (this.charterEligible()) {
      // The Mayor drafts the Regional Charter — the slice's civics gate.
      this.charterProgress = Math.min(100, this.charterProgress + 100 / 90); // ~90 days of drafting
      if (this.charterProgress >= 100) {
        this.ceremonyPending = true;
        this.addLog('The Regional Charter is drafted. The towns await your word. (Incorporation ceremony)', 'good');
      }
    } else {
      this.charterProgress = Math.max(0, this.charterProgress - 0.5);
    }
  }

  /** The promotion-as-moment (GDD §2.2): the player names the State and sets its lean. */
  completeIncorporation(stateName: string, lean: GovLean): void {
    if (!this.ceremonyPending || this.stateProclaimed) return;
    this.ceremonyPending = false;
    this.stateProclaimed = true;
    this.stateName = stateName.trim() || 'The Valley State';
    this.govLean = lean;
    this.treasury = 50;
    const mayor = this.notables.find((n) => n.alive && n.role === 'Mayor');
    this.addLog(
      `INCORPORATION: with ${this.settlements.length} towns and ${this.totalPop()} citizens, ` +
      `${mayor ? mayor.name + ' signs' : 'the council signs'} the Regional Charter under the banner of ` +
      `${GOV_LEANS[lean].name}. ${this.stateName} is proclaimed — Tier 2 begins here.`,
      'good',
    );
    if (mayor) mayor.bio.push(`Signed the Regional Charter of ${this.stateName}, ${this.year}.`);
  }

  // ---- Faction system (GDD §5.3) ----

  /** Recompute faction power and support from current game state (called monthly). */
  private updateFactions(): void {
    const pop = this.totalPop();
    const food = this.settlements.reduce((s, t) => s + t.food, 0);
    const trade = this.tradeValueLastMonth;

    const workerPower = Math.min(70, 30 + pop * 0.05);
    const workerSupport = Math.max(0, Math.min(100,
      50 + (this.servicesLevel - 1) * 20
      - Math.max(0, this.taxRate - 0.15) * 100
      + (this.passedLaws.includes('workers_charter') ? 20 : 0)
      - (this.passedLaws.includes('conscription_act') ? 5 : 0)
      + (this.passedLaws.includes('estate_tax') ? 10 : 0)
      + (this.passedLaws.includes('progressive_tax') ? 15 : 0)
      + (this.passedLaws.includes('welfare_benefits') ? 10 : 0)
      + (this.passedLaws.includes('national_education_act') ? 10 : 0)
      + (this.passedLaws.includes('healthcare_act') ? 10 : 0)
      + (this.passedLaws.includes('land_reform') ? 20 : 0),
    ));

    const landownerPower = Math.min(50, 15 + food * 0.005);
    const landownerSupport = Math.max(0, Math.min(100,
      70 - this.taxRate * 160
      - (this.passedLaws.includes('estate_tax') ? 25 : 0)
      - (this.passedLaws.includes('workers_charter') ? 10 : 0)
      - (this.passedLaws.includes('progressive_tax') ? 10 : 0)
      - (this.passedLaws.includes('land_reform') ? 30 : 0),
    ));

    const merchantPower = Math.min(40, 10 + trade * 0.12);
    const merchantSupport = Math.max(0, Math.min(100,
      50 + trade * 0.05
      + (this.passedLaws.includes('merchants_charter') ? 25 : 0)
      - (this.passedLaws.includes('workers_charter') ? 10 : 0)
      - (this.passedLaws.includes('progressive_tax') ? 10 : 0)
      + (this.passedLaws.includes('press_freedom_act') ? 10 : 0),
    ));

    this.factions = [
      {
        id: 'workers', name: 'Workers', power: workerPower, support: workerSupport,
        demand: workerSupport < 40 ? 'better services & lower taxes' : 'content',
      },
      {
        id: 'landowners', name: 'Landowners', power: landownerPower, support: landownerSupport,
        demand: landownerSupport < 40 ? 'tax cuts' : 'content',
      },
      {
        id: 'merchants', name: 'Merchants', power: merchantPower, support: merchantSupport,
        demand: merchantSupport < 40 ? 'open markets' : 'content',
      },
    ];
  }

  // ---- Elections (GDD §5.3) ----

  /** Schedule the first election once universal suffrage + state both exist. */
  private checkElection(): void {
    if (!this.stateProclaimed || !this.has('universal_suffrage')) return;
    // Non-democratic governments don't hold elections after proclamation
    if (this.nationProclaimed && this.govType !== null) {
      const def = GOV_TYPES.find((g) => g.id === this.govType)!;
      if (!def.electionsRequired) return;
    }
    if (this.nextElectionDay < 0) {
      this.nextElectionDay = this.day + 240; // ~4 game-years
    }
    if (this.day >= this.nextElectionDay) this.runElection();
  }

  /** Run an election: award political capital proportional to approval. */
  private runElection(): void {
    const n = this.settlements.length;
    const avgSat = n > 0
      ? this.settlements.reduce((s, t) => s + t.satisfaction, 0) / n
      : 50;
    const earned = Math.round(20 + (avgSat / 100) * 80);
    this.politicalCapital = Math.min(200, this.politicalCapital + earned);
    this.lastElectionYear = this.year;
    this.nextElectionDay = this.day + 240;
    const result = avgSat >= 65 ? 'LANDSLIDE' : avgSat >= 50 ? 'MAJORITY' : avgSat >= 35 ? 'MINORITY' : 'LOST';
    this.addLog(
      `ELECTION ${this.year}: ${result} (approval ${Math.round(avgSat)}%) — ${earned} political capital earned.` +
      (result === 'LOST' ? ' The government limps on.' : ''),
      avgSat >= 50 ? 'good' : 'bad',
    );
    // Democracy/Republic: legitimacy refreshed by elections (GDD §5.3)
    if (this.nationProclaimed && (this.govType === 'democracy' || this.govType === 'republic')) {
      const legBonus = result === 'LANDSLIDE' ? 20 : result === 'MAJORITY' ? 12 : result === 'MINORITY' ? 4 : -12;
      this.legitimacy = Math.max(0, Math.min(100, this.legitimacy + legBonus));
    }
  }

  // ---- Law system (GDD §5.3) ----

  /** Laws available to be enacted: not yet passed, prereqs met, tier gates satisfied. */
  availableLaws(): (RegionLaw & { canAfford: boolean })[] {
    return REGION_LAWS
      .filter(
        (l) =>
          !this.passedLaws.includes(l.id) &&
          (!l.requiresState || this.stateProclaimed) &&
          (!l.requiresNation || this.nationProclaimed) &&
          l.prereqs.every((p) => this.has(p)),
      )
      .map((l) => ({ ...l, canAfford: this.politicalCapital >= l.cost }));
  }

  /** Policy cards eligible for a given slot domain (prereqs met, nation proclaimed). */
  availablePoliciesFor(domain: PolicyDomain): PolicyCard[] {
    if (!this.nationProclaimed) return [];
    return POLICY_CARDS.filter(
      (c) => c.domain === domain && c.prereqs.every((p) => this.has(p)),
    );
  }

  /** Socket or clear a policy slot. Swapping an occupied slot costs POLICY_SWAP_COST PC. */
  setPolicy(slotIndex: number, cardId: string | null): boolean {
    if (!this.nationProclaimed || this.govType === null) return false;
    const govDef = GOV_TYPES.find((g) => g.id === this.govType)!;
    if (slotIndex < 0 || slotIndex >= govDef.policySlots.length) return false;
    if (cardId !== null) {
      const card = POLICY_CARDS.find((c) => c.id === cardId);
      if (!card) return false;
      if (card.domain !== govDef.policySlots[slotIndex]) return false;
      if (!card.prereqs.every((p) => this.has(p))) return false;
      if (this.activePolicies[slotIndex] !== null && this.politicalCapital < POLICY_SWAP_COST) return false;
      if (this.activePolicies[slotIndex] !== null) this.politicalCapital -= POLICY_SWAP_COST;
      this.activePolicies[slotIndex] = cardId;
      this.addLog(`POLICY: "${card.name}" is now national policy (${govDef.policySlots[slotIndex]} slot).`, 'good');
    } else {
      this.activePolicies[slotIndex] = null;
      this.addLog('Policy slot cleared.', 'info');
    }
    return true;
  }

  policyActive(id: string): boolean {
    return this.activePolicies.includes(id);
  }

  private policyUpkeep(): number {
    return this.activePolicies.reduce((sum, id) => {
      if (!id) return sum;
      return sum + (POLICY_CARDS.find((c) => c.id === id)?.upkeep ?? 0);
    }, 0);
  }

  /** Enact a law: spend political capital and apply the permanent effect. */
  enactLaw(id: string): boolean {
    if (this.passedLaws.includes(id)) return false;
    const law = REGION_LAWS.find((l) => l.id === id);
    if (!law) return false;
    if (law.requiresState && !this.stateProclaimed) return false;
    if (!law.prereqs.every((p) => this.has(p))) return false;
    if (this.politicalCapital < law.cost) return false;

    this.politicalCapital -= law.cost;
    this.passedLaws.push(id);

    switch (id) {
      case 'workers_charter':
        this.servicesLevel = Math.min(2, this.servicesLevel + 1);
        break;
      case 'merchants_charter':
        this.tradeLevyRate = 0.03;
        break;
      case 'estate_tax':
        this.estateTaxActive = true;
        break;
      case 'conscription_act':
        this.militiaLevel = Math.min(2, this.militiaLevel + 1);
        break;
    }

    this.addLog(`LAW ENACTED: "${law.name}". ${law.desc.split('.')[0]}.`, 'good');
    return true;
  }

  // ---- Nation-tier: Constitutional Convention (GDD §2.2) ----

  /** True when the player may call the Constitutional Convention. */
  canCallConvention(): boolean {
    return (
      this.stateProclaimed &&
      !this.nationProclaimed &&
      this.has('statecraft') &&
      this.totalPop() >= 1500
    );
  }

  /** Confirm the Constitutional Convention — names the nation, sets gov type, assigns ministers. */
  proclaimNation(
    name: string,
    gov: GovType,
    assignments: Partial<Record<MinisterRoleId, number | null>>,
  ): void {
    const def = GOV_TYPES.find((g) => g.id === gov)!;
    this.nationName = name;
    this.govType = gov;
    this.legitimacy = def.startingLegitimacy;
    this.nationProclaimed = true;
    this.activePolicies = new Array(def.policySlots.length).fill(null);
    this.militiaLevel = Math.min(4, this.militiaLevel + def.militiaBonus);
    for (const m of this.ministers) {
      m.notableId = assignments[m.role] ?? null;
    }
    if (!def.electionsRequired) this.nextElectionDay = -1;
    this.addLog(
      `THE PROCLAMATION OF ${name.toUpperCase()}: The Constitutional Convention has spoken. ` +
      `${def.name} — the form of government is set. A new era begins.`,
      'good',
    );
  }

  /** Return the Notable assigned to a ministry role (null if vacant or dead). */
  ministerFor(role: MinisterRoleId): Notable | null {
    const m = this.ministers.find((x) => x.role === role);
    if (!m || m.notableId === null) return null;
    return this.notables.find((n) => n.id === m.notableId && n.alive) ?? null;
  }

  /** Monthly legitimacy tick (GDD §5.3). */
  private tickLegitimacy(): void {
    if (!this.nationProclaimed) return;
    // Press Freedom Act law slows legitimacy decay by 30%
    const decayRate = this.passedLaws.includes('press_freedom_act') ? 0.35 : 0.5;
    this.legitimacy = Math.max(0, this.legitimacy - decayRate);
    if (this.govType === 'junta') {
      const ws = this.factions.find((f) => f.id === 'workers')?.support ?? 50;
      const ls = this.factions.find((f) => f.id === 'landowners')?.support ?? 50;
      const avg = ws * 0.5 + ls * 0.5;
      if (avg > 60) this.legitimacy = Math.min(100, this.legitimacy + 0.3);
      if (avg < 30) this.legitimacy = Math.max(0, this.legitimacy - 0.5);
    }
    if (this.govType === 'monarchy') {
      const elders = this.notables.filter((n) => n.alive && n.age >= 50).length;
      if (elders > 0) this.legitimacy = Math.min(100, this.legitimacy + 0.2 * elders);
    }
    if (this.legitimacy < 30 && this.rng.chance(0.05)) {
      this.addLog(
        'LEGITIMACY CRISIS: opposition groups are openly challenging the regime.',
        'bad',
      );
    }
  }

  // ---- Rival nations & diplomacy (GDD §5.4, §6.2–6.4) ----

  rival(id: number): RivalNation | undefined {
    return this.rivals.find((rv) => rv.id === id);
  }

  /** Rivals open to mischief: cold relations and nothing signed to stop them. */
  hostileRivals(): RivalNation[] {
    return this.rivals.filter((rv) => rv.relations < -40 && !rv.treaties.includes('non_aggression'));
  }

  private clampRel(v: number): number {
    return Math.max(-100, Math.min(100, v));
  }

  regimeOf(rv: RivalNation): RivalRegimeDef {
    return RIVAL_REGIMES.find((g) => g.id === rv.regime) ?? RIVAL_REGIMES[0];
  }

  /** The player's bloc, for ideology distance — null before the Proclamation. */
  private playerBloc(): RegimeBloc | null {
    if (!this.nationProclaimed || !this.govType) return null;
    return this.govType === 'junta' ? 'autocratic' : this.govType === 'monarchy' ? 'traditional' : 'liberal';
  }

  /** Personality-weighted, era-gated regime choice (GDD §6.3): juntas for the
   *  risk-takers, theocracies for the ideologues — and no fascism before 1925. */
  private pickRegime(w: RivalPersonality, excludeId?: string): RivalRegimeDef {
    const pool = RIVAL_REGIMES.filter((g) => this.year >= g.eraFrom && g.id !== excludeId);
    const scored = pool.map((g) => {
      let s = this.rng.int(4); // history is not a formula
      switch (g.id) {
        case 'parliamentary': s += w.honor; break;
        case 'merchant_republic': s += w.commerce; break;
        case 'const_monarchy': s += (w.honor + (10 - w.risk)) / 2; break;
        case 'abs_monarchy': s += w.expansion * 0.5 + (10 - w.commerce) * 0.4; break;
        case 'theocracy': s += w.ideology; break;
        case 'junta': s += (w.expansion + w.risk) / 2; break;
        case 'peoples_republic': s += w.ideology * 0.7 + w.grudge * 0.3; break;
        case 'one_party': s += (w.ideology + w.expansion) / 2; break;
        case 'fascist': s += (w.expansion + w.grudge) / 2; break;
        case 'corporate': s += w.commerce * 0.7 + w.risk * 0.3; break;
      }
      return { g, s };
    });
    scored.sort((x, y) => y.s - x.s);
    return scored[0].g;
  }

  pairKey(a: number, b: number): string {
    return a < b ? `${a}:${b}` : `${b}:${a}`;
  }

  /** Relations between two rival powers — the world's own ledger. */
  pairRelations(aId: number, bId: number): number {
    return this.rivalPairs[this.pairKey(aId, bId)] ?? 0;
  }

  warBetween(aId: number, bId: number): ForeignWar | undefined {
    return this.foreignWars.find(
      (w) => (w.a === aId && w.b === bId) || (w.a === bId && w.b === aId),
    );
  }

  /** A new great power proclaims itself at the edge of the map (GDD §6.2).
   *  Public so scenarios and tests can seed the world directly. */
  spawnRival(archetype?: RivalArchetype): RivalNation | null {
    if (this.rivals.length >= MAX_RIVALS) return null;
    const kinds = Object.keys(RIVAL_ARCHETYPES) as RivalArchetype[];
    const arch = archetype ?? kinds[this.rng.int(kinds.length)];
    const base = RIVAL_ARCHETYPES[arch].weights;
    const jitter = (v: number) => Math.max(0, Math.min(10, v + this.rng.int(3) - 1));
    const weights: RivalPersonality = {
      expansion: jitter(base.expansion),
      commerce: jitter(base.commerce),
      ideology: jitter(base.ideology),
      risk: jitter(base.risk),
      honor: jitter(base.honor),
      grudge: jitter(base.grudge),
    };
    const regime = this.pickRegime(weights);
    const names = RIVAL_NAMES.filter((n) => !this.rivals.some((rv) => rv.name === n));
    const leaders = RIVAL_LEADERS.filter((n) => !this.rivals.some((rv) => rv.leader === n));
    // banners stack, but spread the powers around the horizon first
    const counts = { north: 0, east: 0, south: 0, west: 0 };
    for (const rv of this.rivals) counts[rv.compass]++;
    const compass = (['north', 'east', 'south', 'west'] as const)
      .reduce((a, b) => (counts[b] < counts[a] ? b : a));
    const origin = RIVAL_ORIGINS[this.rng.int(RIVAL_ORIGINS.length)];
    const rv: RivalNation = {
      id: this.nextId++,
      name: names[this.rng.int(names.length)] ?? `Power ${this.rivals.length + 1}`,
      leader: leaders[this.rng.int(leaders.length)] ?? 'the Directorate',
      archetype: arch,
      weights,
      regime: regime.id,
      agenda: RIVAL_AGENDAS[arch],
      compass,
      pop: 2500 + this.rng.int(3000),
      relations: this.clampRel(10 + weights.commerce - weights.expansion - weights.grudge + this.rng.int(11) - 5),
      treaties: [],
      borderSettled: false,
      emergedYear: this.year,
      history: [`Proclaimed ${this.year}, ${COMPASS_FLAVOR[compass]} — ${origin}.`],
      lastEnvoyDay: -999,
      lastGiftDay: -999,
    };
    // The newcomer arrives into a world with opinions already formed
    for (const other of this.rivals) {
      const ob = this.regimeOf(other).bloc;
      const rel =
        (rv.weights.commerce + other.weights.commerce) * 1.2 -
        (rv.weights.expansion + other.weights.expansion) * 1.5 +
        blocAffinity(regime.bloc, ob) +
        this.rng.int(21) - 10;
      this.rivalPairs[this.pairKey(rv.id, other.id)] = this.clampRel(Math.max(-60, Math.min(40, rel)));
    }
    this.rivals.push(rv);
    this.addLog(
      `A NEW POWER: ${COMPASS_FLAVOR[rv.compass]}, ${rv.leader} proclaims ${rv.name}, a ${regime.name.toLowerCase()} ` +
      `${origin} — ${RIVAL_ARCHETYPES[arch].name}. Its agenda, the envoys say: "${rv.agenda}."`,
      'info',
    );
    return rv;
  }

  /** What this rival wants on the ledger before it signs (GDD §6.3: the
   *  AI prices every basket from its own personality and situation). */
  treatyAsk(rv: RivalNation, kind: TreatyKind): number {
    let ask = TREATY_DEFS[kind].baseAsk + rv.weights.grudge * 2 + this.treatiesBroken * TREATY_BREACH_PENALTY;
    if (kind === 'trade_agreement') ask -= rv.weights.commerce * 2.5;
    if (kind === 'non_aggression') ask -= 10 - rv.weights.risk; // the cautious want fences
    if (kind === 'defensive_pact') ask -= rv.weights.honor * 1.5;
    return Math.round(ask);
  }

  // ---- the bargaining table (GDD §6.3): baskets, valuation, counter-offers ----

  /** What signing this treaty is worth *to the rival*, in diplomatic points —
   *  positive is appetite, negative is a concession it wants paying for. */
  treatyAppetite(rv: RivalNation, kind: TreatyKind): number {
    switch (kind) {
      case 'trade_agreement':
        // fuel access is worth triple to an oil-poor industrializer — here,
        // markets are worth most to the commerce-minded
        return rv.weights.commerce * 1.6 - 4;
      case 'non_aggression':
        return (10 - rv.weights.risk) * 0.8 + rv.weights.honor * 0.3 - 3;
      case 'defensive_pact':
        // an entangling commitment: the honorable mean it, the rash resent it
        return rv.weights.honor * 0.8 - rv.weights.risk * 0.5 - 5;
    }
  }

  /** A fixed frontier, valued by temperament: hermits love fences,
   *  hegemons will not pin a border they mean to move. */
  borderAppetite(rv: RivalNation): number {
    return (4 - rv.weights.expansion) * 1.2 + rv.weights.grudge * 0.4;
  }

  /** What £1 buys at this court, in points — commerce raises the bid. */
  private goldRate(rv: RivalNation): number {
    return (0.6 + rv.weights.commerce * 0.08) / GOLD_PER_POINT;
  }

  /** Reputation premium on everything the rival gives up (GDD §5.4:
   *  treaty-breaking is priced into all future deals, +30%/breach). */
  dealPremium(rv: RivalNation): number {
    return Math.max(0.5, 1 + this.treatiesBroken * 0.3 + rv.weights.grudge * 0.03 - rv.relations / 150);
  }

  /** Sitting down at all has a price when they hate you. */
  private tableCost(rv: RivalNation): number {
    return Math.max(0, -rv.relations / 8) + this.treatiesBroken * 2 + rv.weights.grudge * 0.4;
  }

  /** Strip a basket to the items that still mean anything. */
  private normalizeBasket(rv: RivalNation, b: DealBasket): DealBasket {
    return {
      treaties: [...new Set(b.treaties)].filter((k) => !rv.treaties.includes(k)),
      goldToThem: Math.max(0, Math.round(b.goldToThem || 0)),
      goldToYou: Math.max(0, Math.round(b.goldToYou || 0)),
      borderSettlement: b.borderSettlement && !rv.borderSettled,
    };
  }

  /** The AI reads a basket (GDD §6.3): accepts when what it gets covers what
   *  it gives at its premium, counters with a sweetener when within 30%,
   *  and walks away — stating why, truthfully but vaguely — when far off.
   *  Pure: the UI live-previews the verdict while the player composes. */
  evaluateDeal(rv: RivalNation, basket: DealBasket): DealVerdict {
    const b = this.normalizeBasket(rv, basket);
    const empty = b.treaties.length === 0 && !b.borderSettlement && b.goldToThem === 0 && b.goldToYou === 0;
    let get = 0;
    let give = 0;
    const weigh = (v: number) => { if (v >= 0) get += v; else give += -v; };
    for (const k of b.treaties) weigh(this.treatyAppetite(rv, k));
    if (b.borderSettlement) weigh(this.borderAppetite(rv));
    get += b.goldToThem * this.goldRate(rv);
    give += b.goldToYou * this.goldRate(rv);
    const cost = give * this.dealPremium(rv) + this.tableCost(rv);
    if (empty) return { accept: false, get: 0, cost, counter: null, reason: 'there is nothing on the table' };
    if (get >= cost) return { accept: true, get, cost, counter: null, reason: '' };
    // Within 30%: they name their sweetener instead of walking (GDD §6.3)
    if (get >= cost * 0.7) {
      const shortfall = cost - get;
      const sweetener = Math.ceil(shortfall / this.goldRate(rv) / 5) * 5;
      return {
        accept: false, get, cost,
        counter: { ...b, goldToThem: b.goldToThem + sweetener },
        reason: 'close — they want a sweetener',
      };
    }
    const reason = this.treatiesBroken > 0
      ? `${rv.name} remembers broken seals`
      : b.borderSettlement && this.borderAppetite(rv) < 0
        ? 'they will not trade away the frontier'
        : rv.relations < -20
          ? 'their people will not deal with you yet'
          : `${rv.name} sees no profit in it`;
    return { accept: false, get, cost, counter: null, reason };
  }

  /** Put a basket on the table. Accepted deals execute at once; near-misses
   *  come back as counter-offers the player can sign from the panel. */
  proposeDeal(id: number, basket: DealBasket): boolean {
    const rv = this.rival(id);
    if (!rv || !this.stateProclaimed) return false;
    if (this.playerWar?.rivalId === id) return false; // peace has its own table
    const b = this.normalizeBasket(rv, basket);
    if (this.treasury < b.goldToThem) return false;
    const v = this.evaluateDeal(rv, b);
    if (v.accept) {
      this.executeDeal(rv, b);
      return true;
    }
    if (v.counter) {
      this.counters = this.counters.filter((c) => c.rivalId !== rv.id);
      this.counters.push({ rivalId: rv.id, basket: v.counter, expiresDay: this.day + DEAL_COUNTER_DAYS });
      this.addLog(
        `${rv.name} counters: "${this.basketLabel(v.counter)} — and we have an accord." The offer stands ${DEAL_COUNTER_DAYS} days.`,
        'info',
      );
      return false;
    }
    this.addLog(`${rv.name} walks from the table — "${v.reason}."`, 'bad');
    return false;
  }

  /** The pending counter-offer from a rival, if any. */
  counterFor(rivalId: number): DealCounter | undefined {
    return this.counters.find((c) => c.rivalId === rivalId);
  }

  /** Sign the rival's counter-offer as it stands. */
  acceptCounter(rivalId: number): boolean {
    const c = this.counterFor(rivalId);
    const rv = this.rival(rivalId);
    if (!c || !rv || this.treasury < c.basket.goldToThem) return false;
    this.counters = this.counters.filter((x) => x !== c);
    this.executeDeal(rv, this.normalizeBasket(rv, c.basket));
    return true;
  }

  /** Let the counter lapse — a slight, but a small one. */
  declineCounter(rivalId: number): boolean {
    const c = this.counterFor(rivalId);
    const rv = this.rival(rivalId);
    if (!c || !rv) return false;
    this.counters = this.counters.filter((x) => x !== c);
    rv.relations = this.clampRel(rv.relations - 2);
    this.addLog(`${rv.name}'s counter-offer is declined. Their envoys fold the papers away.`, 'info');
    return true;
  }

  /** A basket in plain words, for logs and the panel. */
  basketLabel(b: DealBasket): string {
    const parts = b.treaties.map((k) => TREATY_DEFS[k].name);
    if (b.borderSettlement) parts.push('Border Settlement');
    if (b.goldToThem > 0) parts.push(`£${b.goldToThem} to them`);
    if (b.goldToYou > 0) parts.push(`£${b.goldToYou} to you`);
    return parts.join(' + ') || 'nothing';
  }

  /** Ink, gold, and surveys change hands. */
  private executeDeal(rv: RivalNation, b: DealBasket): void {
    for (const k of b.treaties) rv.treaties.push(k);
    this.treasury += b.goldToYou - b.goldToThem;
    if (b.borderSettlement) {
      rv.borderSettled = true;
      this.noteHistory(rv, `Settled the frontier with ${this.stateName || 'the State'}, ${this.year}.`);
    }
    rv.relations = this.clampRel(rv.relations + 4 + b.treaties.length * 2);
    this.addLog(`ACCORD: ${this.stateName || 'the State'} and ${rv.name} sign — ${this.basketLabel(b)}.`, 'good');
  }

  /** Send a paid envoy: the cheap, repeatable relations verb. */
  sendEnvoy(id: number): boolean {
    const rv = this.rival(id);
    if (!rv || !this.stateProclaimed || this.treasury < ENVOY_COST) return false;
    if (this.playerWar?.rivalId === id) return false; // no letters cross the front
    if (this.day - rv.lastEnvoyDay < ENVOY_COOLDOWN_DAYS) return false;
    this.treasury -= ENVOY_COST;
    rv.lastEnvoyDay = this.day;
    const gain = 4 + Math.round(rv.weights.commerce * 0.3);
    rv.relations = this.clampRel(rv.relations + gain);
    this.addLog(`An envoy rides for ${rv.name} with letters and samples of the valley's grain — relations warm (+${gain}).`, 'good');
    return true;
  }

  /** A state gift: dearer, faster — commerce-minded courts love it most. */
  sendGift(id: number): boolean {
    const rv = this.rival(id);
    if (!rv || !this.stateProclaimed || this.treasury < GIFT_COST) return false;
    if (this.playerWar?.rivalId === id) return false;
    if (this.day - rv.lastGiftDay < GIFT_COOLDOWN_DAYS) return false;
    this.treasury -= GIFT_COST;
    rv.lastGiftDay = this.day;
    const gain = 6 + Math.round(rv.weights.commerce * 0.5);
    rv.relations = this.clampRel(rv.relations + gain);
    this.addLog(`A state gift is sent to ${rv.leader} of ${rv.name} — relations warm (+${gain}).`, 'good');
    return true;
  }

  /** Propose a treaty. The rival accepts when relations meet its ask;
   *  otherwise it walks away, stating why — truthfully but vaguely. */
  proposeTreaty(id: number, kind: TreatyKind): boolean {
    const rv = this.rival(id);
    if (!rv || !this.stateProclaimed || rv.treaties.includes(kind)) return false;
    if (this.playerWar?.rivalId === id) return false; // peace is made at the peace table
    if (rv.relations >= this.treatyAsk(rv, kind)) {
      rv.treaties.push(kind);
      rv.relations = this.clampRel(rv.relations + 5);
      this.addLog(`TREATY: ${this.stateName || 'the State'} and ${rv.name} sign a ${TREATY_DEFS[kind].name}.`, 'good');
      return true;
    }
    const why = this.treatiesBroken > 0
      ? `"${rv.name} remembers broken seals."`
      : rv.relations < -20
        ? `"our people will not deal with you yet."`
        : `"${rv.name} sees no profit in it — for now."`;
    this.addLog(`${rv.name} declines the ${TREATY_DEFS[kind].name} — ${why}`, 'bad');
    return false;
  }

  /** Tear up a treaty. Everyone reads the reputation ledger (GDD §5.4). */
  breakTreaty(id: number, kind: TreatyKind): boolean {
    const rv = this.rival(id);
    if (!rv || !rv.treaties.includes(kind)) return false;
    rv.treaties = rv.treaties.filter((k) => k !== kind);
    this.treatiesBroken++;
    rv.relations = this.clampRel(rv.relations - (25 + rv.weights.grudge * 2));
    this.addLog(
      `TREATY BROKEN: the ${TREATY_DEFS[kind].name} with ${rv.name} is torn up. ` +
      `Every chancery on the continent takes note.`,
      'bad',
    );
    return true;
  }

  /** The pending AI-initiated offer for a rival, if any. */
  offerFor(rivalId: number): TreatyOffer | undefined {
    return this.offers.find((o) => o.rivalId === rivalId);
  }

  /** Sign an offered treaty off the diplomacy panel. */
  acceptOffer(rivalId: number): boolean {
    const o = this.offerFor(rivalId);
    const rv = this.rival(rivalId);
    if (!o || !rv) return false;
    this.offers = this.offers.filter((x) => x !== o);
    if (!rv.treaties.includes(o.kind)) rv.treaties.push(o.kind);
    rv.relations = this.clampRel(rv.relations + 8);
    this.addLog(`TREATY: ${rv.name}'s offered ${TREATY_DEFS[o.kind].name} is signed.`, 'good');
    return true;
  }

  /** Decline an offered treaty — a small, remembered slight. */
  declineOffer(rivalId: number): boolean {
    const o = this.offerFor(rivalId);
    const rv = this.rival(rivalId);
    if (!o || !rv) return false;
    this.offers = this.offers.filter((x) => x !== o);
    rv.relations = this.clampRel(rv.relations - 4);
    this.addLog(`${rv.name}'s offer is declined. Their envoys withdraw, noting the hour.`, 'info');
    return true;
  }

  /** Monthly diplomacy tick: emergence, relations drift, AI offers,
   *  hostile mischief, regime change abroad, and foreign wars. */
  private updateDiplomacy(): void {
    // Emergence: the world proclaims its nations on its own clock (GDD §6.2),
    // banded so the first foreign power reliably exists by mid-century.
    if (this.year >= RIVAL_EMERGENCE_YEAR && this.rivals.length < MAX_RIVALS) {
      const overdue = this.rivals.length === 0 && this.year >= 1940;
      if (this.rng.chance(overdue ? 0.25 : 0.03)) this.spawnRival();
    }
    this.offers = this.offers.filter((o) => o.expiresDay > this.day && this.rival(o.rivalId));
    this.counters = this.counters.filter((c) => c.expiresDay > this.day && this.rival(c.rivalId));
    const myBloc = this.playerBloc();
    for (const rv of this.rivals) {
      rv.pop *= 1.0015; // they grow whether you watch or not
      if (this.playerWar?.rivalId === rv.id) {
        rv.relations = this.clampRel(Math.min(rv.relations, -60)); // war pins the ledger
        continue; // mischief, offers, and drift all yield to the front
      }
      // Relations drift toward a baseline set by personality, regime
      // distance (GDD §5.4), and whatever ink is already on the page.
      let base = rv.weights.commerce * 1.2 - rv.weights.expansion * 1.5 - rv.weights.grudge * 0.8;
      if (myBloc) base += blocAffinity(myBloc, this.regimeOf(rv).bloc);
      if (rv.treaties.includes('non_aggression')) base += 8;
      if (rv.treaties.includes('trade_agreement')) base += 12;
      if (rv.treaties.includes('defensive_pact')) base += 16;
      if (rv.borderSettled) base += 6; // a fixed frontier is a quiet one
      rv.relations = this.clampRel(rv.relations + (base - rv.relations) * 0.04);
      // AI-initiated offers (GDD §6.3): commerce courts you; caution wants fences
      if (this.stateProclaimed && !this.offers.some((o) => o.rivalId === rv.id)) {
        if (!rv.treaties.includes('trade_agreement') && rv.weights.commerce >= 5 && rv.relations > 30 && this.rng.chance(0.12)) {
          this.offers.push({ rivalId: rv.id, kind: 'trade_agreement', expiresDay: this.day + 90 });
          this.addLog(`Envoys from ${rv.name} arrive with ledgers and samples: they offer a Trade Agreement.`, 'info');
        } else if (!rv.treaties.includes('non_aggression') && rv.relations < -10 && rv.relations > -50 && rv.weights.risk <= 5 && this.rng.chance(0.08)) {
          this.offers.push({ rivalId: rv.id, kind: 'non_aggression', expiresDay: this.day + 90 });
          this.addLog(`${rv.name} proposes a Non-Aggression Pact — cold neighbors, fenced borders.`, 'info');
        }
      }
      // Hostile mischief (GDD §6.4): town-scale friction, deniable and cheap
      if (rv.relations < -40 && !rv.treaties.includes('non_aggression') && this.rng.chance(0.1 + rv.weights.risk * 0.015)) {
        if (!rv.borderSettled && (this.rng.chance(0.5) || this.tradeValueLastMonth <= 0)) {
          const t = this.settlements[this.rng.int(this.settlements.length)];
          if (t) {
            t.grievance = Math.min(100, t.grievance + 6);
            rv.relations = this.clampRel(rv.relations - 3);
            this.addLog(`Border friction: ${rv.name}'s surveyors plant markers in ${t.name}'s outfields. Tempers fray.`, 'bad');
          }
        } else {
          const toll = Math.min(this.treasury, 5 + this.rng.int(10));
          this.treasury -= toll;
          this.addLog(`${rv.name}'s customs men shake down caravans at the frontier — £${toll} in seized goods and bribes.`, 'bad');
        }
      }
      // Beyond mischief (GDD §7.1): an emboldened hostile power declares war outright
      if (
        !this.playerWar && this.nationProclaimed && rv.relations < -60 &&
        !rv.treaties.includes('non_aggression') &&
        this.rng.chance(0.01 + rv.weights.risk * 0.003 + rv.weights.expansion * 0.002)
      ) {
        // a settled frontier leaves them no honest grievance — they stage one
        this.startPlayerWar(rv, rv.borderSettled ? 'fabricated' : 'border_dispute', true);
        continue;
      }
      // Regime change abroad is world news the player reads about (GDD §6.3)
      if (this.rng.chance(0.01)) this.changeRegime(rv, 'drift');
    }
    this.tickForeignRelations();
    this.tickPlayerWar();
  }

  /** A nation's bio stays readable: cap the beats, keep the founding line. */
  private noteHistory(rv: RivalNation, text: string): void {
    rv.history.push(text);
    if (rv.history.length > 16) rv.history.splice(1, 1);
  }

  /** A rival's government falls — by slow drift or by losing a war. The
   *  era gates what replaces it: the interwar pool leans autocratic. */
  private changeRegime(rv: RivalNation, cause: 'drift' | 'defeat'): void {
    const old = this.regimeOf(rv);
    const next = this.pickRegime(rv.weights, old.id);
    rv.regime = next.id;
    this.noteHistory(rv,
      cause === 'defeat'
        ? `Defeat brought down the ${old.name}; a ${next.name} seized power, ${this.year}.`
        : `The ${old.name} fell; a ${next.name} took its place, ${this.year}.`,
    );
    this.addLog(
      cause === 'defeat'
        ? `REVOLUTION in ${rv.name}: defeat brings down the ${old.name.toLowerCase()} — a ${next.name.toLowerCase()} seizes power.`
        : `REGIME CHANGE in ${rv.name}: the ${old.name.toLowerCase()} falls; a ${next.name.toLowerCase()} takes its place.`,
      'info',
    );
  }

  /** The world's own politics (GDD §6.4): rival pairs drift, ally, feud,
   *  and fight — the player reads the dispatches and sells into the booms. */
  private tickForeignRelations(): void {
    for (let i = 0; i < this.rivals.length; i++) {
      for (let j = i + 1; j < this.rivals.length; j++) {
        const a = this.rivals[i];
        const b = this.rivals[j];
        const key = this.pairKey(a.id, b.id);
        const allied = this.alliances.includes(key);
        const atWar = this.warBetween(a.id, b.id) !== undefined;
        // Drift toward a baseline from both personalities and bloc distance
        let base =
          (a.weights.commerce + b.weights.commerce) * 1.2 -
          (a.weights.expansion + b.weights.expansion) * 1.5 +
          blocAffinity(this.regimeOf(a).bloc, this.regimeOf(b).bloc);
        if (allied) base += 25;
        let rel = (this.rivalPairs[key] ?? 0) + (base - (this.rivalPairs[key] ?? 0)) * 0.03;
        if (atWar) rel = Math.min(rel, -50);
        this.rivalPairs[key] = this.clampRel(rel);
        if (atWar) continue;
        if (!allied && rel > 45 && a.weights.honor + b.weights.honor >= 10 && this.rng.chance(0.05)) {
          this.alliances.push(key);
          this.noteHistory(a, `Allied with ${b.name}, ${this.year}.`);
          this.noteHistory(b, `Allied with ${a.name}, ${this.year}.`);
          this.addLog(`PACT ABROAD: ${a.name} and ${b.name} sign an alliance — the world is choosing sides.`, 'info');
        } else if (!allied && rel > 25 && a.weights.commerce + b.weights.commerce >= 10 && this.rng.chance(0.04)) {
          this.rivalPairs[key] = this.clampRel(rel + 5);
          this.addLog(`${a.name} and ${b.name} open a customs union — freight moves freely between them.`, 'info');
        } else if (rel < -20 && this.rng.chance(0.06)) {
          this.rivalPairs[key] = this.clampRel(rel - 4);
          this.addLog(`${a.name} and ${b.name} trade ultimatums over a border survey. The chanceries buzz.`, 'info');
        }
        if (!allied && rel < -50 && this.rng.chance(0.03 + (a.weights.risk + b.weights.risk) * 0.003)) {
          this.startForeignWar(a.id, b.id);
        }
      }
    }
    // Run the active wars: refugees flow now, the reckoning comes at the peace
    for (const w of [...this.foreignWars]) {
      const a = this.rival(w.a);
      const b = this.rival(w.b);
      if (!a || !b) {
        this.foreignWars = this.foreignWars.filter((x) => x !== w);
        continue;
      }
      if (this.rng.chance(0.2) && this.settlements.length > 0) {
        const t = this.settlements[this.rng.int(this.settlements.length)];
        const wave = 2 + this.rng.int(6);
        t.cohorts.bands[1] += wave * 0.6;
        t.cohorts.bands[0] += wave * 0.25;
        t.cohorts.bands[2] += wave * 0.15;
        this.addLog(`Refugees from the ${a.name}–${b.name} war reach ${t.name} — ${wave} souls with what they could carry.`, 'info');
      }
      if (this.day >= w.endsDay) this.endForeignWar(w, a, b);
    }
  }

  /** War between two powers (GDD §6.4: "their wars move prices").
   *  Public so scenarios and tests can light the fuse directly. */
  startForeignWar(aId: number, bId: number): boolean {
    const a = this.rival(aId);
    const b = this.rival(bId);
    if (!a || !b || a === b || this.warBetween(aId, bId)) return false;
    const endsDay = this.day + 240 + this.rng.int(480);
    this.foreignWars.push({ a: aId, b: bId, startedDay: this.day, endsDay });
    this.rivalPairs[this.pairKey(aId, bId)] = Math.min(this.pairRelations(aId, bId), -60);
    this.warBoomUntil = Math.max(this.warBoomUntil, endsDay);
    this.noteHistory(a, `Went to war with ${b.name}, ${this.year}.`);
    this.noteHistory(b, `Went to war with ${a.name}, ${this.year}.`);
    // Allies of each side turn cold toward the enemy — sides harden
    for (const key of this.alliances) {
      const [x, y] = key.split(':').map(Number);
      for (const [self, foe] of [[aId, bId], [bId, aId]] as const) {
        const ally = x === self ? y : y === self ? x : null;
        if (ally !== null && ally !== foe) {
          const k = this.pairKey(ally, foe);
          this.rivalPairs[k] = this.clampRel((this.rivalPairs[k] ?? 0) - 20);
        }
      }
    }
    this.addLog(`WAR ABROAD: ${a.name} and ${b.name} are at war. Their buyers pay any price — the valley's exports boom.`, 'info');
    return true;
  }

  /** The peace: the loser bleeds population, nurses a grudge for decades,
   *  and may lose its government to the defeat (GDD §6.3 regime change). */
  private endForeignWar(w: ForeignWar, a: RivalNation, b: RivalNation): void {
    this.foreignWars = this.foreignWars.filter((x) => x !== w);
    const aWins = this.rng.next() < a.pop / (a.pop + b.pop);
    const winner = aWins ? a : b;
    const loser = aWins ? b : a;
    loser.pop *= 0.85 + this.rng.next() * 0.1;
    winner.pop *= 1.02;
    this.rivalPairs[this.pairKey(a.id, b.id)] = -60; // betrayal-grade memory
    this.noteHistory(winner, `Victorious over ${loser.name}, ${this.year}.`);
    this.noteHistory(loser, `Defeated by ${winner.name}, ${this.year}.`);
    this.addLog(
      `PEACE ABROAD: the ${a.name}–${b.name} war ends — ${winner.name} dictates terms, and ${loser.name} signs them. ` +
      `The export boom cools.`,
      'info',
    );
    if (this.rng.chance(0.5)) this.changeRegime(loser, 'defeat');
  }

  // ---- The nation at war (GDD §7) ----

  /** Casus belli on the table against a rival (GDD §7.1): fabrication is
   *  always available; honest grievances must be earned by their hostility. */
  availableCasusBelli(rv: RivalNation): CasusBelli[] {
    const list: CasusBelli[] = [];
    if (rv.relations < -40 && !rv.treaties.includes('non_aggression')) list.push('sponsored_raids');
    if (rv.relations < -20 && !rv.borderSettled) list.push('border_dispute'); // a signed survey leaves nothing to dispute
    list.push('fabricated');
    return list;
  }

  /** Declare war (GDD §7.1). Nation-tier only — war is fought with industry
   *  and politics, and only a proclaimed nation has either at scale. */
  declareWar(id: number, cb: CasusBelli): boolean {
    const rv = this.rival(id);
    if (!rv || !this.nationProclaimed || this.playerWar) return false;
    if (!this.availableCasusBelli(rv).includes(cb)) return false;
    if (rv.treaties.length > 0) {
      rv.treaties = [];
      this.treatiesBroken++; // ink torn up on the way to war
    }
    if (cb === 'fabricated') {
      this.legitimacy = Math.max(0, this.legitimacy - 10);
      this.treatiesBroken++; // the lie is priced like a broken seal
    }
    this.startPlayerWar(rv, cb, false);
    return true;
  }

  private startPlayerWar(rv: RivalNation, cb: CasusBelli, defensive: boolean): void {
    this.playerWar = {
      rivalId: rv.id, cb, defensive, startedDay: this.day,
      support: defensive ? 85 : CASUS_BELLI_DEFS[cb].support, // a defensive war starts at 85 (§7.1)
      score: 0, mobilization: 'peacetime', casualties: 0,
      blockade: false, allies: [], enemyAllies: [],
      occupied: 0, resistance: 0, occupationPolicy: 'conciliatory', brutality: false,
    };
    rv.relations = this.clampRel(Math.min(rv.relations, -60));
    // Their allies turn cold toward you — sides harden (as in startForeignWar),
    // and the honorable ones march: co-belligerence runs both ways (GDD §7.3)
    for (const key of this.alliances) {
      const [x, y] = key.split(':').map(Number);
      const ally = x === rv.id ? this.rival(y) : y === rv.id ? this.rival(x) : undefined;
      if (!ally) continue;
      ally.relations = this.clampRel(ally.relations - 20);
      if (this.rng.chance(0.3 + ally.weights.honor * 0.05)) {
        this.playerWar.enemyAllies.push(ally.id);
        ally.relations = this.clampRel(Math.min(ally.relations, -40));
        this.noteHistory(ally, `Marched beside ${rv.name} against ${this.nationName || this.stateName || 'the nation'}, ${this.year}.`);
        this.addLog(`${ally.name} honors its alliance with ${rv.name} — its armies take the field against you.`, 'bad');
      }
    }
    const nation = this.nationName || this.stateName || 'the nation';
    this.noteHistory(rv, defensive ? `Declared war on ${nation}, ${this.year}.` : `Attacked by ${nation}, ${this.year}.`);
    this.addLog(
      defensive
        ? `WAR: ${rv.name} declares war on ${nation}! A defensive war — the home front rallies (support ${this.playerWar.support}).`
        : `WAR DECLARED on ${rv.name} — casus belli: ${CASUS_BELLI_DEFS[cb].name.toLowerCase()} (support ${this.playerWar.support}).`,
      'bad',
    );
  }

  /** Combat power (GDD §7.3): manpower^0.6 × quality × mobilization — the
   *  sub-linear exponent makes funding and industry matter more than mass. */
  warPower(): number {
    const quality =
      (1 + 0.25 * this.militiaLevel + (this.policyActive('standing_army') ? 0.5 : 0)) *
      (this.ministerFor('defence') ? 1.2 : 1) *
      (this.passedLaws.includes('military_reform') ? 1.2 : 1) *
      (this.govType === 'junta' ? 1.15 : 1);
    const mob = this.playerWar ? MOBILIZATION_DEFS[this.playerWar.mobilization].power : 1;
    // Defensive pacts put allied arms on your front (GDD §5.4); a called
    // co-belligerent commits its army, not just its sympathy (GDD §7.3)
    const allies = this.rivals.reduce((s, rv) => {
      if (rv.id === this.playerWar?.rivalId) return s;
      if (this.playerWar?.allies.includes(rv.id)) return s + Math.pow(rv.pop, 0.6) * 0.5;
      if (rv.treaties.includes('defensive_pact')) return s + Math.pow(rv.pop, 0.6) * 0.25;
      return s;
    }, 0);
    return Math.pow(Math.max(1, this.totalPop()), 0.6) * quality * mob + allies;
  }

  /** The other side of the front: their mass, discounted by their appetite —
   *  plus whoever marches with them, minus whatever the blockade starves. */
  rivalWarPower(rv: RivalNation): number {
    let p = Math.pow(rv.pop, 0.6) * (0.5 + rv.weights.expansion * 0.04 + rv.weights.risk * 0.015);
    const w = this.playerWar;
    if (w?.rivalId === rv.id) {
      for (const id of w.enemyAllies) {
        const ally = this.rival(id);
        if (ally) p += Math.pow(ally.pop, 0.6) * 0.3;
      }
      if (w.blockade) p *= 0.85; // supply starves at the quays (GDD §7.3)
    }
    return p;
  }

  /** Call a defensive-pact ally to the colors (GDD §7.3). Honor weight sets
   *  whether signed ink survives the shells; refusing a *defensive* call
   *  tears the pact up for all to read. */
  callAlly(id: number): boolean {
    const w = this.playerWar;
    const rv = this.rival(id);
    const enemy = w ? this.rival(w.rivalId) : undefined;
    if (!w || !rv || !enemy || rv.id === w.rivalId || w.allies.includes(id)) return false;
    if (!rv.treaties.includes('defensive_pact')) return false;
    const nation = this.nationName || this.stateName || 'the nation';
    const honors = w.defensive
      ? rv.weights.honor >= 4 || this.rng.chance(rv.weights.honor / 10)
      : rv.relations >= 60 && this.rng.chance(0.2 + rv.weights.honor * 0.06);
    if (!honors) {
      if (w.defensive) {
        rv.treaties = rv.treaties.filter((k) => k !== 'defensive_pact');
        rv.relations = this.clampRel(rv.relations - 10);
        this.noteHistory(rv, `Abandoned its pact with ${nation} when the shells fell, ${this.year}.`);
        this.addLog(`${rv.name} abandons its pact when the shells fall — the ink was worth nothing.`, 'bad');
      } else {
        this.addLog(`${rv.name} declines the call — "this is not the war we signed for."`, 'info');
      }
      return false;
    }
    w.allies.push(id);
    rv.relations = this.clampRel(rv.relations + 8);
    this.noteHistory(rv, `Marched beside ${nation} against ${enemy.name}, ${this.year}.`);
    this.addLog(`CO-BELLIGERENCE: ${rv.name} honors the pact — its armies take the field beside yours.`, 'good');
    return true;
  }

  /** Trade interdiction made of warships (GDD §7.3): strangles their supply
   *  and growth, costs upkeep, and requisitions your own merchantmen. */
  setBlockade(on: boolean): boolean {
    const w = this.playerWar;
    if (!w || w.blockade === on) return false;
    if (on && this.militiaLevel < 2 && !this.policyActive('standing_army')) {
      this.addLog('A blockade needs a funded service — raise the militia budget or a standing army first.', 'info');
      return false;
    }
    w.blockade = on;
    this.addLog(
      on
        ? 'BLOCKADE: gunboats and requisitioned merchantmen close the enemy\'s lanes — trade strangles both ways.'
        : 'The blockade is lifted; the sea lanes reopen.',
      'info',
    );
    return true;
  }

  /** Choose how the occupied marches are run (GDD §7.4). Brutality is
   *  cheaper now and costlier forever — the first order is remembered. */
  setOccupationPolicy(p: OccupationPolicy): boolean {
    const w = this.playerWar;
    if (!w || w.occupationPolicy === p) return false;
    w.occupationPolicy = p;
    if (p === 'brutal' && !w.brutality) {
      w.brutality = true;
      this.legitimacy = Math.max(0, this.legitimacy - 5);
      this.addLog('The army is given a free hand in the occupied marches. Cheaper now — costlier forever.', 'bad');
    } else if (p === 'conciliatory') {
      this.addLog('The military administration softens: requisitions end, local councils reconvene.', 'info');
    }
    return true;
  }

  /** Set the mobilization level (GDD §7.2, §7.5: democracies mobilize slowly —
   *  Total needs six months at war unless the war is defensive). */
  setMobilization(m: Mobilization): boolean {
    const w = this.playerWar;
    if (!w || m === w.mobilization) return false;
    if (
      m === 'total' && !w.defensive &&
      (this.govType === 'democracy' || this.govType === 'republic') &&
      this.day - w.startedDay < 180
    ) {
      this.addLog('The chamber refuses total mobilization for a war of choice — not six months in.', 'info');
      return false;
    }
    w.mobilization = m;
    this.addLog(`MOBILIZATION: ${MOBILIZATION_DEFS[m].name.toLowerCase()} — ${MOBILIZATION_DEFS[m].desc}`, 'info');
    return true;
  }

  /** What the enemy wants on the scoreboard before signing — the §6.3
   *  pricing engine at the peace table: proud nations fight past reason. */
  peaceAsk(rv: RivalNation, term: PeaceTerm): number {
    return Math.round(PEACE_TERMS[term].score + rv.weights.grudge * 2);
  }

  /** Combined ask for a basket of terms (GDD §7.4 priced with the §6.3
   *  engine): scores sum, the grudge premium is charged once, and ground
   *  the army already holds discounts the bill. */
  peaceBasketAsk(rv: RivalNation, terms: PeaceTerm[]): number {
    const occupied = this.playerWar?.occupied ?? 0;
    const sum = terms.reduce((s, t) => s + PEACE_TERMS[t].score, 0);
    return Math.max(0, Math.round(sum + rv.weights.grudge * 2 - occupied * OCCUPATION_SCORE_DISCOUNT));
  }

  /** Offer peace (GDD §7.4), priced in war score. Overreach is punished:
   *  a humiliated rival is a revanchist for fifty years — the Versailles trap. */
  offerPeace(term: PeaceTerm): boolean {
    return this.offerPeaceBasket([term]);
  }

  /** Peace is negotiated with the §6.3 engine: a basket of terms, a single
   *  combined ask, and a counter-offer when the front nearly says yes. */
  offerPeaceBasket(termsIn: PeaceTerm[]): boolean {
    const w = this.playerWar;
    const rv = w ? this.rival(w.rivalId) : undefined;
    if (!w || !rv) return false;
    let terms = [...new Set(termsIn)];
    if (terms.length > 1) terms = terms.filter((t) => t !== 'status_quo'); // the maps cannot both move and stay
    if (terms.length === 0) return false;
    if (terms.includes('border_province') && w.occupied === 0) {
      this.addLog(`${rv.name} refuses — "you will not sign away ground you do not hold."`, 'bad');
      return false;
    }
    const ask = this.peaceBasketAsk(rv, terms);
    if (w.score < ask) {
      // a near miss draws a counter-offer, not a refusal (GDD §6.3)
      if (terms.length > 1 && w.score >= ask - 15) {
        const counter = this.peaceCounter(rv, terms);
        if (counter.length > 0) {
          this.addLog(
            `${rv.name}'s envoys counter: "${counter.map((t) => PEACE_TERMS[t].name).join(' + ')} — that, we would sign."`,
            'info',
          );
          return false;
        }
      }
      this.addLog(`${rv.name} rejects the terms — "the front does not say you may ask for that."`, 'bad');
      return false;
    }
    const nation = this.nationName || 'the nation';
    this.playerWar = null;
    rv.pop *= 0.92; // the war's bill abroad
    this.treasury *= 0.9; // demobilization and pensions — the drain after (GDD §7.2)
    this.legitimacy = Math.min(100, this.legitimacy + (w.defensive ? 15 : 10));
    // each clause in turn, the heaviest last so its memory sets the ledger
    for (const t of [...terms].sort((a, b) => PEACE_TERMS[a].score - PEACE_TERMS[b].score)) {
      this.applyPeaceTerm(rv, t, nation);
    }
    // co-belligerents share the victory (GDD §7.3)
    for (const id of w.allies) {
      const ally = this.rival(id);
      if (!ally) continue;
      ally.relations = this.clampRel(ally.relations + 8);
      this.noteHistory(ally, `Shared the victory over ${rv.name}, ${this.year}.`);
    }
    // the occupation's record follows the peace (GDD §7.4)
    if (w.brutality) {
      rv.weights.grudge = Math.min(10, rv.weights.grudge + 2);
      rv.relations = this.clampRel(rv.relations - 15);
      this.addLog("The occupation's cruelties travel home with the refugees — they will not be forgotten.", 'bad');
    }
    return true;
  }

  /** What of the basket the enemy *would* sign at the current score —
   *  drop the heaviest clauses until the front agrees. */
  private peaceCounter(rv: RivalNation, terms: PeaceTerm[]): PeaceTerm[] {
    const w = this.playerWar;
    if (!w) return [];
    const sorted = [...terms].sort((a, b) => PEACE_TERMS[b].score - PEACE_TERMS[a].score);
    while (sorted.length > 0 && w.score < this.peaceBasketAsk(rv, sorted)) sorted.shift();
    return sorted;
  }

  /** One clause of the instrument. */
  private applyPeaceTerm(rv: RivalNation, term: PeaceTerm, nation: string): void {
    switch (term) {
      case 'status_quo':
        rv.relations = this.clampRel(Math.max(rv.relations, -40));
        this.noteHistory(rv, `Made peace with ${nation}, ${this.year} — status quo.`);
        this.addLog(`PEACE: the guns fall silent. Status quo with ${rv.name}; the maps stay as they were.`, 'good');
        break;
      case 'reparations': {
        const tranche = Math.round(120 + rv.pop * 0.03);
        this.treasury += tranche;
        rv.relations = this.clampRel(rv.relations - 10);
        this.noteHistory(rv, `Paid reparations to ${nation} after defeat, ${this.year}.`);
        this.addLog(`PEACE: ${rv.name} signs — and pays. £${tranche} in reparations reaches the treasury.`, 'good');
        break;
      }
      case 'border_province': {
        const t = [...this.settlements].sort((a, b) => this.popOf(b) - this.popOf(a))[0];
        const absorbed = Math.round(rv.pop * 0.012);
        if (t) {
          t.cohorts.bands[1] += absorbed * 0.5;
          t.cohorts.bands[2] += absorbed * 0.3;
          t.cohorts.bands[0] += absorbed * 0.2;
        }
        rv.pop *= 0.9;
        rv.weights.grudge = Math.min(10, rv.weights.grudge + 3);
        rv.relations = -80; // the Versailles trap, signed and sealed
        this.noteHistory(rv, `Ceded its border province to ${nation}, ${this.year}. The revanchists vow return.`);
        this.addLog(
          `PEACE: the frontier moves — ${rv.name}'s border province (${absorbed} souls) joins ${nation}. ` +
          `Its revanchists will remember.`,
          'good',
        );
        break;
      }
      case 'regime_change':
        this.changeRegime(rv, 'defeat');
        rv.relations = 15; // a friendlier government signs the instrument
        this.addLog(`PEACE: ${rv.name}'s government falls with the war — the new ministry signs whatever is put before it.`, 'good');
        break;
    }
  }

  /** Sue for terms you cannot refuse — or be made to (GDD §7.4). */
  capitulate(): boolean {
    const w = this.playerWar;
    const rv = w ? this.rival(w.rivalId) : undefined;
    if (!w || !rv) return false;
    this.playerWar = null;
    const nation = this.nationName || 'the nation';
    this.treasury *= 0.6; // reparations, paid the other way
    for (const t of this.settlements) this.removePop(t, this.popOf(t) * 0.04);
    // Defeat is existential for a junta (GDD §7.5)
    this.legitimacy = Math.max(0, this.legitimacy - (this.govType === 'junta' ? 25 : 15));
    rv.relations = this.clampRel(Math.min(rv.relations, -60));
    rv.pop *= 1.02;
    // allies dragged into your defeat read the ledger too (GDD §7.3)
    for (const id of w.allies) {
      const ally = this.rival(id);
      if (!ally) continue;
      ally.relations = this.clampRel(ally.relations - 10);
      this.noteHistory(ally, `Shared in ${nation}'s defeat by ${rv.name}, ${this.year}.`);
    }
    this.noteHistory(rv, `Dictated peace to ${nation}, ${this.year}.`);
    this.addLog(
      `DEFEAT: ${rv.name} dictates the peace — reparations, a stripped treasury, ` +
      `and a generation that will not forget.`,
      'bad',
    );
    return true;
  }

  /** Monthly war resolution (GDD §7.3–7.4): the front moves on the power
   *  ratio, attrition bleeds the cohorts, and the home front keeps score. */
  private tickPlayerWar(): void {
    const w = this.playerWar;
    if (!w) return;
    if (w.startedDay === this.day) return; // the declaration day musters; the front resolves with the month
    const rv = this.rival(w.rivalId);
    if (!rv) {
      this.playerWar = null;
      return;
    }
    const mob = MOBILIZATION_DEFS[w.mobilization];
    const P = this.warPower();
    const R = this.rivalWarPower(rv);
    const delta = 16 * ((P - R) / (P + R)) + this.rng.int(9) - 4;
    w.score = Math.max(-100, Math.min(100, w.score + delta));
    if (w.blockade) {
      rv.pop *= 0.997; // the quays starve before the trenches do
      w.score = Math.min(100, w.score + 1.5);
    }
    // Attrition (GDD §7.3): burns even on quiet fronts; the pyramid keeps the scar
    const lossRate =
      (w.mobilization === 'total' ? 0.006 : w.mobilization === 'partial' ? 0.004 : 0.003) +
      (delta < 0 ? 0.002 : 0);
    let lost = 0;
    for (const t of this.settlements) {
      const l = (t.cohorts.bands[1] + t.cohorts.bands[2]) * lossRate;
      t.cohorts.bands[1] -= l * 0.7;
      t.cohorts.bands[2] -= l * 0.3;
      t.satisfaction = Math.max(0, t.satisfaction + mob.satMonthly); // rationing bites
      lost += l;
    }
    w.casualties += lost;
    rv.pop *= 1 - lossRate * (delta > 0 ? 1.2 : 0.8);
    // co-belligerents bleed beside you, at half the rate (GDD §7.3)
    for (const id of w.allies) {
      const ally = this.rival(id);
      if (ally) ally.pop *= 1 - lossRate * 0.5;
    }
    // Interdiction runs both ways (GDD §7.3): their raiders cut your routes
    if (this.routes.length > 0 && this.rng.chance(0.3)) {
      const rt = this.routes[this.rng.int(this.routes.length)];
      rt.condition = Math.max(ROUTE_CONDITION_FLOOR, rt.condition - 12);
      const an = this.settlement(rt.a)?.name ?? '?';
      const bn = this.settlement(rt.b)?.name ?? '?';
      this.addLog(`Enemy raiders fire the depots — the ${an}–${bn} ${rt.kind} is cut about.`, 'bad');
    }
    // War support (GDD §7.4): decays with duration and defeat, rallies on victories
    w.support += delta > 4 ? 2 : delta < -4 ? -4 : -1.5;
    if (w.mobilization === 'total') w.support -= 1.5;
    w.support = Math.max(0, Math.min(100, w.support));
    // Occupation (GDD §7.4): a winning front takes ground; a losing one cedes it
    if (w.score >= 35 && w.occupied < MAX_OCCUPIED_MARCHES && this.rng.chance(0.3)) {
      w.occupied++;
      w.support = Math.min(100, w.support + 3); // the parade writes the headline
      this.addLog(`Our columns take one of ${rv.name}'s marches — military administration begins (${w.occupied} occupied).`, 'good');
    } else if (w.score < 0 && w.occupied > 0 && this.rng.chance(0.25)) {
      w.occupied--;
      if (w.occupied === 0) w.resistance = 0;
      this.addLog(`${rv.name}'s counterattack retakes its march — the garrison falls back (${w.occupied} occupied).`, 'bad');
    }
    if (w.occupied > 0) {
      const occ = OCCUPATION_DEFS[w.occupationPolicy];
      // resistance scales with ideology distance and your policy (GDD §7.4)
      const distance = blocAffinity(this.playerBloc() ?? 'liberal', this.regimeOf(rv).bloc) < 0 ? 1.5 : 1;
      w.resistance = Math.min(100, w.resistance + occ.resistance * distance);
      this.treasury += w.occupied * (occ.yield - occ.garrison); // partial output, garrisons paid
      if (w.resistance > 50 && this.rng.chance(w.resistance / 120)) {
        w.casualties += w.occupied * 1.5;
        w.score = Math.max(-100, w.score - 2);
        w.support = Math.max(0, w.support - 1.5);
        this.addLog('Partisans burn the depots in the occupied marches — garrisons bleed and the occupation sours.', 'bad');
      }
    }
    if (this.rng.chance(0.35)) {
      this.addLog(
        delta > 4
          ? `The front moves: our columns push into ${rv.name}'s marches.`
          : delta < -4
            ? `Bad news from the front: ${rv.name}'s offensive gains ground.`
            : `Stalemate on the ${rv.name} front. The shells fall; the line holds.`,
        delta < -4 ? 'bad' : 'info',
      );
    }
    // The regime's consent floor (GDD §7.5)
    const floor = WAR_SUPPORT_FLOOR[this.govType ?? 'democracy'];
    if (w.support < floor) {
      this.legitimacy = Math.max(0, this.legitimacy - 2);
      for (const t of this.settlements) t.grievance = Math.min(100, t.grievance + 4);
      if (this.rng.chance(0.3)) this.addLog('War weariness: draft riots and strike talk — the home front is buckling.', 'bad');
      if (w.support <= floor - 15) {
        this.addLog('THE HOME FRONT BREAKS: the government cannot continue the war.', 'bad');
        this.capitulate();
        return;
      }
    }
    // The enemy dictates when the scoreboard is theirs
    if (w.score <= -60) {
      this.capitulate();
      return;
    }
    // A beaten enemy lets you know the table is set (GDD §7.4)
    if (w.score >= 60 && this.rng.chance(0.25)) {
      this.addLog(`${rv.name} sues for peace — its envoys ask what the guns will cost to stop.`, 'info');
    }
  }

  private removePop(t: Settlement, count: number): void {
    const pop = this.popOf(t);
    if (pop <= 0) return;
    const frac = Math.min(1, count / pop);
    for (let i = 0; i < t.cohorts.bands.length; i++) t.cohorts.bands[i] *= 1 - frac;
  }

  // ---- save & load (region tier) ----
  /**
   * Snapshot the region as JSON. The map and weather are seed-derived and
   * shared with the town sim (one truth), so they rebuild from the town
   * snapshot; everything mutable here — settlements, Notables, routes,
   * the State's books, the RNG word — is captured verbatim.
   */
  serialize(): string {
    return JSON.stringify({
      v: 1,
      rng: this.rng.getState(),
      minute: this.minute,
      settlements: this.settlements,
      notables: this.notables,
      expeditions: this.expeditions,
      routes: this.routes,
      log: this.log,
      stateProclaimed: this.stateProclaimed,
      ceremonyPending: this.ceremonyPending,
      charterProgress: this.charterProgress,
      stateName: this.stateName,
      govLean: this.govLean,
      treasury: this.treasury,
      taxRate: this.taxRate,
      servicesLevel: this.servicesLevel,
      militiaLevel: this.militiaLevel,
      gdpLastMonth: this.gdpLastMonth,
      tradeValueLastMonth: this.tradeValueLastMonth,
      gameOver: this.gameOver,
      droughtAnnounced: this.droughtAnnounced,
      railAnnounced: this.railAnnounced,
      highwayAnnounced: this.highwayAnnounced,
      maglevAnnounced: this.maglevAnnounced,
      researched: this.researched,
      activeResearch: this.activeResearch,
      researchProgress: this.researchProgress,
      politicalCapital: this.politicalCapital,
      nextElectionDay: this.nextElectionDay,
      lastElectionYear: this.lastElectionYear,
      passedLaws: this.passedLaws,
      tradeLevyRate: this.tradeLevyRate,
      estateTaxActive: this.estateTaxActive,
      nationProclaimed: this.nationProclaimed,
      nationName: this.nationName,
      govType: this.govType,
      legitimacy: this.legitimacy,
      ministers: this.ministers,
      activePolicies: this.activePolicies,
      rivals: this.rivals,
      offers: this.offers,
      counters: this.counters,
      treatiesBroken: this.treatiesBroken,
      warBoomUntil: this.warBoomUntil,
      exportEarningsLastMonth: this.exportEarningsLastMonth,
      rivalPairs: this.rivalPairs,
      alliances: this.alliances,
      foreignWars: this.foreignWars,
      playerWar: this.playerWar,
      nextId: this.nextId,
      nextEventDay: this.nextEventDay,
      townNamePool: this.townNamePool,
    });
  }

  /** Rebuild from a snapshot atop a restored town sim — the region keeps
   *  sharing its rng, map, and weather (the corridor cache refills lazily). */
  static deserialize(json: string, sim: Simulation): RegionSim {
    const d = JSON.parse(json);
    const r = new RegionSim(sim.rng, d.minute, sim.regionMap, sim.weather);
    // pre-market saves carry no prices: open those towns at the base rates
    r.settlements = (d.settlements as Settlement[]).map((s) => ({ ...s, prices: s.prices ?? defaultPrices() }));
    r.notables = d.notables;
    r.expeditions = d.expeditions;
    r.routes = d.routes;
    r.log = d.log;
    r.stateProclaimed = d.stateProclaimed;
    r.ceremonyPending = d.ceremonyPending;
    r.charterProgress = d.charterProgress;
    r.stateName = d.stateName;
    r.govLean = d.govLean;
    r.treasury = d.treasury;
    r.taxRate = d.taxRate;
    r.servicesLevel = d.servicesLevel;
    r.militiaLevel = d.militiaLevel;
    r.gdpLastMonth = d.gdpLastMonth;
    r.tradeValueLastMonth = d.tradeValueLastMonth ?? 0;
    r.gameOver = d.gameOver;
    r.droughtAnnounced = d.droughtAnnounced;
    r.railAnnounced = d.railAnnounced;
    r.highwayAnnounced = d.highwayAnnounced ?? false;
    r.maglevAnnounced = d.maglevAnnounced ?? false;
    r.researched = d.researched ?? ['steam_power', 'common_law'];
    r.activeResearch = d.activeResearch ?? null;
    r.researchProgress = d.researchProgress ?? 0;
    r.politicalCapital = d.politicalCapital ?? 0;
    r.nextElectionDay = d.nextElectionDay ?? -1;
    r.lastElectionYear = d.lastElectionYear ?? -1;
    r.passedLaws = d.passedLaws ?? [];
    r.tradeLevyRate = d.tradeLevyRate ?? 0.05;
    r.estateTaxActive = d.estateTaxActive ?? false;
    r.nationProclaimed = d.nationProclaimed ?? false;
    r.nationName = d.nationName ?? '';
    r.govType = d.govType ?? null;
    r.legitimacy = d.legitimacy ?? 0;
    r.ministers = d.ministers ?? MINISTER_ROLES.map((x) => ({ role: x.id, title: x.title, notableId: null }));
    if (d.activePolicies) {
      r.activePolicies = d.activePolicies;
    } else if (d.govType) {
      const govDef = GOV_TYPES.find((g) => g.id === d.govType);
      r.activePolicies = new Array(govDef?.policySlots.length ?? 0).fill(null);
    }
    // pre-diplomacy saves carry no rivals: the world is still empty
    r.rivals = (d.rivals ?? []).map((rv: RivalNation) => ({ ...rv, borderSettled: rv.borderSettled ?? false }));
    r.offers = d.offers ?? [];
    r.counters = d.counters ?? [];
    r.treatiesBroken = d.treatiesBroken ?? 0;
    r.warBoomUntil = d.warBoomUntil ?? -1;
    r.exportEarningsLastMonth = d.exportEarningsLastMonth ?? 0;
    r.rivalPairs = d.rivalPairs ?? {};
    r.alliances = d.alliances ?? [];
    r.foreignWars = d.foreignWars ?? [];
    // v0.18 saves carry wars without the depth fields — fill them at peace defaults
    r.playerWar = d.playerWar
      ? {
          blockade: false, allies: [], enemyAllies: [], occupied: 0, resistance: 0,
          occupationPolicy: 'conciliatory' as OccupationPolicy, brutality: false,
          ...d.playerWar,
        }
      : null;
    r.nextId = d.nextId;
    r.nextEventDay = d.nextEventDay;
    r.townNamePool = d.townNamePool;
    // last: the constructor consumed a draw scheduling its event day
    r.rng.setState(d.rng);
    return r;
  }

  addLog(text: string, kind: LogEntry['kind']): void {
    this.log.push({ day: this.day, text, kind });
    if (this.log.length > 200) this.log.shift();
  }
}
