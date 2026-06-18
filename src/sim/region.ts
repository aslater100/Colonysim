/**
 * RegionSim — the aggregate simulation that takes over at the flip (GDD §2.4).
 *
 * The moment town #2 is founded, individual settlers become cohort statistics
 * and a small cast of Notables carries the attachment forward. Settlements
 * grow, age, migrate, and get raided as populations, not agents — this is the
 * performance answer that lets the game scale to a State and beyond.
 */
import { Rng } from './rng';
import { MINUTES_PER_DAY, DAYS_PER_SEASON, DAYS_PER_YEAR, SEASONS, START_YEAR, formatCurrency, setCurrencySymbol, AI_DIFFICULTY, TUNING } from './defs';
import type { CurrencySymbol, RegionDesign, NationDesign, AiDifficulty } from './defs';
import { computePenalty, transitionEfficiency, ANNOUNCE_LEAD_DAYS } from './currency';
import type { CurrencyChangeCause, CurrencyAnnouncement, CurrencyTransition } from './currency';
import { RegionMap, REGION_N, CELL_SCALE } from './worldgen';
import type { TownSite } from './worldgen';
import { Weather } from './weather';
import type { Lender, Loan } from './economy';
import { createInitialLenders } from './lenders';
import techTreeJson from '../data/techtree.json';
import regionBuildingsJson from '../data/region_buildings.json';

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

/** Minimal log entry (shared with town sim). */
export interface LogEntry {
  day: number;
  text: string;
  kind: 'info' | 'good' | 'bad';
}

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
  /** Adaptation works (GDD §8.2): a raised coastal town shrugs off the rising sea. */
  seaWall?: boolean;
  /** Per-town growth/event log: last 12 entries, newest first. */
  recentEvents: { day: number; text: string; kind: 'good' | 'bad' | 'info' }[];
  // ---- Phase 0: Regional Gameplay Expansion ----
  /** Which faction controls this settlement (faction id) */
  factionId: number;
  /** Military garrison strength (abstract: militia count) */
  garrisonStrength: number;
  /** Units stationed in this settlement's garrison (GDD §7.1) */
  stationedUnits: ArmyUnit[];
  /** Loyalty to controlling faction (0–100); affects labor productivity and revolt risk */
  loyaltyToFaction: number;
  /** Phase 1: where this town's labor works, what it produces, what it pays. */
  sectors: Sectors;
  /** Phase 2: civic works raised in a managed city (building def ids). */
  buildings: string[];
  /** Construction underway, if any — one project at a time per town. */
  construction: CityConstruction | null;
  /** Development focus: biases where this town's labor drifts. */
  focus: TownFocus;
  /** Phase 4: active regional events currently affecting this settlement. */
  activeEvents: ActiveEvent[];
  /** Phase 5: local governance policies for managed cities. */
  policies: CityPolicies;
  // ---- AI Competitors Phase 2d: settlement resource bias ----
  /** Primary resource focus: wool, grain, iron, wood (tied to founding location/goal) */
  resourceFocus?: 'wool' | 'grain' | 'iron' | 'wood' | 'diverse';
  /** Last day emergency grain was purchased — prevents buying every single day. */
  lastEmergencyGrainDay?: number;
}

// ---- Phase 0: Territory & resource visualization ----

/** At-a-glance health of a settlement's three headline goods. */
export type ResourceStatus = 'surplus' | 'balanced' | 'deficit';
export interface SettlementResourceStatus {
  food: ResourceStatus;
  wood: ResourceStatus;
  goods: ResourceStatus;
}

/** Territory control summary: who holds what share of the claimable region. */
export interface TerritoryControl {
  /** Land cell ownership over the REGION_N×REGION_N grid, row-major (x*N+y).
   *  Values: faction id (≥0), -1 unclaimed land, -2 water/uninhabitable. */
  grid: Int8Array;
  /** factionId → fraction of claimable land (0..1). */
  control: Map<number, number>;
  /** Count of claimable (non-water) cells — the denominator for control. */
  landCells: number;
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

// ---- Phase 1: Sectoral economy (GDD §5.2: the century's structural transformation) ----

/** The four sectors every settlement's labor splits across. In 1900 the
 *  frontier farms; by 2000 it files, codes, and serves. The shift is driven
 *  by technology, not script. */
export type SectorId = 'agriculture' | 'industry' | 'services' | 'information';
export const SECTOR_IDS: SectorId[] = ['agriculture', 'industry', 'services', 'information'];
export const SECTOR_NAMES: Record<SectorId, string> = {
  agriculture: 'Agriculture',
  industry: 'Industry',
  services: 'Services',
  information: 'Information',
};

export interface Sector {
  /** Employment share of the settlement's workers, 0..1 (shares sum to 1). */
  share: number;
  /** £/month produced by this sector last month. */
  output: number;
  /** £/worker/month — the wage signal that pulls migrants. */
  wage: number;
  /** Monthly share trend (for UI arrows): + growing, − shrinking. */
  growth: number;
}

export type Sectors = Record<SectorId, Sector>;

/** 1900 frontier employment: the plough takes seven hands in ten. */
const SECTOR_BASE_SHARES: Record<SectorId, number> = {
  agriculture: 0.72, industry: 0.14, services: 0.11, information: 0.03,
};

/** Base output per worker per month (£), before tech multipliers. Calibrated
 *  so that a 200-worker region earns ~£2,400/mo GDP (taxes cover services at
 *  10% rate). Richer sectors pay more — the wage gap pulls labor off the land. */
const SECTOR_BASE_OUTPUT: Record<SectorId, number> = {
  agriculture: 10.0, industry: 14.0, services: 13.0, information: 30.0,
};

export function defaultSectors(): Sectors {
  const s = {} as Sectors;
  for (const id of SECTOR_IDS) {
    s[id] = { share: SECTOR_BASE_SHARES[id], output: 0, wage: SECTOR_BASE_OUTPUT[id], growth: 0 };
  }
  return s;
}

// ---- Phase 2: civic works & development focus (deep management for managed cities) ----

/** A regional-tier building: raised with treasury money in a city the player
 *  manages directly (the capital, or any town grown past city size). */
export interface RegionalBuildingDef {
  id: string;
  name: string;
  cost: number;    // £ from the treasury
  days: number;    // construction time
  upkeep: number;  // £/month
  max: number;     // per settlement
  prereq?: string; // tech node id
  sector: SectorId | 'all';
  bonus: number;   // sector output multiplier add (+0.25 = +25%)
  research?: number;     // research rate multiplier add
  satisfaction?: number; // flat satisfaction-target bonus
  sight?: number;        // survey radius bonus for this town
  desc: string;
}

export const REGION_BUILDINGS: RegionalBuildingDef[] = regionBuildingsJson.buildings as RegionalBuildingDef[];

/** A construction site in a managed city: one project at a time per town. */
export interface CityConstruction {
  id: string;      // building def id
  doneDay: number; // absolute day it completes
}

/** Population at which a town (beyond the capital) opens to direct management. */
export const CITY_MANAGEMENT_POP = 100;
/** Repainting a town's development focus costs a survey and some bureaucracy. */
export const FOCUS_CHANGE_COST = 10;

export type TownFocus = SectorId | 'balanced';

// ---- Phase 4: Regional Events ----

export type RegionalEventKind =
  | 'drought' | 'flood' | 'plague' | 'earthquake'
  | 'harvest_bonus' | 'trade_windfall' | 'labor_shortage' | 'gold_rush'
  // ---- events-depth: flavorful additions spanning the century ----
  | 'coal_boom' | 'wildfire' | 'pandemic_wave' | 'rail_windfall'
  | 'factory_unrest' | 'tourism_boom' | 'tech_breakthrough' | 'automation_surge';

export interface ActiveEvent {
  kind: RegionalEventKind;
  untilDay: number;
  severity: number; // 0..1 — scales the output modifier
}

export interface RegionalEventDef {
  kind: RegionalEventKind;
  name: string;
  sector: SectorId | 'all';
  outputMult: number;   // multiplier applied to the affected sector output
  durationDays: number;
  probability: number;  // per-settlement per monthly update
  desc: string;
  minYear?: number;     // events-depth: era-gated — won't fire before this year
  satisfaction?: number; // events-depth: one-shot satisfaction swing when it fires
  grievance?: number;    // events-depth: one-shot grievance swing when it fires
}

export const REGION_EVENT_DEFS: RegionalEventDef[] = [
  { kind: 'drought',       name: 'Drought',       sector: 'agriculture', outputMult: 0.60, durationDays: 60, probability: 0.04, desc: 'Dry weeks bake the fields. Agriculture -40%.' },
  { kind: 'flood',         name: 'Flood',         sector: 'agriculture', outputMult: 0.70, durationDays: 30, probability: 0.03, desc: 'River breaks its banks. Agriculture -30%.' },
  { kind: 'plague',        name: 'Plague',        sector: 'all',         outputMult: 0.75, durationDays: 45, probability: 0.02, desc: 'Disease spreads through the streets. All output -25%.' },
  { kind: 'earthquake',    name: 'Earthquake',    sector: 'industry',    outputMult: 0.50, durationDays: 20, probability: 0.01, desc: 'Mills and forges go dark. Industry -50%.' },
  { kind: 'harvest_bonus', name: 'Bumper Harvest', sector: 'agriculture', outputMult: 1.40, durationDays: 30, probability: 0.05, desc: 'Rains and sunshine, perfectly timed. Agriculture +40%.' },
  { kind: 'trade_windfall', name: 'Trade Windfall', sector: 'services', outputMult: 1.20, durationDays: 30, probability: 0.04, desc: 'Caravans arrive flush with coin. Services +20%.' },
  { kind: 'labor_shortage', name: 'Labor Shortage', sector: 'industry', outputMult: 0.75, durationDays: 40, probability: 0.03, desc: 'Workers drain to the capital. Industry -25%.' },
  { kind: 'gold_rush',     name: 'Gold Rush',     sector: 'information', outputMult: 1.30, durationDays: 45, probability: 0.02, desc: 'Prospectors flood in hungry for maps and news. Information +30%.' },
  // ---- events-depth additions ----
  // Early-century industrial fortune: a rich coal seam under the town.
  { kind: 'coal_boom',      name: 'Coal Boom',     sector: 'industry',    outputMult: 1.35, durationDays: 50, probability: 0.025, satisfaction: 2, minYear: 1905, desc: 'A rich seam is struck. The forges roar. Industry +35%.' },
  // Disaster: a dry-season blaze sweeps the fields.
  { kind: 'wildfire',       name: 'Wildfire',      sector: 'agriculture', outputMult: 0.55, durationDays: 35, probability: 0.02, satisfaction: -4, minYear: 1905, desc: 'Fire jumps the firebreaks. The harvest burns. Agriculture -45%.' },
  // Disaster: a wave of contagion harsher than the local plague, era-flavored.
  { kind: 'pandemic_wave',  name: 'Pandemic Wave', sector: 'all',         outputMult: 0.80, durationDays: 40, probability: 0.015, satisfaction: -3, grievance: 4, minYear: 1915, desc: 'A new sickness rides the rails between towns. All output -20%.' },
  // Mid-century: the railhead arrives and freight floods the works.
  { kind: 'rail_windfall',  name: 'Railhead Boom', sector: 'industry',    outputMult: 1.25, durationDays: 40, probability: 0.025, minYear: 1910, desc: 'The line reaches town; freight pours through the works. Industry +25%.' },
  // Mid-century labor strife: the shop floor downs tools.
  { kind: 'factory_unrest', name: 'Factory Unrest', sector: 'industry',   outputMult: 0.70, durationDays: 35, probability: 0.02, satisfaction: -3, grievance: 6, minYear: 1920, desc: 'The shop floor walks out over wages. Industry -30%.' },
  // Late-century services surge: the town becomes a destination.
  { kind: 'tourism_boom',   name: 'Tourism Boom',  sector: 'services',    outputMult: 1.30, durationDays: 45, probability: 0.025, satisfaction: 3, minYear: 1960, desc: 'Visitors and their coin arrive in droves. Services +30%.' },
  // Late-century, scales the information sector hard.
  { kind: 'tech_breakthrough', name: 'Tech Breakthrough', sector: 'information', outputMult: 1.45, durationDays: 45, probability: 0.02, satisfaction: 2, minYear: 1980, desc: 'A local lab files a patent that changes everything. Information +45%.' },
  // End-century automation shock: information soars while the floor empties.
  { kind: 'automation_surge', name: 'Automation Surge', sector: 'information', outputMult: 1.50, durationDays: 50, probability: 0.02, grievance: 5, minYear: 2010, desc: 'Robots take the line; the terminal booms, the floor grumbles. Information +50%.' },
];

// Fast lookups for building and event definitions.
const REGION_BUILDINGS_MAP = new Map(REGION_BUILDINGS.map((b) => [b.id, b]));
const REGION_EVENT_DEFS_MAP = new Map(REGION_EVENT_DEFS.map((d) => [d.kind, d]));

// ---- Phase 5: Local Policies ----

export type WagePolicy = 'low' | 'market' | 'high';

export interface CityPolicies {
  taxBand: number;         // 0–3: 0=none, 1=light (5%), 2=standard (10%), 3=heavy (15%)
  wagePolicy: WagePolicy;  // shapes migration pull and sector cost
  serviceLevel: number;    // 0–2: 0=minimal, 1=standard, 2=generous
}

export const DEFAULT_CITY_POLICIES: CityPolicies = { taxBand: 0, wagePolicy: 'market', serviceLevel: 1 };
export const TAX_BAND_RATES = [0, 0.05, 0.10, 0.15] as const;
export const TAX_BAND_LABELS = ['None', 'Light (5%)', 'Standard (10%)', 'Heavy (15%)'] as const;
export const SERVICE_PROD_MULT = [0.90, 1.0, 1.15] as const;

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
    desc: 'A national bank holds reserves and smooths the boom-bust. Unlocks policy rate, bond issuance, credit cycle, and FX regime controls.',
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
  {
    id: 'carbon_levy',
    name: 'Carbon Levy',
    cost: 35,
    prereqs: ['environmentalism'],
    requiresState: true,
    requiresNation: true,
    domain: 'economic',
    desc: 'A tax on the smoke itself. National emissions ×0.7; treasury receives +1% of GDP monthly.',
  },
  // ---- events-depth: additional laws (wired to existing hooks) ----
  {
    id: 'sanitation_act',
    name: 'Public Sanitation Act',
    cost: 25,
    prereqs: [],
    requiresState: true,
    domain: 'social',
    desc: 'Sewers, clean water, refuse collection. Settlement mortality −10%; satisfaction +3 everywhere.',
  },
  {
    id: 'trade_unions_act',
    name: 'Trade Unions Act',
    cost: 30,
    prereqs: ['labor_law'],
    requiresState: true,
    requiresNation: true,
    domain: 'social',
    desc: 'Legal collective bargaining. Grievance buildup 30% slower. Workers +20, Landowners −10.',
  },
  {
    id: 'tariff_act',
    name: 'Tariff Act',
    cost: 20,
    prereqs: ['income_tax'],
    requiresState: true,
    domain: 'economic',
    desc: 'Protective duties on imports. Trade levy raised to 8%. Merchants −10, Landowners +10.',
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
  // ---- events-depth: additional policy cards (all wired to existing hooks) ----
  {
    id: 'austerity', name: 'Austerity', domain: 'economic', prereqs: ['income_tax'], upkeep: 0,
    desc: 'Balanced books, cut services. Treasury +£4/month, but satisfaction −4 everywhere.',
  },
  {
    id: 'green_subsidies', name: 'Green Subsidies', domain: 'economic', prereqs: ['environmentalism'], upkeep: 3,
    desc: 'Subsidize clean industry. National emissions ×0.85. Cost £3/month.',
  },
  {
    id: 'research_grants', name: 'Research Grants', domain: 'social', prereqs: ['public_education'], upkeep: 2,
    desc: 'State funds the laboratories. Research rate +20%. Cost £2/month.',
  },
  {
    id: 'civic_pride', name: 'Civic Pride Campaign', domain: 'social', prereqs: [], upkeep: 1,
    desc: 'Festivals, parades, public works. Grievance 20% slower. Cost £1/month.',
  },
  {
    id: 'guest_workers', name: 'Guest Worker Program', domain: 'diplomatic', prereqs: ['labor_law'], upkeep: 0,
    desc: 'Seasonal labor pacts draw newcomers. Migration flows +20%.',
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

export type TreatyKind = 'non_aggression' | 'trade_agreement' | 'defensive_pact' | 'climate_accord';

// ---- Monetary system types (GDD §5.1) ----
export type CreditRating = 'AAA' | 'AA' | 'A' | 'BBB' | 'BB' | 'B' | 'CCC' | 'D';
export type MonetaryRegime = 'float' | 'peg' | 'print';

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
  climate_accord: {
    name: 'Climate Accord', baseAsk: 25,
    desc: 'Both parties pledge emission reductions. Compliant signatories bend the world curve; free-riders can be sanctioned if detected.',
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

// ---- Monetary system constants (GDD §5.1) ----
/** Credit-neutral policy rate; below this leverage builds, above it contracts. */
const NEUTRAL_RATE = 0.05;
// Minsky instability dials — pulled from TUNING so they can be adjusted without
// touching region.ts (see TUNING.leverageFragile / fragilityGain in defs.ts).
const LEVERAGE_FRAGILITY = TUNING.leverageFragility;
const LEVERAGE_FRAGILE   = TUNING.leverageFragile;
const FRAGILITY_GAIN     = TUNING.fragilityGain;
export const MIN_POLICY_RATE = 0.01;
export const MAX_POLICY_RATE = 0.15;
/** Credit spreads over policy rate by rating tier. */
export const CREDIT_RATING_SPREADS: Record<CreditRating, number> = {
  AAA: 0, AA: 0.005, A: 0.01, BBB: 0.02, BB: 0.04, B: 0.07, CCC: 0.12, D: 0.25,
};

// ---- Fog of War & Regional Exploration (Phase 0: Region Gameplay Expansion) ----

/** Tile visibility state: 'fogged' = unknown, 'explored' = discovered, 'scouted' = visible this turn. */
export type TileVisibility = 'fogged' | 'explored' | 'scouted';

/** A scout unit: mobile unit owned by a faction that explores the map. */
export interface Scout {
  id: number;
  factionId: number; // which faction owns this scout
  x: number; // region coords 0..100
  y: number;
  health: number; // 0–100; dies when reaches 0 (from enemy scouts, etc.)
  maintenanceCost: number; // gold per tick to keep alive
  createdDay: number;
  expireDay: number; // scout auto-removed when day >= expireDay (200 days lifespan)
  targetMode: 'random' | 'objective'; // random walk or move toward goal objective
}

/** Central Bank: tracks currency systems, reserves, and monetary policy. */
export interface CentralBank {
  factionId: number;
  foundedDay: number;
  /** Reserves of each currency (as forex reserves): { currencyId: amount } */
  reserves: Record<number, number>;
  /** Annual interest rate policy: 0.01 (1%) to 0.15 (15%); neutral at 0.05 (5%) */
  interestRate: number;
  /** Annual inflation rate; increases with money printing, decreases with high interest rates */
  inflationRate: number;
}

/** A strategic goal for an AI faction, procedurally generated from templates. */
export interface FactionGoal {
  id: string; // unique within faction
  objective: string; // human-readable goal ("control wool trade", "achieve military supremacy")
  govTypes: string[]; // governments suited to this goal (e.g., ["junta", "autocracy"])
  generatedYear: number; // when this goal was set
  targetYear: number; // when success is measured
  /** Condition to check for success (e.g., "control 5+ wool settlements") */
  successCondition: (faction: RegionalFaction, region: RegionSim) => boolean;
  /** Narrative description of the goal for the activity log */
  description: string;
  /** Bias settlement placement toward these resource types or geography */
  settlementBias?: ('river' | 'coastal' | 'mountain' | 'plains' | 'forest')[];
  /** Tech types that accelerate this goal */
  supportingTechs?: string[];
  /** Expected sector focus (e.g., "commerce", "military", "culture") */
  sectorFocus?: string;
}

/** Regional Faction: competes with the player for control of settlements and resources. */
export interface RegionalFaction {
  id: number;
  name: string;
  color: string; // hex color for map display (e.g., '#FF0000' for red)
  capital: number; // settlement id
  settlementIds: number[]; // settlements controlled by this faction
  treasury: number; // gold reserves
  treasuryByCurrency: Record<number, number>; // multi-currency reserves
  militaryStrength: number; // abstract: sum of garrison strengths
  techProgress: number; // how far along the tech tree
  centralBank: CentralBank | null; // null until established
  currencyId: number; // unique id for this faction's currency
  currencyName: string; // e.g., "Dollars", "Francs"
  /** AI personality: -100 (passive) to +100 (aggressive) */
  aggressiveness: number;
  /** Government type (RivalRegimeDef id) — drives which goals this faction pursues. */
  regime: string;
  /** AI tech focus: what the AI prioritizes researching */
  techFocus: string;
  aiGoal: string; // current strategic goal (for logging/UI)
  lastScoutDay: number; // day the AI last sent out scouts
  lastRaidDay: number; // day of last raid against player (cooldown gate)
  // ---- Faction AI scheduling (GDD §6.2 optimization: staggered updates) ----
  lastUpdateDay: number; // day of last AI update (settlement expansion, goal generation, etc.)
  updateFrequency: number; // days between updates (scaled by difficulty)
  currentGoal: FactionGoal | null; // procedurally generated goal, may be null
  lastGoalCheckDay: number; // when goal success/failure was last checked
  // ---- Phase C: Vassalage (conquest tier) ----
  /** Faction this faction is a vassal of; null if independent. */
  overlordId: number | null;
  /** Faction IDs that have submitted as vassals to this faction. */
  vassals: number[];
}

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
  { id: 'parliamentary', name: 'Parliamentary Democracy', bloc: 'liberal', eraFrom: 1800 },
  { id: 'merchant_republic', name: 'Merchant Republic', bloc: 'liberal', eraFrom: 1800 },
  { id: 'const_monarchy', name: 'Constitutional Monarchy', bloc: 'traditional', eraFrom: 1800 },
  { id: 'abs_monarchy', name: 'Absolute Monarchy', bloc: 'traditional', eraFrom: 1800 },
  { id: 'theocracy', name: 'Theocracy', bloc: 'traditional', eraFrom: 1800 },
  { id: 'junta', name: 'Military Junta', bloc: 'autocratic', eraFrom: 1800 },
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

/** Unit type recruitment costs and supply needs (GDD §7.1 military depth). */
export const UNIT_TYPES: Record<ArmyUnitType, {
  recruitCost: number;   // £ per unit
  trainingDays: number;  // days to recruit
  powerPerUnit: number;  // military power contribution
  supplyCost: number;    // food/ammo per unit per day
}> = {
  militia: { recruitCost: 10, trainingDays: 1, powerPerUnit: 1.0, supplyCost: 0.04 },
  cavalry: { recruitCost: 25, trainingDays: 14, powerPerUnit: 1.5, supplyCost: 0.06 },
  artillery: { recruitCost: 40, trainingDays: 21, powerPerUnit: 2.0, supplyCost: 0.08 },
};

/** Unit types for armies: different training, equipment, supply needs. */
export type ArmyUnitType = 'militia' | 'cavalry' | 'artillery';

/** Recruited army units: type, count, morale. */
export interface ArmyUnit {
  type: ArmyUnitType;
  count: number;
  morale: number; // 0–100; affects combat power, desertion risk
  suppliedDays: number; // food/ammo remaining at current supply rate
}

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
  /** Army composition: different unit types. */
  units: ArmyUnit[];
  /** Food/ammunition reserve for the army (months of supply). */
  supplyReserve: number;
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

/** Goal templates: procedurally instantiated based on faction government type and current state.
 *  Format: (faction, region) => FactionGoal | null (return null if goal not applicable).
 *  Allows huge possibility space without pre-computing; condition is checked yearly. */
const FACTION_GOAL_GENERATORS: Array<(faction: RegionalFaction, region: RegionSim) => FactionGoal | null> = [
  // ---- Junta / Autocracy (military-focused) ----
  (faction, region) => {
    if (faction.treasury >= 300 && region.year >= 1920) {
      return {
        id: 'military_supremacy',
        objective: 'Achieve military supremacy in the region',
        govTypes: ['junta', 'one_party', 'fascist', 'corporate'],
        generatedYear: region.year,
        targetYear: region.year + 10,
        successCondition: (f, r) => {
          // Success: high garrison strength across settlements (3+ settlements with 10+ garrison each)
          const garrisonedSettlements = f.settlementIds.filter((id) => {
            const s = r.settlement(id);
            return s && s.garrisonStrength >= 10;
          }).length;
          return garrisonedSettlements >= 3 && f.militaryStrength >= 40;
        },
        description: 'Build the strongest army — every neighbor must tremble.',
        sectorFocus: 'military',
        settlementBias: ['mountain', 'plains'],
      };
    }
    return null;
  },
  (faction, region) => {
    if (faction.settlementIds.length >= 2) {
      return {
        id: 'resource_monopoly',
        objective: 'Secure all iron and coal deposits in the region',
        govTypes: ['junta', 'one_party', 'fascist'],
        generatedYear: region.year,
        targetYear: region.year + 15,
        successCondition: (f, r) => {
          // Success: control 3+ iron-focused settlements AND have industrial treasury
          const ironSettlements = f.settlementIds.filter((id) => {
            const s = r.settlement(id);
            return s?.resourceFocus === 'iron';
          }).length;
          return ironSettlements >= 3 && f.treasury >= 300;
        },
        description: 'Monopolize strategic resources — lock rivals out of industrialization.',
        sectorFocus: 'industry',
        settlementBias: ['mountain'],
        supportingTechs: ['steel_mills', 'coal_mining'],
      };
    }
    return null;
  },
  // ---- Monarchy (dynastic/prestige-focused) ----
  (faction, region) => {
    if (faction.treasury >= 250 && region.year >= 1800) {
      return {
        id: 'dynastic_supremacy',
        objective: 'Establish a royal lineage and secure inheritance',
        govTypes: ['abs_monarchy', 'const_monarchy'],
        generatedYear: region.year,
        targetYear: region.year + 20,
        successCondition: () => true, // Always possible; success is narrative
        description: 'Cement your dynasty — it must outlive you.',
        sectorFocus: 'culture',
      };
    }
    return null;
  },
  // ---- Theocracy (religious/doctrinal-focused) ----
  (_faction, region) => {
    if (region.year >= 1800) {
      return {
        id: 'convert_heathen',
        objective: 'Spread the faith to ideologically distant regions',
        govTypes: ['theocracy'],
        generatedYear: region.year,
        targetYear: region.year + 25,
        successCondition: (f, r) => {
          // Success: expansion to 5+ settlements with high collective satisfaction (cultural dominance)
          const totalPop = f.settlementIds.reduce((sum, id) => {
            const s = r.settlement(id);
            return sum + (s ? r.popOf(s) : 0);
          }, 0);
          return f.settlementIds.length >= 5 && totalPop >= 300;
        },
        description: 'Convert the godless — expand the church\'s reach.',
        sectorFocus: 'culture',
        settlementBias: ['river', 'plains', 'coastal'],
      };
    }
    return null;
  },
  // ---- Republic / Democracy (trade/commerce-focused) ----
  (faction, region) => {
    if (faction.treasury >= 200) {
      return {
        id: 'trade_dominance',
        objective: 'Control the wool and wine export trade',
        govTypes: ['merchant_republic', 'parliamentary'],
        generatedYear: region.year,
        targetYear: region.year + 12,
        successCondition: (f, r) => {
          // Success: control 3+ coastal settlements (wool producers)
          const woolSettlements = f.settlementIds.filter((id) => {
            const s = r.settlement(id);
            return s?.resourceFocus === 'wool';
          }).length;
          return woolSettlements >= 3 && f.treasury >= 400;
        },
        description: 'Become the merchant kings — the continent trades at your prices.',
        sectorFocus: 'commerce',
        settlementBias: ['river', 'coastal'],
        supportingTechs: ['trade_routes', 'merchants'],
      };
    }
    return null;
  },
  (faction, region) => {
    if (region.year >= 1910 && faction.settlementIds.length >= 2) {
      return {
        id: 'scholarly_supremacy',
        objective: 'Establish a center of learning and culture',
        govTypes: ['parliamentary', 'merchant_republic'],
        generatedYear: region.year,
        targetYear: region.year + 15,
        successCondition: (f, r) => {
          // Success: 3+ settlements with high average satisfaction (cultural health)
          const culturedSettlements = f.settlementIds.filter((id) => {
            const s = r.settlement(id);
            return s && s.satisfaction >= 65;
          }).length;
          return culturedSettlements >= 3;
        },
        description: 'Make us the intellectual heart of the continent.',
        sectorFocus: 'culture',
        supportingTechs: ['universities', 'printing_press'],
      };
    }
    return null;
  },
  // ---- Expansion-focused (all types) ----
  (faction, region) => {
    if (faction.settlementIds.length < 3 && region.year < 1950) {
      return {
        id: 'territorial_expansion',
        objective: `Control ${3 + Math.floor(region.year / 100)} settlements`,
        govTypes: ['abs_monarchy', 'junta', 'one_party', 'fascist', 'const_monarchy'],
        generatedYear: region.year,
        targetYear: region.year + 20,
        successCondition: (f, r) => {
          // Success: 4+ settlements with combined population 400+
          const totalPop = f.settlementIds.reduce((sum, id) => {
            const s = r.settlement(id);
            return sum + (s ? r.popOf(s) : 0);
          }, 0);
          return f.settlementIds.length >= 4 && totalPop >= 400;
        },
        description: 'Expand our borders — empty lands await settlement.',
        sectorFocus: 'agriculture',
        settlementBias: ['river', 'plains', 'forest'],
      };
    }
    return null;
  },
  // ---- Defense / Fortress (traditional & autocratic regimes hunker down) ----
  (faction, region) => {
    if (faction.settlementIds.length >= 1) {
      return {
        id: 'fortress_realm',
        objective: 'Fortify the realm into an impregnable fastness',
        govTypes: ['abs_monarchy', 'const_monarchy', 'junta', 'theocracy', 'one_party'],
        generatedYear: region.year,
        targetYear: region.year + 12,
        successCondition: (f, r) => {
          // Success: most settlements heavily garrisoned (a hard shell, not a wide empire)
          const fortified = f.settlementIds.filter((id) => {
            const s = r.settlement(id);
            return s && s.garrisonStrength >= 15;
          }).length;
          return fortified >= 2 && f.militaryStrength >= 25;
        },
        description: 'No invader shall pass — every town a citadel.',
        sectorFocus: 'military',
        settlementBias: ['mountain'],
      };
    }
    return null;
  },
  // ---- Economic growth (universal) ----
  (faction, region) => {
    if (faction.treasury < 150) {
      return {
        id: 'enrich_treasury',
        objective: 'Accumulate wealth through trade and taxation',
        govTypes: ['merchant_republic', 'corporate', 'parliamentary'],
        generatedYear: region.year,
        targetYear: region.year + 8,
        successCondition: (f) => f.treasury >= 400,
        description: 'Build wealth — prosperity feeds power.',
        sectorFocus: 'commerce',
      };
    }
    return null;
  },
  // ---- Naval / coastal trade empire (maritime republics) ----
  (faction, region) => {
    if (faction.settlementIds.length >= 1) {
      return {
        id: 'naval_trade_empire',
        objective: 'Build a coastal trade empire commanding the seaways',
        govTypes: ['merchant_republic', 'parliamentary', 'const_monarchy'],
        generatedYear: region.year,
        targetYear: region.year + 14,
        successCondition: (f, r) => {
          const coastal = f.settlementIds.filter((id) => r.settlement(id)?.resourceFocus === 'wool').length;
          return coastal >= 2 && f.treasury >= 500;
        },
        description: 'Every port a counting-house; every tide a profit.',
        sectorFocus: 'commerce',
        settlementBias: ['coastal'],
        supportingTechs: ['trade_routes', 'merchants'],
      };
    }
    return null;
  },
  // ---- Industrial powerhouse (modern & collectivist states) ----
  (_faction, region) => {
    if (region.year >= 1800) {
      return {
        id: 'industrial_powerhouse',
        objective: 'Forge an industrial powerhouse of mills and mines',
        govTypes: ['corporate', 'one_party', 'peoples_republic', 'parliamentary', 'fascist'],
        generatedYear: region.year,
        targetYear: region.year + 16,
        successCondition: (f, r) => {
          const industrial = f.settlementIds.filter((id) => r.settlement(id)?.resourceFocus === 'iron').length;
          return industrial >= 2 && f.techProgress >= 8;
        },
        description: 'Smoke and steel — the future belongs to the makers.',
        sectorFocus: 'industry',
        settlementBias: ['mountain'],
        supportingTechs: ['steel_mills', 'coal_mining'],
      };
    }
    return null;
  },
  // ---- Agrarian heartland (populist & agrarian regimes) ----
  (faction, region) => {
    if (faction.settlementIds.length >= 1) {
      return {
        id: 'agrarian_heartland',
        objective: 'Cultivate a fertile agrarian heartland',
        govTypes: ['peoples_republic', 'const_monarchy', 'parliamentary', 'theocracy'],
        generatedYear: region.year,
        targetYear: region.year + 14,
        successCondition: (f, r) => {
          const totalPop = f.settlementIds.reduce((sum, id) => {
            const s = r.settlement(id);
            return sum + (s ? r.popOf(s) : 0);
          }, 0);
          const farms = f.settlementIds.filter((id) => r.settlement(id)?.resourceFocus === 'grain').length;
          return farms >= 2 && totalPop >= 350;
        },
        description: 'Bread for the people — fields without end.',
        sectorFocus: 'agriculture',
        settlementBias: ['plains', 'river'],
      };
    }
    return null;
  },
  // ---- Colonial reach (expansionist crowns & empires) ----
  (faction, region) => {
    if (faction.settlementIds.length >= 2 && region.year < 1960) {
      return {
        id: 'colonial_reach',
        objective: 'Plant colonies across every frontier',
        govTypes: ['fascist', 'abs_monarchy', 'merchant_republic', 'corporate'],
        generatedYear: region.year,
        targetYear: region.year + 18,
        successCondition: (f) => f.settlementIds.length >= 6,
        description: 'The map shall be painted in our colour.',
        sectorFocus: 'agriculture',
        settlementBias: ['river', 'coastal', 'plains', 'forest'],
      };
    }
    return null;
  },
  // ---- Cultural golden age (liberal & refined regimes) ----
  (faction, region) => {
    if (faction.settlementIds.length >= 2 && region.year >= 1905) {
      return {
        id: 'cultural_golden_age',
        objective: 'Usher in a golden age of arts and contentment',
        govTypes: ['parliamentary', 'const_monarchy', 'merchant_republic'],
        generatedYear: region.year,
        targetYear: region.year + 15,
        successCondition: (f, r) => {
          const happy = f.settlementIds.filter((id) => (r.settlement(id)?.satisfaction ?? 0) >= 70).length;
          return happy >= 3;
        },
        description: 'Let history remember us for beauty, not blood.',
        sectorFocus: 'culture',
        supportingTechs: ['universities', 'printing_press'],
      };
    }
    return null;
  },
  // ---- The one true faith (theocratic consolidation) ----
  (_faction, region) => {
    if (region.year >= 1800) {
      return {
        id: 'one_true_faith',
        objective: 'Bind the faithful under one sacred banner',
        govTypes: ['theocracy'],
        generatedYear: region.year,
        targetYear: region.year + 20,
        successCondition: (f, r) => {
          const devout = f.settlementIds.filter((id) => (r.settlement(id)?.loyaltyToFaction ?? 0) >= 80).length;
          return f.settlementIds.length >= 4 && devout >= 3;
        },
        description: 'One creed, one flock, one will.',
        sectorFocus: 'culture',
        settlementBias: ['river', 'coastal'],
      };
    }
    return null;
  },
  // ---- Iron-fisted rule (totalitarian consolidation) ----
  (_faction, region) => {
    if (region.year >= 1920) {
      return {
        id: 'iron_fisted_rule',
        objective: 'Rule with an iron fist — total obedience',
        govTypes: ['fascist', 'one_party', 'junta', 'corporate'],
        generatedYear: region.year,
        targetYear: region.year + 12,
        successCondition: (f, r) => {
          const obedient = f.settlementIds.filter((id) => (r.settlement(id)?.loyaltyToFaction ?? 0) >= 85).length;
          return f.militaryStrength >= 30 && obedient >= 2;
        },
        description: 'Loyalty is not asked for — it is enforced.',
        sectorFocus: 'military',
        settlementBias: ['plains', 'mountain'],
      };
    }
    return null;
  },
  // ---- Forest dominion (timber economies) ----
  (faction, region) => {
    if (faction.settlementIds.length >= 1) {
      return {
        id: 'forest_dominion',
        objective: 'Master the great forests and their timber wealth',
        govTypes: ['peoples_republic', 'const_monarchy', 'merchant_republic', 'parliamentary'],
        generatedYear: region.year,
        targetYear: region.year + 13,
        successCondition: (f, r) => {
          const timber = f.settlementIds.filter((id) => r.settlement(id)?.resourceFocus === 'wood').length;
          return timber >= 3;
        },
        description: 'From the deep woods, an empire of timber.',
        sectorFocus: 'industry',
        settlementBias: ['forest'],
      };
    }
    return null;
  },
  // ---- Mercantile hegemony (the richest of all) ----
  (faction, region) => {
    if (faction.treasury >= 300) {
      return {
        id: 'mercantile_hegemony',
        objective: 'Amass a fortune unrivalled in the region',
        govTypes: ['merchant_republic', 'corporate', 'parliamentary'],
        generatedYear: region.year,
        targetYear: region.year + 14,
        successCondition: (f) => f.treasury >= 700,
        description: 'Gold is the truest crown.',
        sectorFocus: 'commerce',
        settlementBias: ['river', 'coastal'],
      };
    }
    return null;
  },
  // ---- Revolutionary vanguard (the people's cause) ----
  (_faction, region) => {
    if (region.year >= 1917) {
      return {
        id: 'revolutionary_vanguard',
        objective: 'Lead the revolutionary vanguard to the masses',
        govTypes: ['peoples_republic', 'one_party'],
        generatedYear: region.year,
        targetYear: region.year + 16,
        successCondition: (f, r) => {
          const totalPop = f.settlementIds.reduce((sum, id) => {
            const s = r.settlement(id);
            return sum + (s ? r.popOf(s) : 0);
          }, 0);
          return f.settlementIds.length >= 5 && totalPop >= 400;
        },
        description: 'The future is a tide; we are its vanguard.',
        sectorFocus: 'industry',
        settlementBias: ['plains', 'river', 'mountain'],
      };
    }
    return null;
  },
];

/** Strategic families goals fall into — drives inter-faction conflict & alliance
 *  scoring. Conquering families (military/expansion) clash over scarce ground;
 *  building families (economic/cultural) coexist far more readily. */
const FACTION_GOAL_CATEGORIES: Record<'military' | 'expansion' | 'economic' | 'cultural', string[]> = {
  military: ['military_supremacy', 'resource_monopoly', 'fortress_realm', 'iron_fisted_rule'],
  expansion: ['territorial_expansion', 'convert_heathen', 'colonial_reach', 'one_true_faith', 'revolutionary_vanguard'],
  economic: ['enrich_treasury', 'trade_dominance', 'naval_trade_empire', 'mercantile_hegemony', 'industrial_powerhouse', 'forest_dominion', 'agrarian_heartland'],
  cultural: ['dynastic_supremacy', 'scholarly_supremacy', 'cultural_golden_age'],
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
  cargoType: SectorId | null; // Phase 6: dominant sector cargo flowing this route
  cargoPriority?: SectorId | null; // Phase A: governor's manual cargo pin (overrides the auto tag)
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

// ---- Climate & the reckoning (GDD §8.2, §3.2 eras 7–8) ----

/** Atmospheric CO₂ at the wagon's arrival, 1900 (GDD §8.2). */
export const CO2_BASE_PPM = 295;
/** Warming equilibrium per ppm above base: 600 ppm ≈ +3.4°C at rest. */
const WARMING_PER_PPM = 0.011;
/** The ~20-year lag (GDD §8.2): warming closes 1/40th of the gap per
 *  climate tick (two ticks a game-year) — the bill arrives two governments
 *  after the smoke. */
const WARMING_LAG_TICKS = 40;
/** Adaptation works open once the threat is on the survey maps. */
export const SEA_WALL_YEAR = 2025;
/** Era 8 begins: the century's verdict is read (GDD §3.2). */
export const BRANCH_YEAR = 2040;
/** The game ends 1 Jan 2100 with the Century Report — sandbox continues. */
export const CENTURY_YEAR = 2100;
/** Geoengineering: total °C shed by stratospheric aerosol injection. */
export const GEOENGINEER_COOLING = 0.4;
/** How long the aerosols stay effective: 2 years × 60 days/year. */
export const GEOENGINEER_DURATION_DAYS = 120;
/** Accord compliance: below this fraction the signatory is a free-rider. */
export const ACCORD_DEFECT_THRESHOLD = 0.35;
/** Maximum world-emissions cut from fully compliant accord coverage. */
export const ACCORD_EMISSION_CUT = 0.28;

/** The endgame's three skies (GDD §3.2): chosen by your climate, economy,
 *  and regime outcomes — not the calendar. */
export type EraBranch = 'solarpunk' | 'dystopia' | 'drowned';

/** The four paths to victory — player wins when any one is achieved. */
export type WinPath = 'unification' | 'legacy' | 'domination' | 'solarpunk';
export interface WinCondition {
  path: WinPath;
  year: number;
  details: string;
}

/** The verdict at 1 Jan 2100 (GDD §8.4): graded, not won. */
export interface CenturyReport {
  branch: EraBranch | null;
  pop: number;
  towns: number;
  gdp: number;
  treasury: number;
  co2ppm: number;
  warmingC: number;
  techs: number;
  laws: number;
  legitimacy: number;
  grades: { stewardship: string; prosperity: string; liberty: string; standing: string };
  verdict: string;
}

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

/** Hard cap on settlements per region — see docs/design/map-scale.md. Raised
 *  with the larger REGION_N map (more room) and the viewport-bound renderer. */
export const MAX_SETTLEMENTS = 24;

export class RegionSim {
  rng: Rng;
  /** Separate deterministic stream for rival faction AI decisions. Kept apart
   *  from the main `rng` so AI choices never perturb the colony's own stochastic
   *  outcomes (events, washouts, raids) — preserving cross-feature determinism. */
  aiRng: Rng;
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
  /** Net change in the treasury over the last full month (+ income, − outgo).
   *  Surfaced in the HUD so the trend is legible, not a flickering arrow. */
  treasuryDeltaMonth = 0;
  /** Snapshot of the treasury at the previous month boundary. */
  private prevMonthTreasury = 0;
  taxRate = 0.1; // 0–0.3
  servicesLevel = 1; // 0–2: health & schools — satisfaction + mortality
  militiaLevel = 1; // 0–2: funded defense
  gdpLastMonth = 0;
  gameOver = false;
  /** Research: nodes that have been completed (ids). Start nodes (cost 0) pre-seeded. */
  researched: Set<string> = new Set(['steam_power', 'common_law']);
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
  passedLaws: Set<string> = new Set();
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
  // ---- Climate & the reckoning (GDD §8.2, eras 7–8) ----
  /** The global ledger: every chimney on earth exhales into one number. */
  co2ppm = CO2_BASE_PPM;
  /** Realized warming, °C above 1900 — lags the ledger by ~20 years. */
  warmingC = 0;
  /** ppm added by the last climate tick (player + world), for the UI. */
  emissionsLastMonth = 0;
  /** The 2040 verdict, once read. Null until era 8 opens. */
  eraBranch: EraBranch | null = null;
  /** The 1 Jan 2100 Century Report; sandbox continues after it. */
  centuryReport: CenturyReport | null = null;
  /** Compliance per rival (0–1): drifts monthly, commerce-driven. Below
   *  ACCORD_DEFECT_THRESHOLD = free-rider. Cleared when accord torn. */
  accordCompliance: Record<number, number> = {};
  /** Rivals whose defection has already triggered a log (transient: resets on load). */
  private accordDefectLogged = new Set<number>();
  /** True once Deploy is activated; the aerosols are in the stratosphere. */
  geoDeployed = false;
  /** Day the aerosols were injected; used to phase the cooling. */
  geoDeployDay = -1;
  // ---- Monetary system (GDD §5.1): central bank, credit cycle, FX ----
  /** Annual policy rate (1–15%); player-adjustable once central_bank_charter enacted. */
  policyRate = NEUTRAL_RATE;
  /** Private sector credit as fraction of monthly GDP; grows at low rates. */
  privateLeverage = 0.0;
  /** 0–100 market confidence: below 30 triggers deleveraging crisis. */
  confidence = 70;
  /** Annual inflation rate; driven by credit expansion and money printing. */
  inflationRate = 0.02;
  /** float = market-driven; peg = fixed rate (drains reserves); print = money creation. */
  monetaryRegime: MonetaryRegime = 'float';
  /** Outstanding sovereign bond debt (£). */
  nationalDebt = 0;
  /** Derived from debt/GDP, inflation, and stability — updated monthly. */
  creditRating: CreditRating = 'AA';
  /** Domestic currency value (1.0 = par; < 1.0 = devalued). */
  exchangeRate = 1.0;
  /** Prevents the 1929-analog crash from firing twice. */
  private crashFired = false;
  // ---- Lender system: NPC bankers and merchants offering loans ----
  lenders: Lender[] = [];
  /** Player's active loans from lenders. */
  loans: Loan[] = [];
  /** Outstanding loan balance borrowed from the Central Bank discount window. */
  centralBankLoan = 0;
  currencySymbol: CurrencySymbol = '$';
  marketDisruptionEnd = 0;
  /** A telegraphed future switch; softens the shock if 6+ months old. */
  currencyAnnouncement: CurrencyAnnouncement | null = null;
  /** In-progress currency transition; output recovers linearly to endDay. */
  currencyTransition: CurrencyTransition | null = null;
  // ---- Design-screen choices (region flip / nation flip) ----
  expansionSpeed: 'cautious' | 'steady' | 'aggressive' = 'steady';
  tradeOpenness: 'protectionist' | 'balanced' | 'free-trade' = 'balanced';
  economicSystem: 'laissez-faire' | 'mixed' | 'planned' = 'mixed';
  militaryDoctrine: 'defensive' | 'professional' | 'expansionist' = 'professional';
  allianceStance: 'isolationist' | 'opportunist' | 'coalition-builder' = 'opportunist';
  // ---- Phase 0: Regional Gameplay Expansion ----
  /** 100×100 grid tracking tile visibility: fogged/explored/scouted */
  explorationMap: TileVisibility[][] = [];
  /** One-time latch: player territory (own + vassal) has reached ≥50% of the region.
   *  Set in monthlyUpdate; never cleared after set. Surface "Proclaim Nation" in UI. */
  proclamationReady = false;
  /** Scout units exploring the map */
  scouts: Scout[] = [];
  /** Monthly history for sparklines: last 12 months of key metrics. */
  monthlyHistory: Array<{ gdp: number; treasury: number; inflation: number; employment: number }> = [];
  /** Regional factions competing for dominance (includes player faction) */
  regionalFactions: RegionalFaction[] = [];
  /** Player faction id (always 0 or first in list) */
  playerFactionId = 0;
  /** Difficulty chosen at town design — tunes the regional AI competitors. */
  aiDifficulty: AiDifficulty = 'normal';
  /** Currency exchange rates: { from:factionId:to:factionId => rate } */
  exchangeRates: Record<string, number> = {};
  /** Global trade volume: used to calculate currency dominance */
  globalTradeVolume = 0;
  /** Next scout id for creating new scouts */
  private nextScoutId = 5000;
  /** Faction IDs whose settlement has been revealed through fog (first-contact tracking). */
  private contactedFactionIds = new Set<number>();
  /** Set when any win condition is achieved; sandbox continues but result is displayed. */
  winCondition: WinCondition | null = null;
  /** Track triggered epilogue events (post-2100 flavor) to avoid repeats */
  private triggeredEpilogueEvents = new Set<string>();
  private seaRiseAnnounced = false;
  private lastTidalLogDay = -999;
  private droughtAnnounced = false;
  private railAnnounced = false;
  private highwayAnnounced = false;
  private maglevAnnounced = false;
  private nextId = 1000;
  private nextEventDay: number;
  private townNamePool: string[];

  constructor(rng: Rng, minute: number, map: RegionMap, weather: Weather) {
    this.rng = rng;
    // Derive the AI stream deterministically from the main seed so it stays
    // reproducible without sharing draws with the colony simulation.
    this.aiRng = new Rng((rng.getState() ^ 0x9e3779b9) >>> 0);
    this.minute = minute;
    this.map = map;
    this.weather = weather;
    this.nextEventDay = this.day + 4 + rng.int(4);
    this.townNamePool = [...TOWN_NAMES];
    // Initialize fog of war: 100×100 grid of fogged tiles
    this.explorationMap = Array.from({ length: 100 }, () =>
      Array.from({ length: 100 }, () => 'fogged' as TileVisibility)
    );
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

  // ---- Phase 0: Exploration & Fog of War ----

  /** Reveal tiles in a circular radius around a point. */
  revealTiles(centerX: number, centerY: number, radius: number, type: TileVisibility = 'explored'): void {
    const radiusSq = radius * radius;
    // ponytail: clamp to bounding box — avoids 10,000 iterations for small radii
    const x0 = Math.max(0, Math.floor(centerX - radius));
    const x1 = Math.min(99, Math.ceil(centerX + radius));
    const y0 = Math.max(0, Math.floor(centerY - radius));
    const y1 = Math.min(99, Math.ceil(centerY + radius));
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const dx = x - centerX;
        const dy = y - centerY;
        if (dx * dx + dy * dy <= radiusSq) {
          if (type === 'scouted' || this.explorationMap[x][y] === 'fogged') {
            this.explorationMap[x][y] = type;
          }
        }
      }
    }
    this.checkFirstContact();
  }

  /** Fire a first-contact event when a rival's settlement is revealed through fog. */
  private checkFirstContact(): void {
    for (const faction of this.regionalFactions) {
      if (faction.id === this.playerFactionId) continue;
      if (this.contactedFactionIds.has(faction.id)) continue;
      for (const sid of faction.settlementIds) {
        const s = this.settlement(sid);
        if (!s) continue;
        const sx = Math.round(s.x), sy = Math.round(s.y);
        if (sx >= 0 && sx < 100 && sy >= 0 && sy < 100 && this.explorationMap[sx][sy] !== 'fogged') {
          this.contactedFactionIds.add(faction.id);
          const disp = faction.aggressiveness > 60 ? 'hostile' : faction.aggressiveness < 30 ? 'cautious' : 'watchful';
          this.addLog(
            `FIRST CONTACT: ${faction.name} — a ${faction.regime.replace(/_/g, ' ')} power ` +
            `has been scouted. Garrison: ${faction.militaryStrength}. Initial disposition: ${disp}.`,
            'info',
          );
          break;
        }
      }
    }
  }

  /** Check if a tile is visible to a faction for settlement founding. */
  canFoundSettlement(x: number, y: number, factionId: number): boolean {
    // Can only found in tiles visible to the faction (revealed by settlements + scouts)
    if (!this.isVisibleToFaction(x, y, factionId)) return false;
    // Can't found where another settlement already exists
    return !this.settlements.some((s) => Math.abs(s.x - x) < 4 && Math.abs(s.y - y) < 4);
  }

  /** Get the faction object by id. */
  faction(id: number): RegionalFaction | undefined {
    return this.regionalFactions.find((f) => f.id === id);
  }

  /** Difficulty knobs for the regional AI competitors (GDD §6.2). */
  aiKnobs(): typeof AI_DIFFICULTY[AiDifficulty] {
    return AI_DIFFICULTY[this.aiDifficulty] ?? AI_DIFFICULTY.normal;
  }

  /** Get garrison strength of a settlement, including stationed units (GDD §7.1). */
  garrisonOf(settlement: Settlement): number {
    let strength = settlement.garrisonStrength || 0;
    // Add contribution from stationed units: each unit contributes power proportional to its type
    for (const unit of settlement.stationedUnits) {
      const unitDef = UNIT_TYPES[unit.type];
      strength += unit.count * unitDef.powerPerUnit;
    }
    return strength;
  }

  /** Get total unit count stationed at a settlement (GDD §7.1). */
  garrisonUnitCount(settlement: Settlement): number {
    return settlement.stationedUnits.reduce((sum, u) => sum + u.count, 0);
  }

  /** Get comprehensive statistics for a faction (Phase 4: UI foundation).
   *  Useful for faction status panels and activity log context. */
  getFactionStats(factionId: number): {
    id: number;
    name: string;
    population: number;
    settlements: number;
    treasury: number;
    militaryStrength: number;
    techProgress: number;
    currentGoal: string | null;
    goalProgress: number;
    allies: number[];
    rivals: number[];
  } | null {
    const faction = this.faction(factionId);
    if (!faction) return null;

    const population = faction.settlementIds.reduce((sum, id) => {
      const s = this.settlement(id);
      return sum + (s ? this.popOf(s) : 0);
    }, 0);

    // Calculate goal progress as percentage toward target year
    let goalProgress = 0;
    if (faction.currentGoal) {
      const elapsed = this.year - faction.currentGoal.generatedYear;
      const total = faction.currentGoal.targetYear - faction.currentGoal.generatedYear;
      goalProgress = total > 0 ? Math.round((elapsed / total) * 100) : 0;
    }

    // Find allies and rivals
    const allies: number[] = [];
    const rivals: number[] = [];
    for (const other of this.regionalFactions) {
      if (other.id === faction.id) continue;
      if (this.areAllied(faction.id, other.id)) {
        allies.push(other.id);
      } else if (faction.currentGoal && other.currentGoal) {
        const conflict = this.evaluateGoalConflict(faction.currentGoal, other.currentGoal);
        if (conflict > 60) {
          rivals.push(other.id);
        }
      }
    }

    return {
      id: faction.id,
      name: faction.name,
      population,
      settlements: faction.settlementIds.length,
      treasury: Math.round(faction.treasury),
      militaryStrength: faction.militaryStrength,
      techProgress: Math.round(faction.techProgress),
      currentGoal: faction.currentGoal?.objective ?? null,
      goalProgress,
      allies,
      rivals,
    };
  }

  // ---- Phase 0: Territory, borders & resource visualization ----

  /** Territory radius (in 0..100 region coords) a settlement projects onto the
   *  map. Population is the main driver; a garrison pushes the frontier further
   *  (with diminishing returns, so military reach grows slower than the town);
   *  civic works thicken the hold. Deterministic, so the border map is stable. */
  territoryRadius(t: Settlement): number {
    const pop = Math.max(0, this.popOf(t));
    const popReach = 4 + Math.sqrt(pop) * 0.45; // hamlet ~5 units, city ~14
    const garrisonReach = Math.sqrt(Math.max(0, t.garrisonStrength)) * 0.6;
    const devReach = (t.buildings?.length ?? 0) * 0.4;
    return Math.min(18, popReach + garrisonReach + devReach);
  }

  /** Everything that can move a border, flattened to a string for cheap cache
   *  invalidation: positions, population, garrison, development and ownership. */
  private territorySignature(): string {
    let s = `${this.settlements.length}`;
    for (const t of this.settlements) {
      s += `|${t.id}:${t.x.toFixed(1)},${t.y.toFixed(1)},${Math.round(this.popOf(t))},` +
        `${Math.round(t.garrisonStrength)},${t.factionId},${t.buildings?.length ?? 0}`;
    }
    return s;
  }

  private _territoryCache: { sig: string; result: TerritoryControl } | null = null;

  /** Compute the territory control grid over the REGION_N×REGION_N map: each
   *  land cell is claimed by the faction projecting the strongest influence
   *  (radius − distance) onto it, or left unclaimed if no settlement reaches.
   *  Cached by signature so it's cheap to call every render frame. */
  computeTerritoryGrid(): TerritoryControl {
    const sig = this.territorySignature();
    if (this._territoryCache && this._territoryCache.sig === sig) {
      return this._territoryCache.result;
    }
    const N = REGION_N;
    const grid = new Int8Array(N * N);
    const prep = this.settlements.map((t) => {
      const cell = this.map.coordToCell(t.x, t.y);
      return { cx: cell.x, cy: cell.y, r: (this.territoryRadius(t) / 100) * N, fid: t.factionId };
    });
    let landCells = 0;
    const area = new Map<number, number>();
    for (let x = 0; x < N; x++) {
      for (let y = 0; y < N; y++) {
        const idx = x * N + y;
        if (this.map.isWater(x, y)) { grid[idx] = -2; continue; }
        landCells++;
        let bestFid = -1;
        let bestInf = 0;
        for (const p of prep) {
          const d = Math.hypot(x - p.cx, y - p.cy);
          if (d > p.r) continue;
          const inf = p.r - d;
          if (inf > bestInf) { bestInf = inf; bestFid = p.fid; }
        }
        grid[idx] = bestFid;
        if (bestFid >= 0) area.set(bestFid, (area.get(bestFid) ?? 0) + 1);
      }
    }
    const control = new Map<number, number>();
    if (landCells > 0) for (const [fid, cells] of area) control.set(fid, cells / landCells);
    const result: TerritoryControl = { grid, control, landCells };
    this._territoryCache = { sig, result };
    return result;
  }

  /** Fraction (0..1) of claimable regional land a faction controls. */
  territoryControlOf(factionId: number): number {
    return this.computeTerritoryGrid().control.get(factionId) ?? 0;
  }

  /** The player's effective territory share (0..1), counting own settlements
   *  plus any vassal factions' territory. Crossing 0.5 gates the Nation proclamation. */
  playerTerritoryControl(): number {
    const playerFaction = this.faction(this.playerFactionId);
    let total = this.territoryControlOf(this.playerFactionId);
    if (playerFaction) {
      for (const vassalId of playerFaction.vassals) {
        total += this.territoryControlOf(vassalId);
      }
    }
    return Math.min(1, total);
  }

  /** Classify a settlement's three headline goods as surplus / balanced /
   *  deficit, for the at-a-glance resource icons on the map. */
  getSettlementResourceStatus(t: Settlement): SettlementResourceStatus {
    const pop = Math.max(1, this.popOf(t));
    // Food: stored grain per head — a frontier town wants a few days' buffer.
    const foodPer = t.food / pop;
    const food: ResourceStatus = foodPer > 3 ? 'surplus' : foodPer < 1 ? 'deficit' : 'balanced';
    // Wood: timber stock against the housing the population needs.
    const woodPer = t.wood / pop;
    const wood: ResourceStatus = woodPer > 2 ? 'surplus' : woodPer < 0.5 ? 'deficit' : 'balanced';
    // Goods: non-farm output per worker — does the town make more than it eats?
    const workers = Math.max(1, this.workersOf(t));
    const industrial = t.sectors.industry.output + t.sectors.services.output + t.sectors.information.output;
    const goodsPer = industrial / workers;
    const goods: ResourceStatus = goodsPer > 6 ? 'surplus' : goodsPer < 2 ? 'deficit' : 'balanced';
    return { food, wood, goods };
  }

  /** Initialize the regional faction system for the player. Called once when entering region mode. */
  regionalizeFactionSystem(homeSettlement: Settlement): void {
    // Create the player faction (faction 0)
    const playerFaction: RegionalFaction = {
      id: 0,
      name: 'Your Nation',
      color: '#0066FF', // blue for player
      capital: homeSettlement.id,
      settlementIds: [homeSettlement.id],
      treasury: 100, // starting capital
      treasuryByCurrency: { 0: 100 }, // faction 0 uses currency 0
      militaryStrength: 5,
      techProgress: 0,
      centralBank: null, // not yet established
      currencyId: 0,
      currencyName: 'Pounds', // starting currency name
      aggressiveness: 50, // neutral
      regime: 'parliamentary', // player runs a representative government by default
      techFocus: 'agriculture', // starting tech focus
      aiGoal: 'establish dominance',
      lastScoutDay: -1,
      lastUpdateDay: this.day,
      updateFrequency: 30, // update every month (for player, mostly unused)
      currentGoal: null, // player has no procedural goal
      lastGoalCheckDay: this.day,
      overlordId: null,
      vassals: [],
      lastRaidDay: -999,
    };

    this.regionalFactions.push(playerFaction);
    this.playerFactionId = 0;

    // Reveal the starting settlement and 3-tile radius
    this.revealTiles(homeSettlement.x, homeSettlement.y, 3, 'explored');

    // Initialize exchange rates (will be expanded with rival factions)
    this.exchangeRates['0:0'] = 1.0; // player currency to itself

    // Initialize rival factions (simplified: 2-3 rivals spawn on the map)
    this.initializeRivalFactions();
  }

  /** Create initial rival factions competing for regional dominance. */
  private initializeRivalFactions(): void {
    // Simplified rival faction system: create 2-3 rival AI factions
    const rivalNames = ['Northern Alliance', 'Eastern Confederacy', 'Southern League'];
    const rivalColors = ['#FF0000', '#00AA00', '#FFAA00']; // red, green, orange
    const numRivals = 2 + this.rng.int(2); // 2-3 rivals
    const knobs = this.aiKnobs();
    // Regimes that already exist this early in the century — drives each rival's
    // goal palette. Drawn from the AI stream so the colony seed is untouched.
    const eraRegimes = RIVAL_REGIMES.filter((g) => g.eraFrom <= this.year).map((g) => g.id);

    for (let i = 0; i < numRivals; i++) {
      const rivalId = i + 1; // ids 1, 2, 3, etc.
      const regime = eraRegimes[this.aiRng.int(eraRegimes.length)] ?? 'abs_monarchy';
      const faction: RegionalFaction = {
        id: rivalId,
        name: rivalNames[i] || `Rival Faction ${i}`,
        color: rivalColors[i] || '#999999',
        capital: -1, // no capital yet; will be set when they found a settlement
        settlementIds: [],
        treasury: 80 + this.rng.int(40), // 80-120 gold
        treasuryByCurrency: { [rivalId]: 80 + this.rng.int(40) },
        militaryStrength: 3 + this.rng.int(3), // 3-6
        techProgress: 0,
        centralBank: null,
        currencyId: rivalId,
        currencyName: ['Francs', 'Guilders', 'Crowns', 'Marks'][i] || 'Marks',
        aggressiveness: Math.max(0, Math.min(100, 30 + this.rng.int(70) + knobs.aggressionBias)),
        regime,
        techFocus: ['mining', 'forestry', 'farming'][this.rng.int(3)],
        aiGoal: 'expand territory',
        lastScoutDay: -1,
        lastRaidDay: -999,
        lastUpdateDay: this.day,
        updateFrequency: knobs.updateFreq, // difficulty-scaled cadence (GDD §6.2)
        currentGoal: null, // will be generated on first AI update
        lastGoalCheckDay: this.day,
        overlordId: null,
        vassals: [],
      };

      faction.treasury = 120 + this.aiRng.int(60); // enough to found immediately
      // ponytail: mark as immediately due so the first monthly tick (day 30) bootstraps their settlement
      faction.lastUpdateDay = this.day - faction.updateFrequency;
      this.regionalFactions.push(faction);

      // Initialize exchange rates for this rival
      this.exchangeRates[`0:${rivalId}`] = 1.0; // start at parity
      this.exchangeRates[`${rivalId}:0`] = 1.0;
    }
  }

  // ---- the route network (M6b: transportation.md §3) ----
  routeBetween(aId: number, bId: number): Route | undefined {
    return this.routes.find((r) => (r.a === aId && r.b === bId) || (r.a === bId && r.b === aId));
  }

  /** Throughput a route can actually carry: capacity scales with condition. */
  effectiveCapacity(r: Route): number {
    return ROUTE_SPECS[r.kind].capacity * (r.condition / 100);
  }

  /** Spare capacity on the tightest leg of a path — the bottleneck a caravan
   *  must squeeze through. Loop, not Math.min(...legs.map()): no per-call array
   *  and no spread (which overflows the stack on a very long corridor). */
  private legCapacity(legs: Route[]): number {
    let min = Infinity;
    for (const r of legs) {
      const spare = this.effectiveCapacity(r) - r.freight;
      if (spare < min) min = spare;
    }
    return min;
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
      path, terrainCost: c ? c.cost : path.length * 2, freight: 0, cargoType: null,
    });
  }

  /** Settlement ids reachable from `start` through the route graph (one BFS).
   *  Shared by connectedToAll() and networkAnchor() so the traversal lives once. */
  private reachableFrom(start: number): Set<number> {
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
    return seen;
  }

  /** The town a faction's network grows from: its capital, else its first town. */
  private factionRoot(factionId: number): number {
    const f = this.faction(factionId);
    if (f && f.capital >= 0) return f.capital;
    const first = this.settlements.find((s) => s.factionId === factionId);
    return first ? first.id : -1;
  }

  /** Pick the existing same-faction town a newcomer should graft onto: the
   *  nearest one already wired into the faction backbone, so the network grows
   *  from one spine instead of each town sprouting its own roads. Falls back to
   *  the root when nothing is connected yet. */
  private networkAnchor(town: Settlement): number {
    const root = this.factionRoot(town.factionId);
    if (root < 0 || root === town.id) return root;
    const onBackbone = this.reachableFrom(root); // single BFS, not per-peer
    let best = root, bestD = Infinity;
    for (const s of this.settlements) {
      if (s.id === town.id || s.factionId !== town.factionId || !onBackbone.has(s.id)) continue;
      const dx = s.x - town.x, dy = s.y - town.y;
      const d = dx * dx + dy * dy; // squared distance: ordering only, skip sqrt
      if (d < bestD) { bestD = d; best = s.id; }
    }
    return best;
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
    return { total: Math.ceil((c.cost / CELL_SCALE) * ROUTE_SPECS[kind].buildPerCost * this.devFactor()), cells: c.path.length, breakdown };
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
    return this.researched.has(id);
  }

  /** Research points generated per day; scales with population and boosts from nodes. */
  researchRate(): number {
    const base = this.settlements.length * 0.5 + this.totalPop() * 0.004;
    let mult = 1;
    if (this.has('public_education')) mult *= 1.5;
    if (this.has('compulsory_schooling')) mult *= 1.2;
    if (this.has('womens_suffrage')) mult *= 1.1;
    if (this.has('electrical_grid')) mult *= 1.25;
    if (this.has('telecommunications')) mult *= 1.15;
    if (this.has('computing')) mult *= 1.25;
    if (this.has('internet')) mult *= 1.15;
    if (this.has('artificial_intelligence')) mult *= 1.25;
    if (this.passedLaws.has('national_education_act')) mult *= 1.3;
    if (this.policyActive('research_grants')) mult *= 1.2;
    // Phase 2: every university adds its laboratories to the effort
    for (const t of this.settlements) {
      for (const id of t.buildings) {
        const def = REGION_BUILDINGS_MAP.get(id);
        if (def?.research) mult *= 1 + def.research;
      }
    }
    return base * mult;
  }

  /** Development factor for money costs (Baumol's cost disease): public works
   *  track the economy's wage/output level, which climbs as labor moves up the
   *  value chain. Reads the cached monthly GDP — O(1), safe on the per-row HUD
   *  path. Floors at 1, so a fresh state pays the raw 1900 prices. */
  devFactor(): number {
    const pop = this.totalPop();
    const gdpPerCapita = pop > 0 ? this.gdpLastMonth / pop : 0;
    const ratio = gdpPerCapita / TUNING.baumolBaseGdpPerCapita;
    return Math.max(1, ratio ** TUNING.baumolExp);
  }

  /** Research-cost scale ("ideas are getting harder to find"): each tech costs
   *  more RP as the nation grows, so it stays a real investment instead of being
   *  blitzed. Driven by the RAW size rate (not the boosted researchRate), so
   *  research-boost buildings/civics still give a net speedup. Floors at 1. */
  researchScale(): number {
    const baseRate = this.settlements.length * 0.5 + this.totalPop() * 0.004;
    const ratio = baseRate / TUNING.researchBaseRate;
    return Math.max(1, ratio ** TUNING.researchScaleExp);
  }

  /** What a civic work actually costs to raise here and now (Baumol-scaled). */
  cityBuildCost(def: RegionalBuildingDef): number {
    return Math.round(def.cost * this.devFactor());
  }

  /** What a tech/civics node actually costs in RP for a nation this size. */
  techCost(node: TechNode): number {
    return Math.ceil(node.cost * this.researchScale());
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
    if (this.researchProgress >= this.techCost(node)) {
      this.researched.add(this.activeResearch);
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

  // ---- Climate & the reckoning (GDD §8.2, §3.2 eras 7–8) ----

  /** Your own chimneys: pop-scaled, rising with each industrial node,
   *  falling with green tech and the Carbon Levy. Deliberately small next
   *  to the world's output — one green player can't solo-fix the sky. */
  playerEmissions(): number {
    let intensity = 0.15; // the steam era's coal-fired baseline
    if (this.has('steel_industry')) intensity += 0.2;
    if (this.has('chemical_industry')) intensity += 0.15;
    if (this.has('combustion_engine')) intensity += 0.25;
    if (this.has('electrical_grid')) intensity += 0.25;
    if (this.has('mass_production')) intensity += 0.3;
    if (this.has('smart_grid')) intensity *= 0.8;
    if (this.has('renewables')) intensity *= 0.6;
    if (this.has('fusion_power')) intensity *= 0.15;
    if (this.has('carbon_capture')) intensity *= 0.4;
    if (this.passedLaws.has('carbon_levy')) intensity *= 0.7;
    if (this.policyActive('green_subsidies')) intensity *= 0.85;
    if (this.eraBranch === 'solarpunk') intensity *= 0.8;
    return (this.totalPop() / 1000) * intensity * 0.04;
  }

  /** Everyone else's chimneys. The old world industrializes whether you
   *  meet it or not; after 2030 it slowly decarbonizes on its own — but
   *  only proven green tech *diffuses* fast enough to bend the curve
   *  (GDD §5.6: lagging nations adopt proven tech at discount). Climate
   *  accords with compliant signatories add a further cut. */
  worldEmissions(): number {
    const rivalPop = this.rivals.reduce((s, rv) => s + rv.pop, 0);
    const worldPop = Math.max(rivalPop, 12000) / 1000;
    const ramp = Math.max(0.05, Math.min(1, (this.year - 1905) / 55));
    const decarb = this.year > 2030 ? Math.max(0.35, 1 - (this.year - 2030) / 100) : 1;
    let diffusion = 1;
    if (this.has('renewables')) diffusion *= 0.8;
    if (this.has('fusion_power')) diffusion *= 0.5;
    if (this.has('carbon_capture')) diffusion *= 0.7;
    // Climate accords: each compliant signatory drags their share down
    let accordFactor = 1;
    if (this.rivals.length > 0) {
      const totalPop = this.rivals.reduce((s, rv) => s + rv.pop, 0);
      let coveredPop = 0;
      for (const rv of this.rivals) {
        if (rv.treaties.includes('climate_accord')) {
          coveredPop += rv.pop * (this.accordCompliance[rv.id] ?? 1);
        }
      }
      if (totalPop > 0) accordFactor = 1 - (coveredPop / totalPop) * ACCORD_EMISSION_CUT;
    }
    return worldPop * 0.045 * ramp * decarb * diffusion * accordFactor;
  }

  /** The thin blue ghost-line (GDD §8.2): where the ledger lands by 2100
   *  if the current rate holds (discounted for the world's own transition). */
  projectedWarming(): number {
    const ticksLeft = Math.max(0, (CENTURY_YEAR - this.year) * 2);
    const ppm2100 = this.co2ppm + (this.playerEmissions() + this.worldEmissions()) * ticksLeft * 0.85;
    return Math.max(0, (ppm2100 - CO2_BASE_PPM) * WARMING_PER_PPM);
  }

  /** The climate tick — runs with every monthly update, from the first
   *  decade (the ledger runs from day one; only its payoff waits). No RNG
   *  draws here: climate is arithmetic, not luck. */
  private tickClimate(): void {
    const emit = this.playerEmissions() + this.worldEmissions();
    this.emissionsLastMonth = emit;
    this.co2ppm += emit;
    const equilibrium = Math.max(0, (this.co2ppm - CO2_BASE_PPM) * WARMING_PER_PPM);
    this.warmingC += (equilibrium - this.warmingC) / WARMING_LAG_TICKS;
    // Geoengineering: phased aerosol cooling over the active window
    if (this.geoDeployed && this.day - this.geoDeployDay < GEOENGINEER_DURATION_DAYS) {
      const ticksInWindow = GEOENGINEER_DURATION_DAYS / 30; // 30-day climate ticks
      this.warmingC = Math.max(0, this.warmingC - GEOENGINEER_COOLING / ticksInWindow);
    }
    this.tickAccords();
    // The ghost-line announcement: quiet dread as UI (GDD §8.2)
    if (!this.seaRiseAnnounced && this.warmingC >= 1.2 && this.settlements.some((t) => t.site.coastal)) {
      this.seaRiseAnnounced = true;
      this.addLog(
        `+${this.warmingC.toFixed(1)}°C: State surveyors pencil the projected 2100 waterline onto the coastal charts. ` +
        `It runs through streets people live on.`,
        'bad',
      );
    }
    // The sea collects (GDD §8.2): tidal flooding on unwalled coastal towns
    if (this.year >= 2035 && this.warmingC > 1.5) {
      const severity = (this.warmingC - 1.5) * (this.eraBranch === 'drowned' ? 1.5 : 1);
      let hit = false;
      for (const t of this.settlements) {
        if (!t.site.coastal || t.seaWall || this.popOf(t) < 1) continue;
        t.food *= Math.max(0.7, 1 - 0.05 * severity);
        this.removePop(t, this.popOf(t) * 0.0015 * severity);
        t.satisfaction = Math.max(0, t.satisfaction - 2 * severity);
        hit = true;
      }
      if (hit && this.day - this.lastTidalLogDay > 300) {
        this.lastTidalLogDay = this.day;
        this.addLog(
          'King tides take the low streets again — unwalled coastal towns pump out cellars and count who left.',
          'bad',
        );
      }
    }
    if (this.eraBranch === null && this.year >= BRANCH_YEAR) this.decideBranch();
    if (!this.centuryReport && this.year >= CENTURY_YEAR) this.buildCenturyReport();
    this.triggerEpilogueEvent(); // post-2100 flavor events
  }

  /** Monthly: drift accord compliance and detect free-riders (GDD §8.2).
   *  Commerce-driven signatories stay honest; expansion-minded ones quietly
   *  cheat. First detection triggers one log entry; the player can sanction. */
  private tickAccords(): void {
    for (const rv of this.rivals) {
      if (!rv.treaties.includes('climate_accord')) {
        if (this.accordCompliance[rv.id] !== undefined) {
          delete this.accordCompliance[rv.id];
          this.accordDefectLogged.delete(rv.id);
        }
        continue;
      }
      let comp = this.accordCompliance[rv.id] ?? 1.0;
      // High-commerce powers keep their word; expansion hawks cut corners
      const drift = (rv.weights.commerce - rv.weights.expansion) * 0.006;
      comp = Math.max(0, Math.min(1, comp + drift + (this.rng.next() - 0.55) * 0.04));
      this.accordCompliance[rv.id] = comp;
      if (comp < ACCORD_DEFECT_THRESHOLD && !this.accordDefectLogged.has(rv.id)) {
        this.accordDefectLogged.add(rv.id);
        this.addLog(
          `ACCORD DEFECTION: satellite readings show ${rv.name}'s emissions climbing behind diplomatic smiles. ` +
          `Sanction them (−20 relations, accord torn) or absorb the betrayal to keep the network intact.`,
          'bad',
        );
      }
      if (comp >= ACCORD_DEFECT_THRESHOLD + 0.1) {
        this.accordDefectLogged.delete(rv.id);
      }
    }
  }

  /** True once `environmentalism` is researched and the year is right —
   *  this gates the Climate Accord treaty type in diplomacy. */
  accordUnlocked(): boolean {
    return this.has('environmentalism') && this.year >= 2010 && this.stateProclaimed;
  }

  /** Deploy stratospheric aerosol injection (GDD §8.2 geoengineering).
   *  One-time; arrests warming fast but infuriates every rival. */
  deployGeoengineering(): boolean {
    if (this.geoDeployed || !this.has('geoengineering') || !this.nationProclaimed) return false;
    this.geoDeployed = true;
    this.geoDeployDay = this.day;
    const SIDE_EFFECTS = [
      'Monsoon patterns shift — distant regions report anomalous drought, and diplomatic notes arrive within the week.',
      'UV anomalies bleach shallow reefs; three fishing nations demand compensation.',
      'Polar ice rebounds faster than the models predicted — sea-level projections are revised downward.',
      'A thin permanent haze rings the equatorial sky. Crop yields drag 5% in low latitudes.',
    ];
    const fx = SIDE_EFFECTS[this.rng.int(SIDE_EFFECTS.length)];
    for (const rv of this.rivals) {
      rv.relations = Math.max(-100, rv.relations - 15);
      this.noteHistory(rv, `${this.year}: unilateral geoengineering deployed without their consent.`);
    }
    this.addLog(
      `GEOENGINEERING DEPLOYED: stratospheric aerosol injection begins. Warming will ease ~${GEOENGINEER_COOLING}°C ` +
      `over two years — but every rival calls it a unilateral act on the shared sky. ${fx}`,
      'bad',
    );
    return true;
  }

  /** Sanction a Climate Accord defector: tear the accord, cost relations.
   *  Unlike breakTreaty, this does not increment treatiesBroken — they defected. */
  sanctionAccordDefector(id: number): boolean {
    const rv = this.rival(id);
    if (!rv || !rv.treaties.includes('climate_accord')) return false;
    if ((this.accordCompliance[rv.id] ?? 1) >= ACCORD_DEFECT_THRESHOLD) return false;
    rv.treaties = rv.treaties.filter((k) => k !== 'climate_accord');
    this.onBreakTreaty(rv, 'climate_accord');
    rv.relations = this.clampRel(rv.relations - 20);
    this.addLog(
      `SANCTION: ${rv.name}'s Climate Accord suspended — satellite data is the stated cause. ` +
      `The diplomatic chill is real. Their emissions record is now the continent's business.`,
      'bad',
    );
    return true;
  }

  /** Era 8 opens and the verdict is read (GDD §3.2): the sky you get was
   *  chosen by climate, regime, and how your people live — not the calendar. */
  private decideBranch(): void {
    const proj = this.projectedWarming();
    const pops = this.settlements.filter((t) => this.popOf(t) >= 1);
    const avgSat = pops.length > 0 ? pops.reduce((s, t) => s + t.satisfaction, 0) / pops.length : 50;
    const gov = GOV_TYPES.find((g) => g.id === this.govType);
    const democratic = gov ? gov.electionsRequired : this.has('universal_suffrage');
    let branch: EraBranch;
    if (proj >= 2.3) branch = 'drowned';
    else if (!democratic || avgSat < 42 || (this.nationProclaimed && this.legitimacy < 35)) branch = 'dystopia';
    else branch = 'solarpunk';
    this.eraBranch = branch;
    const lines: Record<EraBranch, string> = {
      solarpunk:
        `THE GARDEN CENTURY: ${BRANCH_YEAR} opens under glass and green. The grid hums clean, the ` +
        `squares are planted, and the projected waterline stays on the chart, not in the streets.`,
      dystopia:
        `THE NEON CENTURY: ${BRANCH_YEAR} arrives behind checkpoints and billboards. The economy roars; ` +
        `the people queue in its light and grumble in its shadow.`,
      drowned:
        `THE DROWNED CENTURY: ${BRANCH_YEAR}, and the projection is now a tide table. The sea is coming ` +
        `for the coastal streets — wall them, move them, or mourn them.`,
    };
    this.addLog(lines[branch], branch === 'solarpunk' ? 'good' : 'bad');
  }

  /** Adaptation, the honest kind (GDD §8.2): province-scale money, poured
   *  early or paid for in streets. Walls only rise where there's a coast. */
  seaWallCost(t: Settlement): number {
    return Math.round(120 + this.popOf(t) * 0.4);
  }

  buildSeaWall(townId: number): boolean {
    const t = this.settlement(townId);
    if (!t || !t.site.coastal || t.seaWall) return false;
    if (!this.stateProclaimed || this.year < SEA_WALL_YEAR) return false;
    const cost = this.seaWallCost(t);
    if (this.treasury < cost) return false;
    this.treasury -= cost;
    t.seaWall = true;
    this.addLog(
      `The sea wall at ${t.name} tops out — ` + formatCurrency(cost) + ` of granite and pumps between the town and the tide.`,
      'good',
    );
    return true;
  }

  /** 1 Jan 2100: the Century Report (GDD §8.4) — a verdict, not a win
   *  screen. The sandbox keeps running afterward if you wish. */
  private buildCenturyReport(): void {
    const pop = this.totalPop();
    const gdpPerHead = pop > 0 ? this.gdpLastMonth / pop : 0;
    const gov = GOV_TYPES.find((g) => g.id === this.govType);
    const democratic = gov ? gov.electionsRequired : false;
    const avgRelations =
      this.rivals.length > 0 ? this.rivals.reduce((s, rv) => s + rv.relations, 0) / this.rivals.length : 0;
    const grade = (v: number, bands: [number, string][]): string =>
      bands.find(([cut]) => v >= cut)?.[1] ?? 'F';
    const stewardship = grade(-this.warmingC, [[-1.5, 'A'], [-2.0, 'B'], [-2.5, 'C'], [-3.0, 'D']]);
    const prosperity = grade(gdpPerHead, [[1.4, 'A'], [1.1, 'B'], [0.85, 'C'], [0.6, 'D']]);
    const liberty = democratic
      ? (this.legitimacy >= 60 ? 'A' : 'B')
      : grade(this.legitimacy, [[60, 'C'], [35, 'D']]);
    const standing = grade(avgRelations, [[40, 'A'], [15, 'B'], [-10, 'C'], [-40, 'D']]);
    const branchLine: Record<EraBranch, string> = {
      solarpunk: 'under solar glass, the gardens still growing',
      dystopia: 'in neon and rain, prosperous and watched',
      drowned: 'behind the walls that held — and beside the streets that did not',
    };
    const verdict =
      `A century after twelve settlers stepped off a wagon, ${pop.toLocaleString()} people live here ` +
      `${this.eraBranch ? branchLine[this.eraBranch] : 'on the old frontier'}. ` +
      `The air carries ${Math.round(this.co2ppm)} ppm and +${this.warmingC.toFixed(1)}°C of the century's heat. ` +
      `History's grades: stewardship ${stewardship}, prosperity ${prosperity}, liberty ${liberty}, standing ${standing}.`;
    this.centuryReport = {
      branch: this.eraBranch,
      pop,
      towns: this.settlements.length,
      gdp: Math.round(this.gdpLastMonth),
      treasury: Math.round(this.treasury),
      co2ppm: Math.round(this.co2ppm),
      warmingC: Math.round(this.warmingC * 10) / 10,
      techs: this.researched.size,
      laws: this.passedLaws.size,
      legitimacy: Math.round(this.legitimacy),
      grades: { stewardship, prosperity, liberty, standing },
      verdict,
    };
    this.addLog(`1 JANUARY 2100 — THE CENTURY REPORT. ${verdict}`, 'info');
    this.addLog('The century is over; the country is not. The sandbox runs on.', 'info');
    this.checkCenturyWins();
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
      this.routes.push({ a: aId, b: bId, kind, condition: 100, path: c.path, terrainCost: c.cost, freight: 0, cargoType: null });
    }
    this.addLog(
      kind === 'road'
        ? `A wagon road opens between ${a.name} and ${b.name} — ` + formatCurrency(cost.total) + ` of grading and bridgework.`
        : kind === 'rail'
          ? `Steel rails link ${a.name} and ${b.name} — ` + formatCurrency(cost.total) + ` of cuttings, trestles, and track. The whistle carries for miles.`
          : kind === 'highway'
            ? `Fresh asphalt runs from ${a.name} to ${b.name} — ` + formatCurrency(cost.total) + ` of paving${wasRail ? '. The old rail bed goes quiet' : ''}.`
            : `A maglev guideway hums between ${a.name} and ${b.name} — ` + formatCurrency(cost.total) + ` of pylons and superconductors. The freight drives itself now.`,
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
    this.addLog(`Repair gangs put the ${r.kind} between ${a} and ${b} back in order — ` + formatCurrency(cost) + `.`, 'good');
    return true;
  }

  /** Tear up a built link (Phase A route-network controls): the rails come up,
   *  the asphalt is broken, and the corridor falls back to a plain trail so the
   *  towns stay connected — no upkeep, no capacity, no stranded asset. */
  deleteRoute(aId: number, bId: number): boolean {
    if (!this.stateProclaimed) return false;
    const r = this.routeBetween(aId, bId);
    if (!r || r.kind === 'trail') return false;
    const was = r.kind;
    r.kind = 'trail';
    r.condition = 100;
    r.cargoPriority = null;
    const a = this.settlement(aId)?.name ?? '?';
    const b = this.settlement(bId)?.name ?? '?';
    this.addLog(`The ${was} between ${a} and ${b} is torn up — only a trail remains.`, 'bad');
    return true;
  }

  /** Pin (or clear) the cargo a route should prioritise carrying (Phase A).
   *  A null sector hands the route back to the automatic dominant-cargo reading. */
  setRouteCargoPriority(aId: number, bId: number, sector: SectorId | null): boolean {
    const r = this.routeBetween(aId, bId);
    if (!r) return false;
    r.cargoPriority = sector;
    if (sector) r.cargoType = sector;
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

  /** The GDD §2.2 connection requirement: every player-faction settlement is
   *  reachable from the first through the route graph. Rival settlements are
   *  excluded — they manage their own networks. */
  connectedToAll(): boolean {
    const playerTowns = this.settlements.filter((t) => t.factionId === this.playerFactionId);
    if (playerTowns.length < 2) return true;
    const seen = this.reachableFrom(playerTowns[0].id);
    return playerTowns.every((t) => seen.has(t.id));
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
    // Washout odds rise with the thermometer (GDD §8.2): a warmer sky
    // carries more water, and the storms that drop it hit harder.
    const washoutChance = Math.min(0.3, 0.12 * (1 + this.warmingC * 0.3));
    if (storm && this.routes.length > 0 && this.rng.chance(washoutChance)) {
      const r = this.routes[this.rng.int(this.routes.length)];
      if (r.kind !== 'trail' && r.condition > 40) {
        r.condition = Math.max(ROUTE_CONDITION_FLOOR, r.condition - 45);
        const a = this.settlement(r.a)?.name ?? '?';
        const b = this.settlement(r.b)?.name ?? '?';
        this.addLog(
          `Storm washout: the ${r.kind} between ${a} and ${b} is cut — ` +
          `${r.kind === 'rail' ? 'a trestle is down' : r.kind === 'maglev' ? 'a guideway pylon is down' : 'a bridge is out'}. Repairs would cost ` + formatCurrency(this.repairCost(r)) + `.`,
          'bad',
        );
      }
    }
  }

  /** What a link's road gangs (or drone crews) bill per month — Automated
   *  Freight research swaps the work crews for machines at 60% the cost, and
   *  Robotics cuts the remaining crews by a further 30%. */
  maintBill(r: Route): number {
    const automation = (this.has('automated_logistics') ? 0.6 : 1) * (this.has('robotics') ? 0.7 : 1);
    // Normalized to the base grid so a finer map doesn't inflate upkeep.
    return (r.path.length / CELL_SCALE) * ROUTE_SPECS[r.kind].maintPerCell * automation;
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

  // ---- THE FOUNDING: a fresh colony for the standalone 4X campaign ----
  /**
   * Found a brand-new colony with no TownCore flip behind it. Seeds a single
   * small founding settlement at the map's best river-valley site, reveals the
   * land immediately around it (the rest of the region stays under fog), and
   * wires up the player faction, lenders and starting notables.
   *
   * This is the colony→nation arc's day zero: grow this town to ~24 souls with
   * food and timber to spare, send out the first expedition, charter a state,
   * and proclaim a nation before the century turns.
   */
  static foundColony(
    rng: Rng,
    map: RegionMap,
    weather: Weather,
    opts: { name?: string; treasury?: number; pref?: 'river-valley' | 'coastal' | 'highlands' | 'surprise' } = {},
  ): RegionSim {
    const region = new RegionSim(rng, 0, map, weather);
    const site = map.startSite(opts.pref ?? 'river-valley');
    const coord = map.cellToCoord(site.cellX, site.cellY);
    region.treasury = opts.treasury ?? 1200;

    const home: Settlement = {
      id: region.nextId++,
      name: opts.name ?? "Founder's Rest",
      x: coord.rx,
      y: coord.ry,
      foundedDay: 0,
      cohorts: { bands: [3, 5, 4, 2, 0] }, // ~14 souls: children, young, prime, elders
      food: 60,
      wood: 40,
      satisfaction: 62,
      housing: 18,
      landQuality: site.fertility,
      site,
      lastRaidDay: -99,
      lastFloodDay: -99,
      strikeUntil: -1,
      grievance: 0,
      prices: defaultPrices(),
      recentEvents: [],
      factionId: 0, // player faction
      garrisonStrength: 5,
      stationedUnits: [],
      loyaltyToFaction: 100,
      sectors: defaultSectors(),
      buildings: [],
      construction: null,
      focus: 'balanced',
      activeEvents: [],
      policies: { ...DEFAULT_CITY_POLICIES },
    };
    region.settlements.push(home);
    region.lenders = createInitialLenders();
    region.regionalizeFactionSystem(home);

    // The founding valley is known; the rest of the region waits under fog.
    region.revealTiles(home.x, home.y, 14, 'explored');

    // The founders who will carry the story toward statehood.
    for (const role of ['Mayor', 'Doctor', 'Captain'] as NotableRole[]) {
      region.mintNotable(role, home.id);
    }

    region.addLog(
      `Wagons halt in a sheltered valley. ${home.name} is founded, 1900 — ` +
      `the first stone of a nation yet unnamed.`,
      'good',
    );
    return region;
  }

  /** Create a fresh colony from a seed and optional design overrides. */
  static create(seed: number, design: { currencySymbol?: string; expansionSpeed?: string; tradeOpenness?: string; taxRate?: number; servicesLevel?: number } = {}): RegionSim {
    const rng = new Rng(seed);
    const map = new RegionMap(seed);
    const weather = new Weather(seed);
    const region = RegionSim.foundColony(rng, map, weather, { treasury: 5000 });
    if (design.currencySymbol) region.currencySymbol = design.currencySymbol as CurrencySymbol;
    if (design.expansionSpeed) region.expansionSpeed = design.expansionSpeed as 'cautious' | 'steady' | 'aggressive';
    if (design.tradeOpenness) region.tradeOpenness = design.tradeOpenness as 'protectionist' | 'balanced' | 'free-trade';
    if (design.taxRate !== undefined) region.taxRate = design.taxRate;
    if (design.servicesLevel !== undefined) region.servicesLevel = design.servicesLevel;
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

  // ---- main loop: one tick = 30 game-minutes ----
  tick(): void {
    if (this.gameOver) return;
    const prevDay = this.day;
    this.minute += REGION_MINUTES_PER_TICK;
    if (this.day !== prevDay) this.dailyUpdate();
  }

  private dailyUpdate(): void {
    const seasonMult = [1.25, 1.35, 1.0, 0.15][this.seasonIndex];
    // A hotter century farms worse (GDD §8.2): yield drag past +0.8°C.
    const climateDrag = 1 - Math.min(0.35, Math.max(0, this.warmingC - 0.8) * 0.08);
    const weatherMult = this.weather.growthMult(this.day) * climateDrag;
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
        this.townEvent(t, 'River flood — stores spoiled, fields under water.', 'bad');
      }
      // Housing grows when wood allows
      if (t.housing < pop + 4 && t.wood >= 20) {
        t.wood -= 20;
        t.housing += 3;
        if (Math.round(t.housing) % 15 === 0) {
          this.townEvent(t, `New dwellings raised — housing capacity now ${Math.floor(t.housing)}.`, 'good');
        }
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
          (this.passedLaws.has('welfare_benefits') ? 5 : 0) +
          (this.passedLaws.has('sanitation_act') ? 3 : 0) +
          (this.policyActive('austerity') ? -4 : 0) +
          (this.eraBranch === 'solarpunk' ? 4 : 0) // the garden century is good to live in
        : 0;
      // Land Reform (nation law) boosts food production 5%
      if (this.passedLaws.has('land_reform')) t.food += workers * 1.15 * seasonMult * t.landQuality * weatherMult * granger * strike * 0.05;
      const target =
        50 +
        Math.min(20, foodDays * 1.5) -
        Math.max(0, (pop - t.housing) * 2) -
        (this.day - t.lastRaidDay < 10 ? 10 : 0) +
        5 * this.roleMult(t, 'Mayor') +
        (this.has('universal_suffrage') ? 3 : 0) +
        (this.has('womens_suffrage') ? 2 : 0) +
        (this.has('civil_rights') ? 3 : 0) +
        (this.has('participatory_democracy') ? 3 : 0) +
        this.buildingSatisfaction(t) + // Phase 2: waterworks and wards make town life kinder
        stateTerms;
      t.satisfaction += (Math.max(0, Math.min(100, target)) - t.satisfaction) * 0.08;
      // Grievance: heavy taxes build pressure daily; services and contentment vent it.
      // Labor Standards research slows buildup 30%; Border Constabulary policy adds another 25%.
      if (this.stateProclaimed) {
        const laborFactor = (this.has('labor_law') ? 0.7 : 1) * (this.has('welfare_state') ? 0.8 : 1) *
          (this.has('social_insurance') ? 0.85 : 1) * (this.has('civil_rights') ? 0.85 : 1);
        const constabFactor = (this.policyActive('border_constabulary') ? 0.75 : 1) *
          (this.passedLaws.has('trade_unions_act') ? 0.7 : 1) *
          (this.policyActive('civic_pride') ? 0.8 : 1);
        const pressure =
          (Math.max(0, this.taxRate - 0.15) * 35 - this.servicesLevel * 0.4 - Math.max(0, t.satisfaction - 55) * 0.05) * laborFactor * constabFactor +
          (this.eraBranch === 'dystopia' ? 0.15 : 0); // the neon century simmers
        t.grievance = Math.max(0, Math.min(100, t.grievance + pressure));
      }
      this.updateMarket(t);
      // Starvation: player-owned towns get a seasonal emergency grain purchase
      // (once per 30 days), scaled to the town's population so it actually lasts.
      if (t.food < 0) {
        if (t.factionId === this.playerFactionId && this.treasury >= 10) {
          const daysSinceLast = this.day - (t.lastEmergencyGrainDay ?? -9999);
          if (daysSinceLast >= 30) {
            // 30 days of full consumption — enough to last a season change
            const relief = Math.max(500, Math.round(this.popOf(t) * 0.75 * 30));
            const cost = Math.max(10, Math.ceil(relief / 50));
            if (this.treasury >= cost) {
              t.food += relief;
              t.lastEmergencyGrainDay = this.day;
              this.treasury -= cost;
              if (t.food < 0) {
                const starved = Math.min(pop * 0.01, -t.food / 20);
                this.removePop(t, starved);
                t.food = 0;
                this.addLog(`Famine in ${t.name} — emergency grain bought, but not enough.`, 'bad');
                this.townEvent(t, 'Famine — emergency rations exhausted.', 'bad');
              } else {
                this.addLog(`Emergency grain purchased for ${t.name} (${formatCurrency(cost)} from treasury).`, 'info');
              }
            } else {
              const starved = Math.min(pop * 0.01, -t.food / 20);
              this.removePop(t, starved);
              t.food = 0;
            }
          }
          // cooldown active: no purchase, but starvation is also suppressed this tick
        } else {
          const starved = Math.min(pop * 0.01, -t.food / 20);
          this.removePop(t, starved);
          t.food = 0;
          if (starved > 0.5 && this.rng.chance(0.2)) {
            this.addLog(`Hunger stalks ${t.name} — the granary is empty.`, 'bad');
            this.townEvent(t, 'Granary empty — hunger in the streets.', 'bad');
          }
        }
      }
    }
    this.abandonGhostTowns();
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
    this.updateConstruction(); // Phase 2: scaffolding comes down, doors open
    this.updateExploration(); // Phase 0: Update fog of war based on scouts and settlements
    if (this.totalPop() <= 0) {
      this.gameOver = true;
      this.addLog('The last settlement is empty. (Failure state: depopulation.)', 'bad');
    }
  }

  private monthlyUpdate(): void {
    // Record the prior month's net treasury swing before this month's books move.
    this.treasuryDeltaMonth = this.treasury - this.prevMonthTreasury;
    this.prevMonthTreasury = this.treasury;

    // ponytail: cache policy/law checks that are constant across all settlements
    const hasHealthcare = this.passedLaws.has('healthcare_act');
    const hasSanitation = this.passedLaws.has('sanitation_act');
    const hasAntibiotics = this.has('antibiotics');
    const hasSocialInsurance = this.has('social_insurance');
    const hasPublicHealth = this.policyActive('public_health_policy');
    const hasOpenBorders = this.policyActive('open_borders');
    const hasGuestWorkers = this.policyActive('guest_workers');
    const interiorMinister = this.ministerFor('interior');

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
      const interiorBonus = interiorMinister ? 1.15 : 1;
      const services = this.stateProclaimed ? 1 - 0.05 * this.servicesLevel * interiorBonus : 1;
      const healthPolicy = hasPublicHealth ? 0.8 : 1;
      const healthcareLaw = hasHealthcare ? 0.85 : 1;
      const sanitationLaw = hasSanitation ? 0.9 : 1;
      // Tech & civics that bend the death rate: antibiotics end lethal infection,
      // social insurance funds the clinics that keep people out of the grave.
      const techHealth = (hasAntibiotics ? 0.85 : 1) * (hasSocialInsurance ? 0.92 : 1);
      for (let i = 0; i < b.length; i++) {
        b[i] -= b[i] * (BASE_MORTALITY_PER_YEAR[i] / 12) * doctor * services * healthPolicy * healthcareLaw * sanitationLaw * techHealth;
      }
      // Immigration: the frontier draws people to fed, content towns
      const reeve = 1 + 0.1 * this.roleMult(t, 'Reeve');
      const openBorders = (hasOpenBorders ? 1.3 : 1) * (hasGuestWorkers ? 1.2 : 1);
      // Drought suppresses immigration: news of failed harvests travels fast
      const agriEventMult = this.eventOutputMult(t, 'agriculture');
      // High taxes deter settlers: each tax band reduces immigration appeal by 10%
      const taxImmigrantMult = 1 - TAX_BAND_RATES[Math.min(3, Math.max(0, t.policies.taxBand))] * 2;
      const pop = this.popOf(t);
      if (t.satisfaction > 55 && t.food > pop * 2) {
        const arrivals = (pop * 0.02 + 2) * reeve * openBorders * agriEventMult * taxImmigrantMult;
        b[1] += arrivals * 0.6;
        b[2] += arrivals * 0.3;
        b[0] += arrivals * 0.1;
        if (arrivals >= 3 && this.rng.chance(0.25)) {
          this.townEvent(t, `${Math.round(arrivals)} settlers drawn in by word of good land.`, 'good');
        }
      }
      // Population milestone events
      const popNow = Math.round(this.popOf(t));
      const totalBands = Math.round(b.reduce((a, x) => a + x, 0) * 0.001);
      for (const milestone of [50, 100, 200, 500, 1000, 2000]) {
        const popBefore = popNow - totalBands;
        if (popBefore < milestone && popNow >= milestone) {
          this.townEvent(t, `Population reaches ${milestone} — a true town now.`, 'good');
        }
      }
    }
    for (const t of this.settlements) this.updateSectors(t); // Phase 1: labor follows the technology
    this.tickRegionalEvents(); // Phase 4: disasters and windfalls
    this.updateRouteCargo();   // Phase 6: cargo labels follow sector surplus
    this.migrate();
    this.caravans();
    this.traders();
    this.ageNotables();
    // The treasury runs even before the Charter: pre-statehood the Mayor still
    // taxes the towns and pays for services/militia, so the player has real
    // economic levers to climb out of a deficit toward the £8k Charter gate
    // (otherwise the only pre-State income is trade tolls and the books can only
    // sink). Nation-tier machinery (factions/diplomacy/central bank) stays gated.
    this.monthlyEconomy();
    if (this.stateProclaimed) this.updateFactions();
    this.updateDiplomacy();
    this.consumeWarSupply(); // deplete supply reserves based on army size and supply consumption rate
    this.updateRivalAI(); // staggered AI updates for rivals (GDD §6.2)
    this.updateScouts(); // update faction scouts: movement, spawning, expiry (GDD §6.2)
    this.tickClimate(); // the ledger runs from the first decade (GDD §8.2)
    if (this.passedLaws.has('central_bank_charter')) this.tickMonetary();
    this.updateLoans(); // process loan interest and check for defaults
    if (this.stateProclaimed) this.collectVassalTribute();
    this.checkProclamationGate();
    this.checkWinConditions();
    // Record monthly history for sparklines (last 12 months)
    const gdp = this.settlements.reduce((s, t) => s + SECTOR_IDS.reduce((ss, id) => ss + t.sectors[id].output, 0), 0);
    this.monthlyHistory.push({ gdp, treasury: this.treasury, inflation: this.inflationRate * 100, employment: 100 });
    if (this.monthlyHistory.length > 12) this.monthlyHistory.shift();
  }

  /** Check all four victory paths; set winCondition on the first achieved.
   *  Sandbox continues after any win — the modal is informational, not a forced stop. */
  private checkWinConditions(): void {
    if (this.winCondition) return; // already won — don't overwrite

    // Solarpunk: democratic + warm satisfaction + clean sky — can win from 2040 onward
    if (this.eraBranch === 'solarpunk') {
      this.winCondition = {
        path: 'solarpunk',
        year: this.year,
        details: `The grid hums clean. ${Math.round(this.warmingC * 10) / 10}°C above baseline — the gardens hold.`,
      };
      this.addLog('VICTORY — THE GARDEN PATH: solarpunk conditions achieved. The century belongs to you.', 'good');
      return;
    }

    // Unification: control 75%+ of region by 2070, or 90%+ at any point
    if (this.nationProclaimed) {
      const terr = this.playerTerritoryControl();
      if ((terr >= 0.75 && this.year <= 2070) || terr >= 0.9) {
        this.winCondition = {
          path: 'unification',
          year: this.year,
          details: `${Math.round(terr * 100)}% of the region under one banner.`,
        };
        this.addLog('VICTORY — UNIFICATION: the region bends to your flag. The era of division is over.', 'good');
        return;
      }
    }
  }

  /** Check legacy and domination wins at century end; called from buildCenturyReport(). */
  private checkCenturyWins(): void {
    if (this.winCondition) return;
    const g = this.centuryReport?.grades;
    if (!g) return;

    // Legacy: A grade in 3 of 4 century categories
    const aCount = [g.stewardship, g.prosperity, g.liberty, g.standing].filter(x => x === 'A').length;
    if (aCount >= 3) {
      this.winCondition = {
        path: 'legacy',
        year: this.year,
        details: `${aCount}/4 century grades are A — a dynasty remembered well.`,
      };
      this.addLog('VICTORY — LEGACY: three A-grades in the century report. History will speak your name.', 'good');
      return;
    }

    // Domination: nation proclaimed, holds majority territory, no rivals stronger
    if (this.nationProclaimed && this.playerTerritoryControl() >= 0.5) {
      const playerStrength = this.faction(this.playerFactionId)?.militaryStrength ?? 0;
      const dominates = this.regionalFactions.every(
        f => f.id === this.playerFactionId || f.militaryStrength <= playerStrength,
      );
      if (dominates) {
        this.winCondition = {
          path: 'domination',
          year: this.year,
          details: "The last nation standing at the century's end — sovereignty unchallenged.",
        };
        this.addLog('VICTORY — DOMINATION: your nation stands alone at 2100, unchallenged and sovereign.', 'good');
      }
    }
  }

  /** Vassals pay 5% of their treasury each month as tribute to the player. */
  private collectVassalTribute(): void {
    const playerFaction = this.faction(this.playerFactionId);
    if (!playerFaction) return;
    for (const vassalId of playerFaction.vassals) {
      const vassal = this.faction(vassalId);
      if (!vassal) continue;
      const tribute = Math.floor(vassal.treasury * 0.05);
      if (tribute <= 0) continue;
      vassal.treasury -= tribute;
      this.treasury += tribute;
      if (tribute >= 10) {
        this.addLog(`TRIBUTE: ${vassal.name} pays ${formatCurrency(tribute)} to your treasury.`, 'good');
      }
    }
  }

  /** Post-2100 epilogue flavor events: era-specific achievements and narrative beats. */
  private triggerEpilogueEvent(): void {
    if (this.year < CENTURY_YEAR) return;

    const epilogueEvents = this.getEpilogueEventPool();
    if (epilogueEvents.length === 0) return;

    // 1% daily chance of an epilogue event
    if (!this.rng.chance(0.01)) return;

    const event = epilogueEvents[this.rng.int(epilogueEvents.length)];
    if (this.triggeredEpilogueEvents.has(event.id)) return; // already triggered

    this.triggeredEpilogueEvents.add(event.id);
    this.addLog(event.text, event.kind);
  }

  /** Get era-specific epilogue events. */
  private getEpilogueEventPool(): Array<{ id: string; text: string; kind: 'good' | 'info' | 'bad' }> {
    const events: Array<{ id: string; text: string; kind: 'good' | 'info' | 'bad' }> = [];
    const yearsSince = this.year - CENTURY_YEAR;

    if (this.eraBranch === 'solarpunk') {
      events.push(
        { id: 'sol-greening', text: 'THE GREENING: Reforestation initiatives accelerate across the region. The land blooms anew.', kind: 'good' },
        { id: 'sol-carbon', text: 'CARBON NEGATIVE: Your nation\'s collective efforts have finally driven CO₂ down. Skies clearing.', kind: 'good' },
        { id: 'sol-commons', text: 'THE COMMONS: A network of shared gardens and parks weaves through your cities. Quality of life soars.', kind: 'good' },
        { id: 'sol-migration', text: 'CLIMATE REFUGE: Thousands migrate to your stable, prosperous nation seeking asylum from chaos elsewhere.', kind: 'good' },
      );
    } else if (this.eraBranch === 'dystopia') {
      events.push(
        { id: 'dys-surveillance', text: 'PANOPTICON: Omnipresent sensors monitor every street, every transaction. Order is absolute.', kind: 'info' },
        { id: 'dys-strikes', text: 'LABOR UNREST: Underground movements organize despite crackdowns. Whispers of rebellion in the factories.', kind: 'bad' },
        { id: 'dys-wealth', text: 'WEALTH DISPARITY: The gap widens. The elite enclaves gleam while the outer rings seethe with discontent.', kind: 'bad' },
        { id: 'dys-tech', text: 'MEGACORP DOMINANCE: Private megacorps rival the state in power. The economy hums, but at what cost?', kind: 'info' },
      );
    } else if (this.eraBranch === 'drowned') {
      events.push(
        { id: 'drown-walls', text: 'GREAT WALLS: Dykes and barriers hold back the rising sea. The coast is now a fortress.', kind: 'info' },
        { id: 'drown-migration', text: 'INLAND FLIGHT: Coastal populations abandon their ancestral homes, migrating inland. Entire regions depopulate.', kind: 'bad' },
        { id: 'drown-refugees', text: 'CLIMATE REFUGEES: Neighboring nations collapse under tidal pressures. Refugee camps swell at your borders.', kind: 'bad' },
        { id: 'drown-adaptation', text: 'ADAPTATION: Your people, resilient, build floating settlements and amphibious farms. Life finds a way.', kind: 'info' },
      );
    }

    // All eras can have these universal post-2100 events
    if (yearsSince >= 10) {
      events.push(
        { id: 'legacy-monument', text: 'MONUMENTS: Historians and architects immortalize the 21st century in grand public works.', kind: 'good' },
      );
    }
    if (yearsSince >= 20) {
      events.push(
        { id: 'long-peace', text: 'LONG PEACE: A generation has now grown up knowing only stability. The old conflicts fade to memory.', kind: 'good' },
      );
    }

    return events;
  }

  /** One-time latch: set proclamationReady once player territory ≥50%, log the milestone. */
  private checkProclamationGate(): void {
    if (this.proclamationReady || !this.stateProclaimed) return;
    if (this.playerTerritoryControl() >= 0.5) {
      this.proclamationReady = true;
      this.addLog(
        'REGIONAL HEGEMON: Your state controls more than half the known territory. ' +
        'The path to nationhood lies before you — open the State panel to Proclaim the Nation.',
        'good',
      );
    }
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
        // cheapest market that isn't the buyer — a linear scan, not a copy+sort per buyer
        let seller: Settlement | undefined;
        let sellerPrice = Infinity;
        for (const s of this.settlements) {
          if (s === buyer) continue;
          if (s.prices[g] < sellerPrice) { sellerPrice = s.prices[g]; seller = s; }
        }
        if (!seller) continue;
        const legs = this.routePath(seller.id, buyer.id);
        if (!legs || legs.length === 0) continue; // traders need a route
        const freightRate = 0.01 * legs.length; // £/unit per hop on the wagon
        const margin = buyer.prices[g] - seller.prices[g];
        if (margin <= freightRate * 1.5) continue; // not worth the trip
        const surplus = this.stockOf(seller, g) - this.monthNeed(seller, g);
        const capLeft = this.legCapacity(legs);
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
    if (turnover > 0) {
      // Free Trade policy removes the levy entirely; otherwise use the configured rate.
      const baseRate = this.policyActive('free_trade') ? 0 : this.tradeLevyRate;
      // Before the State exists the Mayor still collects market tolls on every
      // caravan — at a gentler rate — so connecting and trading between towns
      // visibly builds the treasury toward the Charter's economic gate.
      const effectiveLevyRate = this.stateProclaimed ? baseRate : baseRate * 0.8;
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
      // fullest larder in the same faction — a linear scan, not a copy+filter+sort per needy town
      let donor: Settlement | undefined;
      let donorFood = -Infinity;
      for (const t of this.settlements) {
        if (t === needy || t.factionId !== needy.factionId) continue;
        if (t.food <= this.popOf(t) * 0.75 * 60) continue;
        if (t.food > donorFood) { donorFood = t.food; donor = t; }
      }
      if (!donor) continue;
      const surplus = donor.food - this.popOf(donor) * 0.75 * 60;
      const legs = this.routePath(donor.id, needy.id);
      if (legs && legs.length > 0) {
        const cap = this.legCapacity(legs);
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
    // Phase 1: GDP is the sum of what the sectors actually made — the same
    // magnitude as the old flat formula at 1900 tech (calibration ×1.08),
    // but now it grows as labor climbs the value chain.
    for (const t of this.settlements) {
      gdp += this.sectorOutputOf(t) * 1.08 * incomeMult;
    }
    gdp += this.tradeValueLastMonth; // commerce counts (GDD §5.2)
    // War economy (GDD §7.2): armaments demand is a stimulus first…
    const warMob = this.playerWar ? MOBILIZATION_DEFS[this.playerWar.mobilization] : null;
    if (warMob) gdp *= warMob.gdpMult;
    // The neon century (era 8 dystopia branch): the economy roars — at a price paid in grievance
    if (this.eraBranch === 'dystopia') gdp *= 1.08;
    // Credit cycle (GDD §5.1): boom raises GDP, confidence collapse contracts it
    if (this.passedLaws.has('central_bank_charter')) {
      const boom = Math.max(0, (this.confidence - 50) * 0.002);
      const bust = this.confidence < 30 ? (30 - this.confidence) * 0.004 : 0;
      const inflDrag = Math.max(0, (this.inflationRate - 0.08) * 2.0);
      gdp *= Math.max(0.5, (1 + boom - bust) * (1 - inflDrag));
    }
    this.gdpLastMonth = gdp;
    // Treasury Secretary bonus: +10% tax collection (GDD §8.7)
    const treasuryMult = this.ministerFor('treasury') ? 1.1 : 1;
    const revenue = gdp * this.taxRate * collection * treasuryMult;
    const pop = this.totalPop();
    const spending =
      pop * 0.05 * this.servicesLevel * serviceCost +
      pop * 0.03 * this.militiaLevel +
      this.settlements.length * 5 + // administration
      this.buildingUpkeep() + // Phase 2: the civic works keep their lights on
      this.policyServiceUpkeep() + // Phase 5: generous city services cost the treasury
      this.policyUpkeep() + // active policy running costs
      (this.passedLaws.has('welfare_benefits') ? pop * 0.01 : 0) + // welfare relief payments
      (warMob ? pop * warMob.upkeepPerPop : 0) + // …and the drain runs concurrently (GDD §7.2)
      (this.playerWar?.blockade ? pop * BLOCKADE_UPKEEP_PER_POP : 0); // coal and crews for the gunboats
    // Income Tax (civic research): a progressive levy adds 3% of GDP on top
    const incomeTaxBonus = this.has('income_tax') ? this.gdpLastMonth * 0.03 : 0;
    // Central Banking (civic research): a national reserve adds a further 1% of GDP
    const centralBankingBonus = this.has('central_banking') ? this.gdpLastMonth * 0.01 : 0;
    // Estate Tax law: a wealth levy on the land
    const estateLevyBonus = this.estateTaxActive ? this.totalPop() * 0.1 : 0;
    // Progressive Taxation law: graduated bands yield 2% extra of GDP
    const progressiveTaxBonus = this.passedLaws.has('progressive_tax') ? this.gdpLastMonth * 0.02 : 0;
    // Protectionism policy: tariff wall adds flat £3/month
    const protectionismBonus = this.policyActive('protectionism') ? 3 : 0;
    // Austerity policy: belt-tightening adds a flat £4/month (paid in satisfaction elsewhere)
    const austerityBonus = this.policyActive('austerity') ? 4 : 0;
    // Central Bank Charter: treasury earns interest at the policy rate
    const bankInterest = this.passedLaws.has('central_bank_charter') ? this.treasury * (this.policyRate / 12) : 0;
    // Carbon Levy law: the smoke pays 1% of GDP into the treasury
    const carbonLevyBonus = this.passedLaws.has('carbon_levy') ? this.gdpLastMonth * 0.01 : 0;
    // Trade agreements (GDD §5.4): export earnings per signed rival, scaled to
    // GDP and the rival's commerce appetite. Foreign wars make buyers pay more.
    // FX boost (GDD §5.1): a devalued currency makes exports cheaper for buyers.
    const warBoom = this.day < this.warBoomUntil ? 1.5 : 1;
    const fxBoost = this.passedLaws.has('central_bank_charter') ? 1 / Math.max(0.5, this.exchangeRate) : 1;
    this.exportEarningsLastMonth = this.rivals.reduce(
      (s, rv) =>
        rv.treaties.includes('trade_agreement')
          ? s + Math.min(12, this.gdpLastMonth * 0.025) * (0.5 + rv.weights.commerce / 10) * warBoom * fxBoost
          : s,
      0,
    );
    // Your own war contests the lanes (GDD §7.3) — and your own blockade
    // requisitions the merchantmen that would have carried the exports
    if (this.playerWar) this.exportEarningsLastMonth *= this.playerWar.blockade ? 0.6 : 0.7;
    this.treasury += revenue - spending + incomeTaxBonus + centralBankingBonus + estateLevyBonus +
      progressiveTaxBonus + protectionismBonus + austerityBonus + bankInterest + carbonLevyBonus + this.exportEarningsLastMonth;
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

  // ---- Monetary system (GDD §5.1): central bank, credit cycle, FX ----

  /** Bond coupon = policy rate + credit-rating spread. */
  get bondRate(): number {
    return this.policyRate + CREDIT_RATING_SPREADS[this.creditRating];
  }

  /** Issue sovereign bonds into the treasury. Returns false if the rating or
   *  debt ceiling blocks issuance. */
  issueBonds(amount: number): boolean {
    if (!this.nationProclaimed || !this.passedLaws.has('central_bank_charter')) return false;
    if (this.creditRating === 'D') return false;
    const ceiling = Math.max(1, this.gdpLastMonth * 12) * 2.0;
    if (this.nationalDebt + amount > ceiling) return false;
    this.nationalDebt += amount;
    this.treasury += amount;
    this.creditRating = this.computeCreditRating();
    this.addLog(`Issued ` + formatCurrency(Math.floor(amount)) + ` in bonds at ${(this.bondRate * 100).toFixed(1)}% (${this.creditRating}).`, 'info');
    return true;
  }

  setMonetaryRegime(regime: MonetaryRegime): void {
    if (this.monetaryRegime === regime) return;
    this.monetaryRegime = regime;
    const labels: Record<MonetaryRegime, string> = {
      float: 'floating exchange rate',
      peg: 'fixed exchange rate peg',
      print: 'money printing',
    };
    this.addLog(`Monetary regime: ${labels[regime]}.`, 'info');
  }

  private computeCreditRating(): CreditRating {
    const annualGDP = Math.max(1, this.gdpLastMonth * 12);
    const debtRatio = this.nationalDebt / annualGDP;
    let score = 6; // default AA
    if (debtRatio < 0.30) score = Math.min(score + 1, 7); // low debt → AAA
    if (debtRatio > 0.60) score--;
    if (debtRatio > 1.00) score--;
    if (debtRatio > 1.50) score--;
    if (debtRatio > 2.00) score--;
    if (this.inflationRate > 0.08) score--;
    if (this.inflationRate > 0.15) score--;
    if (this.confidence < 30) score--;
    if (this.nationProclaimed && this.legitimacy < 25) score--;
    const ratings: CreditRating[] = ['D', 'CCC', 'B', 'BB', 'BBB', 'A', 'AA', 'AAA'];
    return ratings[Math.max(0, Math.min(7, score))];
  }

  /** Monthly tick of the credit cycle, inflation, FX, and bond service. */
  private tickMonetary(): void {
    const gdp = Math.max(1, this.gdpLastMonth);

    // 1. Credit cycle: leverage grows below neutral rate, shrinks above it
    const dLeverage = (NEUTRAL_RATE - this.policyRate) * 0.5 * (1 - this.privateLeverage / 5.0);
    this.privateLeverage = Math.max(0, this.privateLeverage + dLeverage);

    // 2. Inflation: credit expansion + money printing
    const leverageInflation = Math.max(0, dLeverage) * 0.08;
    const printInflation = this.monetaryRegime === 'print' ? 0.010 : 0;
    const inflTarget = 0.02 + leverageInflation + printInflation;
    this.inflationRate += (inflTarget - this.inflationRate) * 0.15;
    this.inflationRate = Math.max(0, Math.min(0.50, this.inflationRate));

    // 3. Confidence: mean-reverts to 70, falls when debt service, inflation, or the
    //    leverage *level* (Minsky fragility) is high
    const debtService = this.privateLeverage * this.policyRate; // annual fraction
    const leveragePressure = Math.max(0, debtService - LEVERAGE_FRAGILITY) * 80;
    const inflPressure = Math.max(0, this.inflationRate - 0.08) * 40;
    const fragilityPressure = Math.max(0, this.privateLeverage - LEVERAGE_FRAGILE) * FRAGILITY_GAIN;
    const confTarget = Math.max(5, 70 - leveragePressure - inflPressure - fragilityPressure);
    this.confidence += (confTarget - this.confidence) * 0.12;
    this.confidence = Math.max(0, Math.min(100, this.confidence));

    // 4. Deleveraging bust: confidence crash forces rapid credit contraction
    if (this.confidence < 30 && this.privateLeverage > 0.5) {
      this.privateLeverage *= (1 - (0.05 + (30 - this.confidence) * 0.002));
      if (this.rng.chance(0.2)) {
        this.addLog('Credit markets freeze — banks call in loans as confidence breaks.', 'bad');
      }
    }

    // 5. 1929-analog crash: fires once when leverage is fragile in the historic window
    if (!this.crashFired && this.year >= 1927 && this.year <= 1936) {
      if (this.privateLeverage * this.policyRate > 0.12 && this.confidence < 55) {
        this.crashFired = true;
        this.confidence = Math.max(5, this.confidence - 40);
        this.privateLeverage *= 0.65;
        this.addLog('THE CRASH — credit markets seize. The world has not seen this before. A generation will remember.', 'bad');
      }
    }

    // 6. FX dynamics
    if (this.monetaryRegime === 'peg') {
      // Peg: hold exchange rate; drain reserves if trade is unfavorable
      const deficit = Math.max(0, this.totalPop() * 0.025 - this.exportEarningsLastMonth);
      this.treasury -= deficit * 0.12;
      // An exhausted treasury cannot defend a peg at all; a thin one gambles.
      if (this.treasury < gdp * 0.1 || (this.treasury < gdp * 0.25 && this.rng.chance(0.25))) {
        this.monetaryRegime = 'float';
        this.confidence = Math.max(5, this.confidence - 25);
        this.exchangeRate = Math.max(this.exchangeRate * 0.82, 0.30);
        this.addLog('The currency peg breaks — reserves exhausted. The exchange rate is in freefall.', 'bad');
      }
    } else {
      // Float/print: market-driven exchange rate
      const tradeUp = this.exportEarningsLastMonth > this.totalPop() * 0.025;
      const rateDiff = (this.policyRate - NEUTRAL_RATE) * 0.04;
      const confFlow = (this.confidence - 50) * 0.0003;
      const printDrag = this.monetaryRegime === 'print' ? -0.012 : 0;
      this.exchangeRate += (tradeUp ? 0.003 : -0.003) + rateDiff + confFlow + printDrag;
      this.exchangeRate = Math.max(0.30, Math.min(2.0, this.exchangeRate));
    }

    // 7. Print regime: money creation boosts treasury
    if (this.monetaryRegime === 'print') {
      this.treasury += gdp * 0.018;
    }

    // 8. Bond debt service
    if (this.nationalDebt > 0) {
      const service = this.nationalDebt * this.bondRate / 12;
      this.treasury -= service;
      if (this.treasury < 0) {
        this.nationalDebt -= this.treasury; // unpaid interest compounds into debt
        this.treasury = 0;
      }
    }

    // 9. Update credit rating
    this.creditRating = this.computeCreditRating();

    // 10. Inflation erodes satisfaction
    if (this.inflationRate > 0.05) {
      const drag = (this.inflationRate - 0.05) * 30;
      for (const t of this.settlements) {
        t.satisfaction = Math.max(0, t.satisfaction - drag);
      }
    }

    // 11. Transmit policy rate to private lenders — banks price above the base rate
    for (const lender of this.lenders) {
      const spread = 0.02 + lender.id * 0.005; // 2–3.5% spread; riskier lenders charge more
      lender.interestRate = Math.max(0.01, Math.min(0.20, this.policyRate + spread));
    }

    // 12. Lender liquidity regeneration — low rates encourage banks to lend freely
    for (const lender of this.lenders) {
      const recoveryRate = Math.max(0.04, 0.12 - this.policyRate); // 4–12% of max loan recovered per month
      lender.liquidCash = Math.min(lender.maxLoan * 4, lender.liquidCash + lender.maxLoan * recoveryRate);
    }

    // 13. Accrue interest on outstanding Central Bank discount window loan
    if (this.centralBankLoan > 0) {
      this.centralBankLoan += this.centralBankLoan * (this.policyRate / 12);
    }

    // 14. Keep player faction's CentralBank metadata in sync (create lazily if missing)
    const pf = this.faction(this.playerFactionId);
    if (pf) {
      if (!pf.centralBank) {
        pf.centralBank = {
          factionId: this.playerFactionId,
          foundedDay: this.day,
          reserves: {},
          interestRate: this.policyRate,
          inflationRate: this.inflationRate,
        };
      } else {
        pf.centralBank.interestRate = this.policyRate;
        pf.centralBank.inflationRate = this.inflationRate;
      }
    }
  }

  // ---- Phase 1: the sectoral economy (GDD §5.2) ----

  /** How industrialized the region is, 0..1 — counted off the tech tree. */
  private modernizationIndex(): number {
    const nodes = ['steel_industry', 'electrical_grid', 'combustion_engine', 'mass_production', 'asphalt', 'atomic_age'];
    return nodes.filter((n) => this.has(n)).length / nodes.length;
  }

  /** How far into the information age, 0..1. */
  private informationIndex(): number {
    return (this.has('computing') ? 0.5 : 0) +
      (this.has('automated_logistics') ? 0.35 : 0) +
      (this.has('maglev') ? 0.15 : 0);
  }

  /** Tech multipliers on output per worker, by sector.
   *
   *  Calibrated so wages feel right for each era:
   *    1900 (base):    £10–18/mo  ≈ £0.33–0.60/day  (frontier subsistence)
   *    1930 (steel+e): £25–50/mo  ≈ £0.83–1.67/day  (early industrial)
   *    1960 (mass):    £55–130/mo ≈ £1.83–4.33/day  (post-war boom)
   *    2000+ (info):   £80–220/mo ≈ £2.67–7.33/day  (knowledge economy)
   *
   *  Cumulative maximums: agri ~4x, industry ~9x, services ~7x, info ~12x. */
  private sectorProductivity(id: SectorId): number {
    let m = 1;
    const boost = (node: string, mult: number) => { if (this.has(node)) m *= mult; };
    switch (id) {
      case 'agriculture':
        boost('electrical_grid', 1.5);     // electrified irrigation and tools
        boost('combustion_engine', 2.5);   // tractors replace the horse
        boost('mass_production', 3.5);     // industrialised farming at scale
        boost('green_revolution', 1.8);    // high-yield cultivars and synthetic inputs
        boost('renewables', 2.0);          // precision agriculture, sustainable yields
        break;
      case 'industry':
        boost('steel_industry', 2.0);      // steel mills and heavy equipment
        boost('chemical_industry', 1.6);   // synthetics, fertilizer, process chemistry
        boost('electrical_grid', 2.0);     // electrified factories
        boost('mass_production', 4.0);     // assembly lines, Fordism
        boost('atomic_age', 2.5);          // nuclear power drives heavy industry
        boost('automated_logistics', 2.5); // robotic supply chains
        break;
      case 'services':
        boost('free_press', 1.5);          // literacy drives commerce
        boost('labor_law', 1.3);           // protected workers are productive workers
        boost('electrical_grid', 2.0);     // electrified retail, refrigeration
        boost('aviation', 1.4);            // air mobility multiplies trade and travel
        boost('asphalt', 2.0);             // road mobility multiplies trade
        boost('smart_grid', 1.3);          // sensors and demand-response trim waste
        boost('computing', 8.0);           // the productivity leap of the office PC
        break;
      case 'information':
        boost('free_press', 2.0);          // free information accelerates learning
        boost('telecommunications', 2.0);  // exchanges and broadcast knit the region
        boost('computing', 10.0);          // digital revolution, internet economy
        boost('internet', 3.0);            // packet-switched networks at scale
        boost('automated_logistics', 5.0); // global information networks
        boost('maglev', 2.0);              // ultra-fast connectivity
        break;
    }
    return m;
  }

  /** Where this town's labor wants to be, given the technology and the land.
   *  The century's arc: plough → mill → counter → terminal. */
  private sectorTargetShares(t: Settlement): Record<SectorId, number> {
    const m = this.modernizationIndex();
    const i = this.informationIndex();
    const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
    // Good land holds people on the farms a little longer; ports trade sooner.
    let agri = lerp(0.72, 0.04, m) + (t.landQuality - 1) * 0.08;
    let info = lerp(0.03, 0.30, i);
    let industry = lerp(0.14, 0.40, m) * (1 - 0.5 * i); // industrialize, then deindustrialize
    agri = Math.max(0.02, agri);
    let services = Math.max(0.05, 1 - agri - industry - info);
    if (t.site.coastal) services += 0.02;
    const shares = { agriculture: agri, industry, services, information: info };
    // Phase 2: a zoned town pulls an extra tenth of its labor to the designation
    if (t.focus !== 'balanced') shares[t.focus] += 0.10;
    const sum = shares.agriculture + shares.industry + shares.services + shares.information;
    for (const id of SECTOR_IDS) shares[id] /= sum;
    return shares;
  }

  /** Monthly: shares drift toward the tech-set target, output and wages follow. */
  private updateSectors(t: Settlement): void {
    const workers = this.workersOf(t);
    const target = this.sectorTargetShares(t);
    const strike = this.day < t.strikeUntil ? 0.6 : 1;
    // A resentful town works at half-heart (Phase 0 loyalty feeds Phase 1 output).
    const loyalty = 0.7 + 0.3 * (t.loyaltyToFaction / 100);
    // Phase 5: service level improves sector productivity
    const svcIdx = Math.min(2, Math.max(0, Math.round(t.policies.serviceLevel)));
    const svcMult = SERVICE_PROD_MULT[svcIdx];
    // Phase 5: tax band reduces effective sector output
    const taxRate = TAX_BAND_RATES[Math.min(3, Math.max(0, t.policies.taxBand))];
    const taxMult = 1 - taxRate;
    for (const id of SECTOR_IDS) {
      const s = t.sectors[id];
      const before = s.share;
      s.share += (target[id] - s.share) * 0.03; // a generation-scale drift, not a snap
      s.growth = s.share - before;
      const landTerm = id === 'agriculture' ? 0.6 + 0.4 * t.landQuality : 1;
      // Phase 2: civic works multiply what each hand produces
      const perWorker = SECTOR_BASE_OUTPUT[id] * this.sectorProductivity(id) * landTerm * (1 + this.buildingBonus(t, id));
      // Phase 4: active event modifiers (disasters reduce, windfalls boost)
      const eventMult = this.eventOutputMult(t, id);
      // Currency transition dents output until markets stabilize; the economic
      // system (design choice at nation flip) sets the steady-state multiplier.
      const fxMult = this.currencyEfficiency() * this.economyOutputMult();
      s.output = workers * s.share * perWorker * strike * loyalty * eventMult * svcMult * taxMult * fxMult;
      // Phase 5: wage policy adjusts the migration signal without affecting output
      const wagePolicyMult = t.policies.wagePolicy === 'low' ? 0.85 : t.policies.wagePolicy === 'high' ? 1.20 : 1.0;
      s.wage = perWorker * strike * loyalty * eventMult * svcMult * wagePolicyMult * fxMult;
    }
  }

  /** Combined output multiplier from all active events for a given sector. */
  private eventOutputMult(t: Settlement, sector: SectorId): number {
    let mult = 1;
    for (const ev of t.activeEvents) {
      if (ev.untilDay <= this.day) continue;
      const def = REGION_EVENT_DEFS_MAP.get(ev.kind);
      if (!def) continue;
      if (def.sector === sector || def.sector === 'all') mult *= def.outputMult;
    }
    return mult;
  }

  /** Total sector output, £/month — the town's contribution to GDP. */
  sectorOutputOf(t: Settlement): number {
    return SECTOR_IDS.reduce((sum, id) => sum + t.sectors[id].output, 0);
  }

  /** Employment-weighted average wage — the migration signal. */
  avgWageOf(t: Settlement): number {
    return SECTOR_IDS.reduce((sum, id) => sum + t.sectors[id].share * t.sectors[id].wage, 0);
  }

  // ---- Phase 2: civic works & development focus ----

  /** Deep management opens for the capital from Incorporation, and for any
   *  other town that grows past city size (the hybrid: your seat of power
   *  gets the drafting table; the hamlets run themselves). */
  canManageCity(t: Settlement): { ok: boolean; reason: string } {
    if (!this.stateProclaimed) return { ok: false, reason: 'city management opens at Incorporation' };
    if (t.factionId !== this.playerFactionId) return { ok: false, reason: 'not your town' };
    const isCapital = this.faction(this.playerFactionId)?.capital === t.id;
    if (!isCapital && this.popOf(t) < CITY_MANAGEMENT_POP) {
      return { ok: false, reason: `direct management at ${CITY_MANAGEMENT_POP} pop (or the capital)` };
    }
    return { ok: true, reason: '' };
  }

  buildingCount(t: Settlement, defId: string): number {
    return t.buildings.filter((b) => b === defId).length + (t.construction?.id === defId ? 1 : 0);
  }

  /** Why this building can't be raised here right now — or ok. */
  cityBuildCheck(t: Settlement, def: RegionalBuildingDef): { ok: boolean; reason: string } {
    if (t.factionId !== this.playerFactionId) return { ok: false, reason: 'not your town' };
    if (this.stateProclaimed) {
      const manage = this.canManageCity(t);
      if (!manage.ok) return manage;
    }
    if (t.construction) return { ok: false, reason: 'a project is already underway' };
    if (def.prereq && !this.has(def.prereq)) {
      const node = TECH_TREE.find((n) => n.id === def.prereq);
      return { ok: false, reason: `requires ${node?.name ?? def.prereq}` };
    }
    if (this.buildingCount(t, def.id) >= def.max) return { ok: false, reason: 'already built' };
    const cost = this.cityBuildCost(def);
    if (this.treasury < cost) return { ok: false, reason: `needs ` + formatCurrency(cost) + `` };
    return { ok: true, reason: '' };
  }

  /** Break ground on a civic work. The treasury pays now; the bonus arrives
   *  when the scaffolding comes down. */
  buildCity(townId: number, defId: string): boolean {
    const t = this.settlement(townId);
    const def = REGION_BUILDINGS_MAP.get(defId);
    if (!t || !def || !this.cityBuildCheck(t, def).ok) return false;
    const cost = this.cityBuildCost(def);
    this.treasury -= cost;
    t.construction = { id: def.id, doneDay: this.day + def.days };
    this.addLog(`Ground is broken for the ${def.name} at ${t.name} — ` + formatCurrency(cost) + `, ${def.days} days.`, 'info');
    return true;
  }

  /** Hire a scout from one of the player's towns to explore the fog of war.
   *  Available pre-state; costs £10 from the treasury. Max 2 active scouts. */
  sendPlayerScout(townId: number): { ok: boolean; reason: string } {
    const t = this.settlement(townId);
    if (!t || t.factionId !== this.playerFactionId) return { ok: false, reason: 'not your town' };
    const active = this.scouts.filter((s) => s.factionId === this.playerFactionId).length;
    if (active >= 2) return { ok: false, reason: 'already 2 scouts in the field' };
    if (this.treasury < 10) return { ok: false, reason: 'need £10' };
    this.treasury -= 10;
    const scout: Scout = {
      id: this.nextScoutId++,
      factionId: this.playerFactionId,
      x: Math.max(0, Math.min(100, t.x + (Math.random() * 4 - 2))),
      y: Math.max(0, Math.min(100, t.y + (Math.random() * 4 - 2))),
      health: 100,
      maintenanceCost: 0,
      createdDay: this.day,
      expireDay: this.day + 200,
      targetMode: 'random',
    };
    this.scouts.push(scout);
    this.addLog(`A scout sets out from ${t.name} to map the surrounding lands.`, 'info');
    return { ok: true, reason: '' };
  }

  /** Repaint a town's development focus: labor drifts toward the favored
   *  sector starting next month. */
  setTownFocus(townId: number, focus: TownFocus): boolean {
    const t = this.settlement(townId);
    if (!t || t.focus === focus) return false;
    // Pre-state: only the player's own towns may be steered; post-state the full
    // canManageCity gate applies (which also covers population requirements).
    const isPlayerTown = t.factionId === this.playerFactionId;
    if (!isPlayerTown) return false;
    if (this.stateProclaimed && !this.canManageCity(t).ok) return false;
    if (this.treasury < FOCUS_CHANGE_COST) return false;
    this.treasury -= FOCUS_CHANGE_COST;
    t.focus = focus;
    this.addLog(
      focus === 'balanced'
        ? `${t.name} returns to balanced development.`
        : `${t.name} is zoned for ${SECTOR_NAMES[focus].toLowerCase()} — labor will follow the designation.`,
      'info',
    );
    return true;
  }

  /** Sum of building output bonuses for one sector in this town. */
  private buildingBonus(t: Settlement, sector: SectorId): number {
    let bonus = 0;
    for (const id of t.buildings) {
      const def = REGION_BUILDINGS_MAP.get(id);
      if (def && (def.sector === sector || def.sector === 'all')) bonus += def.bonus;
    }
    return bonus;
  }

  /** Flat satisfaction bonus from civic works (waterworks, hospital…). */
  private buildingSatisfaction(t: Settlement): number {
    return t.buildings.reduce((s, id) => s + (REGION_BUILDINGS_MAP.get(id)?.satisfaction ?? 0), 0);
  }

  /** Extra survey radius from this town's works (telegraph office). */
  private buildingSight(t: Settlement): number {
    return t.buildings.reduce((s, id) => s + (REGION_BUILDINGS_MAP.get(id)?.sight ?? 0), 0);
  }

  /** £/month the built works cost to keep running. */
  private buildingUpkeep(): number {
    let total = 0;
    for (const t of this.settlements) {
      if (t.factionId !== this.playerFactionId) continue;
      for (const id of t.buildings) total += REGION_BUILDINGS_MAP.get(id)?.upkeep ?? 0;
    }
    // Wagner tilt: the public sector's share of GDP rises as the nation develops.
    return total * this.devFactor() ** TUNING.wagnerExp;
  }

  // ---- Phase 4: Regional Events ----

  /** Fire and expire settlement-level events monthly. */
  private tickRegionalEvents(): void {
    for (const t of this.settlements) {
      // Expire events whose duration has run
      t.activeEvents = t.activeEvents.filter((ev) => ev.untilDay > this.day);
      // Roll each event definition per settlement
      for (const def of REGION_EVENT_DEFS) {
        if (def.minYear !== undefined && this.year < def.minYear) continue; // era-gated
        if (!this.rng.chance(def.probability)) continue;
        if (t.activeEvents.some((ev) => ev.kind === def.kind)) continue; // no stacking
        t.activeEvents.push({ kind: def.kind, untilDay: this.day + def.durationDays, severity: 1 });
        // events-depth: one-shot satisfaction/grievance swings (bounded, clamped)
        if (def.satisfaction) t.satisfaction = Math.max(0, Math.min(100, t.satisfaction + def.satisfaction));
        if (def.grievance) t.grievance = Math.max(0, Math.min(100, t.grievance + def.grievance));
        const good = def.outputMult >= 1.0;
        this.townEvent(t, `${def.name}: ${def.desc}`, good ? 'good' : 'bad');
        this.addLog(`${def.name} strikes ${t.name} — ${def.desc}`, good ? 'good' : 'bad');
      }
    }
  }

  // ---- Emergency Aid ----

  /** Spend treasury to send emergency grain to a starving player-owned town.
   *  Cost: £10 per 500 food (minimum viable ration for the settlement's pop). */
  sendFoodAid(townId: number): boolean {
    const t = this.settlement(townId);
    if (!t || t.factionId !== this.playerFactionId) return false;
    const cost = 10;
    if (this.treasury < cost) return false;
    const amount = Math.max(200, Math.round(this.popOf(t) * 5));
    t.food += amount;
    this.treasury -= cost;
    this.addLog(`Emergency grain convoy reaches ${t.name} (+${amount} food, −` + formatCurrency(cost) + `).`, 'good');
    this.townEvent(t, `Emergency grain convoy arrived.`, 'good');
    return true;
  }

  // ---- Phase C: Conquest & Diplomacy ----

  /** Player's military power relative to a rival faction (0 = even, >1 = player dominant). */
  private militaryEdge(rivalFactionId: number): number {
    const playerFaction = this.faction(this.playerFactionId);
    const rival = this.faction(rivalFactionId);
    if (!playerFaction || !rival) return 0;
    const playerPower = playerFaction.militaryStrength + playerFaction.settlementIds.length * 2;
    const rivalPower = Math.max(1, rival.militaryStrength + rival.settlementIds.length * 2);
    return playerPower / rivalPower;
  }

  /**
   * Player proposes vassalization to a rival regional faction.
   * Accepted when the player has ≥2× military edge OR the rival is economically
   * desperate (treasury < 100) with player at ≥1.2× military edge.
   * Returns 'accepted' | 'refused' | 'invalid'.
   */
  offerVassalage(factionId: number): 'accepted' | 'refused' | 'invalid' {
    const playerFaction = this.faction(this.playerFactionId);
    const rival = this.faction(factionId);
    if (!playerFaction || !rival || factionId === this.playerFactionId) return 'invalid';
    if (rival.overlordId !== null) return 'invalid'; // already a vassal
    if (rival.settlementIds.length === 0) return 'invalid'; // no territory to submit
    if (!this.stateProclaimed) return 'invalid'; // need a state to receive vassals

    const edge = this.militaryEdge(factionId);
    const desperate = rival.treasury < 100;
    const accepts = edge >= 2.0 || (desperate && edge >= 1.2);

    if (accepts) {
      rival.overlordId = this.playerFactionId;
      playerFaction.vassals.push(factionId);
      rival.aggressiveness = Math.max(0, rival.aggressiveness - 30);
      this.addLog(
        `VASSALAGE: ${rival.name} submits to your authority, pledging tribute and allegiance. ` +
        `Their territory now counts toward your hegemony.`,
        'good',
      );
      return 'accepted';
    } else {
      this.addLog(
        `REFUSED: ${rival.name} rejects your offer of suzerainty. ` +
        `Their ${rival.regime} government will not submit to a foreign power — yet.`,
        'bad',
      );
      return 'refused';
    }
  }

  /**
   * Player purchases territory from a faction that is economically desperate
   * (treasury < 150). The least-developed non-capital settlement is ceded; player
   * pays £500. Returns true if the purchase completed.
   */
  buyLand(factionId: number): boolean {
    const playerFaction = this.faction(this.playerFactionId);
    const rival = this.faction(factionId);
    if (!playerFaction || !rival || factionId === this.playerFactionId) return false;
    if (rival.treasury >= 150) return false; // not desperate enough
    const COST = 500;
    if (this.treasury < COST) return false;

    // Find the rival's least-populated non-capital settlement
    const candidates = rival.settlementIds
      .filter((id) => id !== rival.capital)
      .map((id) => ({ id, pop: this.popOf(this.settlement(id)!) || 0 }))
      .sort((a, b) => a.pop - b.pop);

    if (candidates.length === 0) return false;
    const ceded = candidates[0];
    const s = this.settlement(ceded.id);
    if (!s) return false;

    // Transfer settlement to player
    s.factionId = this.playerFactionId;
    rival.settlementIds = rival.settlementIds.filter((id) => id !== ceded.id);
    playerFaction.settlementIds.push(ceded.id);
    this.treasury -= COST;
    rival.treasury += COST;

    this.addLog(
      `LAND PURCHASE: ${rival.name} cedes ${s.name} in exchange for ${formatCurrency(COST)}. ` +
      `Their depleted treasury accepted the offer.`,
      'good',
    );
    return true;
  }

  // ---- Phase 5: Local Policies ----

  /** Change a local governance policy for a managed city. */
  setCityPolicy(townId: number, key: keyof CityPolicies, value: number | WagePolicy): boolean {
    const t = this.settlement(townId);
    if (!t) return false;
    // Pre-state: allow the player to set basic policies on their own towns.
    // Post-state: the full canManageCity gate applies.
    const isPlayerTown = t.factionId === this.playerFactionId;
    if (!isPlayerTown) return false;
    if (this.stateProclaimed && !this.canManageCity(t).ok) return false;
    if (key === 'taxBand') {
      const v = Number(value);
      if (v < 0 || v > 3 || !Number.isInteger(v)) return false;
      t.policies.taxBand = v;
    } else if (key === 'wagePolicy') {
      if (value !== 'low' && value !== 'market' && value !== 'high') return false;
      t.policies.wagePolicy = value as WagePolicy;
    } else if (key === 'serviceLevel') {
      const v = Number(value);
      if (v < 0 || v > 2 || !Number.isInteger(v)) return false;
      t.policies.serviceLevel = v;
    }
    return true;
  }

  /** Extra monthly treasury cost for cities running generous services. */
  private policyServiceUpkeep(): number {
    let total = 0;
    for (const t of this.settlements) {
      if (!this.canManageCity(t).ok) continue;
      if (t.policies.serviceLevel >= 2) total += this.popOf(t) * 0.002;
    }
    return total;
  }

  // ---- Phase 6: Trade Route Cargo ----

  /** Monthly: tag each route with its dominant cargo based on the output gap
   *  between connected settlements. The greater the surplus difference in a
   *  sector, the more that sector's goods fill the wagons. */
  private updateRouteCargo(): void {
    for (const route of this.routes) {
      const a = this.settlement(route.a);
      const b = this.settlement(route.b);
      if (!a || !b) { route.cargoType = null; continue; }
      // A governor's manual pin (Phase A route-network controls) wins over the
      // auto reading — the wagons carry what the state directs.
      if (route.cargoPriority) { route.cargoType = route.cargoPriority; continue; }
      let maxDiff = 0;
      let dominant: SectorId | null = null;
      for (const id of SECTOR_IDS) {
        const diff = Math.abs(a.sectors[id].output - b.sectors[id].output);
        if (diff > maxDiff) { maxDiff = diff; dominant = id; }
      }
      route.cargoType = maxDiff > 0.5 ? dominant : null;
    }
  }

  /** Finish any construction whose day has come. */
  private updateConstruction(): void {
    for (const t of this.settlements) {
      if (t.construction && this.day >= t.construction.doneDay) {
        const def = REGION_BUILDINGS_MAP.get(t.construction!.id);
        t.buildings.push(t.construction.id);
        t.construction = null;
        if (def) {
          this.addLog(`The ${def.name} opens at ${t.name}.`, 'good');
          this.townEvent(t, `The ${def.name} opens its doors.`, 'good');
        }
      }
    }
  }

  private migrate(): void {
    if (this.settlements.length < 2) return;
    // People follow both contentment and pay (Phase 1): a booming mill town
    // pulls labor off poor farms even when life there is pleasant enough.
    const regionWage = this.settlements.reduce((s, t) => s + this.avgWageOf(t), 0) / this.settlements.length;
    const score = (t: Settlement) => t.satisfaction + (this.avgWageOf(t) - regionWage) * 30;
    // One pass for the magnet and the source — no full sort, and avgWageOf runs
    // once per town instead of O(n log n) times through a comparator.
    let best = this.settlements[0], worst = this.settlements[0];
    let bestScore = score(best), worstScore = bestScore;
    for (const t of this.settlements) {
      const sc = score(t);
      if (sc > bestScore) { bestScore = sc; best = t; }      // first max (matches stable sort [0])
      if (sc <= worstScore) { worstScore = sc; worst = t; }  // last min (matches stable sort [last])
    }
    // Don't feed an already-overcrowded destination; cap the capital magnet effect.
    const destFull = this.popOf(best) >= best.housing;
    if (bestScore - worstScore > 15 && this.popOf(worst) > 10 && !destFull) {
      // movers ride the network too: without a route, only a trickle walks out
      const connected = this.routePath(worst.id, best.id) !== null;
      // 1% per month (was 2%): urbanization is gradual, not a mass exodus
      const movers = this.popOf(worst) * 0.01 * (connected ? 1 : 0.3);
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
    const militaryReformBonus = this.passedLaws.has('military_reform') ? 1.2 : 1;
    const standingArmyBonus = this.policyActive('standing_army') ? 2 : 0;
    const funded = this.stateProclaimed
      ? (1 + 0.2 * (this.militiaLevel + standingArmyBonus) + (this.govLean === 'mayor' ? 0.2 : 0)) * defenceBonus * militaryReformBonus
      : 1;
    // M6c: the network is defense — a built link to a bigger town brings relief
    const relief = this.reliefLine(t);
    // A Defensive Pact (GDD §5.4) puts allied arms behind the militia
    const pact = this.rivals.some((rv) => rv.treaties.includes('defensive_pact'));
    // Defensive doctrine (nation design): the homeland is where the drills pay
    const doctrine = this.militaryDoctrine === 'defensive' ? 1.2 : 1;
    // A standing garrison stiffens the line on top of the levée of working hands.
    const garrison = (t.garrisonStrength || 0) * 0.5;
    const militia = (this.workersOf(t) * 0.12 + garrison) * captain * funded * (relief ? 1.25 : 1) * (pact ? 1.15 : 1) * doctrine;
    t.lastRaidDay = this.day;
    const foreignArms = sponsored ? ` The dead carried rifles of foreign make — ${sponsor!.name}'s hand, deniably.` : '';
    if (militia >= strength) {
      this.addLog(
        (relief
          ? `Raiders struck ${t.name} and were driven off — relief militia rode in along the line.`
          : `Raiders struck ${t.name} and were driven off by the militia.`) + foreignArms,
        'good',
      );
      this.townEvent(t, 'Raiders repelled by the militia.', 'good');
    } else {
      const losses = Math.min(this.popOf(t) * 0.06, strength - militia);
      this.removePop(t, losses);
      t.food *= 0.85;
      this.addLog(`Raiders overran ${t.name}'s pickets — ${Math.max(1, Math.round(losses))} lost, stores plundered.` + foreignArms, 'bad');
      this.townEvent(t, `Raid — ${Math.max(1, Math.round(losses))} killed, stores plundered.`, 'bad');
    }
  }

  private eventFever(t: Settlement): void {
    const sick = Math.round(this.popOf(t) * 0.05);
    t.cohorts.bands[4] *= 0.92;
    t.cohorts.bands[0] *= 0.97;
    t.satisfaction -= 5;
    this.addLog(`Fever in ${t.name} — ${sick} bedridden; the old and the young suffer worst.`, 'bad');
    this.townEvent(t, `Fever — ${sick} bedridden; the old and the young suffer worst.`, 'bad');
  }

  private eventHarvest(t: Settlement): void {
    t.food += this.workersOf(t) * 4;
    this.addLog(`A bumper harvest in ${t.name}.`, 'good');
    this.townEvent(t, 'Bumper harvest — the granaries overflow.', 'good');
  }

  private eventWagonTrain(t: Settlement): void {
    // Settlers chase good land, not hardship. A drought (failed harvests, word
    // travels fast) and heavy taxes both thin the wagon trains — and a town that
    // is starving or miserable draws no one at all. This keeps immigration from
    // papering over local economic conditions.
    const droughtMult = this.eventOutputMult(t, 'agriculture');
    const taxMult = 1 - TAX_BAND_RATES[Math.min(3, Math.max(0, t.policies.taxBand))] * 2;
    const fed = t.food > this.popOf(t); // hungry towns repel settlers
    const content = t.satisfaction > 45;
    if (!fed || !content) return; // the wagon train rolls on past
    const wave = Math.round((3 + this.rng.int(6)) * droughtMult * Math.max(0, taxMult));
    if (wave < 1) return; // conditions too poor to draw anyone
    t.cohorts.bands[1] += wave * 0.7;
    t.cohorts.bands[2] += wave * 0.3;
    this.addLog(`A wagon train of ${wave} arrives at ${t.name}, drawn by word of the frontier.`, 'good');
    this.townEvent(t, `Wagon train arrives — ${wave} new settlers join the town.`, 'good');
  }

  private eventFair(t: Settlement): void {
    t.satisfaction = Math.min(100, t.satisfaction + 6);
    this.addLog(`${t.name} holds a harvest fair. Spirits lift.`, 'good');
    this.townEvent(t, 'Harvest fair held — spirits lift across the town.', 'info');
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
      this.addLog(`Prospectors file a claim in the hills above ${t.name} — ` + formatCurrency(find) + ` in fees and assay to the treasury.`, 'good');
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
    const m = this.expansionCostMult();
    const needPop = Math.round(24 * m), needFood = Math.round(80 * m), needWood = Math.round(80 * m);
    if (this.popOf(t) < needPop) return { ok: false, reason: `needs ${needPop} pop (has ${Math.floor(this.popOf(t))})` };
    if (t.food < needFood) return { ok: false, reason: `needs ${needFood} food (has ${Math.floor(t.food)})` };
    if (t.wood < needWood) return { ok: false, reason: `needs ${needWood} wood (has ${Math.floor(t.wood)})` };
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
    const m = this.expansionCostMult();
    const food = Math.round(80 * m), wood = Math.round(80 * m);
    if (!this.launchExpedition(t, 8, food, wood)) return false;
    this.removePop(t, 8);
    t.food -= food;
    t.wood -= wood;
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

  // ---- garrison (militia) ----
  /** A town can only field as many militia as its populace allows — bigger
   *  towns sustain larger garrisons; tiny hamlets can't. */
  garrisonCap(t: Settlement): number {
    return Math.min(16, 6 + Math.floor(this.popOf(t) / 12));
  }

  static readonly MILITIA_COST = 250;
  static readonly MILITIA_ADD = 2;

  canRecruitMilitia(townId: number): { ok: boolean; reason: string } {
    const t = this.settlement(townId);
    if (!t) return { ok: false, reason: 'no settlement' };
    if (this.treasury < RegionSim.MILITIA_COST) {
      return { ok: false, reason: `needs ${formatCurrency(RegionSim.MILITIA_COST)} (have ${formatCurrency(Math.floor(this.treasury))})` };
    }
    if (this.popOf(t) < 12) return { ok: false, reason: 'too few people to muster a militia' };
    if ((t.garrisonStrength || 0) >= this.garrisonCap(t)) {
      return { ok: false, reason: `garrison at capacity (${this.garrisonCap(t)}) — grow the town first` };
    }
    return { ok: true, reason: '' };
  }

  /** Arm and drill fresh militia: spend treasury to raise this town's garrison,
   *  which both stiffens raid defence and counts toward the Charter's military
   *  gate. Capped by the town's population. */
  recruitMilitia(townId: number): boolean {
    const check = this.canRecruitMilitia(townId);
    const t = this.settlement(townId);
    if (!check.ok || !t) return false;
    this.treasury -= RegionSim.MILITIA_COST;
    t.garrisonStrength = Math.min(this.garrisonCap(t), (t.garrisonStrength || 0) + RegionSim.MILITIA_ADD);
    this.addLog(`${t.name} drills fresh militia — garrison now ${Math.round(t.garrisonStrength)}.`, 'info');
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
          recentEvents: [],
          // Phase 0: Regional faction system
          factionId: this.playerFactionId,
          garrisonStrength: 2, // new towns have smaller garrisons
          stationedUnits: [],
          loyaltyToFaction: 100,
          sectors: defaultSectors(),
          buildings: [],
          construction: null,
          focus: 'balanced',
          activeEvents: [],
          policies: { ...DEFAULT_CITY_POLICIES },
        };
        this.settlements.push(town);
        // Reveal the new settlement and surrounding area
        this.revealTiles(town.x, town.y, 2, 'explored');
        // Update player faction settlement list
        const playerFaction = this.faction(this.playerFactionId);
        if (playerFaction) {
          playerFaction.settlementIds.push(town.id);
        }
        this.expeditions = this.expeditions.filter((o) => o !== e);
        const flavor = e.site.river ? 'on the riverbank' : e.site.coastal ? 'by the sea' : e.site.fertility > 1 ? 'in good black soil' : 'on thin ground';
        this.addLog(`${town.name} is founded ${flavor} — the ${this.ordinal(this.settlements.length)} town of the colony.`, 'good');
        // graft the new town onto the central network: blaze its trail to the
        // nearest town already on the faction backbone, not whoever sent the expedition
        this.blazeTrail(this.networkAnchor(town), town.id);
        // A founder steps up
        this.mintNotable('Reeve', town.id);
      }
    }
  }

  private ordinal(n: number): string {
    return n === 2 ? 'second' : n === 3 ? 'third' : `${n}th`;
  }

  // ---- the State gate (GDD §2.2) ----
  /** Per-requirement breakdown of the Incorporation gate, so the UI can show
   *  exactly which conditions are met and which still block the Charter. */
  charterGates(): { label: string; met: boolean; detail: string }[] {
    const playerSettlements = this.settlements.filter((s) => s.factionId === this.playerFactionId);
    const garrison = playerSettlements.reduce((sum, s) => sum + this.garrisonOf(s), 0);
    const net = this.getNetTreasury();
    return [
      { label: 'towns', met: playerSettlements.length >= 3, detail: `${playerSettlements.length}/3` },
      { label: 'citizens', met: this.totalPop() >= 500, detail: `${this.totalPop()}/500` },
      { label: 'all towns connected', met: this.connectedToAll(), detail: this.connectedToAll() ? 'yes' : 'no' },
      { label: 'treasury', met: net >= 8000, detail: `${formatCurrency(Math.round(net))}/${formatCurrency(8000)}` },
      { label: 'garrison', met: garrison >= 10, detail: `${Math.round(garrison)}/10` },
    ];
  }

  charterEligible(): boolean {
    // GDD §2.2: 3 towns, 500 citizens, all connected by routes, plus economic and military strength
    const playerSettlements = this.settlements.filter((s) => s.factionId === this.playerFactionId);
    if (playerSettlements.length < 3 || this.totalPop() < 500 || !this.connectedToAll()) return false;
    // Economic gate: £8k net (after loans) — roughly 3-4 months of surplus at charter scale
    if (this.getNetTreasury() < 8000) return false;
    // Military gate: must have 10+ garrison across all settlements
    const totalGarrison = playerSettlements.reduce((sum, s) => sum + this.garrisonOf(s), 0);
    if (totalGarrison < 10) return false;
    return true;
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

  // ---- Phase 0: Exploration & Fog of War ----

  /** Update exploration visibility based on settlements and caravan routes. */
  private updateExploration(): void {
    // The space age ends the fog for good: orbital survey sees everything.
    if (this.has('computing')) {
      for (let x = 0; x < 100; x++) {
        for (let y = 0; y < 100; y++) {
          this.explorationMap[x][y] = 'explored';
        }
      }
      return;
    }
    // Settlements and routes automatically reveal tiles around them
    let sightRadius = 2; // base sight radius
    // Technology improvements to sight: wires, then wings
    if (this.has('electrical_grid')) sightRadius += 1; // telegraph lines along every road
    if (this.has('combustion_engine')) sightRadius += 2; // aerial survey
    for (const settlement of this.settlements) {
      // Phase 2: a telegraph office extends this town's survey reach
      this.revealTiles(settlement.x, settlement.y, sightRadius + this.buildingSight(settlement), 'explored');
    }

    // Routes also reveal tiles (caravans passively explore)
    for (const route of this.routes) {
      const a = this.settlement(route.a);
      const b = this.settlement(route.b);
      if (!a || !b) continue;
      // Reveal a corridor along the route (simplified: just endpoints)
      this.revealTiles(a.x, a.y, 1, 'explored');
      this.revealTiles(b.x, b.y, 1, 'explored');
    }

    // Scout units reveal tiles
    for (const scout of this.scouts) {
      this.revealTiles(scout.x, scout.y, 5, 'explored');
    }
  }

  /** The promotion-as-moment (GDD §2.2): the player names the State and sets its lean. */
  completeIncorporation(stateName: string, lean: GovLean): void {
    if (!this.ceremonyPending || this.stateProclaimed) return;
    this.ceremonyPending = false;
    this.stateProclaimed = true;
    this.stateName = stateName.trim() || 'The Valley State';
    this.govLean = lean;
    // Charter ceremony costs £4k; remaining treasury becomes state capital (minimum 50 residual)
    const charterCost = 4000;
    this.treasury = Math.max(50, this.treasury - charterCost);
    const mayor = this.notables.find((n) => n.alive && n.role === 'Mayor');
    this.addLog(
      `INCORPORATION: with ${this.settlements.length} towns and ${this.totalPop()} citizens, ` +
      `${mayor ? mayor.name + ' signs' : 'the council signs'} the Regional Charter under the banner of ` +
      `${GOV_LEANS[lean].name}. Charter ceremony costs ` + formatCurrency(charterCost) + `. ${this.stateName} is proclaimed — Tier 2 begins here.`,
      'good',
    );
    if (mayor) mayor.bio.push(`Signed the Regional Charter of ${this.stateName}, ${this.year}.`);
    // Rivals bootstrapped their first settlements in initializeRivalFactions() at region start;
    // any faction still landless (edge case) gets one last chance here.
    for (const faction of this.regionalFactions) {
      if (faction.id === this.playerFactionId) continue;
      if (faction.settlementIds.length === 0 && faction.treasury >= 50) {
        const site = this.findBestExpansionSite(faction, 8);
        if (site && site.score > 0) {
          const s = this.foundSettlement(faction, site.x, site.y);
          if (s) { faction.capital = s.id; faction.treasury -= 50; }
        }
      }
    }
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
      + (this.passedLaws.has('workers_charter') ? 20 : 0)
      - (this.passedLaws.has('conscription_act') ? 5 : 0)
      + (this.passedLaws.has('estate_tax') ? 10 : 0)
      + (this.passedLaws.has('progressive_tax') ? 15 : 0)
      + (this.passedLaws.has('welfare_benefits') ? 10 : 0)
      + (this.passedLaws.has('national_education_act') ? 10 : 0)
      + (this.passedLaws.has('healthcare_act') ? 10 : 0)
      + (this.passedLaws.has('land_reform') ? 20 : 0)
      + (this.passedLaws.has('trade_unions_act') ? 20 : 0),
    ));

    const landownerPower = Math.min(50, 15 + food * 0.005);
    const landownerSupport = Math.max(0, Math.min(100,
      70 - this.taxRate * 160
      - (this.passedLaws.has('estate_tax') ? 25 : 0)
      - (this.passedLaws.has('workers_charter') ? 10 : 0)
      - (this.passedLaws.has('progressive_tax') ? 10 : 0)
      - (this.passedLaws.has('land_reform') ? 30 : 0)
      - (this.passedLaws.has('trade_unions_act') ? 10 : 0)
      + (this.passedLaws.has('tariff_act') ? 10 : 0),
    ));

    const merchantPower = Math.min(40, 10 + trade * 0.12);
    const merchantSupport = Math.max(0, Math.min(100,
      50 + trade * 0.05
      + (this.passedLaws.has('merchants_charter') ? 25 : 0)
      - (this.passedLaws.has('workers_charter') ? 10 : 0)
      - (this.passedLaws.has('progressive_tax') ? 10 : 0)
      + (this.passedLaws.has('press_freedom_act') ? 10 : 0)
      - (this.passedLaws.has('tariff_act') ? 10 : 0),
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

    // Update regional faction economies: calculate production based on resource focus
    this.updateRegionalTrade();

    // Update faction alliances: compatible goals form pacts, incompatible ones break
    this.updateFactionAlliances();
  }

  /** Calculate regional trade dynamics: factions compete for market dominance by resource type. */
  private updateRegionalTrade(): void {
    // Calculate resource production for each faction
    const factionResources: Record<number, Record<string, number>> = {};

    for (const faction of this.regionalFactions) {
      factionResources[faction.id] = {
        wool: 0,
        grain: 0,
        iron: 0,
        wood: 0,
      };

      for (const settlementId of faction.settlementIds) {
        const settlement = this.settlement(settlementId);
        if (!settlement) continue;

        const focus = settlement.resourceFocus ?? 'diverse';
        const pop = this.popOf(settlement);

        // Production scales with population and resource focus
        const baseProduction = pop * 0.5;
        if (focus === 'wool') {
          factionResources[faction.id].wool += baseProduction * 1.5;
        } else if (focus === 'grain') {
          factionResources[faction.id].grain += baseProduction * 1.5;
        } else if (focus === 'iron') {
          factionResources[faction.id].iron += baseProduction * 1.5;
        } else if (focus === 'wood') {
          factionResources[faction.id].wood += baseProduction * 1.5;
        } else {
          // diverse: spread evenly
          factionResources[faction.id].wool += baseProduction * 0.3;
          factionResources[faction.id].grain += baseProduction * 0.3;
          factionResources[faction.id].iron += baseProduction * 0.2;
          factionResources[faction.id].wood += baseProduction * 0.2;
        }
      }
    }

    // Calculate total regional production for price dynamics
    const totalProduction = {
      wool: 0,
      grain: 0,
      iron: 0,
      wood: 0,
    };

    for (const resources of Object.values(factionResources)) {
      totalProduction.wool += resources.wool;
      totalProduction.grain += resources.grain;
      totalProduction.iron += resources.iron;
      totalProduction.wood += resources.wood;
    }

    // Update faction treasuries based on trade dominance
    for (const faction of this.regionalFactions) {
      if (faction.id === this.playerFactionId) continue; // Player treasury handled elsewhere

      const resources = factionResources[faction.id];
      let tradeIncome = 0;

      // Factions with dominant resource production earn more
      if (totalProduction.wool > 0 && resources.wool > totalProduction.wool * 0.4) {
        tradeIncome += resources.wool * 0.08;
      }
      if (totalProduction.grain > 0 && resources.grain > totalProduction.grain * 0.4) {
        tradeIncome += resources.grain * 0.06;
      }
      if (totalProduction.iron > 0 && resources.iron > totalProduction.iron * 0.5) {
        tradeIncome += resources.iron * 0.12;
      }
      if (totalProduction.wood > 0 && resources.wood > totalProduction.wood * 0.4) {
        tradeIncome += resources.wood * 0.07;
      }

      // General trade income from all settlements
      tradeIncome += faction.settlementIds.length * 5;

      // Diplomacy bends the ledger: allies open their markets to one another, while
      // factions locked in goal-conflict raise barriers (an implicit embargo). This
      // ties the regional economy to the alliance/rivalry web rather than running blind.
      tradeIncome *= this.factionTradeModifier(faction);

      faction.treasury += tradeIncome;
    }
  }

  /** Trade multiplier from a faction's standing: each ally opens a market (+8%),
   *  each goal-conflicting rival closes one (−12%, an embargo). Clamped so trade
   *  never fully collapses or runs away. */
  private factionTradeModifier(faction: RegionalFaction): number {
    let mod = 1.0;
    for (const other of this.regionalFactions) {
      if (other.id === faction.id) continue;
      if (this.areAllied(faction.id, other.id)) {
        mod += 0.08;
      } else if (faction.currentGoal && other.currentGoal
        && this.evaluateGoalConflict(faction.currentGoal, other.currentGoal) >= 60) {
        mod -= 0.12;
      }
    }
    return Math.max(0.5, Math.min(1.5, mod));
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
          !this.passedLaws.has(l.id) &&
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
    if (this.passedLaws.has(id)) return false;
    const law = REGION_LAWS.find((l) => l.id === id);
    if (!law) return false;
    if (law.requiresState && !this.stateProclaimed) return false;
    if (!law.prereqs.every((p) => this.has(p))) return false;
    if (this.politicalCapital < law.cost) return false;

    this.politicalCapital -= law.cost;
    this.passedLaws.add(id);

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
      case 'tariff_act':
        this.tradeLevyRate = 0.08;
        break;
      case 'central_bank_charter': {
        const pf = this.faction(this.playerFactionId);
        if (pf) {
          pf.centralBank = {
            factionId: this.playerFactionId,
            foundedDay: this.day,
            reserves: {},
            interestRate: this.policyRate,
            inflationRate: this.inflationRate,
          };
        }
        break;
      }
    }

    this.addLog(`LAW ENACTED: "${law.name}". ${law.desc.split('.')[0]}.`, 'good');
    return true;
  }

  // ---- Nation-tier: Constitutional Convention (GDD §2.2) ----

  /** True when the player may call the Constitutional Convention. */
  canCallConvention(): boolean {
    return this.canCallConventionGates().every(g => g.met);
  }

  /** Per-requirement breakdown for the Constitutional Convention, so the UI
   *  can show exactly which conditions are met and which still block the call. */
  canCallConventionGates(): { label: string; met: boolean; detail: string }[] {
    const totalGarrison = this.settlements.reduce((sum, s) => sum + this.garrisonOf(s), 0);
    const combined = totalGarrison + (this.militiaLevel || 0) * 3;
    const net = this.getNetTreasury();
    const pop = this.totalPop();
    const terr = Math.round(this.playerTerritoryControl() * 100);
    return [
      { label: 'State proclaimed',  met: this.stateProclaimed,         detail: '' },
      { label: 'Statecraft tech',   met: this.has('statecraft'),        detail: '' },
      { label: 'Population 1,500',  met: pop >= 1500,                   detail: `${Math.round(pop)}` },
      { label: 'Territory ≥50%',    met: this.proclamationReady,        detail: `${terr}%` },
      { label: 'Treasury £35k',     met: net >= 35000,                  detail: formatCurrency(Math.round(net)) },
      { label: 'Military ≥15',      met: combined >= 15,                detail: `${combined}` },
    ];
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
    // Constitutional Convention cost: £25k for administrative setup
    const convocationCost = 25000;
    this.treasury = Math.max(5000, this.treasury - convocationCost);
    this.addLog(
      `THE PROCLAMATION OF ${name.toUpperCase()}: The Constitutional Convention has spoken. ` +
      `${def.name} — the form of government is set. Constitutional expenses: ` + formatCurrency(convocationCost) + `. A new era begins.`,
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
    const decayRate = this.passedLaws.has('press_freedom_act') ? 0.35 : 0.5;
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

  /** Rich rival profile for UI display: personality, power, recent events. */
  rivalProfile(id: number): {
    personality: string;
    traits: string[];
    recentHistory: string[];
    approximateStrength: string;
  } | null {
    const rv = this.rival(id);
    if (!rv) return null;

    // Personality description based on dominant traits
    const traits: string[] = [];
    if (rv.weights.expansion >= 7) traits.push('expansionist');
    if (rv.weights.commerce >= 7) traits.push('commercial');
    if (rv.weights.ideology >= 7) traits.push('ideological');
    if (rv.weights.honor >= 7) traits.push('honorable');
    if (rv.weights.risk >= 7) traits.push('risk-taking');
    if (rv.weights.grudge >= 7) traits.push('vindictive');

    // Approximate power level based on population
    let strength = 'modest power';
    if (rv.pop > 10000) strength = 'considerable power';
    if (rv.pop > 20000) strength = 'great-power scale';
    if (rv.pop > 40000) strength = 'continental hegemon';

    // Show most recent history items
    const recentHistory = rv.history.slice(-3);

    const personality = RIVAL_ARCHETYPES[rv.archetype].name;

    return { personality, traits, recentHistory, approximateStrength: strength };
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
    if (kind === 'climate_accord') ask += rv.weights.expansion * 2 - rv.weights.commerce * 1.5;
    // Alliance stance (nation design): a coalition-builder's word is easier
    // to take; an isolationist's signature is worth less to everyone.
    if (this.allianceStance === 'coalition-builder') ask -= 5;
    else if (this.allianceStance === 'isolationist') ask += 5;
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
      case 'climate_accord':
        // commerce-driven powers value stable, shared rules; expansion hawks balk
        return rv.weights.commerce * 1.2 - rv.weights.expansion * 0.8 - 3;
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
    if (b.goldToThem > 0) parts.push(`` + formatCurrency(b.goldToThem) + ` to them`);
    if (b.goldToYou > 0) parts.push(`` + formatCurrency(b.goldToYou) + ` to you`);
    return parts.join(' + ') || 'nothing';
  }

  /** Ink, gold, and surveys change hands. */
  private executeDeal(rv: RivalNation, b: DealBasket): void {
    for (const k of b.treaties) {
      rv.treaties.push(k);
      this.onSignTreaty(rv, k);
    }
    this.treasury += b.goldToYou - b.goldToThem;
    if (b.borderSettlement) {
      rv.borderSettled = true;
      this.noteHistory(rv, `Settled the frontier with ${this.stateName || 'the State'}, ${this.year}.`);
    }
    rv.relations = this.clampRel(rv.relations + 4 + b.treaties.length * 2);
    this.addLog(`ACCORD: ${this.stateName || 'the State'} and ${rv.name} sign — ${this.basketLabel(b)}.`, 'good');
  }

  /** Initialize per-kind state when a treaty is inked. */
  private onSignTreaty(rv: RivalNation, kind: TreatyKind): void {
    if (kind === 'climate_accord') {
      this.accordCompliance[rv.id] = 1.0;
      this.accordDefectLogged.delete(rv.id);
    }
    // Record memorable moment in rival history (GDD §6.2: personality-aware narrative)
    const treaty = TREATY_DEFS[kind].name;
    this.noteHistory(rv, `Signed ${treaty} with ${this.stateName || 'the State'}, ${this.year}.`);
  }

  /** Clean up per-kind state when a treaty is torn. */
  private onBreakTreaty(rv: RivalNation, kind: TreatyKind): void {
    if (kind === 'climate_accord') {
      delete this.accordCompliance[rv.id];
      this.accordDefectLogged.delete(rv.id);
    }
    // Record the betrayal in history — a grudge that decays over decades (GDD §5.4)
    const treaty = TREATY_DEFS[kind].name;
    this.noteHistory(rv, `Treaty of ${treaty} torn by ${this.stateName || 'the State'}, ${this.year} — remembered.`);
  }

  /** Send a paid envoy: the cheap, repeatable relations verb. */
  sendEnvoy(id: number): boolean {
    const rv = this.rival(id);
    if (!rv || !this.stateProclaimed || this.treasury < ENVOY_COST) return false;
    if (this.playerWar?.rivalId === id) return false; // no letters cross the front
    if (this.day - rv.lastEnvoyDay < ENVOY_COOLDOWN_DAYS) return false;
    this.treasury -= ENVOY_COST;
    rv.lastEnvoyDay = this.day;
    // Alliance stance (nation design): coalition-builders' letters land warmer
    const stanceBonus = this.allianceStance === 'coalition-builder' ? 2 : this.allianceStance === 'isolationist' ? -2 : 0;
    const gain = Math.max(1, 4 + Math.round(rv.weights.commerce * 0.3) + stanceBonus);
    rv.relations = this.clampRel(rv.relations + gain);
    // Record this diplomatic outreach in rival history if it's a turning point
    if (rv.relations < -30 && rv.relations + gain >= -30) {
      this.noteHistory(rv, `Thaw in relations with ${this.stateName || 'the State'}, ${this.year}.`);
    }
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
    // Record major gifts in history (memorable gestures of respect)
    if (gain >= 8) {
      this.noteHistory(rv, `Received gifts from ${this.stateName || 'the State'}, ${this.year}.`);
    }
    this.addLog(`A state gift is sent to ${rv.leader} of ${rv.name} — relations warm (+${gain}).`, 'good');
    return true;
  }

  /** Propose a treaty. The rival accepts when relations meet its ask;
   *  otherwise it walks away, stating why — truthfully but vaguely. */
  proposeTreaty(id: number, kind: TreatyKind): boolean {
    const rv = this.rival(id);
    if (!rv || !this.stateProclaimed || rv.treaties.includes(kind)) return false;
    if (this.playerWar?.rivalId === id) return false; // peace is made at the peace table
    if (kind === 'climate_accord' && !this.accordUnlocked()) return false;
    if (rv.relations >= this.treatyAsk(rv, kind)) {
      rv.treaties.push(kind);
      this.onSignTreaty(rv, kind);
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
    this.onBreakTreaty(rv, kind);
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
    if (!rv.treaties.includes(o.kind)) {
      rv.treaties.push(o.kind);
      this.onSignTreaty(rv, o.kind);
    }
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
          this.addLog(`${rv.name}'s customs men shake down caravans at the frontier — ` + formatCurrency(toll) + ` in seized goods and bribes.`, 'bad');
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
      units: [], supplyReserve: 3, // 3 months of supply to start
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

  /** Recruit military units for the active war (GDD §7.1). Returns cost if successful, null if failed. */
  recruitUnits(type: ArmyUnitType, count: number): number | null {
    const w = this.playerWar;
    if (!w) {
      this.addLog('No active war — cannot recruit units.', 'info');
      return null;
    }
    if (count <= 0) return null;

    const unitDef = UNIT_TYPES[type];
    const totalCost = count * unitDef.recruitCost;

    if (this.treasury < totalCost) {
      this.addLog(`Insufficient funds to recruit ${count} ${type}(s): costs £${totalCost}, have £${Math.round(this.treasury)}.`, 'info');
      return null;
    }

    this.treasury -= totalCost;

    // Check if we already have this unit type; if so, add to existing, else create new
    const existing = w.units.find(u => u.type === type);
    if (existing) {
      existing.count += count;
    } else {
      w.units.push({
        type,
        count,
        morale: 100,
        suppliedDays: w.supplyReserve * 30, // supply in days based on reserve
      });
    }

    this.addLog(`Recruited ${count} ${type}(s) for £${totalCost} — ${this.totalArmyUnits()} total units.`, 'good');
    return totalCost;
  }

  /** Get total unit count in the active war army (GDD §7.1). */
  totalArmyUnits(): number {
    return this.playerWar?.units.reduce((sum, u) => sum + u.count, 0) ?? 0;
  }

  /** Combat power (GDD §7.3): unit-based power from armies with supply penalties. */
  warPower(): number {
    const w = this.playerWar;
    let basePower: number;

    if (w && w.units.length > 0) {
      // Unit-based power: each unit type contributes based on count, morale, and supply
      const supplyPenalty = w.supplyReserve >= 1 ? 1 : 0.5 + 0.5 * w.supplyReserve;
      basePower = w.units.reduce((sum, unit) => {
        const unitDef = UNIT_TYPES[unit.type];
        const unitPower = unit.count * unitDef.powerPerUnit * (unit.morale / 100);
        return sum + unitPower;
      }, 0) * supplyPenalty;
    } else {
      // Fallback to population-based power (militia level) if no units recruited
      basePower = Math.pow(Math.max(1, this.totalPop()), 0.6) * (1 + 0.25 * this.militiaLevel);
    }

    const quality =
      (this.policyActive('standing_army') ? 1.5 : 1) *
      (this.ministerFor('defence') ? 1.2 : 1) *
      (this.passedLaws.has('military_reform') ? 1.2 : 1) *
      (this.govType === 'junta' ? 1.15 : 1) *
      (this.militaryDoctrine === 'expansionist' ? 1.15 : this.militaryDoctrine === 'defensive' ? 0.9 : 1);
    const mob = w ? MOBILIZATION_DEFS[w.mobilization].power : 1;
    // Defensive pacts put allied arms on your front (GDD §5.4); a called
    // co-belligerent commits its army, not just its sympathy (GDD §7.3)
    const allies = this.rivals.reduce((s, rv) => {
      if (rv.id === w?.rivalId) return s;
      if (w?.allies.includes(rv.id)) return s + Math.pow(rv.pop, 0.6) * 0.5;
      if (rv.treaties.includes('defensive_pact')) return s + Math.pow(rv.pop, 0.6) * 0.25;
      return s;
    }, 0);
    return basePower * quality * mob + allies;
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

  /** Consume supply reserves based on army size and unit types (GDD §7.1, §7.3). */
  private consumeWarSupply(): void {
    const w = this.playerWar;
    if (!w || w.units.length === 0) return;

    // Calculate monthly supply demand from all units
    const monthDays = 30;
    const supplyDemand = w.units.reduce((total, unit) => {
      const unitDef = UNIT_TYPES[unit.type];
      return total + unit.count * unitDef.supplyCost * monthDays;
    }, 0);

    // Deduct from supply reserve
    w.supplyReserve -= supplyDemand;

    // Log supply status
    if (w.supplyReserve > 3) {
      // Army is well-supplied
    } else if (w.supplyReserve > 1) {
      if (this.rng.chance(0.3)) this.addLog('Supply lines stretching thin — rations cut.', 'info');
    } else if (w.supplyReserve > 0) {
      if (this.rng.chance(0.3)) this.addLog('SUPPLY CRISIS: The army goes hungry. Morale plummets.', 'bad');
      // Reduce morale on critical shortage
      for (const unit of w.units) {
        unit.morale = Math.max(30, unit.morale - 10);
      }
    } else {
      // No supply left — army begins to disband
      if (this.rng.chance(0.5)) {
        const disbanded = Math.ceil(w.units.reduce((sum, u) => sum + u.count, 0) * 0.1);
        let remaining = disbanded;
        for (const unit of w.units) {
          const loss = Math.min(remaining, unit.count);
          unit.count -= loss;
          remaining -= loss;
          if (remaining === 0) break;
        }
        w.units = w.units.filter(u => u.count > 0);
        this.addLog(`DESERTION: ${disbanded} troops abandon the army — supply exhausted.`, 'bad');
      }
      w.supplyReserve = 0;
    }
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

  /** Station units at a settlement garrison (GDD §7.1: garrison management). */
  stationUnits(settlementId: number, type: ArmyUnitType, count: number): boolean {
    const w = this.playerWar;
    if (!w || count <= 0) return false;

    const settlement = this.settlement(settlementId);
    if (!settlement) return false;

    // Find units of this type in the army
    const armyUnit = w.units.find(u => u.type === type);
    if (!armyUnit || armyUnit.count < count) {
      this.addLog(`Not enough ${type} available to station — need ${count}, have ${armyUnit?.count ?? 0}.`, 'info');
      return false;
    }

    // Remove from army
    armyUnit.count -= count;
    w.units = w.units.filter(u => u.count > 0);

    // Add to settlement garrison
    const existing = settlement.stationedUnits.find(u => u.type === type);
    if (existing) {
      existing.count += count;
    } else {
      settlement.stationedUnits.push({
        type,
        count,
        morale: 100,
        suppliedDays: 30, // garrison units don't consume supply like field armies
      });
    }

    this.addLog(`Stationed ${count} ${type}(s) at ${settlement.name}.`, 'good');
    return true;
  }

  /** Deploy units from a settlement garrison to the field army (GDD §7.1). */
  deployUnits(settlementId: number, type: ArmyUnitType, count: number): boolean {
    const w = this.playerWar;
    if (!w || count <= 0) return false;

    const settlement = this.settlement(settlementId);
    if (!settlement) return false;

    // Find units in garrison
    const garrisonUnit = settlement.stationedUnits.find(u => u.type === type);
    if (!garrisonUnit || garrisonUnit.count < count) {
      this.addLog(`Not enough ${type} in ${settlement.name} garrison — need ${count}, have ${garrisonUnit?.count ?? 0}.`, 'info');
      return false;
    }

    // Remove from garrison
    garrisonUnit.count -= count;
    settlement.stationedUnits = settlement.stationedUnits.filter(u => u.count > 0);

    // Add to field army
    const existing = w.units.find(u => u.type === type);
    if (existing) {
      existing.count += count;
    } else {
      w.units.push({
        type,
        count,
        morale: 100,
        suppliedDays: w.supplyReserve * 30,
      });
    }

    this.addLog(`Deployed ${count} ${type}(s) from ${settlement.name}.`, 'good');
    return true;
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
        this.addLog(`PEACE: ${rv.name} signs — and pays. ` + formatCurrency(tranche) + ` in reparations reaches the treasury.`, 'good');
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

  /** An AI settlement whose population decays below one person is a ghost town:
   *  removePop is multiplicative, so without this a starved rival town would
   *  linger forever displaying a fractional "pop 0.004" (the collapsed outposts
   *  players kept seeing on the map). Remove it from the map and its faction,
   *  hand the capital to a survivor, and let a faction with no towns left die.
   *  RNG-free so determinism holds. The player's own towns are left alone —
   *  those are visible and managed, and colony death is the town tier's call. */
  private abandonGhostTowns(): void {
    const doomed = this.settlements.filter(
      (t) => t.factionId !== this.playerFactionId && this.popOf(t) < 1,
    );
    for (const t of doomed) {
      const faction = this.faction(t.factionId);
      this.settlements = this.settlements.filter((s) => s !== t);
      this.routes = this.routes.filter((r) => r.a !== t.id && r.b !== t.id);
      this.notables = this.notables.filter((n) => n.settlementId !== t.id);
      if (faction) {
        faction.settlementIds = faction.settlementIds.filter((id) => id !== t.id);
        if (faction.capital === t.id) {
          faction.capital = faction.settlementIds[0] ?? -1;
        }
      }
      this.addLog(`${t.name} is abandoned — the last of its people have drifted away. A ghost town now.`, 'bad');
    }
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
      mapSeed: this.map.seed,
      rng: this.rng.getState(),
      aiRng: this.aiRng.getState(),
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
      researched: [...this.researched],
      activeResearch: this.activeResearch,
      researchProgress: this.researchProgress,
      politicalCapital: this.politicalCapital,
      nextElectionDay: this.nextElectionDay,
      lastElectionYear: this.lastElectionYear,
      passedLaws: [...this.passedLaws],
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
      co2ppm: this.co2ppm,
      warmingC: this.warmingC,
      emissionsLastMonth: this.emissionsLastMonth,
      eraBranch: this.eraBranch,
      centuryReport: this.centuryReport,
      seaRiseAnnounced: this.seaRiseAnnounced,
      lastTidalLogDay: this.lastTidalLogDay,
      accordCompliance: this.accordCompliance,
      geoDeployed: this.geoDeployed,
      geoDeployDay: this.geoDeployDay,
      policyRate: this.policyRate,
      privateLeverage: this.privateLeverage,
      confidence: this.confidence,
      inflationRate: this.inflationRate,
      monetaryRegime: this.monetaryRegime,
      nationalDebt: this.nationalDebt,
      creditRating: this.creditRating,
      exchangeRate: this.exchangeRate,
      crashFired: this.crashFired,
      nextId: this.nextId,
      nextEventDay: this.nextEventDay,
      townNamePool: this.townNamePool,
      // Phase 0: factions, scouts, currency — the map packs to one char per tile
      explorationMap: this.explorationMap.map((row) => row.map((v) => (v === 'fogged' ? '0' : '1')).join('')),
      scouts: this.scouts,
      regionalFactions: this.regionalFactions,
      playerFactionId: this.playerFactionId,
      aiDifficulty: this.aiDifficulty,
      factionAlliances: this.factionAlliances,
      proclamationReady: this.proclamationReady,
      exchangeRates: this.exchangeRates,
      globalTradeVolume: this.globalTradeVolume,
      nextScoutId: this.nextScoutId,
      lenders: this.lenders,
      loans: this.loans,
      centralBankLoan: this.centralBankLoan,
      currencySymbol: this.currencySymbol,
      marketDisruptionEnd: this.marketDisruptionEnd,
      currencyAnnouncement: this.currencyAnnouncement,
      currencyTransition: this.currencyTransition,
      expansionSpeed: this.expansionSpeed,
      tradeOpenness: this.tradeOpenness,
      economicSystem: this.economicSystem,
      militaryDoctrine: this.militaryDoctrine,
      allianceStance: this.allianceStance,
      triggeredEpilogueEvents: [...this.triggeredEpilogueEvents],
    });
  }

  /** Rebuild a region from a snapshot. The map and weather are reconstructed
   *  from the stored seed; all mutable state is restored from the JSON. */
  static deserialize(json: string): RegionSim {
    const d = JSON.parse(json);
    const seed = d.mapSeed ?? 42;
    const rng = new Rng(0);
    const map = new RegionMap(seed);
    const weather = new Weather(seed);
    const r = new RegionSim(rng, d.minute, map, weather);
    // pre-market saves carry no prices: open those towns at the base rates;
    // pre-faction saves fly the player's banner; pre-sector saves start at 1900 labor shares
    r.settlements = (d.settlements as Settlement[]).map((s) => ({
      ...s,
      prices: s.prices ?? defaultPrices(),
      recentEvents: s.recentEvents ?? [],
      factionId: s.factionId ?? 0,
      garrisonStrength: s.garrisonStrength ?? 2,
      stationedUnits: s.stationedUnits ?? [],
      loyaltyToFaction: s.loyaltyToFaction ?? 100,
      sectors: s.sectors ?? defaultSectors(),
      buildings: s.buildings ?? [],
      construction: s.construction ?? null,
      focus: s.focus ?? 'balanced',
      activeEvents: s.activeEvents ?? [],
      policies: s.policies ?? { ...DEFAULT_CITY_POLICIES },
    }));
    r.notables = d.notables;
    r.expeditions = d.expeditions;
    r.routes = (d.routes as Route[]).map((rt) => ({ ...rt, cargoType: rt.cargoType ?? null, cargoPriority: rt.cargoPriority ?? null }));
    r.log = d.log;
    r.stateProclaimed = d.stateProclaimed;
    r.ceremonyPending = d.ceremonyPending;
    r.charterProgress = d.charterProgress;
    r.stateName = d.stateName;
    r.govLean = d.govLean;
    r.treasury = d.treasury;
    r.prevMonthTreasury = d.treasury; // re-seed; a stale delta isn't worth persisting
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
    r.researched = new Set(d.researched ?? ['steam_power', 'common_law']);
    r.activeResearch = d.activeResearch ?? null;
    r.researchProgress = d.researchProgress ?? 0;
    r.politicalCapital = d.politicalCapital ?? 0;
    r.nextElectionDay = d.nextElectionDay ?? -1;
    r.lastElectionYear = d.lastElectionYear ?? -1;
    r.passedLaws = new Set(d.passedLaws ?? []);
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
    // pre-climate saves opened before the ledger was kept: start it fresh
    r.co2ppm = d.co2ppm ?? CO2_BASE_PPM;
    r.warmingC = d.warmingC ?? 0;
    r.emissionsLastMonth = d.emissionsLastMonth ?? 0;
    r.eraBranch = d.eraBranch ?? null;
    r.centuryReport = d.centuryReport ?? null;
    r.seaRiseAnnounced = d.seaRiseAnnounced ?? false;
    r.lastTidalLogDay = d.lastTidalLogDay ?? -999;
    r.accordCompliance = d.accordCompliance ?? {};
    r.geoDeployed = d.geoDeployed ?? false;
    r.geoDeployDay = d.geoDeployDay ?? -1;
    r.policyRate = d.policyRate ?? NEUTRAL_RATE;
    r.privateLeverage = d.privateLeverage ?? 0;
    r.confidence = d.confidence ?? 70;
    r.inflationRate = d.inflationRate ?? 0.02;
    r.monetaryRegime = d.monetaryRegime ?? 'float';
    r.nationalDebt = d.nationalDebt ?? 0;
    r.creditRating = d.creditRating ?? 'AA';
    r.exchangeRate = d.exchangeRate ?? 1.0;
    r.crashFired = d.crashFired ?? false;
    // Lender system: initialize lenders if not in save, or load existing ones
    r.lenders = d.lenders ?? createInitialLenders();
    r.loans = d.loans ?? [];
    r.centralBankLoan = d.centralBankLoan ?? 0;
    r.currencySymbol = d.currencySymbol ?? '$';
    r.marketDisruptionEnd = d.marketDisruptionEnd ?? 0;
    r.currencyAnnouncement = d.currencyAnnouncement ?? null;
    r.currencyTransition = d.currencyTransition ?? null;
    r.expansionSpeed = d.expansionSpeed ?? 'steady';
    r.tradeOpenness = d.tradeOpenness ?? 'balanced';
    r.economicSystem = d.economicSystem ?? 'mixed';
    r.militaryDoctrine = d.militaryDoctrine ?? 'professional';
    r.allianceStance = d.allianceStance ?? 'opportunist';
    r.nextId = d.nextId;
    r.nextEventDay = d.nextEventDay;
    r.townNamePool = d.townNamePool;
    // Phase 0: factions, scouts, fog of war — older saves rebuild them in place
    r.proclamationReady = d.proclamationReady ?? false;
    if (d.regionalFactions) {
      r.regionalFactions = d.regionalFactions;
      // Older saves predate per-faction regimes — backfill an era-plausible one
      // so goal generation has a government type to key off of.
      for (const f of r.regionalFactions) {
        if (typeof f.regime !== 'string') {
          f.regime = f.id === r.playerFactionId ? 'parliamentary' : 'abs_monarchy';
        }
        // Older saves predate vassalage — backfill as independent.
        f.vassals = (f as unknown as { vassals?: number[] }).vassals ?? [];
        f.overlordId = (f as unknown as { overlordId?: number | null }).overlordId ?? null;
        // Functions don't survive JSON round-trips; null out the goal so it regenerates.
        if (f.currentGoal && typeof f.currentGoal.successCondition !== 'function') f.currentGoal = null;
      }
      r.playerFactionId = d.playerFactionId ?? 0;
      r.aiDifficulty = d.aiDifficulty ?? 'normal';
      r.factionAlliances = d.factionAlliances ?? [];
      r.scouts = d.scouts ?? [];
      r.exchangeRates = d.exchangeRates ?? { '0:0': 1.0 };
      r.globalTradeVolume = d.globalTradeVolume ?? 0;
      r.nextScoutId = d.nextScoutId ?? 5000;
    } else if (r.settlements.length > 0) {
      // pre-faction save: raise the player's banner over every existing town
      r.regionalizeFactionSystem(r.settlements[0]);
      const pf = r.faction(r.playerFactionId);
      if (pf) pf.settlementIds = r.settlements.map((s) => s.id);
    }
    if (d.explorationMap) {
      r.explorationMap = (d.explorationMap as string[]).map((row) =>
        [...row].map((c) => (c === '1' ? 'explored' : 'fogged') as TileVisibility),
      );
    } else {
      // pre-fog save: what the towns can see today is what's on the maps
      for (const s of r.settlements) r.revealTiles(s.x, s.y, 3, 'explored');
    }
    // last: the constructor consumed a draw scheduling its event day
    r.rng.setState(d.rng);
    // restore the AI stream too (older saves predate it — derive from main seed)
    if (typeof d.aiRng === 'number') r.aiRng.setState(d.aiRng);
    // restore epilogue events (post-2100 flavor)
    r.triggeredEpilogueEvents = new Set(d.triggeredEpilogueEvents ?? []);
    return r;
  }

  addLog(text: string, kind: LogEntry['kind']): void {
    this.log.push({ day: this.day, text, kind });
    if (this.log.length > 200) this.log.shift();
  }

  /** Push a per-town event (kept newest-first, capped at 12). */
  private townEvent(t: Settlement, text: string, kind: 'good' | 'bad' | 'info'): void {
    t.recentEvents.unshift({ day: this.day, text, kind });
    if (t.recentEvents.length > 12) t.recentEvents.pop();
  }

  // ---- Lender system: loans, interest, and loan management ----

  /**
   * Request a loan from a lender.
   * Returns { ok: true, loanId } or { ok: false, reason }.
   */
  requestLoan(
    lenderId: number,
    amount: number,
    termMonths: number,
  ): { ok: boolean; reason?: string; loanId?: number } {
    const lender = this.lenders.find((l) => l.id === lenderId);
    if (!lender) return { ok: false, reason: 'Lender not found' };

    // Check lender's availability and capacity
    if (amount > lender.maxLoan) {
      return { ok: false, reason: `This lender can only offer up to ` + formatCurrency(lender.maxLoan) + `` };
    }
    if (amount > lender.liquidCash) {
      return { ok: false, reason: `This lender currently has only ` + formatCurrency(lender.liquidCash) + ` available` };
    }

    // Create and record the loan
    const loan: Loan = {
      id: Math.random(),
      lenderId,
      principal: amount,
      borrowed: amount,
      interestRate: lender.interestRate,
      termYears: Math.round(termMonths / 12 * 100) / 100,
      borrowedAt: this.day,
      nextPaymentDue: this.day + 30, // first payment due in 1 month
      defaulted: false,
    };

    this.loans.push(loan);
    lender.liquidCash -= amount; // lender's cash is tied up
    this.treasury += amount; // treasury receives the loan proceeds

    this.addLog(
      `Borrowed ` + formatCurrency(amount) + ` from ${lender.name} at ${(lender.interestRate * 100).toFixed(1)}% annual interest, due in ${termMonths} months.`,
      'info',
    );

    return { ok: true, loanId: loan.id };
  }

  /**
   * Make a payment on an active loan.
   * Returns { ok: true, remaining } or { ok: false, reason }.
   */
  repayLoan(loanId: number, paymentAmount: number): { ok: boolean; remaining?: number; reason?: string } {
    const loan = this.loans.find((l) => l.id === loanId);
    if (!loan) return { ok: false, reason: 'Loan not found' };

    if (loan.defaulted) {
      return { ok: false, reason: 'This loan has defaulted and cannot be repaid' };
    }

    if (paymentAmount <= 0) {
      return { ok: false, reason: 'Payment must be positive' };
    }

    if (this.treasury < paymentAmount) {
      return { ok: false, reason: 'Insufficient treasury funds for this payment' };
    }

    // Process the payment
    this.treasury -= paymentAmount;
    loan.borrowed = Math.max(0, loan.borrowed - paymentAmount);

    // Move next payment due forward by 1 month if this was an on-time payment
    if (this.day <= loan.nextPaymentDue) {
      loan.nextPaymentDue += 30;
    } else {
      // Make up a late payment but don't move next due date back
      loan.nextPaymentDue = this.day + 30;
    }

    const lender = this.lenders.find((l) => l.id === loan.lenderId);
    if (lender) {
      lender.liquidCash += paymentAmount; // lender recovers the principal
    }

    this.addLog(
      `Paid ` + formatCurrency(paymentAmount) + ` toward outstanding loan. Remaining: ` + formatCurrency(Math.round(loan.borrowed)) + ``,
      'info',
    );

    return { ok: true, remaining: loan.borrowed };
  }

  /**
   * Borrow from the Central Bank discount window at the current policy rate.
   * Available once the central_bank_charter is enacted; limited to half of treasury.
   */
  borrowFromCentralBank(amount: number): { ok: boolean; reason?: string } {
    if (!this.passedLaws.has('central_bank_charter')) {
      return { ok: false, reason: 'Central bank not established' };
    }
    if (amount <= 0) return { ok: false, reason: 'Amount must be positive' };
    const maxBorrow = Math.max(0, this.treasury * 0.5 - this.centralBankLoan);
    if (amount > maxBorrow) {
      return { ok: false, reason: `CB ceiling: max ` + formatCurrency(Math.floor(maxBorrow)) };
    }
    this.centralBankLoan += amount;
    this.treasury += amount;
    this.addLog(
      `Discount window: drew ` + formatCurrency(amount) + ` from the Central Bank at ${(this.policyRate * 100).toFixed(1)}% policy rate.`,
      'info',
    );
    return { ok: true };
  }

  /**
   * Repay an amount to the Central Bank discount window.
   */
  repayCentralBank(amount: number): { ok: boolean; reason?: string } {
    if (this.centralBankLoan <= 0) return { ok: false, reason: 'No outstanding CB balance' };
    if (this.treasury < amount) return { ok: false, reason: 'Insufficient treasury funds' };
    const paid = Math.min(amount, this.centralBankLoan);
    this.treasury -= paid;
    this.centralBankLoan = Math.max(0, this.centralBankLoan - paid);
    this.addLog(`Repaid ` + formatCurrency(Math.floor(paid)) + ` to the Central Bank.`, 'info');
    return { ok: true };
  }

  /**
   * Called monthly to process loan interest accrual and check for defaults.
   */
  updateLoans(): void {
    for (const loan of this.loans) {
      if (loan.defaulted) continue;

      // Calculate interest accrued this month
      const monthlyRate = loan.interestRate / 12;
      const interestThisMonth = loan.borrowed * monthlyRate;
      loan.borrowed += interestThisMonth;

      // Check for default: payment overdue by 90+ days (3 months grace)
      if (this.day > loan.nextPaymentDue + 90 && !loan.defaulted) {
        loan.defaulted = true;
        const lender = this.lenders.find((l) => l.id === loan.lenderId);
        if (lender) {
          lender.reliability = Math.max(0, lender.reliability - 10); // lender loses confidence in player
          lender.liquidCash = 0; // lender becomes cautious
        }
        this.addLog(
          `Loan from ${lender?.name ?? 'lender'} has defaulted. Credit damaged.`,
          'bad',
        );
      }
    }

    // Remove fully repaid loans
    this.loans = this.loans.filter((l) => l.borrowed > 0.01 || l.defaulted);
  }

  /**
   * Get total outstanding loan debt.
   */
  getTotalDebt(): number {
    return this.loans.reduce((sum, loan) => sum + (loan.defaulted ? 0 : loan.borrowed), 0);
  }

  /**
   * Treasury minus outstanding loan debt — used for progression gate checks
   * so loans can't trivially bypass economic gates.
   */
  getNetTreasury(): number {
    return this.treasury - this.getTotalDebt();
  }

  /**
   * Employment-weighted average daily wage across all settlements.
   * Scales with tech era: $0.33/d at 1900 → $200+/d at full info-age tech.
   */
  avgDailyWage(): number {
    let totalWorkers = 0;
    let totalWageMonth = 0;
    for (const t of this.settlements) {
      const workers = this.workersOf(t);
      totalWorkers += workers;
      totalWageMonth += workers * this.avgWageOf(t);
    }
    if (totalWorkers === 0) return 0;
    return (totalWageMonth / totalWorkers) / 30;
  }

  /**
   * Announce a future currency switch. Telegraphing the change 6+ months
   * ahead reads as deliberate policy and softens the eventual shock by 25%.
   */
  announceCurrencyChange(newSymbol: CurrencySymbol): { ok: boolean; reason: string } {
    if (newSymbol === this.currencySymbol) return { ok: false, reason: 'Already on that standard' };
    this.currencyAnnouncement = { newSymbol, announcedDay: this.day };
    this.addLog(
      `The treasury signals an intent to adopt the ${newSymbol} standard. Markets begin pricing it in.`,
      'info',
    );
    return { ok: true, reason: '' };
  }

  /**
   * Switch currency standards. The penalty depends on WHY (GDD §5.1 ext):
   * crisis-forced switches are forgiven, political ones tolerated, arbitrary
   * ones punished. Advance announcement and deep reserves both soften it.
   */
  changeCurrency(newSymbol: CurrencySymbol, cause: CurrencyChangeCause = 'strategic'): { ok: boolean; reason: string } {
    if (newSymbol === this.currencySymbol) return { ok: false, reason: 'No change' };

    const announced =
      this.currencyAnnouncement?.newSymbol === newSymbol &&
      this.day - this.currencyAnnouncement.announcedDay >= ANNOUNCE_LEAD_DAYS;
    const reserveRatio = this.gdpLastMonth > 0 ? this.treasury / this.gdpLastMonth : 0;
    const penalty = computePenalty(cause, announced, reserveRatio);

    const flight = Math.floor(this.treasury * penalty.capitalFlightFrac);
    this.treasury -= flight;
    this.currencySymbol = newSymbol;
    setCurrencySymbol(newSymbol);
    this.currencyAnnouncement = null;
    this.currencyTransition = {
      newSymbol,
      cause,
      startDay: this.day,
      endDay: this.day + penalty.recoveryDays,
      startEfficiencyMult: penalty.efficiencyMult,
    };
    this.marketDisruptionEnd = this.day + penalty.recoveryDays;

    this.addLog(
      `The ${newSymbol} standard is adopted. ${penalty.narrative} ` +
        `Capital flight: ` + formatCurrency(flight) + `. ` +
        `Markets expect ~${Math.round(penalty.recoveryDays / 30)} months to stabilize.` +
        (announced ? ' The advance notice cushioned the blow.' : ''),
      cause === 'crisis' ? 'info' : 'bad',
    );
    return { ok: true, reason: '' };
  }

  /** Output multiplier from an in-progress currency transition (1 = stable). */
  currencyEfficiency(): number {
    return transitionEfficiency(this.currencyTransition, this.day);
  }

  /** The region-flip design screen: doctrine for the new tier. */
  applyRegionDesign(d: RegionDesign): void {
    this.expansionSpeed = d.expansionSpeed;
    this.tradeOpenness = d.tradeOpenness;
    this.taxRate = Math.min(0.3, Math.max(0.05, d.taxRate));
    this.servicesLevel = d.servicesLevel;
    this.tradeLevyRate = d.tradeOpenness === 'protectionist' ? 0.08 : d.tradeOpenness === 'free-trade' ? 0.03 : 0.05;
    this.addLog(
      `The region sets its course: ${d.expansionSpeed} expansion, ${d.tradeOpenness} trade, ` +
        `${Math.round(d.taxRate * 100)}% levy.`,
      'info',
    );
  }

  /** The nation-flip design screen: national identity, and the one sanctioned
   *  chance to re-pick the currency (a political-cause transition, not free). */
  applyNationDesign(d: NationDesign): void {
    this.economicSystem = d.economicSystem;
    this.militaryDoctrine = d.militaryDoctrine;
    this.allianceStance = d.allianceStance;
    this.addLog(
      `The constitution enshrines a ${d.economicSystem} economy, a ${d.militaryDoctrine} military, ` +
        `and a ${d.allianceStance.replace('-', ' ')} foreign policy.`,
      'info',
    );
    if (d.currencySymbol && d.currencySymbol !== this.currencySymbol) {
      this.changeCurrency(d.currencySymbol, 'political');
    }
  }

  /** Expedition requirements scale with the expansion doctrine. */
  expansionCostMult(): number {
    return this.expansionSpeed === 'aggressive' ? 0.75 : this.expansionSpeed === 'cautious' ? 1.25 : 1;
  }

  /** Steady-state output multiplier from the economic system. Markets squeeze
   *  more from each hand; planning trades a slice of output for stability. */
  economyOutputMult(): number {
    return this.economicSystem === 'laissez-faire' ? 1.10 : this.economicSystem === 'planned' ? 0.92 : 1;
  }

  /**
   * Get list of active loans (not defaulted).
   */
  getActiveLoans(): Loan[] {
    return this.loans.filter((l) => !l.defaulted);
  }

  // ---- Regional Faction AI (GDD §6.2 optimization: staggered updates) ----

  /** Generate a new strategic goal for a faction based on templates and current state.
   *  Procedural generation from ~100+ templates ensures unpredictability. */
  private generateFactionGoal(faction: RegionalFaction): FactionGoal | null {
    const all: FactionGoal[] = [];
    for (const generator of FACTION_GOAL_GENERATORS) {
      const goal = generator(faction, this);
      if (goal) all.push(goal);
    }
    if (all.length === 0) return null;

    // Gov-type filter: a faction pursues goals that suit its regime. Goals with an
    // empty govTypes list are universal. If nothing matches the regime, fall back
    // to the universal/whole pool so a faction is never left without ambition.
    const onRegime = all.filter(
      (g) => g.govTypes.length === 0 || g.govTypes.includes(faction.regime),
    );
    const pool = onRegime.length > 0 ? onRegime : all;
    const selected = pool[this.aiRng.int(pool.length)];

    // Difficulty ambition: a harder AI sets itself tighter deadlines, an easier one
    // gives itself room. Compress/stretch the gap between now and the target year.
    const mult = this.aiKnobs().goalYearsMult;
    const gap = selected.targetYear - selected.generatedYear;
    selected.targetYear = selected.generatedYear + Math.max(3, Math.round(gap * mult));

    // techFocus mirrors the goal so the rival's research bends toward its ambition
    // (otherwise techFocus was dead data).
    if (selected.sectorFocus) faction.techFocus = selected.sectorFocus;
    return selected;
  }

  /** Update a single faction's AI: goal generation, settlement expansion, tech progression.
   *  Called on a staggered schedule (not every month) to keep performance O(1) average. */
  updateFactionAI(faction: RegionalFaction): void {
    // Generate or refresh goal (once per year)
    if (!faction.currentGoal || this.day - faction.lastGoalCheckDay >= 365) {
      // Check if previous goal succeeded/failed
      if (faction.currentGoal) {
        const succeeded = faction.currentGoal.successCondition(faction, this);
        if (succeeded) {
          this.addLog(`${faction.name} achieves ambition: "${faction.currentGoal.objective}". Their power grows.`, 'good');
          faction.treasury += 100; // prestige bonus
        } else if (this.day > faction.currentGoal.targetYear * DAYS_PER_YEAR + START_YEAR * DAYS_PER_YEAR) {
          this.addLog(`${faction.name} abandons goal: "${faction.currentGoal.objective.toLowerCase()}" (timeout).`, 'info');
        }
      }

      faction.currentGoal = this.generateFactionGoal(faction);
      faction.lastGoalCheckDay = this.day;
      if (faction.currentGoal) {
        this.addLog(
          `${faction.name} proclaims new goal: ${faction.currentGoal.objective.toLowerCase()}.`,
          'info',
        );
      }
    } else if (faction.currentGoal) {
      // Evaluate progress toward current goal (for milestone announcements)
      this.evaluateGoalProgress(faction);
    }

    // Calculate faction population from its settlements
    let factionPop = 0;
    for (const settlementId of faction.settlementIds) {
      const settlement = this.settlement(settlementId);
      if (settlement) factionPop += this.popOf(settlement);
    }

    const knobs = this.aiKnobs();

    // Tech progression (simplified aggregate, no per-settlement detail). The
    // difficulty multiplier and a goal that focuses on technology both speed it up.
    const techSpeed = (faction.treasury * 0.0001 + factionPop * 0.00001) * knobs.techMult;
    faction.techProgress += techSpeed * (faction.currentGoal?.sectorFocus === 'technology' ? 1.5 : 1);

    // Scout spawning: difficulty-scaled chance per update, if under the slot limit.
    if (this.aiRng.chance(knobs.scoutChance) && faction.settlementIds.length > 0) {
      this.spawnScout(faction);
    }

    // Settlement expansion: Monte Carlo approach (5 random sites, pick best).
    // A faction with no foothold always tries to plant its first settlement
    // (bootstrap — otherwise rivals would never appear on the map); established
    // factions expand only occasionally so the region doesn't fill instantly.
    // Difficulty sets both the per-update chance and the ceiling on territory.
    const canAfford = faction.treasury >= 50;
    // Bootstrap: faction with no settlements always tries to plant its first one.
    // Expansion: only possible when the faction has enough population to spare 8
    // settlers for a new outpost (founding pulls people from the largest town).
    const wantsToExpand = faction.settlementIds.length === 0
      ? canAfford
      : (factionPop >= 16 && this.aiRng.chance(knobs.expandChance) && faction.settlementIds.length < knobs.settlementCap && canAfford);
    if (wantsToExpand) {
      const site = this.findBestExpansionSite(faction, faction.settlementIds.length === 0 ? 8 : 5);
      if (site && site.score > 0) {
        const newSettlement = this.foundSettlement(faction, site.x, site.y);
        if (newSettlement) {
          if (faction.capital < 0) faction.capital = newSettlement.id;
          this.addLog(`${faction.name} founds settlement ${newSettlement.name} at (${site.x}, ${site.y}).`, 'info');
          faction.treasury -= 50; // founding cost
        }
      }
    }

    // Military scaling: garrison = pop * 0.01 * tech_mult
    faction.militaryStrength = Math.round(factionPop * 0.01 * (1 + faction.techProgress * 0.05));

    // Tech → treasury income: high-tech factions earn passive revenue from efficiency gains
    if (faction.techProgress > 0) {
      faction.treasury += Math.round(factionPop * 0.002 * faction.techProgress * knobs.techMult);
    }

    // Check for goal conflicts with other factions (Phase 3a)
    this.checkFactionGoalConflicts(faction);
  }

  /** Detect and escalate goal conflicts between factions (Phase 3a).
   *  When two factions have similar/conflicting goals, tensions rise and raids may occur. */
  private checkFactionGoalConflicts(faction: RegionalFaction): void {
    if (!faction.currentGoal) return;

    for (const other of this.regionalFactions) {
      if (other.id === faction.id || !other.currentGoal) continue;

      // Calculate goal conflict severity (0–100)
      const conflict = this.evaluateGoalConflict(faction.currentGoal, other.currentGoal);
      if (conflict < 30) continue; // No significant conflict

      // Escalate tensions: rival raids friendly settlements or competes for resources.
      // Nearest pair of settlements between the two factions — nested loops, not
      // Math.min(...map(...map())): no temporary arrays and no spread (which would
      // overflow the stack once a faction holds hundreds of towns).
      let settlementDist = 999;
      for (const fid of faction.settlementIds) {
        const fs = this.settlement(fid);
        if (!fs) continue;
        for (const oid of other.settlementIds) {
          const os = this.settlement(oid);
          if (!os) continue;
          const d = Math.hypot(fs.x - os.x, fs.y - os.y);
          if (d < settlementDist) settlementDist = d;
        }
        if (settlementDist === 0) break;
      }

      // Only escalate if factions are neighbors (within 40 map units)
      if (settlementDist > 40) continue;

      // 0–5% per month at normal; difficulty scales rival belligerence.
      const escalationChance = conflict / 100 * 0.05 * this.aiKnobs().raidMult;
      if (this.aiRng.chance(escalationChance)) {
        // Log the conflict
        const conflictReason =
          faction.currentGoal.id === other.currentGoal.id
            ? `both pursue "${faction.currentGoal.objective.toLowerCase()}"`
            : 'competing interests';
        this.addLog(
          `REGIONAL TENSION: ${faction.name} and ${other.name} clash — ${conflictReason}.`,
          'bad'
        );

        // Occasional raids if conflict is severe
        if (conflict > 70 && this.aiRng.chance(0.1)) {
          // settlementDist is the overall nearest pair (≤40 to reach here), so the
          // old per-settlement `settlementDist < 50` gate passed for all of them.
          const targetSettlements: Settlement[] = [];
          if (settlementDist < 50) {
            for (const id of faction.settlementIds) {
              const s = this.settlement(id);
              if (s) targetSettlements.push(s);
            }
          }
          if (targetSettlements.length > 0) {
            const target = targetSettlements[this.aiRng.int(targetSettlements.length)];
            if (target) {
              const losses = 2 + this.aiRng.int(4);
              target.cohorts.bands[1] -= losses;
              target.grievance = Math.min(100, target.grievance + 15);
              this.addLog(
                `RAID: ${other.name} raiding parties strike ${target.name} — ${losses} workers lost.`,
                'bad'
              );
              this.trigerAllyRetaliationForRaid(other.id, faction.id, target.id);
            }
          }
        }

        // Aggressive factions also threaten player settlements — with a cooldown
        if (
          conflict > 60 &&
          other.aggressiveness > 55 &&
          this.day - other.lastRaidDay > 180 &&
          this.aiRng.chance(0.05 * this.aiKnobs().raidMult)
        ) {
          const playerSettlements = this.settlements.filter(s => s.factionId === this.playerFactionId);
          const target = playerSettlements[this.aiRng.int(playerSettlements.length)];
          if (target) {
            other.lastRaidDay = this.day;
            const losses = 1 + this.aiRng.int(3);
            target.cohorts.bands[1] = Math.max(0, target.cohorts.bands[1] - losses);
            target.grievance = Math.min(100, target.grievance + 12);
            this.addLog(
              `ALERT: ${other.name} raiders strike ${target.name} — ${losses} workers lost. ` +
              `Their garrison: ${other.militaryStrength}.`,
              'bad',
            );
          }
        }
      }
    }
  }

  /** When a raid occurs, allies of the victim may retaliate against the raider (Phase 3b). */
  private trigerAllyRetaliationForRaid(raiderId: number, victimId: number, targetSettlementId: number): void {
    // Find allies of the victim faction
    for (const ally of this.regionalFactions) {
      if (!this.areAllied(ally.id, victimId)) continue;
      if (ally.id === raiderId || ally.id === victimId) continue;

      // Allied faction retaliates: raid the raider's settlements
      if (this.aiRng.chance(0.3)) {
        const raiderFaction = this.faction(raiderId);
        const allyFaction = this.faction(ally.id);
        if (!raiderFaction || !allyFaction) continue;

        const raiderSettlements = raiderFaction.settlementIds
          .map(id => this.settlement(id))
          .filter(s => s !== null) as Settlement[];

        if (raiderSettlements.length === 0) continue;

        const target = raiderSettlements[this.aiRng.int(raiderSettlements.length)];
        const losses = 1 + this.aiRng.int(3);
        target.cohorts.bands[1] = Math.max(0, target.cohorts.bands[1] - losses);
        target.grievance = Math.min(100, target.grievance + 10);

        this.addLog(
          `RETALIATION: ${allyFaction.name}, allied with ${this.settlement(targetSettlementId)?.name}, ` +
          `strikes back at ${raiderFaction.name}'s ${target.name} — ${losses} workers lost.`,
          'good'
        );
      }
    }
  }

  /** Coarse strategic family a goal belongs to — drives conflict & alliance logic.
   *  Military/expansion goals clash; economic/cultural goals coexist more easily. */
  private goalCategory(goalId: string): 'military' | 'expansion' | 'economic' | 'cultural' | 'other' {
    if (FACTION_GOAL_CATEGORIES.military.includes(goalId)) return 'military';
    if (FACTION_GOAL_CATEGORIES.expansion.includes(goalId)) return 'expansion';
    if (FACTION_GOAL_CATEGORIES.economic.includes(goalId)) return 'economic';
    if (FACTION_GOAL_CATEGORIES.cultural.includes(goalId)) return 'cultural';
    return 'other';
  }

  /** Calculate goal conflict severity between two faction goals (0–100).
   *  Higher values indicate more direct conflict. */
  private evaluateGoalConflict(goal1: FactionGoal, goal2: FactionGoal): number {
    // Same goal = maximum conflict
    if (goal1.id === goal2.id) return 100;

    const goal1Type = this.goalCategory(goal1.id);
    const goal2Type = this.goalCategory(goal2.id);

    // Land-grab families fight hardest over the same ground.
    const contested = (t: string) => t === 'military' || t === 'expansion';
    if (goal1Type === goal2Type && goal1Type !== 'other') {
      return contested(goal1Type) ? 70 : 50; // same family — territory worse than markets
    }
    if (contested(goal1Type) && contested(goal2Type)) return 50; // expansion vs military
    if (goal1Type !== 'other' && goal2Type !== 'other') return 30; // different non-trivial families
    return 20; // Minor conflict by default
  }

  /** Evaluate goal progress and announce successes/failures (Phase 3a: Presentation).
   *  Called during annual goal checks to provide player feedback on rival ambitions. */
  private evaluateGoalProgress(faction: RegionalFaction): void {
    if (!faction.currentGoal) return;

    const goal = faction.currentGoal;
    const succeeded = goal.successCondition(faction, this);
    const targetYear = goal.targetYear;
    const yearsLeft = targetYear - this.year;

    // Announce major milestones (75% and 90% toward target year)
    const milestoneYear75 = goal.generatedYear + Math.round((targetYear - goal.generatedYear) * 0.75);
    const milestoneYear90 = goal.generatedYear + Math.round((targetYear - goal.generatedYear) * 0.9);

    if (this.year === milestoneYear75 && !succeeded) {
      this.addLog(
        `${faction.name} progresses: "${goal.objective.toLowerCase()}" nearing completion.`,
        'info'
      );
    } else if (this.year === milestoneYear90 && !succeeded) {
      this.addLog(
        `${faction.name} approaches final phase: "${goal.objective.toLowerCase()}" almost within grasp.`,
        'info'
      );
    }

    // Success announcement
    if (succeeded) {
      this.addLog(
        `${faction.name} achieves ambition: "${goal.objective}". Their power grows.`,
        'good'
      );
      return; // Will be replaced by new goal next update
    }

    // Failure: goal becomes impossible or timeout
    if (yearsLeft <= 0) {
      this.addLog(
        `${faction.name} abandons goal: "${goal.objective.toLowerCase()}" (unable to achieve).`,
        'info'
      );
      return; // Will be replaced by new goal next update
    }
  }

  // ---- Faction Alliances (Phase 3b: Alliance Blocs) ----

  /** Track faction alliances: array of pair keys like "1:3" (faction IDs, canonical order). */
  private factionAlliances: string[] = [];

  /** Helper: create canonical pair key for two faction IDs (min:max). */
  private factionPairKey(factionIdA: number, factionIdB: number): string {
    const min = Math.min(factionIdA, factionIdB);
    const max = Math.max(factionIdA, factionIdB);
    return `${min}:${max}`;
  }

  /** Check if two factions are allied. */
  private areAllied(factionIdA: number, factionIdB: number): boolean {
    return this.factionAlliances.includes(this.factionPairKey(factionIdA, factionIdB));
  }

  /** Form an alliance between two factions (Phase 3b). */
  private formAlliance(factionIdA: number, factionIdB: number): boolean {
    if (this.areAllied(factionIdA, factionIdB)) return false;

    const key = this.factionPairKey(factionIdA, factionIdB);
    this.factionAlliances.push(key);

    const a = this.faction(factionIdA);
    const b = this.faction(factionIdB);
    if (a && b) {
      this.addLog(
        `FACTION ALLIANCE: ${a.name} and ${b.name} form a pact for mutual defense and trade.`,
        'good'
      );
    }
    return true;
  }

  /** Break an alliance between two factions. */
  private breakAlliance(factionIdA: number, factionIdB: number): boolean {
    const key = this.factionPairKey(factionIdA, factionIdB);
    const idx = this.factionAlliances.indexOf(key);
    if (idx < 0) return false;

    this.factionAlliances.splice(idx, 1);

    const a = this.faction(factionIdA);
    const b = this.faction(factionIdB);
    if (a && b) {
      this.addLog(
        `ALLIANCE BROKEN: ${a.name} and ${b.name} end their pact. Suspicion grows.`,
        'bad'
      );
    }
    return true;
  }

  /** Evaluate alliance compatibility based on goal alignment (Phase 3b).
   *  Returns 0–100 score indicating how well two factions' goals align. */
  private evaluateAllianceCompatibility(factionIdA: number, factionIdB: number): number {
    const a = this.faction(factionIdA);
    const b = this.faction(factionIdB);
    if (!a || !b || !a.currentGoal || !b.currentGoal) return 20; // baseline

    const aCat = this.goalCategory(a.currentGoal.id);
    const bCat = this.goalCategory(b.currentGoal.id);
    const aPeaceful = aCat === 'economic' || aCat === 'cultural';
    const bPeaceful = bCat === 'economic' || bCat === 'cultural';

    let compatibility = 30; // baseline
    // Two builders (trade/culture) get along; two conquerors can carve up the map together.
    if (aPeaceful && bPeaceful) compatibility += 35;
    else if (aCat === bCat && aCat !== 'other') compatibility += 30;
    else if (aPeaceful !== bPeaceful) compatibility += 10; // mixed temperaments, lukewarm

    // Incompatible: same specific goal = natural rivalry; shared ambition over the
    // same scarce resource (territory/military) breeds the bitterest enmity.
    if (a.currentGoal.id === b.currentGoal.id) compatibility -= 40;
    else if (aCat === bCat && (aCat === 'military' || aCat === 'expansion')) compatibility -= 20;

    // Allies of difficulty: a brutal world is more suspicious, a gentle one more trusting.
    compatibility += -this.aiKnobs().aggressionBias * 0.5;

    return Math.max(0, Math.min(100, compatibility));
  }

  /** Update faction alliance dynamics (Phase 3b: called during monthly faction update). */
  private updateFactionAlliances(): void {
    for (let i = 0; i < this.regionalFactions.length; i++) {
      for (let j = i + 1; j < this.regionalFactions.length; j++) {
        const a = this.regionalFactions[i];
        const b = this.regionalFactions[j];
        const allied = this.areAllied(a.id, b.id);
        const compatibility = this.evaluateAllianceCompatibility(a.id, b.id);

        if (!allied && compatibility > 60 && this.aiRng.chance(0.02)) {
          // Form alliance: compatible goals + random chance
          this.formAlliance(a.id, b.id);
        } else if (allied && compatibility < 30 && this.aiRng.chance(0.03)) {
          // Break alliance: incompatible goals emerged
          this.breakAlliance(a.id, b.id);
        }
      }
    }
  }

  /** Monthly update hook for faction AI: check if any faction is due for update.
   *  Staggered scheduling keeps this O(factions) but amortized O(1) per month. */
  private updateRivalAI(): void {
    // Nation-level rivals: staggered diplomatic cadence (peace, war, treaties).
    // GDD §6.2: Personality-driven AI generates offers based on weights, relations, and situation.
    for (const rival of this.rivals) {
      if (this.day - rival.lastEnvoyDay >= 365) {
        this.rivalDiplomaticRound(rival);
        rival.lastEnvoyDay = this.day;
      }
    }

    // Regional factions: staggered AI so not every faction acts each month.
    // Runs from tick 1 — rivals expand and scout regardless of player statehood.
    for (const faction of this.regionalFactions) {
      if (faction.id === this.playerFactionId) continue;
      if (this.day - faction.lastUpdateDay >= faction.updateFrequency) {
        this.updateFactionAI(faction);
        faction.lastUpdateDay = this.day;
      }
    }
  }

  /** Annual diplomatic round: AI initiates offers based on personality and relations. */
  private rivalDiplomaticRound(rival: RivalNation): void {
    if (!this.stateProclaimed) return; // Player must be a nation to be courted

    // Clean up expired offers
    this.offers = this.offers.filter((o) => o.rivalId !== rival.id || this.day < o.expiresDay);

    // Rival already has an outstanding offer; wait for response
    if (this.offerFor(rival.id)) return;

    // Personality-driven offer generation: weighted by relations, treaties already held,
    // and the rival's archetype preferences.
    const appetite = this.rivalOfferAppetite(rival);
    const kinds = this.treatyKindsRivalCanOffer(rival);

    if (appetite > 0 && kinds.length > 0) {
      // Weight choices by personality: commerce-driven rivals favor trade agreements,
      // honor-weighted rivals push defensive pacts, expansion-hungry rivals want non-aggression.
      const weighted = kinds.map((kind) => ({
        kind,
        priority: this.treatyOfferPriority(rival, kind),
      })).sort((a, b) => b.priority - a.priority);

      const chosen = weighted[0]?.kind;
      if (chosen && this.aiRng.chance(appetite / 50)) {
        this.offers.push({
          rivalId: rival.id,
          kind: chosen,
          expiresDay: this.day + 180, // 6-month expiration
        });
        this.addLog(
          `DIPLOMATIC OVERTURE: ${rival.name} proposes a ${TREATY_DEFS[chosen].name}.`,
          'info',
        );
      }
    }

    // Rare chance for small gifts to improve relations (personality-driven)
    if (rival.weights.commerce >= 6 && this.day - rival.lastGiftDay >= 365) {
      if (rival.relations < 20 && this.aiRng.chance(0.15)) {
        rival.relations = this.clampRel(rival.relations + 15);
        rival.lastGiftDay = this.day;
        this.addLog(`${rival.name} sends a gift of goodwill.`, 'good');
      }
    }

    // Rare dramatic moments and special events (GDD §6.4: the world has its own politics)
    this.checkRivalSpecialEvents(rival);
  }

  /** Rare special diplomatic moments: leadership changes, alliances, betrayals. */
  private checkRivalSpecialEvents(rival: RivalNation): void {
    // Very rare: a rival seeks alliance against a mutual hostile third party
    // (only if they have good relations with us and low relations with someone else)
    if (
      rival.relations >= 40 && rival.treaties.includes('non_aggression') &&
      !rival.treaties.includes('defensive_pact') &&
      this.rivals.length >= 2 && this.aiRng.chance(0.015)
    ) {
      // Find a mutual hostile (someone both dislike)
      const mutualHostiles = this.rivals.filter(
        (other) => other.id !== rival.id &&
          other.relations < rival.relations - 30 &&
          (this.rivalPairs[this.pairKey(rival.id, other.id)] ?? 0) < rival.relations - 30
      );
      if (mutualHostiles.length > 0 && this.aiRng.chance(0.5)) {
        const hostile = mutualHostiles[0];
        this.offers.push({
          rivalId: rival.id,
          kind: 'defensive_pact',
          expiresDay: this.day + 180,
        });
        this.addLog(
          `ALLIANCE PROPOSAL: ${rival.name} proposes a pact against ${hostile.name} ` +
          `— their mutual enmity draws you together.`,
          'info',
        );
        this.noteHistory(rival, `Sought defensive pact against ${hostile.name}, ${this.year}.`);
      }
    }

    // Very rare: if relations collapse, a rival might demand tribute or vassalage
    // (only aggressive/expansionist types do this)
    if (
      rival.relations < -70 && rival.weights.expansion >= 7 && rival.pop > 15000 &&
      !this.playerWar && this.aiRng.chance(0.012)
    ) {
      const tributeDemand = Math.round(this.treasury * 0.1);
      this.addLog(
        `ULTIMATUM: ${rival.name}, emboldened by power, demands ` + formatCurrency(tributeDemand) + ` in tribute. ` +
        `${rival.leader} threatens grave consequences for refusal.`,
        'bad',
      );
      this.noteHistory(rival, `Demanded tribute from ${this.stateName || 'the State'}, ${this.year}.`);
    }

    // Rare: honorable rivals may fulfill verbal agreements or surprising displays of honor
    // (builds legendary status for noble rivals)
    if (
      rival.relations >= 60 && rival.weights.honor >= 8 &&
      rival.history.filter((h) => h.includes(this.stateName || 'State')).length >= 2 &&
      this.aiRng.chance(0.02)
    ) {
      const bonus = 5 + rival.weights.honor;
      rival.relations = this.clampRel(rival.relations + bonus);
      this.addLog(
        `HONOR UPHELD: ${rival.name} fulfills an ancient agreement with surprising integrity. ` +
        `The envoys speak of ${rival.leader}'s legendary word.`,
        'good',
      );
      this.noteHistory(rival, `Displayed honor in dealings with ${this.stateName || 'the State'}, ${this.year}.`);
    }
  }

  /** Appetite (0–100) for AI to initiate an offer: based on relations and personality. */
  private rivalOfferAppetite(rival: RivalNation): number {
    // The more cordial the relation, the more likely to propose (GDD §6.3).
    // Higher commerce weight increases appetite for trade; honor increases pact appetite.
    const baseAppetite = Math.max(0, rival.relations + 30);
    const commerceBonus = rival.weights.commerce * 2;
    const honorBonus = rival.weights.honor * 1.5;
    return baseAppetite + commerceBonus + honorBonus;
  }

  /** Which treaty kinds a rival can currently offer (already signed ones excluded). */
  private treatyKindsRivalCanOffer(rival: RivalNation): TreatyKind[] {
    const all: TreatyKind[] = ['non_aggression', 'trade_agreement', 'defensive_pact'];
    if (this.accordUnlocked()) all.push('climate_accord');
    return all.filter((kind) => !rival.treaties.includes(kind));
  }

  /** Priority (0–100) of offering a specific treaty kind, based on personality. */
  private treatyOfferPriority(rival: RivalNation, kind: TreatyKind): number {
    switch (kind) {
      case 'trade_agreement':
        // Commerce-driven rivals prize trade; ideology-driven rivals less so
        return rival.weights.commerce * 8 - rival.weights.ideology * 2;
      case 'non_aggression':
        // Cautious, expansion-averse rivals push for non-aggression to lock borders
        return (10 - rival.weights.risk) * 6 + (10 - rival.weights.expansion) * 4;
      case 'defensive_pact':
        // Honor-weighted and ideology-driven rivals form alliances; risk-averse rivals avoid
        return rival.weights.honor * 7 + rival.weights.ideology * 4 - rival.weights.risk * 3;
      case 'climate_accord':
        // Commerce-driven (rules-loving) rivals adopt climate accords; expansion hawks resist
        return rival.weights.commerce * 5 - rival.weights.expansion * 4;
    }
  }

  // ---- Scout System (GDD §6.2: exploratory units for faction AI) ----

  /** Spawn scouts for a faction if it has budget and slots. Called during faction AI update. */
  private spawnScout(faction: RegionalFaction): Scout | null {
    if (faction.settlementIds.length === 0) return null;
    const scoutCount = this.scouts.filter((s) => s.factionId === faction.id).length;
    if (scoutCount >= 2) return null; // max 2 scouts per faction
    if (faction.treasury < 5) return null; // costs 5 gold

    // Spawn near random friendly settlement
    const settlement = this.settlement(faction.settlementIds[this.aiRng.int(faction.settlementIds.length)]);
    if (!settlement) return null;

    const scout: Scout = {
      id: this.nextScoutId++,
      factionId: faction.id,
      x: settlement.x + (this.aiRng.int(5) - 2),
      y: settlement.y + (this.aiRng.int(5) - 2),
      health: 100,
      maintenanceCost: 5,
      createdDay: this.day,
      expireDay: this.day + 200, // 200-day lifespan
      targetMode: faction.currentGoal ? 'objective' : 'random',
    };

    // Clamp to map bounds
    scout.x = Math.max(0, Math.min(100, scout.x));
    scout.y = Math.max(0, Math.min(100, scout.y));

    this.scouts.push(scout);
    faction.treasury -= 5;
    return scout;
  }

  /** Move a single scout by 2-3 cells toward objective or random direction. */
  private moveScout(scout: Scout): void {
    const oldX = scout.x, oldY = scout.y;
    const faction = this.faction(scout.factionId);
    if (!faction || !faction.currentGoal) {
      // Random walk
      scout.x += this.aiRng.int(3) - 1;
      scout.y += this.aiRng.int(3) - 1;
    } else {
      // Move toward unexplored tiles biased by goal
      const target = this.scoutDestinationTile(scout, faction);
      if (target) {
        const dx = target.x - scout.x, dy = target.y - scout.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 0) {
          scout.x += (dx / dist) * 2.5;
          scout.y += (dy / dist) * 2.5;
        }
      } else {
        // Fallback: random walk
        scout.x += this.aiRng.int(3) - 1;
        scout.y += this.aiRng.int(3) - 1;
      }
    }

    // Clamp to bounds
    scout.x = Math.max(0, Math.min(100, scout.x));
    scout.y = Math.max(0, Math.min(100, scout.y));

    // Invalidate faction visibility if moved significantly
    if (Math.abs(scout.x - oldX) > 0.1 || Math.abs(scout.y - oldY) > 0.1) {
      // Would invalidate cache here in Phase 2c
    }
    void oldX; // suppress unused warning
  }

  /** Find best tile for scout to explore, biased by goal. Returns tile matching goal bias. */
  private scoutDestinationTile(_scout: Scout, faction: RegionalFaction): { x: number; y: number } | null {
    const bias = faction.currentGoal?.settlementBias ?? [];

    // If no bias, return random target
    if (bias.length === 0) {
      return { x: this.aiRng.int(100), y: this.aiRng.int(100) };
    }

    // Sample 10 random tiles, pick best match for goal bias
    let bestTile: { x: number; y: number } | null = null;
    let bestMatches = 0;

    for (let i = 0; i < 10; i++) {
      const x = this.aiRng.int(100);
      const y = this.aiRng.int(100);
      const siteTypes = this.siteType(x, y);

      // Count how many bias types match
      let matches = 0;
      for (const b of bias) {
        if (siteTypes.includes(b)) matches++;
      }

      if (matches > bestMatches) {
        bestMatches = matches;
        bestTile = { x, y };
      }
    }

    return bestTile ?? { x: this.aiRng.int(100), y: this.aiRng.int(100) };
  }

  // ---- Settlement Expansion (Phase 2b: Monte Carlo placement) ----

  /** Determine site characteristics: river, coastal, mountain, plains, forest. */
  private siteType(x: number, y: number): string[] {
    const site = this.map.siteAt(x, y);
    if (!site) return [];
    const types: string[] = [];
    if (site.river || (x > 0 && y > 0 && this.map.siteAt(x - 1, y)?.river)) types.push('river');
    if (site.coastal || x < 5 || x > 95 || y < 5 || y > 95) types.push('coastal');
    if (site.roughness > 0.4) types.push('mountain');
    if (site.fertility > 0.9 && site.roughness < 0.2) types.push('plains');
    if (site.forest > 0.5) types.push('forest');
    return types;
  }

  /** Find best settlement expansion site using Monte Carlo sampling. */
  private findBestExpansionSite(faction: RegionalFaction, samples: number = 5): { x: number; y: number; score: number } | null {
    let bestSite: { x: number; y: number; score: number } | null = null;
    const bias = faction.currentGoal?.settlementBias ?? [];
    // Compass-direction preference: factions spread from their map-edge compass position
    // so each rival occupies a distinct quadrant rather than piling on top of the player.
    const compassBias: Record<string, (x: number, y: number) => number> = {
      north: (_x, y) => y < 40 ? 15 : 0,
      south: (_x, y) => y > 60 ? 15 : 0,
      east:  (x, _y) => x > 60 ? 15 : 0,
      west:  (x, _y) => x < 40 ? 15 : 0,
    };
    // Bootstrap uses 8 samples for better initial placement; established factions use 5
    const effectiveSamples = faction.settlementIds.length === 0 ? Math.max(samples, 8) : samples;

    for (let i = 0; i < effectiveSamples; i++) {
      const x = this.aiRng.int(100), y = this.aiRng.int(100);
      const site = this.map.siteAt(x, y);
      if (!site) continue;

      // Score using direct field checks — avoids allocating a siteTypes array per sample
      let score = 50;

      const isRiver = site.river || this.map.siteAt(Math.max(0, x - 1), y)?.river === true;
      const isCoastal = site.coastal || x < 5 || x > 95 || y < 5 || y > 95;
      const isMountain = site.roughness > 0.4;
      const isPlains = site.fertility > 0.9 && site.roughness < 0.2;
      const isForest = site.forest > 0.5;

      // Penalty: too close to any existing settlement
      for (const settlementId of faction.settlementIds) {
        const s = this.settlement(settlementId);
        if (s && Math.abs(s.x - x) < 4 && Math.abs(s.y - y) < 4) { score -= 100; break; }
      }

      // Bias matching (goal-driven)
      if (bias.includes('river') && isRiver) score += 20;
      if (bias.includes('coastal') && isCoastal) score += 20;
      if (bias.includes('mountain') && isMountain) score += 20;
      if (bias.includes('plains') && isPlains) score += 20;
      if (bias.includes('forest') && isForest) score += 20;

      // Terrain bonuses
      if (isCoastal) score += 5;
      if (isRiver) score += 3;
      if (isMountain) score += 2;

      // Compass-direction pull keeps rival factions in distinct map quadrants
      const aig = faction.aiGoal ?? '';
      const compassKey = ['north', 'south', 'east', 'west'].find(d => aig.includes(d) || faction.name.toLowerCase().includes(d));
      if (compassKey) score += compassBias[compassKey](x, y);

      // Noise for variety
      score += this.aiRng.int(11) - 5;

      if (score > 0 && (!bestSite || score > bestSite.score)) {
        bestSite = { x: Math.round(x), y: Math.round(y), score };
      }
    }

    return bestSite;
  }

  /** Procedurally name a new AI settlement based on resource focus and faction index. */
  private factionSettlementName(faction: RegionalFaction, focus: string): string {
    const byFocus: Record<string, string[]> = {
      wool:    ['Portside', 'Woolhaven', 'Harbourgate', 'Tidemark'],
      grain:   ['Millford', 'Grangehaven', 'Harvestfield', 'Barleybury'],
      iron:    ['Ironpass', 'Forgepeak', 'Oremont', 'Hammerhead'],
      wood:    ['Timberfall', 'Sawmill Crossing', 'Woodstock', 'Ashwood'],
      diverse: ['New Haven', 'Crossroads', 'Outpost', 'Settlement'],
    };
    const pool = byFocus[focus] ?? byFocus.diverse;
    const idx = faction.settlementIds.length % pool.length;
    // Avoid name collisions with existing settlements
    let name = pool[idx];
    const usedNames = new Set(this.settlements.map(s => s.name));
    if (usedNames.has(name)) {
      const prefix = faction.name.split(' ')[0] ?? faction.name;
      name = `${prefix}'s ${pool[idx]}`;
    }
    return name;
  }

  /** Found a new settlement for a faction at the given coordinates. */
  private foundSettlement(faction: RegionalFaction, x: number, y: number): Settlement | null {
    // Check if placement is valid
    if (x < 0 || x > 100 || y < 0 || y > 100) return null;

    // Don't found where another settlement exists
    if (this.settlements.some((s) => Math.abs(s.x - x) < 4 && Math.abs(s.y - y) < 4)) {
      return null;
    }

    // Create new settlement
    const site = this.map.siteAt(Math.round(x), Math.round(y));
    if (!site) return null;

    // Determine resource focus from site characteristics
    const siteTypes = this.siteType(Math.round(x), Math.round(y));
    let resourceFocus: 'wool' | 'grain' | 'iron' | 'wood' | 'diverse' = 'diverse';
    if (siteTypes.includes('coastal')) resourceFocus = 'wool'; // trade goods
    else if (siteTypes.includes('plains')) resourceFocus = 'grain'; // agriculture
    else if (siteTypes.includes('mountain')) resourceFocus = 'iron'; // mining
    else if (siteTypes.includes('forest')) resourceFocus = 'wood'; // forestry

    const settlement: Settlement = {
      id: this.nextId++,
      name: this.factionSettlementName(faction, resourceFocus),
      x: Math.round(x),
      y: Math.round(y),
      foundedDay: this.day,
      cohorts: { bands: [5, 10, 8, 4, 1] }, // starting population ~28
      food: Math.round(28 * 0.75 * 90), // 90-day buffer so new settlements don't starve immediately
      wood: 30,
      satisfaction: 60,
      housing: 15,
      landQuality: site.fertility,
      site,
      lastRaidDay: -999,
      lastFloodDay: -999,
      strikeUntil: -1,
      grievance: 20,
      prices: { ...BASE_PRICE },
      factionId: faction.id,
      garrisonStrength: 2,
      stationedUnits: [],
      loyaltyToFaction: 85, // new settlements are loyal to their faction
      sectors: defaultSectors(),
      buildings: [],
      construction: null,
      focus: 'balanced' as TownFocus,
      activeEvents: [],
      policies: { ...DEFAULT_CITY_POLICIES },
      recentEvents: [],
      resourceFocus,
    };

    this.settlements.push(settlement);
    faction.settlementIds.push(settlement.id);

    // graft onto the faction's central backbone (the root town self-anchors → no trail)
    const anchor = this.networkAnchor(settlement);
    if (anchor >= 0 && anchor !== settlement.id) this.blazeTrail(anchor, settlement.id);

    return settlement;
  }

  /** Update all scouts: move, age, expire. Called during monthly update. */
  private updateScouts(): void {
    // Move active scouts
    for (const scout of this.scouts) {
      if (this.day < scout.expireDay) {
        const oldX = scout.x, oldY = scout.y;
        this.moveScout(scout);

        // Invalidate faction visibility if scout moved
        if (Math.abs(scout.x - oldX) > 0.1 || Math.abs(scout.y - oldY) > 0.1) {
          this.invalidateFactionVisibility(scout.factionId);
        }
      }
    }

    // Remove expired scouts
    this.scouts = this.scouts.filter((s) => this.day < s.expireDay);

    // Attempt to spawn new scouts for factions with budget
    for (const faction of this.regionalFactions) {
      if (this.rng.chance(0.1)) {
        // 10% chance per update to spawn a scout if faction has budget
        this.spawnScout(faction);
      }
    }
  }

  // ---- Faction Visibility Cache (Phase 2c: deferred per-faction visibility) ----

  /** Visibility cache: tiles visible to each faction (lazily computed, weekly rebuild). */
  private factionVisibilityCache: Map<number, Set<string>> = new Map();
  private lastVisibilityRebuild: Map<number, number> = new Map();

  /** Check if a tile is visible to a faction (cache hits are O(1)). */
  isVisibleToFaction(x: number, y: number, factionId: number): boolean {
    // Rebuild cache if stale (weekly rebuild)
    const lastRebuild = this.lastVisibilityRebuild.get(factionId) ?? -999;
    if (this.day - lastRebuild >= 7) {
      this.rebuildFactionVisibility(factionId);
    }

    const cache = this.factionVisibilityCache.get(factionId);
    return cache ? cache.has(`${Math.round(x)},${Math.round(y)}`) : false;
  }

  /** Mark faction visibility cache as dirty (rebuild on next check). */
  private invalidateFactionVisibility(factionId: number): void {
    this.lastVisibilityRebuild.set(factionId, -999); // force rebuild
  }

  /** Rebuild faction visibility cache from settlements + scouts. O(settlements² + scouts × radius²). */
  private rebuildFactionVisibility(factionId: number): void {
    const faction = this.faction(factionId);
    if (!faction) return;

    const cache = new Set<string>();
    const baseRadius = 2;

    // Settlement visibility: 2 + tech bonus
    for (const settlementId of faction.settlementIds) {
      const settlement = this.settlement(settlementId);
      if (!settlement) continue;

      const radius = baseRadius;
      const r2 = (radius + 1) ** 2;
      for (let dx = -(radius + 1); dx <= radius + 1; dx++) {
        for (let dy = -(radius + 1); dy <= radius + 1; dy++) {
          if (dx * dx + dy * dy <= r2) {
            const nx = settlement.x + dx, ny = settlement.y + dy;
            if (nx >= 0 && nx <= 100 && ny >= 0 && ny <= 100) {
              cache.add(`${Math.round(nx)},${Math.round(ny)}`);
            }
          }
        }
      }
    }

    // Scout visibility: 5-cell radius
    for (const scout of this.scouts) {
      if (scout.factionId !== factionId) continue;
      const radius = 5;
      const r2 = radius * radius;
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          if (dx * dx + dy * dy <= r2) {
            const nx = scout.x + dx, ny = scout.y + dy;
            if (nx >= 0 && nx <= 100 && ny >= 0 && ny <= 100) {
              cache.add(`${Math.round(nx)},${Math.round(ny)}`);
            }
          }
        }
      }
    }

    this.factionVisibilityCache.set(factionId, cache);
    this.lastVisibilityRebuild.set(factionId, this.day);
  }
}
