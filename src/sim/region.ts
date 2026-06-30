/**
 * RegionSim — the aggregate simulation that takes over at the flip (GDD §2.4).
 *
 * The moment town #2 is founded, individual settlers become cohort statistics
 * and a small cast of Notables carries the attachment forward. Settlements
 * grow, age, migrate, and get raided as populations, not agents — this is the
 * performance answer that lets the game scale to a State and beyond.
 */
import { Rng } from './rng';
import { MINUTES_PER_DAY, DAYS_PER_SEASON, DAYS_PER_YEAR, SEASONS, START_YEAR, MONTHS, DAYS_PER_MONTH, FactionId as NewFactionId, activeFactions, formatCurrency, setCurrencySymbol, AI_DIFFICULTY, TUNING } from './defs';
import type { CurrencySymbol, RegionDesign, NationDesign, AiDifficulty } from './defs';
import { computePenalty, transitionEfficiency, ANNOUNCE_LEAD_DAYS } from './currency';
import type { CurrencyChangeCause, CurrencyAnnouncement, CurrencyTransition } from './currency';
import { RegionMap, REGION_N, CELL_SCALE } from './worldgen';
import type { TownSite } from './worldgen';
import { hexNeighbors, hexDistance } from './hex';
import { Weather } from './weather';
import { createInitialLenders, type Lender, type Loan } from './lenders';
import { resolveSupplyChainGraded } from './supply';
import { tickPollution } from './systems/pollution';
import { tickServiceCoverage } from './systems/services';
import { tickPriceArbitrage } from './systems/arbitrage';
import { tickIntermediateGoods, worldGoodPrice, worldGoodScarcity, worldMarketTightness, worldPowerPressure } from './systems/goods';
import { tickAdvisorLoyalty, tickAdvisorEvents, tickLegitimacy, tickRegimeMechanics } from './systems/regime';
import { tickDemographicTransition, tickAppealMigration, tickEducationLag, tickUnrestLadder } from './systems/demographics';
import { tickClimate, checkStrandedAssets, tickAutomation } from './systems/climate';
import { updateDiplomacy } from './systems/diplomacy';
import { tickMonetary, tickFX } from './systems/monetary';
import {
  updateArmyMovement,
  tickRivalArmyAI,
  consumeWarSupply,
  tickMobilization,
  tickSupplyLines,
  tickOccupation,
  tickWarSupport,
  abandonGhostTowns,
} from './systems/military';
import { tickHistoricalAnchors } from './systems/historical';
import { tickNotableLifecycle } from './systems/notables';
import { tickResearch } from './systems/research';
import { updateRouteCargo } from './systems/trade';
import { updateCharter } from './systems/charter';
import { updateLoans } from './systems/loans';
import techTreeJson from '../data/techtree.json';
import regionBuildingsJson from '../data/region_buildings.json';
import rivalNationsJson from '../data/rival_nations.json';

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
  /** Partial flood-proofing: raised thresholds, emergency pumps, floodgates.
   *  Costs half a sea wall; cuts tidal damage by 50% but doesn't eliminate it. */
  floodProofed?: boolean;
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
  /** Faction strength in this settlement (0-100 per faction); higher = more influence */
  factionStrengths: Map<NewFactionId, number>;
  /** Phase 1: where this town's labor works, what it produces, what it pays. */
  sectors: Sectors;
  /** Phase 2: civic works raised in a managed city (building def ids). */
  buildings: string[];
  /** Per-settlement-stocks (Tier-3): this town's share of the intermediate-goods
   *  ledger, good id → units. Optional + sparse — created lazily when a town first
   *  banks a good, absent (and unserialized) otherwise, so old saves migrate for
   *  free. The nation-wide totals the supply chain reads are the SUM across towns
   *  (`goodStock`), so this split is economy-neutral today; it's the storage the
   *  later "consume / ship goods where produced" work builds on. */
  goodStocks?: Record<string, number>;
  /** Spatial-4X Phase B: where each raised building sits, as a cell index
   *  (col*REGION_N + row). Render-only — the economy still reads `buildings`, so
   *  this is purely additive. Stays in sync with `buildings` via completion +
   *  migration (`ensurePlacements`). */
  placedBuildings: PlacedBuilding[];
  /** Spatial-4X Phase D: placed DISTRICTS — themed zones (`DistrictDef` ids on a
   *  cell). Separate from `placedBuildings` so the building-bonus loops never pull
   *  a district in. Player-only and additive — empty in autoplay, so a town with no
   *  districts is byte-identical to base. */
  placedDistricts: PlacedBuilding[];
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
  // ---- Phase 14: Zoning, Infrastructure & City Services (GDD §5.1) ----
  /** Land use fractions (sum to 1.0) */
  zoningMix?: { residential: number; commercial: number; industrial: number; office: number };
  /** Land value 0–100 (computed monthly) */
  landValue?: number;
  /** Pollution level 0–100 (computed monthly) */
  pollutionLevel?: number;
  /** Power generated this settlement (MW) */
  powerCapacity?: number;
  /** Power consumed by this settlement (MW) */
  powerDemand?: number;
  /** Fraction of population served by water system (0–1) */
  waterCoverage?: number;
  /** Fraction of population served by waste management (0–1) */
  wasteCoverage?: number;
  /** City service coverage fractions (each 0–1) */
  serviceCoverage?: { health: number; education: number; safety: number };
  /** Last year a brownout event was logged (prevents spam) */
  lastBrownoutYear?: number;
}

// ---- Phase 0: Territory & resource visualization ----

/** At-a-glance health of a settlement's three headline goods. */
export type ResourceStatus = 'surplus' | 'balanced' | 'deficit';
export interface SettlementResourceStatus {
  food: ResourceStatus;
  wood: ResourceStatus;
  goods: ResourceStatus;
}

/** A named territorial unit at the province layer. One settlement = one province at
 *  State/Nation tier; the settlement IS the province capital. */
export interface Province {
  /** = capitalId — stable identifier tied to the settlement. */
  id: number;
  /** Display name shown on the map overlay. */
  name: string;
  capitalId: number;
  factionId: number;
  /** Region coords 0..100 — the settlement position anchors the province centroid. */
  centroidX: number;
  centroidY: number;
  totalPop: number;
  satisfaction: number;
  militaryStrength: number;
  /** Monthly sector output (GDP contribution). */
  gdpContribution: number;
  keyBuildings: string[];
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

// ---- Phase 15: Intermediate Goods & Supply Chains (GDD §5.2) ----

/** A manufactured good that requires inputs from other goods/raw materials to
 *  produce. The set forms the GDD §5.2 supply-chain DAG: primary raw materials
 *  feed intermediate goods, which feed final goods. A shortage propagates
 *  downstream through `resolveSupplyChain` (see src/sim/supply.ts). */
export interface IntermediateGood {
  id: string;
  name: string;
  eraUnlock: number;   // year this good becomes producible
  inputs: string[];    // required input goods (a raw-material id or another good's id)
  baseOutput: number;  // monthly units produced with full inputs
}

/** Primary raw materials (GDD §5.2 "Primary" tier) — the leaves of the supply
 *  graph. They aren't produced by any good; their availability is proxied from
 *  the sector that extracts them, so a *sector* collapse (not a good outage) is
 *  what cuts the chain at its root. Split by extracting sector. */
export const AGRICULTURAL_RAWS = new Set(['grain', 'livestock']);
export const EXTRACTIVE_RAWS = new Set(['wood', 'coal', 'iron', 'copper', 'oil', 'stone']);

/** The supply-chain DAG (GDD §5.2, MVP-18 named set). Tiered for readability;
 *  `resolveSupplyChain` is order-independent (it resolves dependencies
 *  recursively). The original Phase-15 five (chemicals, components, electronics,
 *  pharmaceuticals, vehicles) keep their exact recipes/eras — the cascade and the
 *  pharma→disease / electronics→research effects are unchanged; the rest deepen
 *  the graph a raw shock cascades through. */
export const INTERMEDIATE_GOODS: IntermediateGood[] = [
  // Intermediate tier (primary raw → processed input). The chain switches on in
  // 1920 (matching the original Phase-15 set), so the 1919 founding year keeps
  // an empty, disruption-free supply graph.
  { id: 'lumber',          name: 'Lumber',          eraUnlock: 1920, inputs: ['wood'],                     baseOutput: 12 },
  { id: 'steel',           name: 'Steel',           eraUnlock: 1920, inputs: ['iron', 'coal'],             baseOutput: 10 },
  { id: 'textiles',        name: 'Textiles',        eraUnlock: 1920, inputs: ['livestock'],                baseOutput: 10 },
  { id: 'chemicals',       name: 'Chemicals',       eraUnlock: 1920, inputs: ['coal'],                     baseOutput: 10 },
  { id: 'fuel',            name: 'Fuel',            eraUnlock: 1920, inputs: ['oil'],                       baseOutput: 9  },
  { id: 'electricity',     name: 'Electricity',     eraUnlock: 1922, inputs: ['coal'],                     baseOutput: 11 },
  { id: 'components',      name: 'Components',      eraUnlock: 1930, inputs: ['iron', 'chemicals'],         baseOutput: 8  },
  // Final tier (intermediate → finished good).
  { id: 'food',            name: 'Food',            eraUnlock: 1920, inputs: ['grain', 'livestock'],        baseOutput: 14 },
  { id: 'clothing',        name: 'Clothing',        eraUnlock: 1920, inputs: ['textiles'],                 baseOutput: 9  },
  { id: 'tools',           name: 'Tools',           eraUnlock: 1920, inputs: ['steel'],                    baseOutput: 8  },
  // The fuel-burning finals (GDD §5.4 "the oil shock … is a fuel price your
  // trucking, plastics, and heating all pay"). Taking `fuel` as an input is what
  // lets an oil embargo cascade oil → fuel → here. In healthy play fuel always
  // flows (oil is available whenever industry produces), so these stay supplied
  // and the economy is unchanged; only a real oil cut bites.
  { id: 'vehicles',        name: 'Vehicles',        eraUnlock: 1925, inputs: ['iron', 'components', 'fuel'],     baseOutput: 4  },
  { id: 'machinery',       name: 'Machinery',       eraUnlock: 1930, inputs: ['steel', 'components', 'fuel'],    baseOutput: 6  },
  { id: 'consumer_goods',  name: 'Consumer Goods',  eraUnlock: 1935, inputs: ['textiles', 'components', 'fuel'], baseOutput: 7  },
  { id: 'pharmaceuticals', name: 'Pharmaceuticals', eraUnlock: 1940, inputs: ['chemicals'],                baseOutput: 6  },
  { id: 'electronics',     name: 'Electronics',     eraUnlock: 1950, inputs: ['components', 'copper'],      baseOutput: 5  },
  { id: 'luxury_goods',    name: 'Luxury Goods',    eraUnlock: 1955, inputs: ['textiles', 'electronics'],   baseOutput: 3  },
];

/** Goods whose direct recipe pulls an agricultural raw (grain/livestock) — the
 *  food/textile line. Production of these is attributed to a town's AGRICULTURE
 *  output; everything else (steel, chemicals, machinery, …) to its INDUSTRY
 *  output, when splitting a tick's production across settlements (`produceGood`).
 *  The split only decides which town's bucket holds the units — the supply chain
 *  reads the nation-wide sum — so this mapping is economy-neutral, a future-economy
 *  attribution choice, not a balance one. */
const AGRI_ATTRIBUTED_GOODS = new Set(
  INTERMEDIATE_GOODS.filter((g) => g.inputs.some((i) => AGRICULTURAL_RAWS.has(i))).map((g) => g.id),
);

/** The extracting/producing sector a good's output is attributed to per-settlement.
 *  Exported so the extracted goods system (systems/goods.ts) can weight each town's
 *  share of a good's output by that sector when running the per-town supply solve
 *  (PR-3 slice 2) — the same weighting `produceGood` uses. */
export function goodProducingSector(goodId: string): 'industry' | 'agriculture' {
  return AGRI_ATTRIBUTED_GOODS.has(goodId) ? 'agriculture' : 'industry';
}

/** Maximum industrial-output drag from a *total* supply-chain collapse — every
 *  unlocked good's upstream chain cut. Small and bounded: a full cascade trims
 *  the industry sector by 15%, never zeroes it (so a drag can't itself starve
 *  the raw proxy and spiral — a positive output stays positive). The drag scales
 *  with how far actual supply health falls *below the era's structural baseline*
 *  (a good idling on a not-yet-unlocked input is the era boundary, not a shock),
 *  so healthy play is byte-identical and only a genuine raw collapse bites. */
export const SUPPLY_SHOCK_MAX_DRAG = 0.15;

/** Cost-push inflation gain from a supply-chain shock (GDD §5.2). A shortage is
 *  not only fewer goods made (the `SUPPLY_SHOCK_MAX_DRAG` output bite) — it is
 *  also dearer goods: the 1973 oil embargo quadrupled prices, and *that* half of
 *  the shock was missing. The monthly inflation target gains
 *  `supplyShockSeverity × SUPPLY_SHOCK_INFLATION`, so a partial oil embargo
 *  (severity ≈ 0.15) lifts the target ~4.5pp — a few points of stagflation that
 *  heal as the chain does, capped by the 0.50 inflation ceiling. Exactly 0 in
 *  healthy play (severity is 0 whenever raws flow), so the inflation path — and
 *  the whole monetary RNG stream — stays byte-identical there; only a genuine
 *  cascade below the era-structural baseline pushes prices. Bounded and a pure
 *  sink (inflation feeds confidence/GDP, never sector output → the raw proxy),
 *  so it can't reinforce the shortage that caused it. */
export const SUPPLY_SHOCK_INFLATION = 0.30;

/** Export drag from a supply-chain shock (GDD §5.2), the *trade* leg of the
 *  goods→economy coupling — the output drag (`SUPPLY_SHOCK_MAX_DRAG`) and the
 *  cost-push (`SUPPLY_SHOCK_INFLATION`) are the other two. A nation short on
 *  fuel, components, or food has less surplus to sell abroad, so export earnings
 *  fall by `supplyShockSeverity × SUPPLY_SHOCK_EXPORT_DRAG`: a partial oil
 *  embargo (severity ≈ 0.15) trims exports ~7.5%, a total cut (≈ 0.25) ~12.5%,
 *  a total cascade at most 50%. Foreign sales are the discretionary surplus, so
 *  they're hit harder than essential domestic output (15% max) — yet still
 *  bounded, never zeroed. Exactly 0 in healthy play (severity 0 whenever raws
 *  flow) → ×1 → byte-identical there; only a real cascade below the era baseline
 *  bites. A pure sink: exports feed the treasury, never sector output → the raw
 *  proxy, so it can't deepen the shortage that caused it. */
export const SUPPLY_SHOCK_EXPORT_DRAG = 0.5;

/** PR-3 slice 3 — the LOCAL-goods cost-push gain. The *raw-cascade* shock above
 *  (`SUPPLY_SHOCK_INFLATION`) only fires when raws collapse below the era baseline;
 *  this is the *second* price channel, driven by the per-town goods ledger slice 2
 *  built. A nation-wide local-goods scarcity index `localGoodsScarcity` ∈ [0,1]
 *  (demand-weighted: how short each town is of the manufactured goods it actually
 *  consumes) lifts the monthly inflation target by `localGoodsScarcity ×
 *  LOCAL_GOODS_INFLATION`. EXACTLY 0 in single-town / self-sufficient play (every
 *  town holds what it makes → every local gate is 1 → scarcity 0), so that play is
 *  byte-identical; positive only once SPECIALIZATION strands a cross-sector good in
 *  a multi-town nation (slice 2's intended divergence) — the first time local stock
 *  reaches GDP/inflation. Bounded (the index is ≤1 and the 0.50 inflation ceiling +
 *  0.15 smoothing cap the climb) and a pure sink (inflation feeds confidence/GDP,
 *  never sector output → the raw proxy), so it can't reinforce the shortage. */
export const LOCAL_GOODS_INFLATION = 0.08;

/** PR-3 slice 3 — the LOCAL-goods industry-output drag, the *output* half of the
 *  same coupling (`LOCAL_GOODS_INFLATION` is the price half). A nation that can't
 *  put manufactured goods where they're needed makes less: industry output is
 *  multiplied by `1 − localGoodsScarcity × LOCAL_GOODS_OUTPUT_DRAG`. Small and
 *  bounded — like `SUPPLY_SHOCK_MAX_DRAG` it never zeroes industry, so it can't
 *  itself starve the raw proxy and spiral (a positive output stays positive, and
 *  the trailing output norm follows it so the raw level mean-reverts to ~1). 0 in
 *  single-town/self-sufficient play (scarcity 0) → ×1 → byte-identical there. */
export const LOCAL_GOODS_OUTPUT_DRAG = 0.10;

/** How long (sim days) the 1970s oil-shock anchor embargoes the `oil` raw,
 *  cutting `fuel` and the fuel-burning finals downstream. ~6 months — the real
 *  1973 embargo's span — long enough to register across several monthly supply
 *  ticks so the cascade and the industry drag are felt, not a one-frame blip. */
export const OIL_EMBARGO_DAYS = 180;

/** How deeply the oil-shock anchor cuts the `oil` raw, 0..1 (1 = total). The 1973
 *  embargo wasn't a full shut-off — OPEC trimmed output and prices quadrupled — so
 *  the cascade is a *partial* cut: oil (and `fuel` and the fuel-burning finals
 *  downstream) run at `1 − OIL_EMBARGO_CUT` for the window, not zero. The graded
 *  supply solver carries the fraction through; the industry drag scales with it. */
export const OIL_EMBARGO_CUT = 0.6;

/** Graded extraction proxy (D1-econ): an extracting sector's raw-availability
 *  level grades off how its current output compares to its own trailing norm, so
 *  an *ordinary* contraction — a recession, a disaster, a wartime dip, not just a
 *  total shutdown — partly starves the chain downstream.
 *
 *  - `SECTOR_NORM_ALPHA`: EWMA weight for the per-sector output norm (~0.02 ≈ a
 *    4-year trailing average over monthly ticks). The norm chases output, so a
 *    drag fires on the *transition* into a downturn and heals as the norm catches
 *    up to the new lower level — it bites the shock, not the steady state.
 *  - `RAW_SHORTAGE_DEADBAND`: output within this fraction of norm still reads as
 *    fully available (level 1) — ordinary month-to-month wobble doesn't bite, so
 *    healthy play stays (very nearly) byte-identical.
 *  - `RAW_SHORTAGE_FLOOR` / `RAW_SHORTAGE_MIN_LEVEL`: at/below this output ratio
 *    the graded proxy bottoms out at MIN_LEVEL (not 0 — a *partial* contraction
 *    can't fully cut a raw; only literal zero output does, via the collapse path).
 *    Bounding the floor above 0, plus the 1-month lag and SUPPLY_SHOCK_MAX_DRAG,
 *    keeps the output→raws→drag→output feedback gentle and non-divergent. */
export const SECTOR_NORM_ALPHA = 0.02;
export const RAW_SHORTAGE_DEADBAND = 0.9;
export const RAW_SHORTAGE_FLOOR = 0.5;
export const RAW_SHORTAGE_MIN_LEVEL = 0.35;

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

/** Phase-14 city-service fields (GDD §11), defaulted. Applied SYMMETRICALLY in
 *  serialize() and deserialize() so a save round-trips losslessly: the runtime
 *  settlement-founding sites predate these fields and never set them, so without
 *  a shared normalization serialize would omit (undefined → dropped by JSON)
 *  exactly what deserialize fabricates, and a reloaded save would never byte-match
 *  the in-memory one. Behaviourally inert — the readers already use these same
 *  defaults via `?? `, so making the fields explicit changes no gameplay value. */
export function cityServiceFields(s: Partial<Settlement>) {
  return {
    zoningMix: s.zoningMix ?? { residential: 0.5, commercial: 0.2, industrial: 0.2, office: 0.1 },
    landValue: s.landValue ?? 30,
    pollutionLevel: s.pollutionLevel ?? 0,
    powerCapacity: s.powerCapacity ?? 0,
    powerDemand: s.powerDemand ?? 0,
    waterCoverage: s.waterCoverage ?? 0.5,
    wasteCoverage: s.wasteCoverage ?? 0.3,
    serviceCoverage: s.serviceCoverage ?? { health: 0.3, education: 0.2, safety: 0.2 },
  };
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
  coastal_only?: boolean; // if true, only buildable in coastal settlements
  // Spatial-4X Phase D — Wonders: one-per-EMPIRE placements with a global effect.
  unique?: boolean;                 // empire-wide cap of one (not per-city)
  empireBonus?: number;             // sector output add applied to EVERY town of the owner
  empireSector?: SectorId | 'all';  // which sector empireBonus feeds
  prestige?: number;                // prestige granted to the owner on completion
  desc: string;
}

export const REGION_BUILDINGS: RegionalBuildingDef[] = regionBuildingsJson.buildings as RegionalBuildingDef[];

/** Spatial-4X Phase D — a DISTRICT placement category. Unlike a building (which is
 *  one icon on one hex), a district is a themed zone the player places to designate
 *  a quarter of the city: it grants its sector a flat bonus AND amplifies it for
 *  every same-sector building sited on an adjacent hex (the zoning reward — site the
 *  district at the heart of your matching cluster). One slot per sector per city
 *  (`max`), so placement stays district-scale and strategic. Player-only: the AI
 *  never zones, so a town with no districts is byte-identical to base. */
export interface DistrictDef {
  id: string;
  name: string;
  cost: number;     // £ from the treasury (paid on placement)
  upkeep: number;   // £/month
  max: number;      // per settlement
  prereq?: string;  // tech node id
  sector: SectorId; // themed sector (concrete — 'all' never zones)
  bonus: number;    // flat sector output add the town gains for hosting the district
  desc: string;
}

export const DISTRICT_DEFS: DistrictDef[] =
  (regionBuildingsJson as { districts?: DistrictDef[] }).districts ?? [];

/** A construction site in a managed city: one project at a time per town. */
export interface CityConstruction {
  id: string;      // building def id
  doneDay: number; // absolute day it completes
  cell?: number;   // chosen placement cell (col*REGION_N+row); auto-sited if absent
}

/** A raised building and the hex it occupies (spatial-4X Phase B). */
export interface PlacedBuilding {
  id: string;
  cell: number; // col * REGION_N + row
}

/** Read-only result of `placementPreview` — the output bonuses a building would
 *  earn if sited on a candidate cell, so the placement UI can show WHY one hex
 *  beats another (spatial-4X Phase D). Never affects the sim. */
export interface PlacementPreview {
  sector: SectorId | 'all';
  /** Terrain-match pulse if the cell's terrain suits the building's sector. */
  terrainBonus: number;
  /** Marginal district-synergy gain to the town from adding this building. */
  districtBonus: number;
  /** Marginal district-ZONE lift: extra bonus a placed district earns because this
   *  same-sector building lands on a hex adjacent to it (mirrors `districtZoneBonus`,
   *  capped at DISTRICT_ZONE_CAP). 0 unless the town has zoned a matching district. */
  zoneBonus: number;
  /** terrainBonus + districtBonus + zoneBonus — total output bonus this site grants. */
  total: number;
}

/** Decomposition of a town's per-sector output bonus into its named spatial
 *  sources — the read-only "why does this sector produce what it does" view
 *  behind the city panel. Each field is the additive bonus that source grants
 *  `sector`; `total` is their sum and equals the live `buildingBonus(t, sector)`
 *  bit-for-bit (same summation order), so the displayed numbers can never drift
 *  from the ones that actually drive output. */
export interface SectorBonusBreakdown {
  sector: SectorId;
  /** Flat output bonus from constructed civic/economic buildings. */
  buildings: number;
  /** Worked-ring terrain yield from the surrounding hexes (Phase C). */
  terrain: number;
  /** Terrain-match pulse for placed buildings sited on suiting terrain (Phase C). */
  terrainMatch: number;
  /** Same-sector adjacent-building clustering synergy (Phase D slice 2). */
  districtAdjacency: number;
  /** Placed-district zone bonus — flat quarter + adjacent-cluster reward (Phase D). */
  districtZone: number;
  /** Empire-wide Wonder bonus the owning faction grants every town (Phase D). */
  wonder: number;
  /** Sum of the above — equals buildingBonus(t, sector) exactly. */
  total: number;
}

/** Worked-ring radius (in hexes) a city can place buildings within. District-scale
 *  per the spatial-4X north star — kept small so placement stays strategic. */
export const CITY_WORK_RADIUS = 2;

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
  | 'factory_unrest' | 'tourism_boom' | 'tech_breakthrough' | 'automation_surge'
  // ---- additional events for gameplay variety ----
  | 'immigration_wave' | 'bridge_built' | 'school_founded' | 'vice_boom'
  | 'banking_crisis' | 'commodity_glut' | 'religious_revival' | 'crime_wave'
  | 'conscription_drive' | 'cholera_outbreak' | 'cultural_festival';

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
  // ---- Additional events for gameplay depth ----
  // Population growth
  { kind: 'immigration_wave', name: 'Immigration Wave', sector: 'all', outputMult: 1.10, durationDays: 40, probability: 0.03, satisfaction: 2, minYear: 1880, desc: 'Word spreads of opportunity. Families arrive seeking work. All output +10%.' },
  // Infrastructure milestone
  { kind: 'bridge_built', name: 'Bridge Completed', sector: 'services', outputMult: 1.15, durationDays: 45, probability: 0.02, satisfaction: 2, desc: 'A new crossing knits the region together. Services +15%.' },
  // Education boom
  { kind: 'school_founded', name: 'School Founded', sector: 'information', outputMult: 1.20, durationDays: 50, probability: 0.02, satisfaction: 3, minYear: 1890, desc: 'A school opens its doors. Knowledge spreads, spirits lift. Information +20%.' },
  // Gambling/vice
  { kind: 'vice_boom', name: 'Vice District Boom', sector: 'services', outputMult: 1.25, durationDays: 35, probability: 0.015, satisfaction: -2, grievance: 3, minYear: 1900, desc: 'Taverns and gambling halls fill. Coin flows, morals slip. Services +25%.' },
  // Banking crisis
  { kind: 'banking_crisis', name: 'Banking Crisis', sector: 'services', outputMult: 0.65, durationDays: 30, probability: 0.015, satisfaction: -4, grievance: 3, minYear: 1900, desc: 'A bank fails; savings vanish. Credit freezes. Services -35%.' },
  // Commodity price spike
  { kind: 'commodity_glut', name: 'Market Glut', sector: 'agriculture', outputMult: 0.80, durationDays: 25, probability: 0.02, desc: 'Overproduction floods the market. Prices collapse. Agriculture -20%.' },
  // Religious revival
  { kind: 'religious_revival', name: 'Religious Revival', sector: 'all', outputMult: 1.05, durationDays: 40, probability: 0.015, satisfaction: 2, desc: 'A fervent preacher awakens the faithful. Spirits lift. All output +5%.' },
  // Crime wave
  { kind: 'crime_wave', name: 'Crime Wave', sector: 'all', outputMult: 0.90, durationDays: 30, probability: 0.02, satisfaction: -3, grievance: 2, minYear: 1900, desc: 'Bandits and thieves plague the roads. Trade suffers. All output -10%.' },
  // Military expansion/conscription
  { kind: 'conscription_drive', name: 'Conscription Drive', sector: 'all', outputMult: 0.85, durationDays: 30, probability: 0.015, satisfaction: -2, grievance: 4, minYear: 1910, desc: 'The crown calls up soldiers. Workers march to war. All output -15%.' },
  // Epidemic (different from plague)
  { kind: 'cholera_outbreak', name: 'Cholera Outbreak', sector: 'all', outputMult: 0.70, durationDays: 35, probability: 0.01, satisfaction: -2, grievance: 2, minYear: 1880, desc: 'Cholera strikes the unsanitary districts. All output -30%.' },
  // Cultural event
  { kind: 'cultural_festival', name: 'Grand Festival', sector: 'services', outputMult: 1.15, durationDays: 30, probability: 0.02, satisfaction: 2, desc: 'A festival brings the region together. Music fills the streets. Services +15%.' },
];

// Fast lookups for building and event definitions.
const REGION_BUILDINGS_MAP = new Map(REGION_BUILDINGS.map((b) => [b.id, b]));
const DISTRICT_DEFS_MAP = new Map(DISTRICT_DEFS.map((d) => [d.id, d]));
// Spatial-4X Phase D slice 1b — per-update chance a rich, era-ready rival faction
// bids for an unclaimed Wonder (scaled by the difficulty techMult). aiRng-gated.
const RIVAL_WONDER_CHANCE = 0.1;
// Spatial-4X — per-update chance a rival faction DEVELOPS one of its towns: raises
// an era-ready building on its best-fitting hex, or zones a district on an
// established same-sector cluster (scaled by techMult, aiRng-gated). This is what
// finally makes the AI PLAY SPATIALLY — before it, rivals owned land but never
// built on it, so every spatial bonus (terrain-match, district adjacency/zones)
// was dormant in autoplay and the headless balance suite tested a different game
// than a human plays. Development spends only the SURPLUS above the famine reserve
// (see RIVAL_RESERVE_MONTHS) so it can never starve emergency grain. Intentional
// headless re-baseline — rivals are now genuine spatial builders.
const RIVAL_BUILD_CHANCE = 0.5;
// Fraction of a rival's own town output collected into its faction treasury each
// month (the rival analogue of the player's tax take). Tuned so a developing
// rival accrues enough to expand, advance, and fund full-price Wonders without
// ballooning — rivals run the same economy as the player, just without the
// player's nation-tier policy/central-bank/services machinery.
const RIVAL_TAX_RATE = 0.06;
// Ceiling on a rival's abstract `techProgress` float. It feeds militaryStrength
// (×(1+tech·0.05)); with rivals now on a real (large) treasury the uncapped
// value ran into the thousands → a 200×+ army. ~30 ≈ a fully-teched nation:
// rivals advance far past their old single-digit ceiling, but stay pop-bounded.
const RIVAL_TECH_CAP = 30;
// Wagner-style state-cost sink. Rivals lack the player's policy/services/welfare/
// central-bank machinery, so without a recurring drain they bank nearly the whole
// 6% tax take and balloon to ~2 months of (enormous) late-game output. BUT the
// rival treasury is also the FAMINE SHOCK-ABSORBER — emergency grain is paid from
// the faction purse, and late-game climate warming drives widespread starvation —
// so a flat output-share charge that fires during a crisis drains the purse to 0,
// grain stops, and the population collapses (a death spiral, seen in testing).
// Instead the state spends down only the SURPLUS above a prudent reserve that
// scales with the economy, and STANDS DOWN entirely when the treasury dips below
// that reserve (a crisis). This caps the hoard near ~1.5 months of output without
// ever touching the buffer the rival needs to feed its people. Plus a tiny flat
// per-settlement admin charge mirroring the player's `settlements.length * 5`.
const RIVAL_RESERVE_MONTHS = 1.5; // months of output kept untouched (famine relief, expansion, Wonders)
// Floor (months of output) below which a rival will NOT spend on spatial
// development. Far lower than the state-cost reserve because the state cost holds
// the hoard near 1.5 months, so a development gate set there would never see any
// surplus and the AI would never build. 0.5 months still dwarfs the actual famine
// draw — emergency grain runs ~pop·0.45/mo ≈ ~0.01 months of output — so building
// down to this floor leaves a ~50× grain buffer and cannot trigger a death spiral.
const RIVAL_DEV_RESERVE_MONTHS = 0.5;
const RIVAL_SURPLUS_SKIM = 0.25; // monthly fraction of the above-reserve surplus the state spends down
const RIVAL_ADMIN_PER_TOWN = 5; // gold/settlement/month — mirrors the player's `settlements.length * 5`
// Spatial-4X — personality-driven sector lean for a rival's spatial buildout. Before
// this, EVERY rival picked buildings by pure terrain fit, so a Merchant Republic and
// a Military Junta on the same land built the SAME town — the AI played spatially but
// played the SAME spatially. These weights are a modest thumb on the terrain-fit score
// (each ≤ a strong terrain yield, so a rival still builds to its land — the lean only
// tips close calls and reorders the build sequence), derived PURELY from existing
// serialized faction fields (regime bloc + tech focus + belligerence): no RNG and no
// new serialized state, so the determinism and save-size gates stay green. The point is
// to make rival town ECONOMIES diverge by who the rival is — an intentional headless
// re-baseline that widens the spread the spatial layer produces.
const BUILD_LEAN_BLOC = 0.08;   // a regime bloc's pull toward its signature sector
const BUILD_LEAN_FOCUS = 0.05;  // the faction's research focus (mining/forestry/farming) nudge
const BUILD_LEAN_AGGR = 0.04;   // a belligerent power's extra weight on a war (industry) economy
const BUILD_LEAN_AGGR_THRESHOLD = 60; // aggressiveness at/above which the war-economy nudge applies
// The same personality lean (factionBuildLean) also pulls a rival toward the TERRAIN
// that feeds its signature sector when siting a new town (agri→fertile/river,
// industry→mountain/forest, services→coastal/river). Scaled into the expansion-site
// score's units (~base 50 + terrain bonuses 2–5 + goal bias 20) so it only tips close
// calls — a strong goal bias or the spacing penalty still dominates.
const EXPAND_LEAN_SCALE = 30;
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

export type LegacyFactionId = 'workers' | 'landowners' | 'merchants';

export interface Faction {
  id: LegacyFactionId;
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
  // ---- Phase 11: Renewables, Automation & Carbon Pricing ----
  {
    id: 'carbon_pricing',
    name: 'Carbon Pricing Scheme',
    cost: 45,
    prereqs: ['carbon_tax'],
    requiresState: true,
    requiresNation: true,
    domain: 'economic',
    desc: 'A rising carbon price regime covering the full economy. National emissions ×0.75; treasury +2% GDP monthly. Stranded-asset write-downs begin.',
  },
  {
    id: 'cap_trade_law',
    name: 'Cap-and-Trade Legislation',
    cost: 55,
    prereqs: ['cap_and_trade', 'carbon_pricing'],
    requiresState: true,
    requiresNation: true,
    domain: 'economic',
    desc: 'Hard ceiling on annual emissions, descending 5%/year. Permits trade at market rates. Fastest decarbonization path — but stranded-asset losses accelerate.',
  },
  {
    id: 'green_industry_act',
    name: 'Green Industry Act',
    cost: 60,
    prereqs: ['green_industrial_policy'],
    requiresState: true,
    requiresNation: true,
    domain: 'economic',
    desc: 'State-backed clean manufacturing. Industry output +20%; stranded-asset losses buffered by treasury. Unlocks the solarpunk branch at 2040.',
  },
  {
    id: 'universal_basic_support',
    name: 'Universal Basic Support',
    cost: 50,
    prereqs: ['ai_automation', 'welfare_benefits'],
    requiresState: true,
    requiresNation: true,
    domain: 'social',
    desc: 'A monthly stipend for automation-displaced workers. Satisfaction +4 everywhere; automationUnemployment drift halved. Treasury −£2/month per 100 citizens.',
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

export type GovType =
  | 'democracy' | 'republic' | 'junta' | 'monarchy'
  | 'const_monarchy' | 'abs_monarchy' | 'oligarchy' | 'theocracy'
  | 'direct_democracy' | 'corporatocracy' | 'fascist'
  | 'social_democracy' | 'autocracy' | 'one_party' | 'technocracy';

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
  /** Compatible govLean values (empty = any). */
  allowedLeanings: string[];
  /** Earliest year this regime can emerge. */
  minYear?: number;
  /** After this year the regime can no longer be newly adopted (historical window). */
  maxYear?: number;
  /** Multiplier on monthly legitimacy decay. */
  legitimacyDecayModifier: number;
  /** Max policy slots. */
  maxSlots: number;
}

export interface TransitionStep {
  id: string;
  description: string;
  factionResistance: { factionId: string; resistance: number }[];
  capitalCost: number;
  violenceRisk: number;   // 0–1 probability of unrest spike
  internationalReaction: number;  // −30 to +15 relations change
}

export interface TransitionChain {
  fromGov: string;
  toGov: string;
  steps: TransitionStep[];
  currentStep: number;
}

export const TRANSITION_CHAINS: Record<string, TransitionStep[]> = {
  'junta:democracy': [
    { id: 'announce_elections', description: 'Announce election timeline', factionResistance: [{ factionId: 'militarists', resistance: 15 }], capitalCost: 20, violenceRisk: 0.05, internationalReaction: 8 },
    { id: 'constitutional_assembly', description: 'Hold constitutional assembly', factionResistance: [{ factionId: 'militarists', resistance: 10 }, { factionId: 'nationalists', resistance: 8 }], capitalCost: 40, violenceRisk: 0.2, internationalReaction: 15 },
    { id: 'first_elections', description: 'Hold first free elections', factionResistance: [{ factionId: 'militarists', resistance: 25 }], capitalCost: 30, violenceRisk: 0.1, internationalReaction: 12 },
  ],
  'abs_monarchy:democracy': [
    { id: 'royal_concession', description: 'Crown issues constitutional concession', factionResistance: [{ factionId: 'monarchists', resistance: 20 }, { factionId: 'conservatives', resistance: 10 }], capitalCost: 30, violenceRisk: 0.1, internationalReaction: 5 },
    { id: 'parliament_formed', description: 'Parliament convened with limited franchise', factionResistance: [{ factionId: 'monarchists', resistance: 15 }], capitalCost: 25, violenceRisk: 0.15, internationalReaction: 10 },
    { id: 'universal_suffrage_granted', description: 'Universal suffrage proclaimed', factionResistance: [{ factionId: 'monarchists', resistance: 30 }, { factionId: 'oligarchs', resistance: 20 }], capitalCost: 50, violenceRisk: 0.25, internationalReaction: 15 },
  ],
  'monarchy:democracy': [
    { id: 'royal_concession', description: 'Crown issues constitutional concession', factionResistance: [{ factionId: 'monarchists', resistance: 20 }], capitalCost: 30, violenceRisk: 0.1, internationalReaction: 5 },
    { id: 'parliament_formed', description: 'Parliament convened with limited franchise', factionResistance: [{ factionId: 'monarchists', resistance: 15 }], capitalCost: 25, violenceRisk: 0.15, internationalReaction: 10 },
    { id: 'universal_suffrage_granted', description: 'Universal suffrage proclaimed', factionResistance: [{ factionId: 'monarchists', resistance: 30 }], capitalCost: 50, violenceRisk: 0.25, internationalReaction: 15 },
  ],
  'autocracy:democracy': [
    { id: 'liberalization', description: 'Announce liberalization program', factionResistance: [{ factionId: 'militarists', resistance: 10 }], capitalCost: 25, violenceRisk: 0.1, internationalReaction: 10 },
    { id: 'opposition_legalized', description: 'Legalize opposition parties', factionResistance: [{ factionId: 'militarists', resistance: 15 }, { factionId: 'nationalists', resistance: 10 }], capitalCost: 35, violenceRisk: 0.2, internationalReaction: 12 },
    { id: 'free_vote', description: 'Hold multiparty elections', factionResistance: [{ factionId: 'militarists', resistance: 20 }], capitalCost: 40, violenceRisk: 0.15, internationalReaction: 15 },
  ],
};

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
    allowedLeanings: ['liberal', 'social'],
    legitimacyDecayModifier: 0.8,
    maxSlots: 4,
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
    allowedLeanings: [],
    legitimacyDecayModifier: 0.9,
    maxSlots: 4,
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
    allowedLeanings: ['nationalist', 'conservative'],
    legitimacyDecayModifier: 1.2,
    maxSlots: 3,
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
    allowedLeanings: ['conservative', 'reactionary'],
    legitimacyDecayModifier: 1.1,
    maxSlots: 3,
  },
  {
    id: 'const_monarchy',
    name: 'Constitutional Monarchy',
    legitimacySource: 'Royal tradition and parliamentary consent',
    electionsRequired: true,
    taxCap: 26,
    militiaBonus: 1,
    startingLegitimacy: 77,
    policySlots: ['economic', 'social', 'security', 'diplomatic'],
    allowedLeanings: ['conservative', 'liberal'],
    legitimacyDecayModifier: 0.85,
    maxSlots: 4,
  },
  {
    id: 'abs_monarchy',
    name: 'Absolute Monarchy',
    legitimacySource: 'Divine right and dynastic tradition',
    electionsRequired: false,
    taxCap: 22,
    militiaBonus: 1,
    startingLegitimacy: 75,
    policySlots: ['economic', 'security', 'social'],
    allowedLeanings: ['conservative', 'reactionary'],
    legitimacyDecayModifier: 1.1,
    maxSlots: 3,
  },
  {
    id: 'oligarchy',
    name: 'Oligarchy',
    legitimacySource: 'Wealth and merchant class dominance',
    electionsRequired: false,
    taxCap: 20,
    militiaBonus: 0,
    startingLegitimacy: 65,
    policySlots: ['economic', 'economic', 'diplomatic'],
    allowedLeanings: ['liberal', 'conservative'],
    legitimacyDecayModifier: 1.0,
    maxSlots: 3,
  },
  {
    id: 'theocracy',
    name: 'Theocracy',
    legitimacySource: 'Religious authority and divine mandate',
    electionsRequired: false,
    taxCap: 24,
    militiaBonus: 1,
    startingLegitimacy: 78,
    policySlots: ['social', 'security', 'economic'],
    allowedLeanings: ['reactionary', 'conservative'],
    legitimacyDecayModifier: 0.9,
    maxSlots: 3,
  },
  {
    id: 'direct_democracy',
    name: 'Direct Democracy',
    legitimacySource: 'Popular assemblies and referenda',
    electionsRequired: true,
    taxCap: 28,
    militiaBonus: 0,
    startingLegitimacy: 82,
    policySlots: ['economic', 'social', 'security', 'diplomatic'],
    allowedLeanings: ['liberal', 'socialist'],
    legitimacyDecayModifier: 0.7,
    maxSlots: 4,
  },
  {
    id: 'corporatocracy',
    name: 'Corporatocracy',
    legitimacySource: 'Corporate shareholder approval',
    electionsRequired: false,
    taxCap: 22,
    militiaBonus: 0,
    startingLegitimacy: 68,
    policySlots: ['economic', 'economic', 'diplomatic', 'security'],
    allowedLeanings: ['liberal', 'conservative'],
    legitimacyDecayModifier: 1.1,
    maxSlots: 4,
  },
  {
    id: 'fascist',
    name: 'Fascist State',
    legitimacySource: 'Ultranationalist mass movement and military glory',
    electionsRequired: false,
    taxCap: 35,
    militiaBonus: 3,
    startingLegitimacy: 70,
    policySlots: ['security', 'security', 'economic'],
    allowedLeanings: ['nationalist', 'reactionary'],
    minYear: 1925,
    maxYear: 1955,
    legitimacyDecayModifier: 1.5,
    maxSlots: 3,
  },
  {
    id: 'social_democracy',
    name: 'Social Democracy',
    legitimacySource: 'Democratic mandate and welfare provision',
    electionsRequired: true,
    taxCap: 30,
    militiaBonus: 0,
    startingLegitimacy: 80,
    policySlots: ['economic', 'social', 'social', 'diplomatic'],
    allowedLeanings: ['liberal', 'socialist'],
    legitimacyDecayModifier: 0.8,
    maxSlots: 4,
  },
  {
    id: 'autocracy',
    name: 'Autocracy',
    legitimacySource: 'Strongman authority and loyal apparatus',
    electionsRequired: false,
    taxCap: 32,
    militiaBonus: 2,
    startingLegitimacy: 65,
    policySlots: ['security', 'economic', 'social'],
    allowedLeanings: ['nationalist', 'conservative', 'reactionary'],
    legitimacyDecayModifier: 1.3,
    maxSlots: 3,
  },
  {
    id: 'one_party',
    name: 'One-Party State',
    legitimacySource: 'Party ideology and planned achievement',
    electionsRequired: false,
    taxCap: 35,
    militiaBonus: 2,
    startingLegitimacy: 72,
    policySlots: ['economic', 'security', 'social'],
    allowedLeanings: ['nationalist', 'socialist', 'reactionary'],
    legitimacyDecayModifier: 1.2,
    maxSlots: 3,
  },
  {
    id: 'technocracy',
    name: 'Technocracy',
    legitimacySource: 'Expert consensus and measurable outcomes',
    electionsRequired: false,
    taxCap: 28,
    militiaBonus: 1,
    startingLegitimacy: 74,
    policySlots: ['economic', 'economic', 'security', 'social'],
    allowedLeanings: ['liberal', 'technocratic'],
    minYear: 1950,
    legitimacyDecayModifier: 0.95,
    maxSlots: 4,
  },
];

export type MinisterRoleId = 'interior' | 'treasury' | 'defence' | 'war' | 'press' | 'science' | 'foreign';

export interface MinisterAssignment {
  role: MinisterRoleId;
  title: string;
  notableId: number | null;
}

export const MINISTER_ROLES: { id: MinisterRoleId; title: string; bonus: string }[] = [
  { id: 'interior', title: 'Interior Minister', bonus: 'services 15% more effective' },
  { id: 'treasury', title: 'Treasury Secretary', bonus: 'tax collection +10%' },
  { id: 'defence', title: 'Defence Minister', bonus: 'militia 20% stronger' },
  { id: 'war', title: 'War Minister', bonus: 'army effectiveness +15%' },
  { id: 'press', title: 'Press Secretary', bonus: 'legitimacy decay −25% slower' },
  { id: 'science', title: 'Science Minister', bonus: 'research rate +15%' },
  { id: 'foreign', title: 'Foreign Secretary', bonus: 'envoy relations +5; treaty costs −15%' },
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
export const RIVAL_ARCHETYPES: Record<RivalArchetype, { name: string; desc: string; weights: RivalPersonality }> = {
  hegemon: {
    name: 'the Hegemon',
    desc: 'Seeks regional dominance through military might and territorial expansion. Risks conflict to strengthen position.',
    weights: { expansion: 9, commerce: 4, ideology: 5, honor: 4, risk: 7, grudge: 5 },
  },
  trading_republic: {
    name: 'the Trading Republic',
    desc: 'Values commerce and stable trade routes above all else. Prefers negotiation and mutual prosperity over conflict.',
    weights: { expansion: 3, commerce: 9, ideology: 3, honor: 7, risk: 3, grudge: 3 },
  },
  hermit_kingdom: {
    name: 'the Hermit Kingdom',
    desc: 'Fiercely independent and isolationist. Holds grudges deeply and avoids entanglement with foreign powers.',
    weights: { expansion: 2, commerce: 2, ideology: 6, honor: 6, risk: 2, grudge: 8 },
  },
  crusader_state: {
    name: 'the Crusader State',
    desc: 'Driven by ideology and cultural mission. Builds alliances with like-minded powers to spread influence.',
    weights: { expansion: 6, commerce: 3, ideology: 9, honor: 5, risk: 6, grudge: 6 },
  },
  opportunist: {
    name: 'the Opportunist',
    desc: 'Adaptable and unpredictable. Profits from others\' misfortunes while avoiding direct commitment.',
    weights: { expansion: 6, commerce: 6, ideology: 2, honor: 2, risk: 9, grudge: 4 },
  },
};

export type TreatyKind = 'non_aggression' | 'trade_agreement' | 'defensive_pact' | 'climate_accord';

// ---- Monetary system types (GDD §5.1) ----
export type CreditRating = 'AAA' | 'AA' | 'A' | 'BBB' | 'BB' | 'B' | 'CCC' | 'D';
export type MonetaryRegime = 'float' | 'peg' | 'print';
/** Emergency tools the player can wield while a depression is active (GDD §8.1). */
export type DepressionMeasure = 'qe' | 'gold' | 'publicworks';

/** Static descriptors for the depression-response toolkit, so the UI and sim
 *  share one source of truth for titles, blurbs, and effect summaries. */
export const DEPRESSION_MEASURES: {
  id: DepressionMeasure; title: string; blurb: string; effect: string;
}[] = [
  {
    id: 'qe',
    title: 'Emergency Easing',
    blurb: 'Slash the policy rate and flood the banks with liquidity.',
    effect: 'depth −20% · confidence +6 · inflation +3pts · needs Central Bank',
  },
  {
    id: 'gold',
    title: 'Leave the Gold Standard',
    blurb: 'Float the currency and let it devalue to reignite exports.',
    effect: 'depth −22% · exports surge · short confidence dip',
  },
  {
    id: 'publicworks',
    title: 'Public Works Programme',
    blurb: 'Hire the idle directly — dams, roads, and power lines.',
    effect: 'depth −18% · grievance −12 · jobs restored · costs the treasury',
  },
];

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

/** Appetite bonus (diplomatic points) an *embattled* rival — `rivalSituation > 0`,
 *  i.e. fighting a foreign war — gains for treaties that shore it up: it fears a
 *  second front and needs income and allies, so it signs protection and trade more
 *  readily. ADDITIVE (not multiplicative), so the lift applies even to a treaty the
 *  rival's temperament normally dislikes (a negative base appetite), and exactly 0
 *  at peace (`rivalSituation` 0) → the deal verdict is byte-identical in all current
 *  play and every existing diplomacy test (none of which sets a foreign war). */
export const SITUATION_TREATY_BONUS: Partial<Record<TreatyKind, number>> = {
  defensive_pact: 4,
  non_aggression: 3,
  trade_agreement: 2,
};

// ---- Monetary system constants (GDD §5.1) ----
/** Credit-neutral policy rate; below this leverage builds, above it contracts. */
export const NEUTRAL_RATE = 0.05;
// Minsky instability dials — pulled from TUNING so they can be adjusted without
// touching region.ts (see TUNING.leverageFragile / fragilityGain in defs.ts).
// Exported for systems/monetary.ts (the tickMonetary/tickFX seam).
export const LEVERAGE_FRAGILITY = TUNING.leverageFragility;
export const LEVERAGE_FRAGILE   = TUNING.leverageFragile;
export const FRAGILITY_GAIN     = TUNING.fragilityGain;
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
  /** Player-scout fields — AI scouts leave these undefined. */
  name?: string;             // display name ("Fox", "Wren", etc.)
  autoExplore?: boolean;     // true = move toward unexplored tiles (default for new player scouts)
  manualTargetX?: number;    // explicit waypoint in 0..100 coords
  manualTargetY?: number;
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
  /** Player's intelligence penetration of this rival, 0..1 (espionage, GDD §5.5). */
  intel?: number;
  /** Cooldown gate for covert operations against this rival. */
  lastEspionageDay?: number;
  /** National flag colors and emblem (from named rival definitions). */
  flagData?: {
    primary: string;
    secondary: string;
    emblem: string;
    symbol: string;
  };
}

/** A war between two rival powers — the player reads about it, and sells into it. */
export interface ForeignWar {
  a: number; // rival ids
  b: number;
  startedDay: number;
  endsDay: number;
}

/** Named rival nation definition (loaded from rival_nations.json). */
export interface RivalNationDef {
  id: string;
  name: string;
  leader: string;
  archetype: RivalArchetype;
  regimeId: string;
  description: string;
  flag: {
    primary: string;
    secondary: string;
    emblem: string;
    symbol: string;
  };
  startingBonuses: {
    [key: string]: number | string;
  };
  traits: string[];
  agenda: string;
  personality: RivalPersonality;
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

// ---- Espionage (GDD §5.5: the shadow war) ----

/** Covert operations the player can run against a rival nation. */
export type EspionageOp = 'gather_intel' | 'steal_tech' | 'sabotage_economy' | 'incite_unrest';

export interface EspionageOpDef {
  name: string;
  short: string;
  cost: number;          // £ to attempt
  intelRequired: number; // 0..1 minimum intel on the target to attempt
  baseSuccess: number;   // 0..1 base success before the intel bonus
  exposureRisk: number;  // 0..1 base chance of being caught
  desc: string;
}

export const ESPIONAGE_OPS: Record<EspionageOp, EspionageOpDef> = {
  gather_intel: {
    name: 'Gather Intelligence', short: 'spy', cost: 30, intelRequired: 0, baseSuccess: 0.85, exposureRisk: 0.05,
    desc: 'Plant agents in their chanceries. Raises your intel on the target, improving every later operation.',
  },
  steal_tech: {
    name: 'Steal Technology', short: 'steal', cost: 120, intelRequired: 0.4, baseSuccess: 0.55, exposureRisk: 0.25,
    desc: 'Industrial espionage: lift their blueprints. Pushes your current research sharply forward (or a treasury windfall).',
  },
  sabotage_economy: {
    name: 'Sabotage Economy', short: 'sabotage', cost: 100, intelRequired: 0.5, baseSuccess: 0.55, exposureRisk: 0.35,
    desc: 'Burn a warehouse district. Sets the rival nation back — and risks a war if your hand is seen.',
  },
  incite_unrest: {
    name: 'Incite Unrest', short: 'incite', cost: 90, intelRequired: 0.5, baseSuccess: 0.5, exposureRisk: 0.3,
    desc: 'Fund dissidents and sow discord. Damages the rival and can fracture one of their alliances.',
  },
};

/** Days between covert operations against the same rival. */
export const ESPIONAGE_COOLDOWN_DAYS = 120;

/** Outcome of a covert operation, surfaced to the UI. */
export interface EspionageResult {
  ok: boolean;       // was the operation attempted at all
  success: boolean;  // did it achieve its goal
  exposed: boolean;  // were we caught (relations fallout)
  reason: string;    // human-readable outcome or refusal
}

// ---- Trade blocs (GDD §6.5: economic alliances beyond the bilateral pact) ----

/** A named multi-member economic union the player founds with trade partners. */
export interface TradeBloc {
  id: number;
  name: string;
  /** Rival ids in the bloc; the player is the implicit founding member. */
  memberRivalIds: number[];
  foundedYear: number;
  /** Shared external tariff 0..0.5: higher = more revenue, slow cooling with outsiders. */
  sharedTariff: number;
}

/** A rival must be at least this warm and hold a trade agreement to join a bloc. */
export const BLOC_RELATIONS_FLOOR = 40;
export const BLOC_FORM_COST = 200;

// ---- Phase 5: Province-level governance (GDD §5.6) ----

/** Administrative policy for a player-controlled province (= settlement). */
export interface HexProvincePolicy {
  /** Local tax multiplier 0.5–2.0; scales treasury income collected from this province. */
  taxMultiplier: number;
  /** Infrastructure investment 0–2 (low / medium / high); high accelerates garrison growth. */
  investmentLevel: number;
  /** Autonomy level 0–2 (administered / semi-autonomous / self-governing);
   *  higher autonomy raises satisfaction but reduces direct tax efficiency. */
  autonomyLevel: number;
}
export const DEFAULT_PROVINCE_POLICY: HexProvincePolicy = { taxMultiplier: 1.0, investmentLevel: 1, autonomyLevel: 0 };

// ---- Phase 6: Rival-side economic diplomacy ----

/** A trade bloc formed autonomously among rival nations (separate from the player's bloc). */
export interface RivalTradeBloc {
  id: number;
  memberRivalIds: number[];
  foundedYear: number;
  /** External tariff 0..0.5 applied to the player's exports into member nations. */
  tariff: number;
}

/** An economic sanction between nations: suppresses bilateral trade. */
export interface Sanction {
  /** Who imposed it (0 = player, else rivalId). */
  imposerId: number;
  /** Who is being sanctioned (0 = player, else rivalId). */
  targetId: number;
  startDay: number;
  /** −1 = indefinite; positive = lifted automatically at this day. */
  untilDay: number;
  /** Fraction 0..1 of normal bilateral trade income suppressed. */
  tradeReduction: number;
}

// ---- Phase 7: Inter-provincial unit movement ----

/** An army stationed in or marching between provinces (settlement-level geography). */
export interface ProvincialArmy {
  id: number;
  /** 0 = player; else the rival's id. */
  ownerId: number;
  /** Current province (settlement id). */
  provinceId: number;
  /** Province the army is marching toward; null = stationed in place. */
  destinationId: number | null;
  /** Days remaining until the army arrives at its destination. */
  transitDays: number;
  units: ArmyUnit[];
  /** Food/ammo remaining (months of supply). */
  supply: number;
}

// ---- War (GDD §7): casus belli → mobilization → war score → negotiated peace ----

/** Why we fight (GDD §7.1): CB quality sets home-front war support at declaration. */
export type CasusBelli = 'sponsored_raids' | 'border_dispute' | 'fabricated' | 'revanchism';

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
  revanchism: {
    name: 'Revanchism', support: 85,
    desc: 'They dictated humiliating terms last time. The home front has not forgotten — this war needs no pretext.',
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
  warship: { recruitCost: 80, trainingDays: 45, powerPerUnit: 3.0, supplyCost: 0.10 },
};

/** Unit types for armies: different training, equipment, supply needs. */
export type ArmyUnitType = 'militia' | 'cavalry' | 'artillery' | 'warship';

/** Recruited army units: type, count, morale. */
export interface ArmyUnit {
  type: ArmyUnitType;
  count: number;
  morale: number; // 0–100; affects combat power, desertion risk
  suppliedDays: number; // food/ammo remaining at current supply rate
}

// ---- Phase 16: Warfare System Depth (GDD §7) ----

/** Casus Belli type for Phase 16 structured CB system. */
export type CBType = 'border_dispute' | 'treaty_violation' | 'protect_ideology' | 'resource_denial' | 'fabricated' | 'revanchism';

/** A structured casus belli with effects (Phase 16). */
export interface CBDef {
  type: CBType;
  targetRivalId: number;
  warSupportBonus: number; // added to warSupport at declaration
  reputationCost: number;  // 0 for legitimate, 15–30 for fabricated
}

/** Army Group — higher-resolution unit replacing ProvincialArmy for Phase 16 battles. */
export interface ArmyGroup {
  id: number;
  ownerId: number;         // 0=player, rivalId for rivals
  provinceId: number;
  destinationId?: number;
  transitDays: number;
  manpower: number;        // number of soldiers
  equipmentLevel: number;  // 0–100, based on industry output
  supply: number;          // 0–1; decays in overextended positions
  doctrine: number;        // 0–100; from tech tree (military_doctrine tech)
  morale: number;          // 0–100; decays on losses, rallies on victories
  /** Flag: did this group win a battle this month? */
  wonBattleThisMonth?: boolean;
}

/** Peace term for Phase 16 structured peace negotiation. */
export interface PeaceTermDef {
  type: 'annex_province' | 'reparations' | 'dmz' | 'puppet' | 'status_quo';
  provinceId?: number;   // for annex_province
  amount?: number;       // for reparations tranches
  warScoreCost: number;
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
  /** Front position mirroring war score: positive = we hold the initiative,
   *  negative = we are pushed back. Write-only scaffold; future Front system reads it. */
  front?: { position: number };
}

/** Regime × war (GDD §7.5): below this floor the war eats the regime;
 *  15 below it, the home front breaks and the war ends on dictated terms. */
export const WAR_SUPPORT_FLOOR: Record<GovType, number> = {
  democracy: 45, republic: 45, monarchy: 35, junta: 25,
  const_monarchy: 40, abs_monarchy: 35, oligarchy: 30, theocracy: 40,
  direct_democracy: 50, corporatocracy: 30, fascist: 20,
  social_democracy: 48, autocracy: 20, one_party: 20, technocracy: 35,
};

/** Monthly war-support decay multiplier by regime — all 1.0 now (no-op scaffold);
 *  tune non-1.0 values to differentiate regimes without a re-baseline. */
/** Per-government war-support decay multiplier. <1 = support decays slower (propaganda/control);
 *  >1 = support decays faster (public accountability). Tuned to regime accountability model. */
export const WAR_SUPPORT_DECAY_MULT: Record<GovType, number> = {
  // High accountability: opposition can voice anti-war sentiment
  direct_democracy:  1.5, // every vote counts; casualties trigger immediate backlash
  democracy:         1.3,
  social_democracy:  1.2,
  republic:          1.1,
  // Neutral: mixed accountability
  const_monarchy:    1.0,
  monarchy:          1.0,
  oligarchy:         1.0,
  corporatocracy:    0.9, // war if it's profitable — lobbies dampen backlash
  technocracy:       0.9, // efficiency narrative insulates the regime
  theocracy:         0.8, // holy war framing sustains support
  // Low accountability: regime suppresses dissent
  abs_monarchy:      0.75,
  autocracy:         0.7,
  junta:             0.65, // military culture normalizes conflict
  one_party:         0.60,
  fascist:           0.55, // propaganda + censorship: support barely decays
};

/** Bookkeeping record written when a war ends (GDD §7 post-war state). */
export interface WarScar {
  rivalId: number;
  rivalName: string;
  yearEnded: number;
  outcome: 'victory' | 'defeat' | 'negotiated' | 'status_quo';
  occupied: number;
  casualties: number;
  durationMonths: number;
}

const RIVAL_NAMES = [
  'Vasterholm', 'Karelia', 'Tyrennia', 'Meridia', 'Vossland', 'Cantara',
  'Drovny', 'Ilvermoor', 'Skarov', 'Aldenne',
  'Rethmark', 'Castrion', 'Solvik', 'Tevendale', 'Northhope', 'Estmarch',
  'Ravensfort', 'Kingstead', 'Silvermoor', 'Grandholm', 'Wynchester', 'Trelaine',
  'Ironbound', 'Eastwick', 'Summerlake', 'Windcross', 'Stonehart', 'Brightholm',
];
const RIVAL_LEADERS = [
  'Chancellor Aldric', 'Doge Maren', 'King Osric III', 'Marshal Veka',
  'First Citizen Roux', 'Queen Ilsabet', 'Patriarch Symeon', 'General Brandt',
  'Premier Olenka', 'Lord Protector Hale',
  'Duke Thorsten', 'Countess Verena', 'Burgmeister Klaus', 'Admiral Gryffin',
  'Cardinal Silas', 'Empress Theodora', 'Warlord Ragnar', 'Baroness Elspeth',
  'High Consul Marcus', 'Captain-General Vittoria', 'Prince Valdemar', 'Chieftain Aoife',
  'Archon Lysander', 'Magistrate Cornelius', 'Senator Livia', 'Khan Temüjin',
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
  'risen from merchant guilds that pooled their wealth into statehood',
  'a breakaway province seeking independence from imperial rule',
  'built by refugees fleeing religious persecution across the sea',
  'a tribal confederation that adopted the trappings of civilization',
  'established through colonial conquest and held by military might',
  'a city-state that conquered its hinterland and kept expanding',
  'a federation of farming communes that grew into a national power',
  'forged by a visionary who united warring clans under one banner',
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

/** A FactionGoal's `successCondition` is a closure that JSON.stringify drops, so a
 *  saved goal reloads without it. The continued run still holds the function and
 *  evaluates it at the yearly goal-check (awarding treasury / logging "achieves
 *  ambition"); a reloaded run, missing it, silently scored `false` — a real
 *  save/load DIVERGENCE that surfaced once rivals ran a real economy and actually
 *  pursued goals. Every condition is a pure closure over (faction, region), so we
 *  rebuild an id→condition registry by probing the generators across a grid of
 *  faction/era profiles wide enough to trip every gate (some are upper-bounded:
 *  `treasury < 150`, `settlements < 3`, `year < 1950/1960`). Re-attached on load. */
const GOAL_CONDITION_BY_ID: Record<string, FactionGoal['successCondition']> = (() => {
  const map: Record<string, FactionGoal['successCondition']> = {};
  const treasuries = [100, 250, 1_000_000];
  const settlementSets = [[1], [1, 2], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]];
  const years = [1850, 1920, 1945, 1958, 2000, 2080];
  for (const treasury of treasuries) {
    for (const settlementIds of settlementSets) {
      for (const year of years) {
        const probeF = { treasury, settlementIds, regime: 'junta' } as unknown as RegionalFaction;
        const probeR = { year } as unknown as RegionSim;
        for (const gen of FACTION_GOAL_GENERATORS) {
          try {
            const g = gen(probeF, probeR);
            if (g && !(g.id in map)) map[g.id] = g.successCondition;
          } catch { /* generator touched a field the probe lacks; another profile will catch it */ }
        }
      }
    }
  }
  return map;
})();

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
  skill: number;          // 0-100
  health: number;         // 0-100
  deathYear?: number;
  children: number[];     // ids of child Notables
  parentId?: number;      // id of parent Notable
  loyalty: number;        // 0-100
  factionAlignment?: string; // 'workers' | 'merchants' | 'landowners' | 'military'
  backstory?: string;     // founding backstory blurb
  yearEnteredRole?: number; // year they entered their current role
  monthsIgnored?: number; // months portfolio has been neglected (for loyalty decay)
}

export interface DynastyNode {
  id: number;
  name: string;
  parentId?: number;
  birthYear: number;
  deathYear?: number;
  role?: string;
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
export const RAIL_ERA_YEAR = 1924; // post-WWI rail expansion era — new nations lay their first lines in the 1920s

/** The asphalt age (transportation.md §5): cheap paved highways from 1945
 *  erode rail's monopoly — less throughput than steel, a third the upkeep. */
export const HIGHWAY_ERA_YEAR = 1945;

/** The speculative era (transportation.md §5): maglev/automated freight
 *  from 2005 — colossal to build, nearly free to run once it floats. */
export const MAGLEV_ERA_YEAR = 2005;

/** A rotted route is still a walkable track — people keep using it.
 *  Exported for systems/military.ts (tickPlayerWar's interdiction). */
export const ROUTE_CONDITION_FLOOR = 15;

// ---- Climate & the reckoning (GDD §8.2, §3.2 eras 7–8) ----

/** Atmospheric CO₂ at the wagon's arrival, 1900 (GDD §8.2). */
export const CO2_BASE_PPM = 295;
/** Warming equilibrium per ppm above base: 600 ppm ≈ +3.4°C at rest. */
export const WARMING_PER_PPM = 0.011;
/** The ~20-year lag (GDD §8.2): warming closes 1/40th of the gap per
 *  climate tick (two ticks a game-year) — the bill arrives two governments
 *  after the smoke. */
export const WARMING_LAG_TICKS = 40;
/** Adaptation works open once the threat is on the survey maps. */
export const SEA_WALL_YEAR = 2025;
/** Era 8 begins: the century's verdict is read (GDD §3.2). */
export const BRANCH_YEAR = 2040;
/** Early solarpunk decision point: beat the oil barons before 1990 to take the green path early */
export const EARLY_SOLARPUNK_YEAR = 1990;
/** The game ends 1 Jan 2100 with the Century Report — sandbox continues. */
export const CENTURY_YEAR = 2100;
/** Geoengineering: total °C shed by stratospheric aerosol injection. */
export const GEOENGINEER_COOLING = 0.4;
/** How long the aerosols stay effective: 2 years × 60 days/year. */
export const GEOENGINEER_DURATION_DAYS = 120;

/** Farm-economy climate drag (GDD §8.2). The agriculture SECTOR's £/month output
 *  erodes once realized warming passes `AGRI_CLIMATE_THRESHOLD`°C — heat stress,
 *  shifting growing seasons, water stress on cash crops drag the farm economy's
 *  contribution to GDP. This is DISTINCT from the older subsistence-food drag in
 *  `dailyUpdate` (which scales `t.food` production past +0.8°C) — different
 *  variable, so no double-count: one is the cash-crop economy, the other the
 *  granary. Linear above the threshold, capped at `AGRI_CLIMATE_MAX_DRAG` so a
 *  warm late-century trims agricultural GDP without zeroing it; exactly 1.0 below
 *  the threshold. A pure sink (warming is driven by emissions, never by farm
 *  output), so the loop is non-divergent. */
export const AGRI_CLIMATE_THRESHOLD = 1.5; // °C above 1900 before the farm economy bites
export const AGRI_CLIMATE_SLOPE = 0.06;    // sector-output drag per °C above the threshold
export const AGRI_CLIMATE_MAX_DRAG = 0.30; // cap: agricultural GDP down at most 30%
/** Industrial brownout climate drag: kicks in at ≥3°C, linear, capped at 30%. */
export const INDUSTRY_BROWNOUT_THRESHOLD = 3.0;
export const INDUSTRY_BROWNOUT_SLOPE = 0.10;   // 10% drag per °C above threshold
export const INDUSTRY_BROWNOUT_MAX_DRAG = 0.30; // cap: industrial GDP down at most 30%
/** Accord compliance: below this fraction the signatory is a free-rider. */
export const ACCORD_DEFECT_THRESHOLD = 0.35;
/** Maximum world-emissions cut from fully compliant accord coverage. */
export const ACCORD_EMISSION_CUT = 0.28;

// ---- Emergent world green transition (different timelines to 2100) ----
// Before this, EVERY autoplay seed funnelled to the 'drowned' branch: the only
// forces that bend the warming curve (green tech diffusion, carbon laws, climate
// accords) are PLAYER-driven, and the autoplay player never even becomes a nation,
// so the world ran a pure-fossil rail to proj ~5 °C every time. Now the rival WORLD
// decarbonizes on its own initiative, at a rate that VARIES BY SEED with the rival
// archetype mix — so the era branch (and the whole century's climate) diverges
// across runs. Deterministic (archetypes are fixed at worldgen; no RNG, no new
// serialized field) → the determinism/save-size gates stay green; it is an
// intentional climate re-baseline.
//
// Per-archetype propensity to lead the clean-energy transition (GDD §6.3 flavour):
// the commercial Trading Republic adopts what undercuts on cost; the Crusader
// State makes it a mission; the Opportunist follows the money; the industrial
// Hegemon and the isolationist Hermit Kingdom drag their feet.
export const ARCHETYPE_GREEN_PROPENSITY: Record<RivalArchetype, number> = {
  trading_republic: 1.0,
  crusader_state: 0.9,
  opportunist: 0.5,
  hegemon: 0.2,
  hermit_kingdom: 0.1,
};

/** Per-archetype multiplier on the base AI war-declaration probability.
 *  Applied on the p = 0.01 + risk×0.003 + expansion×0.002 roll in tickRivalAI.
 *  Tuned to archetype personality: hegemons escalate, hermits hide, traders negotiate. */
export const ARCHETYPE_WAR_FREQ_MULT: Record<RivalArchetype, number> = {
  hegemon:          1.6,  // expansion 9 + risk 7 → the natural warmonger
  trading_republic: 0.4,  // expansion 3 + risk 3 → war disrupts trade; avoids conflict
  hermit_kingdom:   0.3,  // expansion 2 + risk 2 → isolationist; only fights if cornered
  crusader_state:   1.2,  // expansion 6 + risk 6 → ideological mission justifies campaigns
  opportunist:      1.1,  // risk 9 but honorless; fights when the odds look good
};
export const WORLD_GREEN_START_YEAR = 1972;  // the transition can begin as renewables become conceivable
export const WORLD_GREEN_RAMP_YEARS = 38;    // years from the start to a full ramp (≈2010)
export const WORLD_GREEN_MAX_CUT = 0.92;     // a fully-green world cuts this fraction of its emissions
export const WORLD_GREEN_URGENCY_C = 1.6;    // warming (°C) at which crisis urgency maxes the transition rate
export const WORLD_GREEN_BASE = 0.55;        // baseline transition rate before warming urgency adds the rest
export const PLAYER_GREEN_DIFFUSION = 0.6;   // how much of the world's transition spills into a passive player's own emissions (GDD §5.6 proven-tech diffusion)
export const DROWNED_GREEN_RELIEF = 1.5;     // °C of projection credit per unit worldGreenShare at the era verdict (a transitioning world's flat projection overstates 2100 warming)

/** Maximum annual snapshots retained in statsHistory (one per year, 200y of coverage). */
export const STATS_HISTORY_MAX = 200;

/** One annual data point for the Century Graph. Sampled each January. */
export interface StatSnapshot {
  year: number;
  /** Annualised GDP (gdpLastMonth × 12). */
  gdp: number;
  /** Total population across all player settlements. */
  pop: number;
  /** Global warming in °C above 1900 baseline. */
  warmingC: number;
  /** Player national treasury at snapshot time. */
  treasury: number;
  /** Mean satisfaction across player settlements (0–100). */
  satisfaction: number;
}

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
  wonders: number;   // Spatial-4X Phase D — player-owned Wonders at century's end
  prestige: number;  // accrued Wonder prestige
  legitimacy: number;
  grades: { stewardship: string; prosperity: string; liberty: string; standing: string };
  verdict: string;
}

// ---- Phase 17: Historical Scenarios & Alternate Starts (GDD §8.8, §6.1) ----

/** A scenario goal — checked monthly against RegionSim state. */
export interface ScenarioGoal {
  id: string;
  description: string;
  /** Method name on RegionSim that returns true when this goal is complete. */
  checkFn: string;
}

/** A named historical scenario: opening condition + goals + narrative. */
export interface Scenario {
  id: string;
  name: string;
  description: string;
  eraStart: '1919' | '1950' | '2000';
  govLock?: string;       // govType locked for 30 years if set
  startingGoals: ScenarioGoal[];
  openingEvent: string;   // flavor log at game start
  difficulty: 'standard' | 'hard' | 'brutal';
}

/** All four pre-built historical scenarios (GDD §8.8). */
export const SCENARIOS: Scenario[] = [
  {
    id: 'long_peace',
    name: 'The Long Peace',
    description: 'Start in a post-war 1919 region. Can you build a nation that endures to the year 2000 without being conquered?',
    eraStart: '1919',
    startingGoals: [
      { id: 'survive_to_2000', description: 'Reach the year 2000 without being conquered', checkFn: 'goalSurviveTo2000' },
    ],
    openingEvent: 'The war is over. The question now is whether the peace will last.',
    difficulty: 'standard',
  },
  {
    id: 'iron_curtain',
    name: 'Iron Curtain',
    description: 'Begin in 1950 as a democracy locked in constitutional law for 30 years. Survive the Cold War and grow to 100,000 population.',
    eraStart: '1950',
    govLock: 'democracy',
    startingGoals: [
      { id: 'maintain_democracy_1990', description: 'Maintain democracy governance through 1990', checkFn: 'goalMaintainDemocracy1990' },
      { id: 'reach_100k_pop', description: 'Reach 100,000 population', checkFn: 'goalReach100kPop' },
    ],
    openingEvent: 'East and West are watching your every move.',
    difficulty: 'standard',
  },
  {
    id: 'digital_crossroads',
    name: 'Digital Crossroads',
    description: 'Begin in the year 2000 during the information age. Research AI automation before 2030, and resolve the misinformation crisis by 2045.',
    eraStart: '2000',
    startingGoals: [
      { id: 'research_ai_2030', description: 'Research ai_automation before 2030', checkFn: 'goalResearchAI2030' },
      { id: 'resolve_polarization_2045', description: 'Reduce polarization below 0.3 by 2045', checkFn: 'goalResolvePolarization2045' },
    ],
    openingEvent: 'The world changes faster than any government can manage.',
    difficulty: 'hard',
  },
  {
    id: 'climate_emergency',
    name: 'Climate Emergency',
    description: 'The carbon budget is nearly spent. Reach net-zero emissions by 2040, and prevent the Drowned branch.',
    eraStart: '2000',
    startingGoals: [
      { id: 'net_zero_2040', description: 'Achieve net-zero emissions by 2040', checkFn: 'goalNetZero2040' },
      { id: 'avoid_drowned', description: 'Avoid the Drowned era branch', checkFn: 'goalAvoidDrowned' },
    ],
    openingEvent: 'The carbon budget is nearly spent. You inherited the crisis.',
    difficulty: 'brutal',
  },
];

/** Difficulty settings: tune crises, AI, economy volatility, and historical events. */
export interface DifficultySettings {
  crisisFrequency: number;       // 0.5 = half as many; 2.0 = twice as many
  aiAggression: number;         // 0.5–2.0 multiplier on rival expansion chance
  economicVolatility: number;   // 0.5–2.0 multiplier on boom/bust amplitude
  historicalAnchors: 'on' | 'emergent' | 'off';
}

export const DEFAULT_DIFFICULTY_SETTINGS: DifficultySettings = {
  crisisFrequency: 1.0,
  aiAggression: 1.0,
  economicVolatility: 1.0,
  historicalAnchors: 'on',
};

const TOWN_NAMES = [
  // Original names
  'Eastvale', 'Norwick', 'Millbrook', 'Ashford', 'Redfort', 'Larkspur',
  'Coldwater', 'Hartsfield', 'Brindle', 'Ostmark', 'Fenwick', 'Sorrel',
  // European-inspired names
  'Aldwick', 'Berling', 'Carlston', 'Doverby', 'Elmhurst', 'Fairdale', 'Glenmore', 'Huntington',
  'Ivywood', 'Jamestown', 'Kingston', 'Lancaster', 'Maidstone', 'Northby', 'Oxford', 'Peterborough',
  'Queenston', 'Ravenswick', 'Salisbury', 'Thornfield', 'Upperton', 'Valeworth', 'Waltham', 'Yarmouth',
  'Zephyrhaven', 'Ashbrook', 'Blackwell', 'Cedarvale', 'Darkwood', 'Eastham', 'Fairwood', 'Greystone',
  'Heathfield', 'Ironford', 'Jardine', 'Kesswick', 'Longfield', 'Moorland', 'Newbrook', 'Oakworth',
  'Penrose', 'Quickwood', 'Riverton', 'Southwick', 'Thorton', 'Underwood', 'Viewmont', 'Waterford',
  // Colonial names
  'Bridgeport', 'Chatham', 'Denton', 'Ellsworth', 'Frankfort', 'Grayville', 'Hartwell', 'Independence',
  'Jefferson', 'Kenmore', 'Liberty', 'Madison', 'Neville', 'Oakton', 'Palmerton', 'Ridgewood',
  'Shelby', 'Tenton', 'Union', 'Vinton', 'Wallingford', 'Westbrook', 'Windham', 'Worthington',
  // Additional variety
  'Appleton', 'Barrington', 'Camden', 'Dalton', 'Edgeworth', 'Felton', 'Grafton', 'Hampden',
  'Idlewood', 'Jacksonvale', 'Kellerton', 'Lewisburg', 'Meredith', 'Newtonville', 'Orchard', 'Princeton',
  'Quincy', 'Rosewood', 'Shirebrook', 'Tallman', 'Utton', 'Vaughn', 'Waverly', 'Whitten',
  'Yardley', 'Zenith', 'Abingdon', 'Bethel', 'Chesterfield', 'Deepwood', 'Everton', 'Fordham',
  'Gladstone', 'Hardwick', 'Inwood', 'Jericho', 'Kellys', 'Lakewood', 'Millford', 'Nantucket',
  'Orwell', 'Pembroke', 'Reddington', 'Stephenson', 'Tilbury', 'Uniontown', 'Ventnor', 'Westgate',
  // River and landmark names
  'Riverdale', 'Bridgehaven', 'Stillwater', 'Clearwater', 'Stonebridge', 'Crossroads', 'Hilltop', 'Marshland',
  'Woodland', 'Sunridge', 'Highfield', 'Flatland', 'Goldwater', 'Silverpine', 'Shadygrove', 'Windridge',
  'Stormvale', 'Brightfield', 'Darkridge', 'Sweetwater', 'Homestead', 'Crossfield', 'Willowbrook', 'Fieldstone',
  'Blackstone', 'Redstone', 'Whitestone', 'Bluegrass', 'Greenwood', 'Hardpine', 'Softmeadow', 'Roughwood',
  // Fantasy-inspired but plausible
  'Goldshire', 'Silverdale', 'Copperfield', 'Ironhill', 'Steelbrook', 'Brightwell', 'Darkwell', 'Deepwell',
  'Stonewood', 'Leatherthorn', 'Thornwell', 'Firebrook', 'Frostbrook', 'Stormbrook', 'Windbrook', 'Sunbrook',
  'Moonbrook', 'Starwood', 'Shadowbrook', 'Ghostfield', 'Spiritwood', 'Lightfield', 'Darkfield', 'Fairfield',
  // Short, punchy names
  'Dale', 'Vale', 'Hill', 'Field', 'Ford', 'Port', 'Bay', 'Cove',
  'Dock', 'Port', 'Moor', 'Fen', 'Bog', 'Heath', 'Bush', 'Grove',
  'Shaw', 'Wood', 'Glen', 'Dale', 'Vale', 'Holt', 'Tor', 'Peak',
  // Compound names (double-element)
  'Ashhill', 'Beechwood', 'Cedarbrook', 'Dalebrook', 'Elmwood', 'Firewood', 'Gravelford', 'Hawthorne',
  'Ironstone', 'Jasperhull', 'Kingsley', 'Limestone', 'Marblewood', 'Nightwood', 'Oakhill', 'Pearlstone',
  'Quarystone', 'Ravenhill', 'Sandhurst', 'Timbering', 'Uniqueville', 'Veinbrook', 'Woldgate', 'Yellowstone',
  // Additional names to reach 200+
  'Acton', 'Antrim', 'Ardmore', 'Armagh', 'Athlone', 'Athy', 'Austen', 'Avery',
  'Bainbridge', 'Ballinamore', 'Ballintoy', 'Ballyliffin', 'Ballymore', 'Ballyshannon', 'Bangor', 'Bantry',
  'Bardstown', 'Barnard', 'Barnstable', 'Barony', 'Basingford', 'Basking', 'Batchford', 'Bathford',
  'Bathurst', 'Battersby', 'Battiscombe', 'Batwick', 'Bawley', 'Baxley', 'Bayfield', 'Baymont',
  'Bayonet', 'Beaconsfield', 'Beadlewood', 'Beakley', 'Beamish', 'Beanfield', 'Bearfield', 'Beatrice',
  'Beauchamp', 'Beaufield', 'Beaufort', 'Beaumont', 'Beckford', 'Bedford', 'Bedworth', 'Beechford',
  'Beefland', 'Beeford', 'Beesley', 'Beeston', 'Beggarsbush', 'Belcourt', 'Belfield', 'Belfast',
  'Belford', 'Belgaum', 'Belingham', 'Belknap', 'Bellamy', 'Bellingham', 'Bellmore', 'Bellville',
  'Belmont', 'Beloyed', 'Belstead', 'Belton', 'Belvidere', 'Benbury', 'Bencoolen', 'Bendigo',
  'Bendsley', 'Benedictville', 'Benfield', 'Benfleet', 'Bengough', 'Benicia', 'Benjamin', 'Benicia',
  'Benmore', 'Bennet', 'Bennettsville', 'Bennington', 'Bennyworth', 'Bensalem', 'Bensley', 'Benstead',
  'Bentham', 'Bentley', 'Bentworth', 'Benwick', 'Benyon', 'Benziger', 'Berard', 'Bercey',
  'Berclay', 'Berdorf', 'Bereford', 'Berengard', 'Bereoford', 'Berenice', 'Berenson', 'Bererford',
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

/** Minimum Euclidean spacing between settlement centres, in 0–100 map coords.
 *  Founding is rejected within this radius of any existing town so cities don't
 *  pile on top of each other. Used by both player expeditions and AI expansion. */
export const MIN_SETTLEMENT_SPACING = 8;

export class RegionSim {
  rng: Rng;
  /** Per-tick memo of `routePath` BFS results (key `from:to:mode`). Transient —
   *  NOT serialized; rebuilt lazily. Cleared at tick start and whenever the route
   *  graph mutates (add/remove/kind-change), so it never returns a stale path.
   *  Public for systems/military.ts (abandonGhostTowns clears it on town death). */
  _routePathCache = new Map<string, Route[] | null>();
  /** Separate deterministic stream for rival faction AI decisions. Kept apart
   *  from the main `rng` so AI choices never perturb the colony's own stochastic
   *  outcomes (events, washouts, raids) — preserving cross-feature determinism. */
  aiRng: Rng;
  /** Third deterministic stream for incidental stochastic detail that must stay
   *  apart from the colony and AI draws — notable health decay, loan ids.
   *  Previously these used `Math.random()`, which made the serialized save
   *  non-reproducible for a fixed seed (the determinism harness caught a notable's
   *  health diverging between two same-seed runs); routing them through a
   *  dedicated seeded stream restores byte-level determinism without shifting the
   *  main or AI streams (so every existing seed-dependent outcome is unchanged). */
  auxRng: Rng;
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
  /**
   * Road & rail maintenance funding level (Issue #16): a single budget knob
   * instead of per-route micromanagement. 1.0 = fully fund upkeep (routes hold
   * and slowly improve); below 1.0 underfunds (routes degrade); above 1.0
   * over-funds for rapid catch-up repairs. Range 0–1.5.
   */
  routeBudget = 1.0;
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
  private activePolicySet: Set<string> = new Set();
  private sectorProdCache: Record<SectorId, number> | null = null;
  private wageCache: Map<number, number> | null = null;
  /** Industry-output multiplier from supply-chain shocks (1.0 = healthy). Set by
   *  `tickIntermediateGoods` each month (health and `year` consistent there) and
   *  read by `updateSectors` the following month — a realistic one-month lag.
   *  Transient (derived from serialized `supplyChainHealth`); after load it
   *  defaults to 1.0 until the next monthly tick re-derives it. Public so the
   *  extracted goods system (systems/goods.ts) can cache it each month. */
  supplyShockMult = 1;
  /** PR-3 slice 3 — nation-wide LOCAL-goods scarcity index, 0..1 (0 = every town
   *  holds the manufactured goods it consumes). Set by `tickIntermediateGoods` each
   *  month (after the per-town production solve, so it reads this month's stocks) and
   *  read the FOLLOWING month by `tickMonetary` (cost-push) and `updateSectors`
   *  (industry drag) — the same one-month lag as `supplyShockMult`. Persisted so a
   *  save reloaded mid-shortage keeps the coupling on the next tick; old saves
   *  backfill to 0 (the value healthy/single-town play always holds, so the format
   *  gain is inert there). Public so the goods system (systems/goods.ts) can cache
   *  it. */
  localGoodsScarcity = 0;
  /** Spatial-4X Phase D — Wonders. Maps a built wonder's id to the factionId
   *  that owns it (one per empire); a `unique` building cannot be raised again
   *  anywhere once it appears here. Empty in a fresh game / pre-Phase-D save. */
  wonderOwner: Record<string, number> = {};
  /** Player prestige — accrued from completing Wonders, surfaced in the Century
   *  Report. Telemetry in slice 1 (no victory path yet). */
  prestige = 0;
  // ---- Phase 18: Advisor System Depth (GDD §8.7) ----
  /** Queue of advisor briefs from ministers (max 5, newest-first). */
  advisorBriefs: { portfolio: string; message: string; day: number }[] = [];
  /** Last day a brief was generated per portfolio (prevents spam). */
  advisorBriefLastDay: Record<string, number> = {};
  /** Last day the player took an action in each portfolio domain. */
  lastActionDay: Record<string, number> = {};
  /** True once the Science bottleneck event fires; cleared when player builds a school. */
  researchBottleneckActive = false;
  /** Spatial-4X Phase C: per-settlement tile yield bonus cache, keyed by settlement
   *  id. Terrain is static (never changes after worldgen), so this is computed once
   *  and kept forever. Transient — NOT serialized; rebuilt lazily on first call. */
  private _tileYieldCache?: Map<number, Partial<Record<SectorId, number>>>;
  /** Spatial-4X Phase D slice 2: per-settlement DISTRICT adjacency bonus cache,
   *  keyed by settlement id. Depends only on placed-building cells (which only ever
   *  grow), so it is keyed by the placement count and recomputed when that changes.
   *  Transient — NOT serialized; rebuilt lazily. */
  private _districtCache?: Map<number, { len: number; byS: Partial<Record<SectorId, number>> }>;
  // ---- Rival nations & diplomacy (GDD §5.4, §6.2–6.4) ----
  rivals: RivalNation[] = [];
  /** Named rival nations that have been used (to avoid duplicates). */
  usedNamedRivals: Set<string> = new Set();
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
  /** Track if player has beaten the oil barons faction (enabler for early solarpunk path) */
  beatOilBarons = false;
  /** The 1 Jan 2100 Century Report; sandbox continues after it. */
  centuryReport: CenturyReport | null = null;
  /** Compliance per rival (0–1): drifts monthly, commerce-driven. Below
   *  ACCORD_DEFECT_THRESHOLD = free-rider. Cleared when accord torn. */
  accordCompliance: Record<number, number> = {};
  /** Rivals whose defection has already triggered a log (transient: resets on load). */
  accordDefectLogged = new Set<number>();
  /** True once Deploy is activated; the aerosols are in the stratosphere. */
  geoDeployed = false;
  /** Day the aerosols were injected; used to phase the cooling. */
  geoDeployDay = -1;
  // ---- Phase 11: Renewables, Automation & Carbon Pricing ----
  /** Cumulative treasury loss from stranded fossil assets (written-off coal/oil infrastructure). */
  strandedAssetLoss = 0;
  /** The speculative 2040 branch chosen by Phase 11 logic: Solarpunk / Corporatocracy / Drowned. */
  speculativeBranch: 'solarpunk' | 'corporatocracy' | 'drowned' | null = null;
  /** True once Universal Basic Support is enacted (UBS softens automation unemployment). */
  ubsActive = false;
  // ---- Monetary system (GDD §5.1): central bank, credit cycle, FX ----
  /** True once the nation runs a central bank — reached either by researching the
   *  Central Banking civic (the tech the player expects to "unlock the bank") or by
   *  enacting the Central Bank Charter law at nation tier. Either path lights up the
   *  policy rate, credit cycle, FX regime, and discount window. (Sovereign bond
   *  issuance stays gated on full nationhood inside issueBonds.) */
  hasCentralBank(): boolean {
    return this.has('central_banking') || this.passedLaws.has('central_bank_charter');
  }
  /** Annual policy rate (1–15%); player-adjustable once a central bank exists. */
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
  crashFired = false;
  /** 0→1 measure of depression severity; set to 1.0 when crash fires, decays ~5%/month. */
  depressionDepth = 0;
  /** Months since the crash fired — drives the recovery-crossroads timing. */
  crashMonthCounter = 0;
  /** Player's chosen recovery path once the crossroads event fires. */
  crashRecoveryChoice: 'pending' | 'stimulus' | 'austerity' | null = null;
  /** Months of stimulus spending remaining (set to 24 on stimulus choice). */
  private stimulusMonthsLeft = 0;
  /** Emergency depression measures already enacted this slump (once each). */
  depressionMeasuresUsed: DepressionMeasure[] = [];
  /** Confidence-ceiling headroom earned by enacting emergency measures.
   *  Public for systems/monetary.ts (read by tickMonetary's depression ceiling). */
  depressionCeilingBonus = 0;
  /** Prevents the 1936–1948 world-war anchor from firing twice. */
  worldWarFired = false;
  /** Prevents the 1970s oil-shock anchor from firing twice. */
  oilShockFired = false;
  /** Prevents the 2020-analog pandemic anchor from firing twice. */
  pandemicFired = false;
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
  /** Running count of non-fogged tiles; incremented in revealTiles for fast mapCacheSignature. */
  exploredCount = 0;
  /** Incremented whenever faction visibility cache is rebuilt; lets RegionView detect fog changes. */
  visibilityVersion = 0;
  /** Cached count of rail routes with condition > 50 — updated at route mutation sites. */
  activeRailRoutes = 0;
  /** Cached maximum grievance across all settlements — updated daily. */
  maxGrievance = 0;
  /** Cached sum of food across all settlements — updated daily. */
  totalFood = 0;
  /** Cached sum of wood across all settlements — updated daily. */
  totalWood = 0;
  /** One-time latch: player territory (own + vassal) has reached ≥50% of the region.
   *  Set in monthlyUpdate; never cleared after set. Surface "Proclaim Nation" in UI. */
  proclamationReady = false;
  /** Scout units exploring the map */
  scouts: Scout[] = [];
  /** Monthly history for sparklines: last 12 months of key metrics. */
  monthlyHistory: Array<{ gdp: number; treasury: number; inflation: number; employment: number }> = [];
  /** Annual snapshots for the Century Graph (sampled each January; ring buffer, max STATS_HISTORY_MAX). */
  statsHistory: StatSnapshot[] = [];
  /** Regional factions competing for dominance (includes player faction) */
  regionalFactions: RegionalFaction[] = [];
  /** Player faction id (always 0 or first in list) */
  playerFactionId = 0;
  /** Autoplay-only: when set, the player faction ALSO auto-develops its towns
   *  spatially (raises terrain-fit buildings, zones districts), funded from the
   *  national treasury and reserve-gated exactly like a rival. Default OFF so
   *  live human play stays manual and byte-identical — the headless tuning
   *  harness turns it on so the balance signal exercises the PLAYER's own
   *  spatial path (otherwise a passive autoplay player holds one bare town and
   *  the whole spatial economy is measured only via rival competition). Not
   *  serialized — it is a run-mode toggle, not game state. */
  autoDevelopPlayer = false;
  /** Global-world leg 1 — the CONSUMER-DEMAND model (the structural fix that makes
   *  the world market able to TIGHTEN). The goods demand functions count only
   *  intermediate-INPUT demand (normalized to sector shares, O(1)/good) and have NO
   *  final-consumption sink, while production deposits `baseOutput × level` units/tick
   *  — so the 8 terminal goods (food/clothing/tools/vehicles/machinery/consumer_goods/
   *  pharmaceuticals/luxury_goods) have ~0 demand, every good oversupplies by ~baseOutput×,
   *  stocks accumulate unbounded, and `worldGoodScarcity = 1 − supply/demand` is pinned
   *  at 0 FOREVER (not because play is balanced — because demand is mis-scaled). When set,
   *  the world market reads a FLOW signal — this-tick production capacity (`baseOutput ×
   *  level`) vs an exogenous final-consumption demand (`baseOutput × FINAL_APPETITE`, the
   *  population's steady appetite, level-independent) tilted by the great powers — so a
   *  supply shock, a great-power war, or a warming breadbasket finally lifts world scarcity
   *  → the world-price anchor → arbitrage. Default OFF so live human play + the determinism
   *  harness stay byte-identical (every demand fn returns its legacy value, every world
   *  scarcity its legacy stock-based 0); the headless sweep turns it on (SIM_CONSUMER_DEMAND).
   *  Not serialized — a run-mode toggle, not game state. */
  consumerDemand = false;
  /** Transient per-good supply LEVEL (∈[0,1], Liebig min of input availability) cached
   *  by `tickIntermediateGoods` each month from the cascade solve, so the (consumer-demand)
   *  flow scarcity can read this-tick production capacity without re-resolving the chain
   *  per price query. Rebuilt every tick → NOT serialized (like `_districtCache`). */
  goodLevels: Map<string, number> = new Map();
  /** Difficulty chosen at town design — tunes the regional AI competitors. */
  aiDifficulty: AiDifficulty = 'normal';
  /** Currency exchange rates: { from:factionId:to:factionId => rate } */
  exchangeRates: Record<string, number> = {};
  /** Global trade volume: used to calculate currency dominance */
  globalTradeVolume = 0;
  /** Next scout id for creating new scouts */
  private nextScoutId = 5000;
  /** Regional faction ids the player has declared war on (Phase C). */
  playerRegionalWars = new Set<number>();
  /** Faction IDs whose settlement has been revealed through fog (first-contact tracking). */
  private contactedFactionIds = new Set<number>();
  /** Set when any win condition is achieved; sandbox continues but result is displayed. */
  winCondition: WinCondition | null = null;
  /** Track triggered epilogue events (post-2100 flavor) to avoid repeats */
  private triggeredEpilogueEvents = new Set<string>();
  /** True once the player has seen the post-2100 epilogue scroll (persisted). */
  epilogueShown = false;
  /** Treasury milestones already announced — prevents re-firing if treasury dips and recovers. */
  private loggedTreasuryMilestones = new Set<number>();
  /** Player-founded economic unions (GDD §6.5). At most one player bloc. */
  tradeBlocs: TradeBloc[] = [];
  private nextBlocId = 1;
  // ---- Phase 5: Province governance ----
  /** Per-province (settlement) administrative policies; keyed by settlement id. */
  provincePolicies: Record<number, HexProvincePolicy> = {};
  // ---- Phase 6: Rival-side economic diplomacy ----
  /** Trade blocs formed among rival nations independently of the player. */
  rivalTradeBlocs: RivalTradeBloc[] = [];
  nextRivalBlocId = 1;
  /** Active economic sanctions (player ↔ rivals). */
  sanctions: Sanction[] = [];
  // ---- Phase 9: Government Type System ----
  /** One-Party / Command Economy: planning optimism (0–1). Grows 0.01/month. */
  planningOptimism = 0;
  /** Reported GDP for one-party states: actual × (1 + planningOptimism × 0.3). */
  reportedGDP = 0;
  /** Credibility gap: grows under authoritarian press control (0–100). */
  credibilityGap = 0;
  /** Theocracy: schism risk (0–100). Grows with secular tech research. */
  schismRisk = 0;
  /** Corporatocracy: shareholder patience (0–100). */
  shareholderPatience = 80;
  /** Active government transition chain (null if no transition in progress). */
  transitionChain: TransitionChain | null = null;
  /** Policy slots: category-tagged slots with active card. */
  policySlots: { category: string; slotId: string; cardId: string | null }[] = [];
  // ---- Phase 7: Inter-provincial army movement ----
  /** Armies stationed at or marching between provinces. */
  provincialArmies: ProvincialArmy[] = [];
  /** Public for systems/military.ts (tickRivalArmyAI mints rival army ids). */
  nextArmyId = 1;
  // ---- Phase 12: Media & Misinformation System (GDD §8.3) ----
  /** Current media reach tier — transitions over the century as technology advances. */
  mediaReach: 'word_of_mouth' | 'press' | 'radio' | 'television' | 'internet' | 'algorithmic' = 'word_of_mouth';
  /** Press freedom index 0–100. Above 65: free press. Below 35: controlled press. */
  pressFreedom = 60;
  /** Propaganda narrative strength 0–1; only effective when pressFreedom < 50. */
  propagandaNarrative = 0;
  // `credibilityGap` (declared above for the Phase 9 government system) is the
  // same accumulator the media system reads — high values risk legitimacy collapse.
  /** Polarization 0–1; grows in the algorithmic era. */
  polarization = 0;
  /** True once internet tech + year >= 2015; never cleared. */
  misinformationEra = false;
  /** True once platform regulation has been enacted. */
  platformRegulationEnacted = false;
  /** True once public media has been funded. */
  publicMediaFunded = false;
  /** True once media literacy investment has been made. */
  mediaLiteracyInvested = false;
  /** Year media literacy investment was made (for 15-year lag). −1 if not invested. */
  mediaLiteracyYear = -1;
  /** True once the polarization reduction from media literacy has been applied. */
  mediaLiteracyApplied = false;
  // ---- Phase 15: Extended Economy & FX (GDD §5.2) ----
  // The intermediate-goods stock ledger now lives PER SETTLEMENT
  // (`Settlement.goodStocks`); the nation-wide totals the supply chain reads are
  // the sum across towns, exposed through the `goodStock`/`produceGood`/… accessors.
  /** Trailing EWMA of each extracting sector's total output, the "recent norm"
   *  the graded raw proxy measures contractions against (see `sectorRawLevel`).
   *  Seeded lazily from the first observed output; serialized so the norm — and
   *  therefore the shock baseline — survives save/load. 0 = not yet warmed. */
  sectorOutputNorm: { industry: number; agriculture: number } = { industry: 0, agriculture: 0 };
  /** Transient raw-material embargoes: raw id → `{ until, cut }`. While
   *  `day < until` the raw runs at level `1 − cut` in the (graded) supply solver
   *  (`cut` 1 = total cut, 0.6 = a 60% reduction), so a *partial* shortage
   *  cascades downstream proportionally — the GDD §5.4 promise that a supply shock
   *  "isn't a popup." The oil-shock anchor writes `oil` here; a war or
   *  canal-closure event could reuse it. Expired entries are pruned in
   *  tickIntermediateGoods. Pre-graded saves stored a bare `until` number; those
   *  migrate to `{ until, cut: 1 }` on load (see `deserialize`). */
  rawEmbargoes: Record<string, { until: number; cut: number }> = {};
  /** 0–1 weighted average input availability across all active intermediate goods. */
  supplyChainHealth = 1.0;
  /** Active inter-settlement goods flows for price arbitrage. A flow is goods
   *  physically in transit: it carries `pendingIncome` (the arbitrage profit) that
   *  is realized only on ARRIVAL, after `transitDays` of travel — so congestion
   *  (which sets the transit time) delays the payout, and a flow whose route is
   *  severed mid-transit is lost. It also carries `cargo` — the real units of
   *  `goodId` debited from the source town's `goodStocks` on dispatch and credited
   *  to the destination's on arrival (lost outright if the route is severed). */
  tradeFlows: Array<{
    goodId: string;
    fromSettlementId: number;
    toSettlementId: number;
    volume: number;
    transitDays: number;
    congestionTariff: number;
    /** Arbitrage profit (£) carried by this shipment, paid out on delivery. */
    pendingIncome: number;
    /** Physical units of `goodId` in transit — what the source town actually had
     *  to ship (≤ volume). Credited to the destination town's `goodStocks` on
     *  arrival; destroyed if the route is severed mid-transit. */
    cargo: number;
  }> = [];
  /** Currency regime for Phase 15 FX. Separate from monetary regime (peg/float/print). */
  currencyRegime: 'gold_standard' | 'fiat' | 'currency_union' = 'fiat';
  /** Partner rival id if in currency union. */
  currencyUnionPartnerId?: number;
  /** Temporary export multiplier from devaluation (starts at 1.0 + amount*1.5, decays 10%/month). */
  fxBoost = 1.0;
  // ---- Phase 16: Warfare System Depth (GDD §7) ----
  /** Army Groups: high-resolution unit groups for Phase 16 battles. */
  armyGroups: ArmyGroup[] = [];
  private nextArmyGroupId = 1;
  /** Mobilization level: 0=peacetime, 1=partial, 2=total. */
  mobilizationLevel: 0 | 1 | 2 = 0;
  /** Months spent at current mobilization level. */
  mobilizationMonths = 0;
  /** War support (0–100); starts at 60 at declaration, modified by CB. */
  warSupport = 60;
  /** Province occupation data: provinceId → occupying rivalId, resistance, policy. */
  provincialOccupations: Record<number, {
    occupiedBy: number;
    resistanceLevel: number;
    occupationPolicy: 'conciliatory' | 'normal' | 'brutal';
    /** Postwar satisfaction penalty accumulated from brutal policy. */
    brutalPolicyPenalty: number;
  }> = {};
  /** Flag: did player win a battle this month? */
  lastBattleWon = false;
  /** Post-war bookkeeping: one entry per finished war, oldest first. */
  warScars: WarScar[] = [];
  seaRiseAnnounced = false;
  lastTidalLogDay = -999;
  lastRefugeesLogDay = -999;
  lastExtremeWeatherDay = -999;
  private droughtAnnounced = false;
  // ---- Phase 17: Historical Scenarios & Alternate Starts (GDD §8.8, §6.1) ----
  /** Scenario id currently in play, or null for sandbox. */
  activeScenario: string | null = null;
  /** Scenario goal ids that have been achieved. */
  scenarioGoalsCompleted: string[] = [];
  /** Year when the govLock expires (null = no lock active). */
  govLockExpiry: number | null = null;
  /** Difficulty knobs for this campaign. */
  difficultySettings: DifficultySettings = { ...DEFAULT_DIFFICULTY_SETTINGS };
  private railAnnounced = false;
  private highwayAnnounced = false;
  private maglevAnnounced = false;
  private nextId = 1000;
  private nextEventDay: number;
  private townNamePool: string[];

  // ---- Phase 13: Population & Society Depth (GDD §5.5) ----
  /** Demographic phase — computed monthly from era/education/urbanization. */
  demographicPhase: 'pre_transition' | 'early_transition' | 'late_transition' | 'post_transition' = 'pre_transition';
  /** True once the aging-crisis pension burden first activates (2050+, post_transition). */
  agingCrisisActive = false;
  /** True once a refugee wave is in flight. */
  refugeeWaveActive = false;
  /** Settlement id that generated the refugee wave origin. */
  refugeeWaveOrigin = '';
  /** Ring buffer of 25 years of school coverage (0–1); newest at index 0. */
  educationLag: number[] = new Array(25).fill(0);
  /** Unrest level on the 6-rung ladder (0=calm … 5=revolution). */
  unrestLevel: 0 | 1 | 2 | 3 | 4 | 5 = 0;
  /** Months the nation has been at the current unrest level. */
  unrestMonthsAtLevel = 0;
  /** Generational ideology drift accumulator (0–1). */
  generationalDrift = 0;
  /** True once the 1968-analog youthquake event has fired. */
  youthquake1968Fired = false;
  /** True once the 2030s digital-generation youthquake event has fired. */
  youthquake2030Fired = false;
  /** Automation unemployment fraction (0–1); rises post-2010 with information-sector dominance. */
  automationUnemployment = 0;

  constructor(rng: Rng, minute: number, map: RegionMap, weather: Weather) {
    this.rng = rng;
    // Derive the AI stream deterministically from the main seed so it stays
    // reproducible without sharing draws with the colony simulation.
    this.aiRng = new Rng((rng.getState() ^ 0x9e3779b9) >>> 0);
    // A third stream (distinct mix constant) for incidental detail — see auxRng.
    this.auxRng = new Rng((rng.getState() ^ 0x85ebca6b) >>> 0);
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
  get month(): number {
    return Math.floor((this.day % DAYS_PER_YEAR) / DAYS_PER_MONTH);
  }
  get monthDay(): number {
    return (this.day % DAYS_PER_MONTH) + 1;
  }
  get monthName(): string {
    return MONTHS[this.month];
  }
  get dateLabel(): string {
    return `${this.monthName} ${this.monthDay}, ${this.year}`;
  }

  /**
   * A 0–1 "tension" scalar for dynamic audio/UI mixing (GDD §3.3): the louder of
   * war, civil unrest, and economic crisis. Drives the music engine's intensity
   * (calm pad → full kit) and the diegetic soundscape. Cheap — read every frame.
   */
  tensionScalar(): number {
    let t = 0;
    // War: any active war is tense; a collapsing home front is tenser still.
    if (this.playerWar) t = Math.max(t, 0.6 + 0.4 * (1 - this.playerWar.support / 100));
    // Civil unrest: the peak grievance anywhere in the nation.
    t = Math.max(t, this.maxGrievance / 100);
    // Economic crisis: a deep depression is dread even at peace.
    t = Math.max(t, this.depressionDepth);
    // Climate dread: warming above 2°C adds ambient tension (the century closing in).
    if (this.warmingC > 2.0) t = Math.max(t, Math.min(0.45, (this.warmingC - 2.0) * 0.15));
    // Era branch dread: dystopia/drowned branches carry an undercurrent of unease.
    if (this.eraBranch === 'drowned' || this.eraBranch === 'dystopia') t = Math.max(t, 0.25);
    return Math.max(0, Math.min(1, t));
  }

  totalPop(): number {
    return Math.round(
      this.settlements.reduce((s, t) => s + this.popOf(t), 0) +
      this.expeditions.reduce((s, e) => s + e.pop, 0),
    );
  }

  /** Population of the player's own settlements only (excludes rivals/expeditions). */
  playerPop(): number {
    return Math.round(
      this.settlements
        .filter((t) => t.factionId === this.playerFactionId)
        .reduce((s, t) => s + this.popOf(t), 0),
    );
  }

  /** Pop-weighted average satisfaction across the player's settlements (0–100).
   *  This is the nation's overall "happiness" — big cities count for more. */
  avgSatisfaction(): number {
    let pop = 0;
    let weighted = 0;
    for (const t of this.settlements) {
      if (t.factionId !== this.playerFactionId) continue;
      const p = this.popOf(t);
      pop += p;
      weighted += p * t.satisfaction;
    }
    return pop > 0 ? weighted / pop : 0;
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
            if (this.explorationMap[x][y] === 'fogged') this.exploredCount++;
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

  /** Scale a rival-belligerence probability by the `aiAggression` difficulty knob
   *  (GDD §6.4): 1.0 on normal so the chance is unchanged, >1 on harder tiers makes
   *  rival mischief and ultimatums more frequent, <1 on easier ones gentler. It
   *  scales the THRESHOLD, not the draw, so the RNG stream is byte-identical on
   *  normal (and in the headless sim and every test, which all run at the 1.0
   *  default). Clamped to [0,1] so a high multiplier can't overflow a probability. */
  aggroChance(p: number): number {
    return Math.max(0, Math.min(1, p * this.difficultySettings.aiAggression));
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

    const population = Math.round(faction.settlementIds.reduce((sum, id) => {
      const s = this.settlement(id);
      return sum + (s ? this.popOf(s) : 0);
    }, 0));

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
      path, terrainCost: c ? c.cost : path.length * 2, freight: 0, cargoType: null, cargoPriority: null,
    });
    this._routePathCache.clear(); // route graph changed
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
    if (this.ministerFor('science')) mult *= 1.15;
    // Phase 18: research bottleneck penalty (Science Minister event)
    if (this.researchBottleneckActive) mult *= 0.9;
    // Phase 2: every university adds its laboratories to the effort
    for (const t of this.settlements) {
      for (const id of t.buildings) {
        const def = REGION_BUILDINGS_MAP.get(id);
        if (def?.research) mult *= 1 + def.research;
      }
    }
    // Phase 15: electronics supply chain disruption −10% research rate
    if (this._electronicsDisrupted) mult *= 0.9;
    return base * mult;
  }

  /** Set by tickIntermediateGoods() each month; true when electronics inputs are
   *  missing. Public so the extracted goods system (systems/goods.ts) can set it. */
  _electronicsDisrupted = false;

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

  /** Scale a flat, headline player cost (scout hire, militia drill, town
   *  founding) by the development level so it keeps pace with the economy and
   *  stays a real outlay deep into the campaign instead of rounding to nothing.
   *  Floors at the authored value (devFactor ≥ 1). */
  flatCost(base: number): number {
    return Math.round(base * this.devFactor());
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
    this.recordPortfolioAction('science'); // Phase 18: science minister loyalty
    return true;
  }

  /** Cancel the active research (progress is lost). */
  cancelResearch(): void {
    this.activeResearch = null;
    this.researchProgress = 0;
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
    // Phase 11: additional clean-energy and carbon-pricing multipliers
    if (this.has('solar_wind_parity')) intensity *= 0.85;
    if (this.has('ev_adoption')) intensity *= 0.85;
    if (this.passedLaws.has('carbon_pricing')) intensity *= 0.75;
    if (this.passedLaws.has('cap_trade_law')) intensity *= 0.65;
    // Proven clean tech diffuses from a greening rival world even to a passive
    // player (GDD §5.6) — so a green century pulls everyone's chimneys down a
    // little, the inverse of "one green player can't solo-fix the sky". An active
    // player still does far more via their own tech/laws above.
    intensity *= 1 - this.worldGreenShare() * PLAYER_GREEN_DIFFUSION;
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
    // Emergent world green transition: the rival world decarbonizes on its own
    // initiative at a seed-varying rate (see worldGreenShare) — the term that makes
    // the climate timeline diverge across runs instead of always drowning.
    const greenFactor = 1 - this.worldGreenShare() * WORLD_GREEN_MAX_CUT;
    return worldPop * 0.045 * ramp * decarb * diffusion * accordFactor * greenFactor;
  }

  /** The mean clean-energy propensity of the current rival world, set by its
   *  archetype mix (ARCHETYPE_GREEN_PROPENSITY). Fixed at worldgen, so it is the
   *  deterministic, per-seed dial that makes one century's world greener than
   *  another's. Defaults to a middling 0.4 when no rivals exist. */
  private archetypeGreenShare(): number {
    if (this.rivals.length === 0) return 0.4;
    let sum = 0;
    for (const rv of this.rivals) sum += ARCHETYPE_GREEN_PROPENSITY[rv.archetype] ?? 0.3;
    return sum / this.rivals.length;
  }

  /** Fraction [0,1] of the rival world that has transitioned to clean energy by
   *  now — the emergent decarbonization force in `worldEmissions`. It climbs from
   *  `WORLD_GREEN_START_YEAR` toward the archetype-set ceiling over
   *  `WORLD_GREEN_RAMP_YEARS`, accelerated by the visible climate crisis (warming
   *  urgency). Pure arithmetic over already-deterministic state — no RNG, no new
   *  serialized field — so two same-seed runs decarbonize identically, but
   *  different seeds (different archetype draws) reach 2100 on different curves. */
  private worldGreenShare(): number {
    const ceiling = this.archetypeGreenShare();
    const ramp = Math.max(0, Math.min(1, (this.year - WORLD_GREEN_START_YEAR) / WORLD_GREEN_RAMP_YEARS));
    const urgency = Math.max(0, Math.min(1, this.warmingC / WORLD_GREEN_URGENCY_C));
    return ceiling * ramp * (WORLD_GREEN_BASE + (1 - WORLD_GREEN_BASE) * urgency);
  }

  /** The thin blue ghost-line (GDD §8.2): where the ledger lands by 2100
   *  if the current rate holds (discounted for the world's own transition). */
  projectedWarming(): number {
    const ticksLeft = Math.max(0, (CENTURY_YEAR - this.year) * 2);
    const ppm2100 = this.co2ppm + (this.playerEmissions() + this.worldEmissions()) * ticksLeft * 0.85;
    return Math.max(0, (ppm2100 - CO2_BASE_PPM) * WARMING_PER_PPM);
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
  decideBranch(): void {
    // `projectedWarming` extrapolates today's emission rate FLAT to 2100 — a fair
    // estimate for a static world, but pessimistic when the rival world is actively
    // bending its own curve (worldGreenShare): a transition already under way keeps
    // deepening, so the realized 2100 warming lands below the flat projection. The
    // verdict therefore credits the world's mitigation — which is what lets a green
    // century (high archetype green-share) escape the Drowned sky even when the
    // naive projection still reads high, and is why the era branch now DIVERGES
    // across seeds instead of always drowning. A do-nothing world earns no credit.
    const proj = Math.max(0, this.projectedWarming() - this.worldGreenShare() * DROWNED_GREEN_RELIEF);
    const pops = this.settlements.filter((t) => this.popOf(t) >= 1);
    const avgSat = pops.length > 0 ? pops.reduce((s, t) => s + t.satisfaction, 0) / pops.length : 50;
    const gov = GOV_TYPES.find((g) => g.id === this.govType);
    const democratic = gov ? gov.electionsRequired : this.has('universal_suffrage');
    let branch: EraBranch;
    const yearLabel = this.year < EARLY_SOLARPUNK_YEAR ? EARLY_SOLARPUNK_YEAR : BRANCH_YEAR;

    // Early solarpunk: beat the oil barons before 1990 to lock in the green path now
    if (this.beatOilBarons && this.year >= EARLY_SOLARPUNK_YEAR && democratic && avgSat >= 42 && proj < 2.3) {
      branch = 'solarpunk';
      this.addLog(
        `THE EARLY GARDEN: The oil barons are routed. Renewable energy sweeps the grid — solar and wind ` +
        `now outpace coal. The 1990s opens under glass and green; the projected waterline retreats from the streets.`,
        'good',
      );
    } else if (proj >= 2.3) {
      branch = 'drowned';
      this.addLog(
        `THE DROWNED CENTURY: Year ${yearLabel}, and the projection is now a tide table. The sea is coming ` +
        `for the coastal streets — wall them, move them, or mourn them.`,
        'bad',
      );
    } else if (!democratic || avgSat < 42 || (this.nationProclaimed && this.legitimacy < 35)) {
      branch = 'dystopia';
      this.addLog(
        `THE NEON CENTURY: Year ${yearLabel} arrives behind checkpoints and billboards. The economy roars; ` +
        `the people queue in its light and grumble in its shadow.`,
        'bad',
      );
    } else {
      branch = 'solarpunk';
      this.addLog(
        `THE GARDEN CENTURY: Year ${yearLabel} opens under glass and green. The grid hums clean, the ` +
        `squares are planted, and the projected waterline stays on the chart, not in the streets.`,
        'good',
      );
    }
    this.eraBranch = branch;
    // Phase 11: refine the branch with renewables/automation context
    this.determineSpeculativeBranch();
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

  /** Cost of partial flood-proofing (cheaper than a sea wall, only partial coverage). */
  floodProofCost(t: Settlement): number {
    return Math.round(80 + this.popOf(t) * 0.15);
  }

  canFloodProof(townId: number): boolean {
    const t = this.settlement(townId);
    if (!t || !t.site.coastal || t.seaWall || t.floodProofed) return false;
    return this.stateProclaimed && this.year >= 2020;
  }

  /** Flood-proof a coastal settlement: raised thresholds, pumps, floodgates.
   *  Cuts tidal damage by 50% — cheaper and faster than a sea wall. */
  buildFloodProof(townId: number): boolean {
    const t = this.settlement(townId);
    if (!t || !this.canFloodProof(townId)) return false;
    const cost = this.floodProofCost(t);
    if (this.treasury < cost) return false;
    this.treasury -= cost;
    t.floodProofed = true;
    this.addLog(
      `Flood barriers and raised thresholds installed at ${t.name} — ` +
      `tidal damage halved. ${formatCurrency(cost)} between the streets and the sea.`,
      'good',
    );
    return true;
  }

  /** Cost of managed retreat: high and politically brutal, permanent relief. */
  managedRetreatCost(t: Settlement): number {
    return Math.round(180 + this.popOf(t) * 0.25);
  }

  canManagedRetreat(townId: number): boolean {
    const t = this.settlement(townId);
    if (!t || !t.site.coastal) return false;
    return this.stateProclaimed && this.year >= 2025;
  }

  /** Relocate a coastal settlement inland: permanently ends flooding, but the
   *  political and social damage is severe — satisfaction craters for years
   *  (GDD §8.2: "politically brutal, necessary late-game in worst scenarios"). */
  doManagedRetreat(townId: number): boolean {
    const t = this.settlement(townId);
    if (!t || !this.canManagedRetreat(townId)) return false;
    const cost = this.managedRetreatCost(t);
    if (this.treasury < cost) return false;
    this.treasury -= cost;
    t.site = { ...t.site, coastal: false };
    t.floodProofed = false;
    t.seaWall = false;
    t.satisfaction = Math.max(0, t.satisfaction - 30);
    t.grievance = Math.min(100, t.grievance + 25);
    this.addLog(
      `MANAGED RETREAT: ${t.name} withdraws from the waterline at ${formatCurrency(cost)}. ` +
      `The old harbour district is sealed and abandoned. ` +
      `Relief will outlast the grief, but grief comes first.`,
      'bad',
    );
    return true;
  }

  /** 1 Jan 2100: the Century Report (GDD §8.4) — a verdict, not a win
   *  screen. The sandbox keeps running afterward if you wish. */
  buildCenturyReport(): void {
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
    const wonders = Object.values(this.wonderOwner).filter((f) => f === this.playerFactionId).length;
    const verdict =
      `A century after twelve settlers stepped off a wagon, ${pop.toLocaleString()} people live here ` +
      `${this.eraBranch ? branchLine[this.eraBranch] : 'on the old frontier'}. ` +
      `The air carries ${Math.round(this.co2ppm)} ppm and +${this.warmingC.toFixed(1)}°C of the century's heat. ` +
      (wonders > 0 ? `${wonders} wonder${wonders === 1 ? '' : 's'} of the age stand to your name. ` : '') +
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
      wonders,
      prestige: Math.round(this.prestige),
      legitimacy: Math.round(this.legitimacy),
      grades: { stewardship, prosperity, liberty, standing },
      verdict,
    };
    this.addLog(`1 JANUARY 2100 — THE CENTURY REPORT. ${verdict}`, 'info');
    this.addLog('The century is over; the country is not. The sandbox runs on.', 'info');
    this.checkCenturyWins();
  }

  // ---- Phase 11: Renewables, Automation & Carbon Pricing ----

  /** Enact Universal Basic Support — a monthly stipend for workers displaced
   *  by automation. Requires the universal_basic_support law to be passed.
   *  Returns true if newly activated, false if already active or prerequisites unmet. */
  enactUniversalBasicSupport(): boolean {
    if (this.ubsActive) return false;
    if (!this.passedLaws.has('universal_basic_support')) return false;
    this.ubsActive = true;
    this.addLog(
      'UNIVERSAL BASIC SUPPORT: the automation dividend is socialized — every displaced worker receives a monthly stipend. ' +
      'Satisfaction rises; the automation treadmill slows.',
      'good',
    );
    return true;
  }

  /** Determine the speculative 2040 branch from Phase 11 conditions.
   *  This runs at BRANCH_YEAR alongside decideBranch() and refines the
   *  eraBranch toward the three Phase 11 paths, but ONLY if Phase 11 tech
   *  (solar_wind_parity or ai_automation) is present — without those technologies,
   *  the original decideBranch() verdict stands and this is a no-op.
   *
   *   - 'solarpunk': green tech + civic equity + low warming + democracy
   *   - 'corporatocracy': automation-heavy without civic equity (maps to 'dystopia')
   *   - 'drowned': unchecked warming (maps to existing 'drowned')
   *
   *  Sets speculativeBranch and may narrow eraBranch accordingly. */
  determineSpeculativeBranch(): void {
    if (this.speculativeBranch !== null) return; // verdict already read

    // Phase 11 only activates when the new tech era has arrived
    const phase11Active = this.has('solar_wind_parity') || this.has('ai_automation');
    if (!phase11Active) {
      // Mirror the eraBranch verdict as the speculative path without changing anything
      this.speculativeBranch = this.eraBranch as 'solarpunk' | 'corporatocracy' | 'drowned' | null === 'drowned'
        ? 'drowned'
        : this.eraBranch === 'solarpunk'
          ? 'solarpunk'
          : 'corporatocracy';
      return;
    }

    const proj = this.projectedWarming();
    const hasGreen = this.has('solar_wind_parity') && this.has('battery_storage');
    const hasCivicEquity = this.passedLaws.has('universal_basic_support') ||
      this.passedLaws.has('green_industry_act');
    const highAutomation = this.automationUnemployment > 0.12;
    const demGov = (() => {
      const g = GOV_TYPES.find((x) => x.id === this.govType);
      return g ? g.electionsRequired : this.has('universal_suffrage');
    })();

    let branch: 'solarpunk' | 'corporatocracy' | 'drowned';
    if (proj >= 2.3) {
      branch = 'drowned';
    } else if (hasGreen && hasCivicEquity && demGov && this.warmingC < 2.0) {
      branch = 'solarpunk';
    } else {
      branch = 'corporatocracy'; // automation without equity = neon future
    }

    this.speculativeBranch = branch;

    // Map to existing eraBranch taxonomy
    if (branch === 'solarpunk') this.eraBranch = 'solarpunk';
    else if (branch === 'drowned') this.eraBranch = 'drowned';
    else this.eraBranch = 'dystopia'; // corporatocracy is the dystopia path

    // Epilogue beats — flavored for Phase 11 realities
    const epilogue: Record<'solarpunk' | 'corporatocracy' | 'drowned', string> = {
      solarpunk:
        `SOLARPUNK 2040: the grid runs clean, the panels tile every south-facing roof, and the battery banks ` +
        `hum through the night. Automation's gains were shared — the UBS stipend freed people to work less and ` +
        `live more. The stranded-asset write-downs are history now, absorbed by policy and forgotten in the ` +
        `green of new industry.`,
      corporatocracy:
        `CORPORATOCRACY 2040: the economy roars on automation rails — output climbs, but the wages follow ` +
        `a flatter curve. The city towers belong to the information sector; the displaced sit outside them ` +
        `with gig contracts and grievances. The sky is not yet on fire, but the political temperature is rising ` +
        `faster than the thermometer.`,
      drowned:
        `DROWNED CENTURY 2040: the projection became a tide table. Fossil infrastructure was never stranded ` +
        `because the transition never came — now the infrastructure itself goes underwater. Coastal streets ` +
        `are pumped, not paved; the insurance maps have blank patches where the models refuse to quote.`,
    };

    this.addLog(epilogue[branch], branch === 'solarpunk' ? 'good' : 'bad');

    // Extra satisfaction/grievance consequence
    if (branch === 'corporatocracy' && highAutomation) {
      for (const t of this.settlements) {
        t.grievance = Math.min(100, t.grievance + 10);
      }
    }
    if (branch === 'solarpunk') {
      for (const t of this.settlements) {
        t.satisfaction = Math.min(100, t.satisfaction + 5);
      }
    }
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
      this.routes.push({ a: aId, b: bId, kind, condition: 100, path: c.path, terrainCost: c.cost, freight: 0, cargoType: null, cargoPriority: null });
    }
    this._routePathCache.clear(); // route graph changed (new link or kind upgrade)
    this.activeRailRoutes = this.routes.filter((r) => r.kind === 'rail' && r.condition > 50).length;
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
    this._routePathCache.clear(); // route kind changed (downgrade to trail)
    const a = this.settlement(aId)?.name ?? '?';
    const b = this.settlement(bId)?.name ?? '?';
    this.addLog(`The ${was} between ${a} and ${b} is torn up — only a trail remains.`, 'bad');
    this.activeRailRoutes = this.routes.filter((rt) => rt.kind === 'rail' && rt.condition > 50).length;
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
  /** BFS over the route graph. Memoized per tick (`_routePathCache`, cleared at
   *  tick start and on any route add/remove/kind-change) because the monthly
   *  trade/caravan/migration passes call it O(n²) times over settlement pairs —
   *  the dominant superlinear cost as the map fills with rival towns. `mode`
   *  selects the edge filter ('no-trail' excludes footpaths); paths are only ever
   *  consumed for length/connectivity/freight, so caching the (possibly reversed)
   *  path is sound. The reload-keeps-ticking determinism test guards correctness. */
  private routePath(fromId: number, toId: number, mode: 'all' | 'no-trail' = 'all'): Route[] | null {
    if (fromId === toId) return [];
    const key = fromId + ':' + toId + ':' + mode;
    const cached = this._routePathCache.get(key);
    if (cached !== undefined) return cached;
    const result = this.computeRoutePath(fromId, toId, mode);
    this._routePathCache.set(key, result);
    return result;
  }

  private computeRoutePath(fromId: number, toId: number, mode: 'all' | 'no-trail'): Route[] | null {
    const usable = mode === 'no-trail' ? (r: Route) => r.kind !== 'trail' : null;
    const prev = new Map<number, { via: Route; from: number }>();
    const seen = new Set([fromId]);
    const queue = [fromId];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const r of this.routes) {
        if (usable && !usable(r)) continue;
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
    this._routePathCache.clear(); // fresh route memo: this is also a direct test entry point
    const pop = this.popOf(t);
    return this.settlements.some(
      (o) => o !== t && this.popOf(o) > pop && this.routePath(t.id, o.id, 'no-trail') !== null,
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

  /** Set the route maintenance budget level (0–1.5). 1.0 fully funds upkeep. */
  setRouteBudget(level: number): void {
    this.routeBudget = Math.max(0, Math.min(1.5, level));
  }

  /** Projected monthly route-maintenance spend at the current budget level —
   *  what the slider will actually draw from the treasury this month. */
  routeUpkeepProjected(): number {
    let total = 0;
    for (const r of this.routes) {
      if (r.kind === 'trail') continue;
      total += this.maintBill(r) * this.routeBudget;
    }
    return total;
  }

  /** Monthly upkeep on built links from the treasury — an unmaintained
   *  empire rots. Rail crews cost more than road gangs. The routeBudget knob
   *  (Issue #16) scales how much the treasury spends and how fast routes mend:
   *  full funding holds and improves them, underfunding lets them degrade. */
  private maintainRoutes(): void {
    const investmentBonus = this.policyActive('public_investment') ? 2 : 0;
    let rotting = false;
    let starved = false;
    for (const r of this.routes) {
      if (r.kind === 'trail') continue;
      const bill = this.maintBill(r) * this.routeBudget;
      if (this.treasury >= bill) {
        this.treasury -= bill;
        // Net condition: at budget 1.0 → +8; at 0 → −6 (no spend, full rot);
        // capped at +12 when over-funding for rapid repair. Public Investment
        // adds its bonus only when at least fully funded.
        const delta = Math.min(12, -6 + 14 * this.routeBudget) + (this.routeBudget >= 1 ? investmentBonus : 0);
        if (delta >= 0) {
          r.condition = Math.min(100, r.condition + delta);
        } else {
          r.condition = Math.max(ROUTE_CONDITION_FLOOR, r.condition + delta);
          if (this.routeBudget > 0) rotting = true;
        }
      } else {
        // Couldn't afford even the reduced bill — routes rut over regardless.
        r.condition = Math.max(ROUTE_CONDITION_FLOOR, r.condition - 6);
        starved = true;
      }
    }
    if (starved && this.rng.chance(0.3)) {
      this.addLog('No coin for the road and rail gangs — the built routes are rutting over.', 'bad');
    } else if (rotting && this.rng.chance(0.2)) {
      this.addLog('The maintenance budget is lean — roads and rails are slowly degrading.', 'info');
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
      factionStrengths: new Map(activeFactions(START_YEAR).map(f => [f.id, 50] as [NewFactionId, number])),
      sectors: defaultSectors(),
      buildings: [],
      placedBuildings: [],
      placedDistricts: [],
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

    // Add extra founding Notables (4-6 total) beyond those mapped from settlers
    const extraRoles: NotableRole[] = ['Granger', 'Forewoman', 'Reeve'];
    const extraBackstories = [
      'A rural landowner facing the agrarian crisis, betting everything on fresh land.',
      'A labour organizer who survived the Red Scare and sought a new beginning.',
      'A colonial administrator returned from overseas, seeking to build something lasting.',
    ];
    const extraFactions = ['landowners', 'workers', 'merchants'];
    const extraCount = Math.max(0, 4 - region.notables.length); // ensure at least 4 notables total
    for (let i = 0; i < extraCount; i++) {
      const role = extraRoles[i % extraRoles.length];
      region.notables.push({
        id: region.nextId++,
        name: (() => {
          const first = ['Edda', 'Tomas', 'Sela', 'Bruno', 'Petra', 'Anders', 'Ivy', 'Casimir'][region.rng.int(8)];
          const last = ['Weller', 'Stroud', 'Halvorsen', 'Quint', 'Mercer', 'Dunmore'][region.rng.int(6)];
          return `${first} ${last}`;
        })(),
        age: 28 + region.rng.int(28),
        traits: [],
        role,
        settlementId: home.id,
        bio: [`Founding settler, 1900.`, `Named ${role} at the founding.`],
        alive: true,
        skill: 40 + region.rng.int(36),
        health: 80 + region.rng.int(21),
        children: [],
        loyalty: 90,
        factionAlignment: extraFactions[i % extraFactions.length],
        backstory: extraBackstories[i % extraBackstories.length],
        yearEnteredRole: region.year,
        monthsIgnored: 0,
      });
    }

    const mayor = region.notables.find((n) => n.role === 'Mayor' && n.alive);
    region.addLog(
      `The Great War has ended. Empires lie shattered. ${home.name} is founded, ${START_YEAR} — ` +
      `a small claim in the wreckage, the first stone of a nation yet unnamed.` +
      (mayor ? ` ${mayor.name} leads as Mayor.` : ''),
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

  // ---- Phase 17: Era Starts (GDD §8.8) ----

  /**
   * Build a pre-formed nation starting in 1950 or 2000, skipping the
   * colony→state arc. The map seed, weather, and rng come in as a design
   * object so the caller can wire them up to the worldgen pipeline.
   */
  static fromEraStart(
    era: '1950' | '2000',
    opts: {
      seed: number;
      nationName?: string;
      govType?: string;
      startingBias?: 'industrial' | 'agrarian' | 'commercial' | 'balanced';
      scenarioId?: string;
      difficultySettings?: Partial<DifficultySettings>;
    },
  ): RegionSim {
    const seed = opts.seed;
    const rng = new Rng(seed);
    const map = new RegionMap(seed);
    const weather = new Weather(seed);
    const bias = opts.startingBias ?? 'balanced';

    // Compute the starting minute offset from 1919 to the desired era year
    const targetYear = era === '1950' ? 1950 : 2000;
    const yearOffset = targetYear - START_YEAR;
    const startMinute = yearOffset * DAYS_PER_YEAR * MINUTES_PER_DAY;

    const r = new RegionSim(rng, startMinute, map, weather);

    // Wire up basic nation-state flags immediately
    r.stateProclaimed = true;
    r.ceremonyPending = false;
    r.nationProclaimed = true;
    r.stateName = opts.nationName ?? (era === '1950' ? 'The Republic' : 'The Nation');
    r.nationName = opts.nationName ?? (era === '1950' ? 'The Republic' : 'The Nation');
    r.govType = (opts.govType ?? 'democracy') as GovType;
    const govDef = GOV_TYPES.find((g) => g.id === r.govType) ?? GOV_TYPES[0];
    r.legitimacy = govDef.startingLegitimacy;
    r.activePolicies = new Array(govDef.policySlots.length).fill(null);
    r.rebuildPolicySet();
    r.lenders = createInitialLenders();

    // ---- Build settlements ----
    const numSettlements = era === '1950' ? 3 : 5;
    const claimedCells: { x: number; y: number }[] = [];

    // Helper to add a settlement
    const addSettlement = (name: string, popBands: number[], isMajor: boolean): void => {
      // Find a suitable site
      let site: TownSite | null = null;
      if (claimedCells.length === 0) {
        site = map.startSite('river-valley');
      } else {
        const anchorCell = claimedCells[0];
        site = map.bestSiteNear(anchorCell.x, anchorCell.y,
          claimedCells.map((c) => ({ x: c.x, y: c.y })));
      }
      if (!site) return;

      claimedCells.push({ x: site.cellX, y: site.cellY });
      const coord = map.cellToCoord(site.cellX, site.cellY);
      const totalPop = popBands.reduce((a, b) => a + b, 0);
      const food = totalPop * 8;
      const wood = totalPop * 3;

      const townFocus: TownFocus = bias === 'industrial' ? 'industry'
        : bias === 'agrarian' ? 'agriculture'
        : bias === 'commercial' ? 'services'
        : 'balanced';

      const settlement: Settlement = {
        id: r.nextId++,
        name,
        x: coord.rx,
        y: coord.ry,
        foundedDay: 0,
        cohorts: { bands: popBands },
        food,
        wood,
        satisfaction: 65,
        housing: Math.round(totalPop * 1.4),
        landQuality: site.fertility,
        site,
        lastRaidDay: -99,
        lastFloodDay: -99,
        strikeUntil: -1,
        grievance: 10,
        prices: defaultPrices(),
        recentEvents: [],
        factionId: r.playerFactionId,
        garrisonStrength: isMajor ? 20 : 10,
        stationedUnits: [],
        loyaltyToFaction: 90,
        factionStrengths: new Map(activeFactions(targetYear).map((f) => [f.id, 50] as [NewFactionId, number])),
        sectors: defaultSectors(),
        buildings: [],
        placedBuildings: [],
        placedDistricts: [],
        construction: null,
        focus: townFocus,
        activeEvents: [],
        policies: { ...DEFAULT_CITY_POLICIES },
      };
      r.settlements.push(settlement);
      r.revealTiles(settlement.x, settlement.y, 14, 'explored');
    };

    if (era === '1950') {
      // Cold War start: 3 settlements
      const popMult = bias === 'agrarian' ? 1.2 : bias === 'industrial' ? 0.9 : 1.0;
      const totalTarget = Math.round((800 + rng.int(401)) * popMult); // 800–1200
      const smallPop  = Math.round(totalTarget * 0.20);
      const medPop    = Math.round(totalTarget * 0.30);
      const largePop  = totalTarget - smallPop - medPop;
      const distSmall  = [Math.round(smallPop*0.18), Math.round(smallPop*0.32), Math.round(smallPop*0.28), Math.round(smallPop*0.15), Math.round(smallPop*0.07)];
      const distMed    = [Math.round(medPop*0.18), Math.round(medPop*0.32), Math.round(medPop*0.28), Math.round(medPop*0.15), Math.round(medPop*0.07)];
      const distLarge  = [Math.round(largePop*0.18), Math.round(largePop*0.32), Math.round(largePop*0.28), Math.round(largePop*0.15), Math.round(largePop*0.07)];
      addSettlement(opts.nationName ? `${opts.nationName} City` : 'Capital City', distLarge, true);
      addSettlement('Ironwick', distMed, false);
      addSettlement('Havenford', distSmall, false);

      // Pre-researched technologies for the 1950 era
      r.researched = new Set([
        'steam_power', 'common_law',
        'agriculture', 'combustion_engine', 'electrification',
        'mass_production', 'printing_press',
      ]);
      r.treasury = 15000 + rng.int(10000); // mid-range Cold War treasury

      // Active rivals (3) with varied relations, reflecting Cold War tensions
      for (let i = 0; i < 3; i++) r.spawnRival();
      // Set rival relations to reflect Cold War world (-10 to +20)
      for (const rv of r.rivals) {
        rv.relations = r.clampRel(-10 + rng.int(31)); // -10 to +20
      }

      // Military faction stronger: Cold War tension
      const mf = r.factions.find((f) => f.id === 'workers');
      if (mf) mf.power = Math.min(100, mf.power + 15);

      r.addLog(
        `Scenario: 1950 Cold War Era start. The nation enters a world in tension between superpowers.`,
        'info',
      );

    } else {
      // Information age start: 4-5 settlements
      const popMult = bias === 'agrarian' ? 1.0 : bias === 'industrial' ? 1.1 : bias === 'commercial' ? 1.2 : 1.05;
      const totalTarget = Math.round((2000 + rng.int(1501)) * popMult); // 2000–3500

      const shares = [0.35, 0.25, 0.18, 0.12, 0.10]; // largest to smallest
      const actualNum = numSettlements; // 5
      const names = ['Capital Metropolitan', 'Northport', 'Eastbridge', 'Millford', 'Southwick'];
      for (let i = 0; i < actualNum; i++) {
        const townPop = Math.round(totalTarget * shares[i]);
        const bands = [
          Math.round(townPop * 0.18),
          Math.round(townPop * 0.25),
          Math.round(townPop * 0.30),
          Math.round(townPop * 0.18),
          Math.round(townPop * 0.09),
        ];
        addSettlement(names[i], bands, i === 0);
      }

      // Pre-researched technologies for 2000 era
      r.researched = new Set([
        'steam_power', 'common_law',
        'agriculture', 'electrification', 'mass_production',
        'computing', 'digital_economy', 'antibiotics', 'renewables',
        'civil_rights', 'welfare_benefits',
        // Conditionally include universal_suffrage if it exists in the tech tree
        ...(TECH_TREE.some((t) => t.id === 'universal_suffrage') ? ['universal_suffrage'] : []),
      ]);

      // Historical CO₂ and warming for year 2000
      r.co2ppm = 368;
      r.warmingC = 0.7;

      // Higher treasury — information age economy
      r.treasury = 80000 + rng.int(40000);

      // Active rivals (5) with complex relation web
      for (let i = 0; i < 5; i++) r.spawnRival();

      r.addLog(
        `Scenario: Year 2000 start. Your nation enters the information age with modern infrastructure.`,
        'info',
      );
    }

    // Initialize the faction system over the first settlement
    if (r.settlements.length > 0 && r.regionalFactions.length === 0) {
      r.regionalizeFactionSystem(r.settlements[0]);
      // Assign all player settlements to player faction
      const pf = r.faction(r.playerFactionId);
      if (pf) pf.settlementIds = r.settlements.filter((s) => s.factionId === r.playerFactionId).map((s) => s.id);
    }

    // Mint notable leaders for the capital
    if (r.settlements.length > 0) {
      for (const role of ['Mayor', 'Doctor', 'Captain'] as NotableRole[]) {
        r.mintNotable(role, r.settlements[0].id);
      }
    }

    // Wire up scenario fields
    r.activeScenario = opts.scenarioId ?? null;
    if (opts.difficultySettings) {
      r.difficultySettings = { ...DEFAULT_DIFFICULTY_SETTINGS, ...opts.difficultySettings };
    }

    // Apply difficulty from scenario
    const scenario = SCENARIOS.find((s) => s.id === r.activeScenario);
    if (scenario) {
      if (scenario.difficulty === 'hard') {
        r.difficultySettings.crisisFrequency = 1.5;
        r.difficultySettings.aiAggression = 1.5;
        r.difficultySettings.economicVolatility = 1.5;
      } else if (scenario.difficulty === 'brutal') {
        r.difficultySettings.crisisFrequency = 2.0;
        r.difficultySettings.aiAggression = 2.0;
        r.difficultySettings.economicVolatility = 2.0;
        // Climate emergency: CO₂ already at 400ppm
        if (scenario.id === 'climate_emergency') {
          r.co2ppm = 400;
          r.warmingC = 1.2;
        }
      }
      if (scenario.govLock) {
        r.beginRegimeLocked(scenario.govLock);
      }
      r.addLog(scenario.openingEvent, 'info');
    }

    return r;
  }

  // ---- Phase 17: Regime-Locked Challenge Starts ----

  /**
   * Lock the government type for 30 years — the constitutional guarantee
   * prevents any regime change until govLockExpiry.
   */
  beginRegimeLocked(govType: string): void {
    this.govLockExpiry = this.year + 30;
    this.govType = govType as GovType;
    const govDef = GOV_TYPES.find((g) => g.id === govType);
    if (govDef) {
      this.activePolicies = new Array(govDef.policySlots.length).fill(null);
      this.rebuildPolicySet();
    }
    this.addLog(
      `The ${govType} is established — and constitutionally guaranteed for thirty years.`,
      'info',
    );
  }

  /** Returns true if the government is currently locked by scenario rules. */
  isGovLocked(): boolean {
    return this.govLockExpiry !== null && this.year < this.govLockExpiry;
  }

  // ---- Phase 17: Scenario Goal Checks ----

  /** Called monthly; checks each active scenario goal and marks completions. */
  checkScenarioGoals(): void {
    if (!this.activeScenario) return;
    const scenario = SCENARIOS.find((s) => s.id === this.activeScenario);
    if (!scenario) return;

    for (const goal of scenario.startingGoals) {
      if (this.scenarioGoalsCompleted.includes(goal.id)) continue;
      const checkFn = (this as unknown as Record<string, () => boolean>)[goal.checkFn];
      if (typeof checkFn === 'function' && checkFn.call(this)) {
        this.scenarioGoalsCompleted.push(goal.id);
        this.addLog(
          `SCENARIO GOAL ACHIEVED: ${goal.description}`,
          'good',
        );
      }
    }
  }

  // ---- Scenario goal check functions ----

  goalSurviveTo2000(): boolean {
    return this.year >= 2000 && !this.gameOver;
  }

  goalMaintainDemocracy1990(): boolean {
    return this.year >= 1990 && (this.govType === 'democracy' || this.govType === 'republic');
  }

  goalReach100kPop(): boolean {
    return this.totalPop() >= 100000;
  }

  goalResearchAI2030(): boolean {
    return this.year < 2030 && this.has('ai_automation');
  }

  goalResolvePolarization2045(): boolean {
    // Proxy: high satisfaction + passed civil_rights law = low polarization
    const avgSat = this.avgSatisfaction();
    return this.year <= 2045 && avgSat >= 70 && this.passedLaws.has('civil_rights');
  }

  goalNetZero2040(): boolean {
    return this.year <= 2040 && this.playerEmissions() <= 0;
  }

  goalAvoidDrowned(): boolean {
    return this.eraBranch !== 'drowned';
  }

  /** Site selection and travel time come from the terrain, not dice. */
  private launchExpedition(from: Settlement, pop: number, food: number, wood: number): boolean {
    const fromCell = this.map.coordToCell(from.x, from.y);
    const claimed = this.settlements
      .map((s) => this.map.coordToCell(s.x, s.y))
      .concat(this.expeditions.map((e) => this.map.coordToCell(e.targetX, e.targetY)));
    const site = this.map.bestSiteNear(fromCell.x, fromCell.y, claimed);
    if (!site) return false;
    return this.launchExpeditionTo(from, site, pop, food, wood);
  }

  /** Launch an expedition toward an explicit, already-chosen site (the
   *  click-to-found path) — identical bookkeeping to the auto-sited variant, so
   *  both share the same RNG-consuming name draw and expedition record. */
  private launchExpeditionTo(from: Settlement, site: TownSite, pop: number, food: number, wood: number): boolean {
    const fromCell = this.map.coordToCell(from.x, from.y);
    const target = this.map.cellToCoord(site.cellX, site.cellY);
    const travel = this.map.travelDays(fromCell.x, fromCell.y, site.cellX, site.cellY);
    const name = this.townNamePool.length > 0
      ? this.townNamePool.splice(this.rng.int(this.townNamePool.length), 1)[0]
      : `New Town ${this.settlements.length + 1}`;
    this.expeditions.push({
      fromId: from.id, x: from.x, y: from.y,
      targetX: target.rx, targetY: target.ry,
      pop, food, wood,
      departDay: this.day, arrivesDay: this.day + travel,
      name, site,
    });
    return true;
  }

  /** Whether the player may found a new town AT a chosen map location
   *  (click-to-found). Same resource/treasury/cap gates as `canFoundTown`, but it
   *  validates the *chosen* site: settleable land, ≥ `MIN_SETTLEMENT_SPACING` from
   *  any town or pending expedition, and within an expedition's reach of the
   *  source town. */
  canFoundAt(fromId: number, rx: number, ry: number): { ok: boolean; reason: string } {
    const t = this.settlement(fromId);
    if (!t) return { ok: false, reason: 'no settlement' };
    if (this.settlements.length + this.expeditions.length >= MAX_SETTLEMENTS) {
      return { ok: false, reason: 'region fully settled' };
    }
    const m = this.expansionCostMult();
    const needPop = Math.round(24 * m), needFood = Math.round(80 * m), needWood = Math.round(80 * m);
    const foundCost = this.foundingCost();
    if (this.treasury < foundCost) return { ok: false, reason: `founding costs ${formatCurrency(foundCost)}` };
    if (this.popOf(t) < needPop) return { ok: false, reason: `needs ${needPop} pop` };
    if (t.food < needFood) return { ok: false, reason: `needs ${needFood} food` };
    if (t.wood < needWood) return { ok: false, reason: `needs ${needWood} wood` };
    if (rx < 0 || rx > 100 || ry < 0 || ry > 100) return { ok: false, reason: 'off the map' };
    const cell = this.map.coordToCell(rx, ry);
    if (this.map.siteScore(cell.x, cell.y) < 0) return { ok: false, reason: 'cannot settle water or mountains' };
    const tooClose = this.settlements.some((s) => Math.hypot(s.x - rx, s.y - ry) < MIN_SETTLEMENT_SPACING)
      || this.expeditions.some((e) => Math.hypot(e.targetX - rx, e.targetY - ry) < MIN_SETTLEMENT_SPACING);
    if (tooClose) return { ok: false, reason: 'too close to an existing town' };
    const fromCell = this.map.coordToCell(t.x, t.y);
    const range = Math.round(REGION_N * 0.28);
    if (Math.hypot(cell.x - fromCell.x, cell.y - fromCell.y) > range) {
      return { ok: false, reason: 'too far from your towns to reach' };
    }
    return { ok: true, reason: '' };
  }

  /** Found a new town at a player-chosen location: launches an expedition toward
   *  the chosen site and pays the founding cost (pop/food/wood/treasury). */
  foundTownAt(fromId: number, rx: number, ry: number): boolean {
    const check = this.canFoundAt(fromId, rx, ry);
    const t = this.settlement(fromId);
    if (!check.ok || !t) return false;
    const m = this.expansionCostMult();
    const food = Math.round(80 * m), wood = Math.round(80 * m);
    const cell = this.map.coordToCell(rx, ry);
    if (!this.launchExpeditionTo(t, this.map.siteAt(cell.x, cell.y), 8, food, wood)) return false;
    this.removePop(t, 8);
    t.food -= food;
    t.wood -= wood;
    const foundCost = this.foundingCost();
    this.treasury -= foundCost;
    const e = this.expeditions[this.expeditions.length - 1];
    const days = e.arrivesDay - this.day;
    this.addLog(
      `An expedition of 8 sets out from ${t.name} for ${e.name} — ${days} days, bound for the ` +
      `site you chose${e.site.river ? ' by the river' : ''}${e.site.coastal ? ' on the coast' : ''} ` +
      `(charter fee: ${formatCurrency(foundCost)}).`,
      'info',
    );
    return true;
  }

  // ---- main loop: one tick = 30 game-minutes ----
  /** Calendar acceleration per tier keeps decision density constant while spanning centuries.
   *  Applies after mid-game (1950+) to avoid breaking early progression. */
  private calendarAcceleration(): number {
    // Calendar speeds up in late mid-game and beyond to compress centuries into ~4-hour sessions.
    // Year-based thresholds ensure consistent pacing regardless of proclamation flags.
    if (this.year < 1950) return 1; // Discovery & exploration: normal pace
    if (this.year < 2000) return 2; // State/nation eras: moderate speedup
    return 1.5; // Late game (2000-2100): slower than mid for decision depth
  }

  tick(): void {
    if (this.gameOver) return;
    if (this._routePathCache.size) this._routePathCache.clear(); // fresh route memo each tick
    const prevDay = this.day;
    this.minute += REGION_MINUTES_PER_TICK * this.calendarAcceleration();
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
        // Apply reduction factors only to positive (building) pressure, not to negative
        // (recovering) pressure — otherwise labor_law would slow grievance recovery.
        const basePressure = Math.max(0, this.taxRate - 0.15) * 35 - this.servicesLevel * 0.4 - Math.max(0, t.satisfaction - 55) * 0.05;
        const pressure =
          Math.max(0, basePressure) * laborFactor * constabFactor +
          Math.min(0, basePressure) +
          (this.eraBranch === 'dystopia' ? 0.15 : 0); // the neon century simmers
        t.grievance = Math.max(0, Math.min(100, t.grievance + pressure));
      }
      this.updateMarket(t);
      // Starvation: every town draws a seasonal emergency grain purchase from its
      // OWNING faction's purse (the player's treasury, or a rival faction's) —
      // once per 30 days, scaled to population. Rival towns used to get no relief
      // and starved outright, which capped rival growth; parity lets a solvent
      // rival feed its people too. A famine only kills where the purse is empty.
      if (t.food < 0) {
        const isPlayer = t.factionId === this.playerFactionId;
        const rivalFaction = isPlayer ? null : this.faction(t.factionId);
        const purse = isPlayer ? this.treasury : (rivalFaction?.treasury ?? 0);
        const pay = (c: number) => { if (isPlayer) this.treasury -= c; else if (rivalFaction) rivalFaction.treasury -= c; };
        if (purse >= 10) {
          const daysSinceLast = this.day - (t.lastEmergencyGrainDay ?? -9999);
          if (daysSinceLast >= 30) {
            // 30 days of full consumption — enough to last a season change
            const relief = Math.max(500, Math.round(this.popOf(t) * 0.75 * 30));
            const cost = Math.max(10, Math.ceil(relief / 50));
            if (purse >= cost) {
              t.food += relief;
              t.lastEmergencyGrainDay = this.day;
              pay(cost);
              if (t.food < 0) {
                const starved = Math.min(pop * 0.01, -t.food / 20);
                this.removePop(t, starved);
                t.food = 0;
                if (isPlayer) {
                  this.addLog(`Famine in ${t.name} — emergency grain bought, but not enough.`, 'bad');
                  this.townEvent(t, 'Famine — emergency rations exhausted.', 'bad');
                }
              } else if (isPlayer) {
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
          if (isPlayer && starved > 0.5 && this.rng.chance(0.2)) {
            this.addLog(`Hunger stalks ${t.name} — the granary is empty.`, 'bad');
            this.townEvent(t, 'Granary empty — hunger in the streets.', 'bad');
          }
        }
      }
    }
    abandonGhostTowns(this);
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
    // Update per-frame cached values so main loop reads fields instead of allocating.
    let tf = 0, tw = 0, mg = 0;
    for (const s of this.settlements) {
      tf += s.food;
      tw += s.wood;
      if (s.grievance > mg) mg = s.grievance;
    }
    this.totalFood = tf;
    this.totalWood = tw;
    this.maxGrievance = mg;

    tickResearch(this);
    this.checkElection();
    if (this.day % 30 === 0) this.monthlyUpdate();
    if (this.day >= this.nextEventDay) {
      this.fireEvent();
      // Isolationism policy reduces incident frequency by 35%
      const eventGap = this.policyActive('isolationism') ? 7 + this.rng.int(8) : 4 + this.rng.int(5);
      this.nextEventDay = this.day + eventGap;
    }
    this.updateExpeditions();
    updateCharter(this);
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
    this.cacheSectorProductivity();

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
    this.wageCache = new Map(this.settlements.map((t) => [t.id, this.avgWageOf(t)]));
    this.tickRegionalEvents(); // Phase 4: disasters and windfalls
    tickPollution(this);       // Phase 14: pollution diffusion (systems/pollution.ts)
    this.tickUtilities();      // Phase 14: power/water/waste utilities
    tickServiceCoverage(this); // Phase 14: service coverage effects (systems/services.ts)
    // Phase 14: update land value for each player settlement
    for (const t of this.settlements) {
      if (t.factionId === this.playerFactionId) {
        t.landValue = this.computeLandValue(t.id);
      }
    }
    updateRouteCargo(this);   // Phase 6: cargo labels follow sector surplus (systems/trade.ts)
    this.migrate();
    this.caravans();
    this.traders();
    this.navalTradeIncome();
    tickNotableLifecycle(this);
    // The treasury runs even before the Charter: pre-statehood the Mayor still
    // taxes the towns and pays for services/militia, so the player has real
    // economic levers to climb out of a deficit toward the £8k Charter gate
    // (otherwise the only pre-State income is trade tolls and the books can only
    // sink). Nation-tier machinery (factions/diplomacy/central bank) stays gated.
    this.monthlyEconomy();
    if (this.stateProclaimed) this.updateFactions();
    if (this.stateProclaimed) this.updateSettlementFactions();
    updateDiplomacy(this);
    this.applyProvincePolicyEffects(); // Phase 5: province governance effects
    updateArmyMovement(this);         // Phase 7: army marching, battles (systems/military.ts)
    tickRivalArmyAI(this);            // Phase 7: rival army planning
    consumeWarSupply(this); // deplete supply reserves based on army size and supply consumption rate
    tickMobilization(this);           // Phase 16: mobilization effects
    tickSupplyLines(this);            // Phase 16: supply line decay for army groups
    tickOccupation(this);             // Phase 16: occupation resistance
    if (this.playerWar) tickWarSupport(this); // Phase 16: war support
    this.updateRivalAI(); // staggered AI updates for rivals (GDD §6.2)
    this.updateScouts(); // update faction scouts: movement, spawning, expiry (GDD §6.2)
    tickClimate(this); // the ledger runs from the first decade (GDD §8.2)
    tickAutomation(this); // Phase 11: automation unemployment drift
    checkStrandedAssets(this); // Phase 11: fossil write-downs as clean energy arrives
    if (this.hasCentralBank()) tickMonetary(this);
    tickHistoricalAnchors(this); // scripted world-events that rhyme with history (systems/historical.ts, GDD §1)
    this.tickMedia(); // Phase 12: media reach, press freedom, misinformation era
    this.checkScenarioGoals();   // Phase 17: check active scenario goals monthly
    updateLoans(this); // process loan interest and check for defaults (systems/loans.ts)
    if (this.stateProclaimed) this.collectVassalTribute();
    this.checkProclamationGate();
    this.checkWinConditions();
    // Early solarpunk trigger: beaten the oil barons when renewables are cheap + available tech
    if (!this.beatOilBarons && this.year >= 1980 && this.year < EARLY_SOLARPUNK_YEAR) {
      const hasRenewables = this.has('solar_cells') || this.has('wind_power') || this.has('hydro_power');
      const hasFossilMult = this.has('coal_mining') && this.has('oil_refining');
      const playerFaction = this.faction(this.playerFactionId);
      const hasStrongEconomy = playerFaction && playerFaction.treasury > 5000;
      // Green victory: renewables tech + strong economy + hasn't relied on fossil fuels = beat the oil barons
      if (hasRenewables && hasStrongEconomy && !hasFossilMult) {
        this.beatOilBarons = true;
        this.addLog(
          `The oil barons are losing ground — renewable energy is now cheaper than coal. ` +
          `Hydropower, wind, and solar plants sweep across the region. The path to green prosperity opens.`,
          'good',
        );
      }
    }
    // Great Depression depth: decay ~5%/month, trigger recovery crossroads at month 12.
    if (this.depressionDepth > 0.01) {
      this.depressionDepth = Math.max(0, this.depressionDepth * 0.95);
      if (this.depressionDepth < 0.01) this.depressionDepth = 0;
      this.crashMonthCounter++;
      // Stimulus path: drain treasury each month for 24 months
      if (this.crashRecoveryChoice === 'stimulus' && this.stimulusMonthsLeft > 0) {
        this.treasury -= 8;
        this.stimulusMonthsLeft--;
      }
      // At 12 months post-crash, invite the player to choose a recovery path
      if (this.crashMonthCounter === 12 && this.crashRecoveryChoice === null) {
        this.crashRecoveryChoice = 'pending';
        this.addLog(
          'RECOVERY CROSSROADS: The depression is deep but not endless. Two paths open: ' +
          'Stimulus — deficit spending and public works restart the engine faster, but cost the treasury £8/month for two years. ' +
          'Austerity — balance the budget; services take a hit but the books stay clean. Choose in the State panel.',
          'info',
        );
      }
    }

    // Phase 13: Population & Society Depth
    tickDemographicTransition(this);
    tickAppealMigration(this);
    tickUnrestLadder(this);
    this.tickOpinionDynamics();
    // Push education coverage to lag buffer once a year (month 0 = January)
    if (this.month === 0) {
      tickEducationLag(this);
      this.tickStatsHistory();
    }

    // Phase 15: Intermediate goods, arbitrage, and FX tick
    tickIntermediateGoods(this); // Phase 15: intermediate-goods production + cascade (systems/goods.ts)
    tickPriceArbitrage(this); // Phase 15: price arbitrage + cargo shipments (systems/arbitrage.ts)
    tickFX(this); // Phase 15: exchange-rate / regime-crisis tick (systems/monetary.ts)

    // Record monthly history for sparklines (last 12 months)
    const gdp = this.settlements.reduce((s, t) => s + SECTOR_IDS.reduce((ss, id) => ss + t.sectors[id].output, 0), 0);
    this.monthlyHistory.push({ gdp, treasury: this.treasury, inflation: this.inflationRate * 100, employment: 100 });
    if (this.monthlyHistory.length > 12) this.monthlyHistory.shift();
    this.sectorProdCache = null;
    this.wageCache = null;
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
  triggerEpilogueEvent(): void {
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

  /** The epilogue beats that have actually fired since 2100, for the epilogue
   *  scroll (GDD §8.5). Resolves triggered ids back to their narrative text. */
  epilogueBeats(): Array<{ id: string; text: string; kind: 'good' | 'info' | 'bad' }> {
    const pool = this.getEpilogueEventPool();
    return pool.filter((e) => this.triggeredEpilogueEvents.has(e.id));
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
    // Phase 18: Advisor System Depth (GDD §8.7)
    this.generateAdvisorBriefs();
    tickAdvisorLoyalty(this);
    tickAdvisorEvents(this);
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
    this._routePathCache.clear(); // fresh route memo: this is also a direct test entry point
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

  /** True if the player has a Harbor built in any of their settlements. */
  hasHarbor(): boolean {
    return this.settlements.some(
      (t) => t.factionId === this.playerFactionId && t.buildings.includes('harbor'),
    );
  }

  /** Monthly: harbors generate sea-trade income; warships add a naval-supremacy
   *  premium that also deters coastal rivals. */
  private navalTradeIncome(): void {
    const harborTowns = this.settlements.filter(
      (t) => t.factionId === this.playerFactionId && t.buildings.includes('harbor'),
    );
    if (harborTowns.length === 0) return;
    const warships = this.playerWar?.units.find((u) => u.type === 'warship')?.count ?? 0;
    // Base income per harbor (£/month) plus a warship escort premium
    const perHarbor = 12 + warships * 2;
    const income = harborTowns.length * perHarbor;
    this.treasury += income;
    if (this.rng.chance(0.3)) {
      const town = harborTowns[this.rng.int(harborTowns.length)];
      this.addLog(
        `Sea trade earns ${formatCurrency(income)} this month — ${town.name}'s harbor is busy.`,
        'good',
      );
    }
  }

  /** Grain caravans ride the route network (M6b): surplus towns provision
   *  hungry ones, but every leg clamps to its route's remaining capacity —
   *  a famine behind a goat trail is now possible, and fixable with money.
   *  Public so tests and the harness can run a caravan season directly. */
  caravans(): void {
    if (this.settlements.length < 2) return;
    this._routePathCache.clear(); // fresh route memo: this is also a direct test entry point
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
    if (this.hasCentralBank()) {
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
    // Wagner's law (GDD §5.2): the cost of running a developed state is a share of
    // GDP that climbs with the services and defense the player funds — public
    // salaries and procurement are priced at prevailing wages, so the bill tracks
    // the economy instead of staying a flat per-head pittance. A gentle development
    // lift nudges the late-century share up (welfare state, complex bureaucracy) to
    // lean against the productivity boom without tipping the budget into a deficit
    // spiral. This is the dominant sink that keeps the treasury honest: at the
    // default tax (10%) and funded services/militia the budget runs a slim surplus,
    // so cranking services or a standing army (or cutting taxes) stays a real
    // fiscal decision rather than a treasury that balloons past the point where
    // anything costs anything.
    // svc1/mil1 lands at ~9% of GDP — below the default 10% tax take (8.5% under a
    // council's collection penalty), so a nation funded at the defaults runs a slim
    // surplus, while svc2/mil2 (~15.5%) demands the income-tax civic and a higher
    // rate. The development lift is deliberately gentle: a steeper one tips the
    // information-era budget into a deficit spiral once productivity (and the
    // GDP-share bill) booms.
    const devShare = (this.modernizationIndex() + this.informationIndex()) / 2; // 0 → 1
    const publicSector =
      gdp * (0.025 + 0.04 * this.servicesLevel * serviceCost + 0.025 * this.militiaLevel) * (1 + devShare * 0.15);
    const spending =
      publicSector +
      this.settlements.length * 5 + // administration
      this.buildingUpkeep() + // Phase 2: the civic works keep their lights on
      this.policyServiceUpkeep() + // Phase 5: generous city services cost the treasury
      this.policyUpkeep() + // active policy running costs
      (this.passedLaws.has('welfare_benefits') ? this.gdpLastMonth * 0.02 : 0) + // welfare relief payments
      (warMob ? pop * warMob.upkeepPerPop : 0) + // …and the drain runs concurrently (GDD §7.2)
      (this.playerWar?.blockade ? pop * BLOCKADE_UPKEEP_PER_POP : 0) + // coal and crews for the gunboats
      (this.publicMediaFunded ? gdp * 0.008 : 0); // Phase 12: public media upkeep (0.8% GDP/month)
    // Income Tax (civic research): a progressive levy adds 3% of GDP on top
    const incomeTaxBonus = this.has('income_tax') ? this.gdpLastMonth * 0.03 : 0;
    // Central Banking (civic research): a national reserve adds a further 1% of GDP
    const centralBankingBonus = this.has('central_banking') ? this.gdpLastMonth * 0.01 : 0;
    // Estate Tax law: a wealth levy on the land
    const estateLevyBonus = this.estateTaxActive ? this.totalPop() * 0.1 : 0;
    // Progressive Taxation law: graduated bands yield 2% extra of GDP
    const progressiveTaxBonus = this.passedLaws.has('progressive_tax') ? this.gdpLastMonth * 0.02 : 0;
    // Protectionism policy: a tariff wall raises ~0.8% of GDP (scales with the
    // economy rather than the vestigial flat £3 from the pre-GDP-budget era)
    const protectionismBonus = this.policyActive('protectionism') ? this.gdpLastMonth * 0.008 : 0;
    // Austerity policy: belt-tightening trims ~1.5% of GDP off the budget (paid in
    // satisfaction elsewhere); GDP-scaled so it stays meaningful against the
    // GDP-scaled public-sector bill
    const austerityBonus = this.policyActive('austerity') ? this.gdpLastMonth * 0.015 : 0;
    // Central Bank Charter: treasury earns interest at the policy rate
    const bankInterest = this.hasCentralBank() ? this.treasury * (this.policyRate / 12) : 0;
    // Carbon Levy law: the smoke pays 1% of GDP into the treasury
    const carbonLevyBonus = this.passedLaws.has('carbon_levy') ? this.gdpLastMonth * 0.01 : 0;
    // Trade agreements (GDD §5.4): export earnings per signed rival, scaled to
    // GDP and the rival's commerce appetite. Foreign wars make buyers pay more.
    // FX boost (GDD §5.1): a devalued currency makes exports cheaper for buyers.
    const warBoom = this.day < this.warBoomUntil ? 1.5 : 1;
    const fxBoost = this.hasCentralBank() ? 1 / Math.max(0.5, this.exchangeRate) : 1;
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
    // A trade bloc (GDD §6.5) layers extra preferential earnings on top.
    this.exportEarningsLastMonth += this.blocTradeBonus();
    // Phase 6: rival trade blocs and sanctions suppress export income
    const blocFriction = this.rivalBlocTariffFriction();
    const sanctionFriction = this.sanctionPressureOnPlayer();
    if (blocFriction > 0 || sanctionFriction > 0) {
      this.exportEarningsLastMonth *= Math.max(0, 1 - blocFriction - sanctionFriction);
    }
    // Great Depression: global trade volumes suppressed while depressionDepth > 0.
    // At depth=1.0 trade is at ~45% of normal; recovers as depth fades over ~30 months.
    if (this.depressionDepth > 0.01) {
      this.exportEarningsLastMonth *= Math.max(0.3, 1 - this.depressionDepth * 0.55);
    }
    // Supply-chain shock chokes exports (GDD §5.2, the trade leg): a nation short
    // on fuel/components/food has less surplus to sell abroad. Reads the same
    // below-the-era-baseline severity as the output drag and the cost-push (cached
    // supplyChainHealth — monthlyEconomy runs before tickIntermediateGoods, a
    // one-month lag), so it is exactly 0 in healthy play → ×1 → byte-identical;
    // only a real cascade trims exports. Bounded by SUPPLY_SHOCK_EXPORT_DRAG.
    const supplyExportSeverity = this.supplyShockSeverity();
    if (supplyExportSeverity > 0) {
      this.exportEarningsLastMonth *= 1 - supplyExportSeverity * SUPPLY_SHOCK_EXPORT_DRAG;
    }
    // Phase 15: Monetary regime effects on economy
    // Gold standard: slight deflation pressure
    if (this.currencyRegime === 'gold_standard') {
      this.inflationRate = Math.max(-0.05, this.inflationRate - 0.002);
    }
    // Fiat at very low rates: inflation creep
    if (this.currencyRegime === 'fiat' && this.policyRate < 0.02) {
      this.inflationRate = Math.min(0.50, this.inflationRate + 0.003);
    }
    // Currency union: export earnings ×1.15
    if (this.currencyRegime === 'currency_union') {
      this.exportEarningsLastMonth *= 1.15;
    }
    // fxBoost from devalue(): export earnings ×fxBoost
    if (this.fxBoost > 1.0) {
      this.exportEarningsLastMonth *= this.fxBoost;
    }
    const treasuryBefore = this.treasury;
    this.treasury += revenue - spending + incomeTaxBonus + centralBankingBonus + estateLevyBonus +
      progressiveTaxBonus + protectionismBonus + austerityBonus + bankInterest + carbonLevyBonus + this.exportEarningsLastMonth;

    // Treasury milestone events (fire once per milestone, never on re-crossing)
    if (this.treasury > 0) {
      for (const milestone of [1000, 5000, 10000, 25000, 50000]) {
        if (treasuryBefore < milestone && this.treasury >= milestone && !this.loggedTreasuryMilestones.has(milestone)) {
          this.loggedTreasuryMilestones.add(milestone);
          this.addLog(`Treasury reaches ${formatCurrency(milestone)} — a growing power.`, 'good');
        }
      }
    }

    if (this.treasury < 0) {
      this.treasury = 0;
      if (this.servicesLevel > 0) {
        this.servicesLevel--;
        this.addLog('The treasury is empty — services are cut back. The towns notice.', 'bad');
      }
    }
    this.maintainRoutes();
    tickLegitimacy(this);
    tickRegimeMechanics(this);
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
    this.recordPortfolioAction('treasury'); // Phase 18: treasury minister loyalty
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

  /** Public for systems/monetary.ts (tickMonetary refreshes the rating). Also
   *  called by issueBonds. */
  computeCreditRating(): CreditRating {
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

  // ---- Phase 15: Intermediate Goods, Supply Chains, Arbitrage & FX (GDD §5.2) ----

  // --- Intermediate-goods stock ledger (now PER SETTLEMENT) ---
  // Every read/write of the goods ledger flows through these accessors. The
  // backing store is `Settlement.goodStocks` (good id → units, per town); the
  // nation-wide totals the production/consumption/supply-chain logic reads are the
  // SUM across towns. Production is split across settlements by the output of the
  // sector that makes the good, and a draw is taken greedily across towns — so the
  // aggregate every reader sees moves exactly as the old single nation-wide pool
  // did (the supply chain is economy-neutral), while the storage is now the
  // per-town store the "consume / ship goods where produced" work builds on.

  /** Current nation-wide stock of a good, in units (0 if untracked everywhere) —
   *  the sum over every settlement's per-town ledger. */
  goodStock(goodId: string): number {
    let total = 0;
    for (const t of this.settlements) total += t.goodStocks?.[goodId] ?? 0;
    return total;
  }

  /** Whether ANY settlement tracks this good (distinct from "tracked, at 0"). A raw
   *  with no ledger entry anywhere resolves through its extracting sector rather
   *  than from stock — see `rawSupplyLevel`. */
  hasGoodStock(goodId: string): boolean {
    for (const t of this.settlements) {
      if (t.goodStocks !== undefined && goodId in t.goodStocks) return true;
    }
    return false;
  }

  /** Add produced units to a good's stock, distributed across settlements by the
   *  output of the sector that makes it (`goodProducingSector`). The aggregate is
   *  unchanged (Σ over towns == qty: every contributing town but the last gets its
   *  proportional share, the last gets the exact remainder so no float drift), so
   *  `goodStock` — and therefore the economy — is byte-identical to the old
   *  single-pool deposit. When no town reports output in the producing sector
   *  (pre-industrial years, a bare test fixture), the units bank in the capital so
   *  none are lost. */
  produceGood(goodId: string, qty: number): void {
    if (qty <= 0) return;
    const ts = this.settlements;
    if (ts.length === 0) return;
    const sector = goodProducingSector(goodId);
    const weight = (t: Settlement): number => Math.max(0, t.sectors?.[sector]?.output ?? 0);
    let totalW = 0;
    let lastPos = -1;
    for (let i = 0; i < ts.length; i++) {
      const w = weight(ts[i]);
      totalW += w;
      if (w > 0) lastPos = i;
    }
    if (totalW <= 0) {
      this.addGoodStock(this.capitalSettlement() ?? ts[0], goodId, qty);
      return;
    }
    let assigned = 0;
    for (let i = 0; i < ts.length; i++) {
      const w = weight(ts[i]);
      if (w <= 0) continue;
      const share = i === lastPos ? qty - assigned : (qty * w) / totalW;
      this.addGoodStock(ts[i], goodId, share);
      assigned += share;
    }
  }

  /** Draw units from a TRACKED good's stock, floored at 0 in aggregate. Drained
   *  greedily across settlements in order, so the nation-wide total falls by exactly
   *  min(qty, total) — identical to the old single-pool `max(0, pool − qty)` — using
   *  only subtraction (no division), so the floor lands on an exact value. A no-op
   *  when the good isn't tracked anywhere (a raw input proxied by its extracting
   *  sector) — exactly the old `if (stock[input] !== undefined)` guard. */
  drawGood(goodId: string, qty: number): void {
    if (qty <= 0 || !this.hasGoodStock(goodId)) return;
    let remaining = qty;
    for (const t of this.settlements) {
      if (remaining <= 0) break;
      const have = t.goodStocks?.[goodId];
      if (have === undefined || have <= 0) continue;
      const take = Math.min(have, remaining);
      t.goodStocks![goodId] = have - take;
      remaining -= take;
    }
  }

  /** Ensure a good has a ledger entry, seeding it to 0 in the capital if no town
   *  tracks it yet, so a good that produced nothing this month still appears in the
   *  ledger. No-op if already tracked anywhere (never overwrites a stock). */
  seedGoodStock(goodId: string): void {
    if (this.hasGoodStock(goodId)) return;
    const cap = this.capitalSettlement() ?? this.settlements[0];
    if (cap !== undefined) this.addGoodStock(cap, goodId, 0);
  }

  /** Lazily create a settlement's per-town ledger and add `qty` to a good.
   *  Public so the extracted arbitrage system (systems/arbitrage.ts) can credit a
   *  shipment's cargo to the destination town on arrival. */
  addGoodStock(t: Settlement, goodId: string, qty: number): void {
    (t.goodStocks ??= {})[goodId] = (t.goodStocks[goodId] ?? 0) + qty;
  }

  /** Debit up to `max` units of a good from a town's ledger for shipment, returning
   *  the amount actually moved (≤ the town's holding, never negative — a town with
   *  none ships nothing). The dispatch complement of `addGoodStock` (the arrival
   *  credit); used by the trade-flow pipeline to relocate real goods between towns.
   *  Public so the extracted arbitrage system (systems/arbitrage.ts) can debit the
   *  source town on dispatch. */
  shipGoodFrom(t: Settlement, goodId: string, max: number): number {
    if (max <= 0) return 0;
    const have = t.goodStocks?.[goodId] ?? 0;
    const moved = Math.min(max, have);
    if (moved > 0) t.goodStocks![goodId] = have - moved;
    return moved;
  }

  /** The settlement that banks unattributed deposits — a legacy-save migration, a
   *  zero-output early-game seed: the player's capital, else the first settlement.
   *  Public so the extracted goods system (systems/goods.ts) can route the
   *  no-producing-sector-output fallback of the per-town supply solve (PR-3 slice 2)
   *  to the same town `produceGood` does. */
  capitalSettlement(): Settlement | undefined {
    const capId = this.faction(this.playerFactionId)?.capital;
    return this.settlements.find((s) => s.id === capId) ?? this.settlements[0];
  }

  /** The derived nation-wide ledger (good id → summed units across all towns). No
   *  longer the serialized form — each settlement serializes its own `goodStocks` —
   *  but kept for the UI/debug aggregate view and as a stable read in tests. */
  goodStocksSnapshot(): Record<string, number> {
    const agg: Record<string, number> = {};
    for (const t of this.settlements) {
      if (t.goodStocks === undefined) continue;
      for (const id of Object.keys(t.goodStocks)) agg[id] = (agg[id] ?? 0) + t.goodStocks[id];
    }
    return agg;
  }

  /** Migrate a legacy nation-wide ledger (an old save's top-level
   *  `intermediateGoodStocks`) into the per-settlement store by depositing the whole
   *  pool into the capital — but ONLY when no settlement already carries per-town
   *  stocks, so a new save (whose stocks ride the settlement spread) is never
   *  clobbered. Absent/empty pool → no-op. */
  restoreGoodStocks(data: Record<string, number> | undefined): void {
    if (data === undefined) return;
    const ids = Object.keys(data);
    if (ids.length === 0) return;
    for (const t of this.settlements) {
      if (t.goodStocks !== undefined && Object.keys(t.goodStocks).length > 0) return;
    }
    const cap = this.capitalSettlement() ?? this.settlements[0];
    if (cap === undefined) return;
    for (const id of ids) this.addGoodStock(cap, id, data[id]);
  }

  /** How freely a raw material flows this period, 0..1 (1 = no constraint). An
   *  active embargo runs it at `1 − cut` (the oil-shock anchor, a future blockade);
   *  otherwise it's full if held in stock, else proxied from the sector that
   *  extracts it — extractive raws (coal/iron/wood/oil/…) off industry,
   *  agricultural raws (grain/livestock) off agriculture (see `sectorRawLevel`).
   *  The graded solver only ever queries this for raws; intermediate inputs resolve
   *  through the graph (the cascade). Pure read — the same source the live UI
   *  snapshot uses. In healthy play every raw returns exactly 1.0, so the chain is
   *  byte-identical; only an embargo or a strained extracting sector grades it down.
   *  Public so the extracted goods system (systems/goods.ts) and the UI snapshot can
   *  read it. */
  rawSupplyLevel(inputId: string): number {
    const embargo = this.rawEmbargoes[inputId];
    if (embargo !== undefined && this.day < embargo.until) {
      return Math.max(0, 1 - embargo.cut);
    }
    if (this.hasGoodStock(inputId)) {
      return this.goodStock(inputId) > 0 ? 1 : 0;
    }
    if (EXTRACTIVE_RAWS.has(inputId)) return this.sectorRawLevel('industry');
    if (AGRICULTURAL_RAWS.has(inputId)) return this.sectorRawLevel('agriculture');
    return 0;
  }

  /** Availability level [0,1] contributed by an extracting sector — the proxy for
   *  "is there enough mining/farming capacity to keep the raws flowing." Total
   *  shutdown (output 0) cuts the chain's root outright, as before; otherwise the
   *  level grades off how current output compares to the sector's trailing norm
   *  (`sectorOutputNorm`). At or above norm (steady/growing play) it's a full 1.0,
   *  so the chain stays byte-clean; a contraction below the deadband grades it down
   *  toward `RAW_SHORTAGE_MIN_LEVEL`, so an ordinary recession/disaster partly
   *  starves the chain and the bounded industry drag bites — not just embargoes or
   *  a literal collapse. Pure read (the norm is advanced in `tickIntermediateGoods`,
   *  not here), so the UI snapshot can call it freely. */
  private sectorRawLevel(sector: 'industry' | 'agriculture'): number {
    const output = this.settlements.reduce((s, t) => s + t.sectors[sector].output, 0);
    if (output <= 0) return 0; // total collapse — the chain's root is cut (as before)
    const norm = this.sectorOutputNorm[sector];
    if (norm <= 0) return 1; // norm not warmed yet (fresh/early game) — no fabricated shock
    const ratio = output / norm;
    if (ratio >= RAW_SHORTAGE_DEADBAND) return 1;
    if (ratio <= RAW_SHORTAGE_FLOOR) return RAW_SHORTAGE_MIN_LEVEL;
    // Linear from full (at the deadband) down to MIN_LEVEL (at the floor).
    const t = (ratio - RAW_SHORTAGE_FLOOR) / (RAW_SHORTAGE_DEADBAND - RAW_SHORTAGE_FLOOR);
    return RAW_SHORTAGE_MIN_LEVEL + t * (1 - RAW_SHORTAGE_MIN_LEVEL);
  }

  /** Advance each extracting sector's trailing output norm one month (EWMA). Seeds
   *  from the first non-zero output so the norm starts at parity (ratio 1, no
   *  phantom shock), then chases output at `SECTOR_NORM_ALPHA`. Called once per
   *  monthly supply tick; isolated here so `sectorRawLevel` stays a pure read.
   *  Public so the extracted goods system (systems/goods.ts) can advance the norms
   *  at the head of its tick. */
  advanceSectorOutputNorms(): void {
    for (const sector of ['industry', 'agriculture'] as const) {
      const output = this.settlements.reduce((s, t) => s + t.sectors[sector].output, 0);
      const norm = this.sectorOutputNorm[sector];
      this.sectorOutputNorm[sector] = norm <= 0 ? output : norm + (output - norm) * SECTOR_NORM_ALPHA;
    }
  }

  /** Returns the current supply chain health (0–1). */
  getSupplyChainHealth(): number {
    return this.supplyChainHealth;
  }

  /** Read-only supply-chain snapshot for the UI (GDD §5.4 legibility). Re-resolves
   *  the cascade live from current raw availability — supplied/disrupted per good,
   *  the active drag, and any standing embargoes with months remaining. Pure read:
   *  no RNG, no mutation, no stock-ledger side effects, so the panel can call it
   *  every frame. `disrupted`/`supplied` are id sets in catalog order. */
  supplyChainSnapshot(): {
    health: number;
    severity: number;
    outputMult: number;
    active: string[];
    disrupted: Set<string>;
    supplied: Set<string>;
    levels: Map<string, number>;
    embargoes: Array<{ raw: string; daysLeft: number; cut: number }>;
  } {
    const res = resolveSupplyChainGraded(INTERMEDIATE_GOODS, this.year, (id) => this.rawSupplyLevel(id));
    const embargoes: Array<{ raw: string; daysLeft: number; cut: number }> = [];
    for (const raw of Object.keys(this.rawEmbargoes)) {
      const daysLeft = this.rawEmbargoes[raw].until - this.day;
      if (daysLeft > 0) embargoes.push({ raw, daysLeft, cut: this.rawEmbargoes[raw].cut });
    }
    embargoes.sort((a, b) => a.raw.localeCompare(b.raw));
    return {
      health: res.health,
      severity: this.supplyShockSeverity(),
      outputMult: this.supplyShockOutputMult(),
      active: res.active,
      disrupted: res.disrupted,
      supplied: res.supplied,
      levels: res.levels,
      embargoes,
    };
  }

  /** Era-structural supply-chain health: what `supplyChainHealth` *would* be with
   *  every raw material flowing. A good unlocked before its intermediate inputs
   *  (vehicles 1925 needs components 1930) is structurally unsupplied through that
   *  window — that dip is the era boundary, not a shortage. Baselining the drag
   *  against it keeps healthy play unperturbed. Pure read; no RNG/state mutation. */
  private supplyChainBaselineHealth(): number {
    return resolveSupplyChainGraded(INTERMEDIATE_GOODS, this.year, () => 1).health;
  }

  /** How far actual supply health has fallen *below* the era-structural baseline,
   *  0..1. Zero whenever raws are flowing (actual == baseline) — i.e. in all
   *  healthy play; positive only when a real upstream shortage cascades downstream
   *  (deep depression / wartime industry shutdown, where total industry output
   *  hits zero and the raw proxy fails). This is the "the shock is genuine" signal. */
  supplyShockSeverity(): number {
    const baseline = this.supplyChainBaselineHealth();
    if (baseline <= 0) return 0;
    const shortfall = (baseline - this.supplyChainHealth) / baseline;
    return shortfall <= 0 ? 0 : Math.min(1, shortfall);
  }

  /** Industry-output multiplier from supply-chain shocks, in
   *  [1 − SUPPLY_SHOCK_MAX_DRAG, 1]. Exactly 1.0 in healthy play (so industry
   *  output, GDP and the RNG stream stay byte-identical); below 1.0 only while a
   *  real shortage cascades. Bounded so it can never zero industry. */
  supplyShockOutputMult(): number {
    return 1 - this.supplyShockSeverity() * SUPPLY_SHOCK_MAX_DRAG;
  }

  /** Compute the exchange rate from trade balance, interest rate, and confidence.
   *  rate = 1.0 + (tradeBalance / (gdp×100)) + (interestRate − 0.05)×2
   *  Applies fxBoost if active. Clamped to 0.5–2.0. */
  computeExchangeRate(): number {
    const gdp = Math.max(1, this.gdpLastMonth);
    const exports = this.exportEarningsLastMonth;
    const imports = this.totalPop() * 0.025; // proxy imports as per-pop spending
    const tradeBalance = exports - imports;
    const interestEffect = (this.policyRate - 0.05) * 2;
    const confidenceFactor = (this.confidence - 50) * 0.002;

    let rate = 1.0 + (tradeBalance / (gdp * 100)) + interestEffect + confidenceFactor;

    // Apply fxBoost (from devalue())
    if (this.fxBoost > 1.0) {
      // fxBoost is an export multiplier; its inverse weakens the rate slightly
      // but the export surge supports it. Net: fxBoost above 1 slightly raises rate
      rate *= 0.98 + this.fxBoost * 0.02;
    }

    return Math.max(0.5, Math.min(2.0, rate));
  }

  /** Devalue the currency by amount (0.1–0.3).
   *  Sets fxBoost for export surge, spikes inflation, creates diplomatic friction. */
  devalue(amount: number): void {
    const clampedAmount = Math.max(0.1, Math.min(0.3, amount));

    // Reduce exchange rate
    this.exchangeRate = Math.max(0.5, this.exchangeRate - clampedAmount);

    // Export multiplier from competitive pricing
    this.fxBoost = 1.0 + clampedAmount * 1.5;

    // Inflation spike
    this.inflationRate = Math.min(0.50, this.inflationRate + clampedAmount * 30);

    // Diplomatic friction: rivals resent the competitive devaluation
    for (const rv of this.rivals) {
      rv.relations = Math.max(-100, rv.relations - 5);
    }

    this.addLog(
      `CURRENCY DEVALUATION: Exchange rate cut by ${Math.round(clampedAmount * 100)}%. ` +
      `Exports surge as foreign buyers rush to capitalize on cheap prices — but inflation bites at home.`,
      'bad'
    );
  }

  /** Switch the currency regime.
   *  gold_standard: fixed rate 1.0, constrained policy rate, deflation risk.
   *  fiat: full monetary flexibility, inflation risk.
   *  currency_union: rate locked to partner, trade bonus +15%. */
  switchCurrencyRegime(regime: 'gold_standard' | 'fiat' | 'currency_union', partnerId?: number): void {
    const prev = this.currencyRegime;
    this.currencyRegime = regime;

    if (regime === 'gold_standard') {
      // Fix exchange rate at par
      this.exchangeRate = 1.0;
      // Constrain policy rate to 3–8%
      this.policyRate = Math.max(0.03, Math.min(0.08, this.policyRate));
      this.addLog(
        'Gold Standard adopted: exchange rate fixed at par. Policy rate constrained to 3–8%. ' +
        'Deflation risk if confidence wavers.',
        'info'
      );
    } else if (regime === 'fiat') {
      this.currencyUnionPartnerId = undefined;
      this.addLog(
        'Fiat currency regime: full monetary independence. Exchange rate floats with trade and confidence.',
        'info'
      );
    } else if (regime === 'currency_union') {
      if (partnerId !== undefined) {
        this.currencyUnionPartnerId = partnerId;
        // Lock exchange rate to partner's rate (approximate at 1.0 for now)
        this.exchangeRate = this.exchangeRates[`0:${partnerId}`] ?? 1.0;
        this.addLog(
          `Currency Union joined with rival ${partnerId}. Exchange rate locked. Trade flows +15%.`,
          'good'
        );
      }
    }

    if (prev !== regime) {
      // Confidence shift on regime change
      this.confidence = Math.max(5, Math.min(100, this.confidence + (regime === 'currency_union' ? 3 : -2)));
    }
  }

  // ---- Historical Anchors (GDD §1) ----

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

  private cacheSectorProductivity(): void {
    this.sectorProdCache = {} as Record<SectorId, number>;
    for (const id of SECTOR_IDS) {
      this.sectorProdCache[id] = this.sectorProductivity(id);
    }
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
      const perWorker = SECTOR_BASE_OUTPUT[id] * (this.sectorProdCache?.[id] ?? this.sectorProductivity(id)) * landTerm * (1 + this.buildingBonus(t, id));
      // Phase 4: active event modifiers (disasters reduce, windfalls boost)
      const eventMult = this.eventOutputMult(t, id);
      // Currency transition dents output until markets stabilize; the economic
      // system (design choice at nation flip) sets the steady-state multiplier.
      const fxMult = this.currencyEfficiency() * this.economyOutputMult();
      // A genuine supply-chain shock (raws collapse → cascade) drags manufacturing.
      // 1.0 in healthy play (era-baselined), so output stays byte-identical there.
      // PR-3 slice 3 — the LOCAL-goods drag rides the same industry channel: a
      // nation that can't put manufactured goods where they're needed makes less.
      // `localGoodsScarcity` is 0 in single-town / self-sufficient play (and under a
      // raw shock — it's a pure gate ratio), so this is ×1 there (byte-identical);
      // bounded so it never zeroes industry (no raw-proxy spiral).
      const supplyMult = id === 'industry'
        ? this.supplyShockMult * (1 - this.localGoodsScarcity * LOCAL_GOODS_OUTPUT_DRAG)
        : 1;
      // A hotter century erodes the farm economy past +1.5°C and industry past +3°C.
      const climateMult = id === 'agriculture' ? this.agriClimateMult()
        : id === 'industry' ? this.industryClimateMult()
        : 1;
      s.output = workers * s.share * perWorker * strike * loyalty * eventMult * svcMult * taxMult * fxMult * supplyMult * climateMult;
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

  /** WORLD MARKET reference price (£/unit) for a good — the single clearing price
   *  formed from total world supply vs. total world demand across EVERY faction's
   *  towns (leg 1 of the global-world arc; `systems/goods.ts`). Pure read-only:
   *  feeds telemetry only, no tick math → byte-identical. base when the world is
   *  self-sufficient (balanced play), dearer as the world runs collectively short. */
  worldGoodPrice(goodId: string): number {
    return worldGoodPrice(this, goodId);
  }

  /** WORLD MARKET scarcity ∈ [0,1] for a good — how far total world supply falls
   *  short of total world demand across EVERY faction (`systems/goods.ts`). 0 when
   *  the world holds at least its collective demand. Drives the world clearing price
   *  and the `localGoodPrice` world-anchor; pure read-only telemetry here. */
  worldGoodScarcity(goodId: string): number {
    return worldGoodScarcity(this, goodId);
  }

  /** WORLD MARKET tightness ∈ [0,1] — the demand-weighted mean world scarcity
   *  across every unlocked good; 0 when the world is collectively self-sufficient.
   *  The single-number read of the global market's state (pure, read-only). */
  worldMarketTightness(): number {
    return worldMarketTightness(this);
  }

  /** GREAT-POWER market pressure ∈ [−0.6, +0.6] — the demand-weighted mean of the
   *  off-map great powers' net pull on the world market: positive when they
   *  collectively tighten it (a great-power war, a warming-hit global breadbasket,
   *  isolationist hoarding), negative when a commercial power's surplus relieves it.
   *  The "world stage" read the on-map tightness can't show — pure, read-only. */
  worldPowerPressure(): number {
    return worldPowerPressure(this);
  }

  /** Employment-weighted average wage — the migration signal. */
  avgWageOf(t: Settlement): number {
    if (this.wageCache?.has(t.id)) return this.wageCache.get(t.id)!;
    return SECTOR_IDS.reduce((sum, id) => sum + t.sectors[id].share * t.sectors[id].wage, 0);
  }

  // ---- Phase 13: Demographic Transition (GDD §5.5) ----

  /** How educated is the nation — proxy via tech tree + services (0–100). */
  private educationLevel(): number {
    let score = 0;
    if (this.has('public_education')) score += 25;
    if (this.has('compulsory_schooling')) score += 20;
    if (this.has('secondary_education')) score += 15;
    if (this.passedLaws.has('national_education_act')) score += 20;
    score += this.servicesLevel * 5;
    return Math.min(100, score);
  }

  /** Fraction of player settlements that have a school or university building (0–1). */
  currentSchoolCoverage(): number {
    const playerSettlements = this.settlements.filter((t) => t.factionId === this.playerFactionId);
    if (playerSettlements.length === 0) return 0;
    const withSchool = playerSettlements.filter((t) =>
      t.buildings.includes('university') || this.has('public_education')
    ).length;
    return withSchool / playerSettlements.length;
  }

  /** Fraction of player settlements that are "urban" (pop > 200 or services-sector dominant). */
  private urbanizationFraction(): number {
    const playerSettlements = this.settlements.filter((t) => t.factionId === this.playerFactionId);
    if (playerSettlements.length === 0) return 0;
    const urban = playerSettlements.filter((t) =>
      this.popOf(t) > 200 || t.sectors.services.share > 0.35 || t.sectors.industry.share > 0.4
    ).length;
    return urban / playerSettlements.length;
  }

  /** Compute demographic transition phase from era, education, and urbanization. */
  computeDemographicPhase(): 'pre_transition' | 'early_transition' | 'late_transition' | 'post_transition' {
    const edu = this.educationLevel();
    const urban = this.urbanizationFraction();
    const yr = this.year;
    if (yr >= 2050 && edu >= 60 && urban >= 0.6) return 'post_transition';
    if (yr >= 1970 && edu >= 40 && urban >= 0.4) return 'late_transition';
    if (yr >= 1940 && (edu >= 20 || urban >= 0.2)) return 'early_transition';
    return 'pre_transition';
  }

  /**
   * Player nation weighted-average birth rate per 1000 population per year.
   * Base 35/1000 (1919), falls with education, urbanization, era, health.
   */
  globalBirthRate(): number {
    let rate = 35;
    const edu = this.educationLevel();
    // Education reduces birth rate: −5 per 25 points
    rate -= Math.floor(edu / 25) * 5;
    // Urbanization reduces birth rate: fraction × −8
    rate -= this.urbanizationFraction() * 8;
    // Post-1960 secular decline: −0.3 per year
    if (this.year > 1960) rate -= (this.year - 1960) * 0.3;
    // Health spending (services level proxy): −2 per level above baseline
    rate -= Math.max(0, this.servicesLevel - 1) * 2;
    // Floor: minimum replacement-level
    return Math.max(8, rate);
  }

  /**
   * Player nation weighted-average death rate per 1000 population per year.
   * Base 20/1000 (1919), falls with health spending and sanitation.
   */
  globalDeathRate(): number {
    let rate = 20;
    // Health buildings across player settlements
    const playerSettlements = this.settlements.filter((t) => t.factionId === this.playerFactionId);
    const totalHealthBuildings = playerSettlements.reduce((sum, t) =>
      sum + t.buildings.filter((b) => b === 'hospital').length, 0
    );
    const healthPerTown = playerSettlements.length > 0 ? totalHealthBuildings / playerSettlements.length : 0;
    rate -= healthPerTown * 2;
    // Sanitation via infrastructure (services level proxy × −3)
    rate -= this.servicesLevel * 3;
    // Post-1940 medical advances: −0.3 per year
    if (this.year > 1940) rate -= (this.year - 1940) * 0.3;
    // Floor: modern mortality minimum
    return Math.max(7, rate);
  }

  /**
   * Appeal score of a settlement for a given socioeconomic cohort class (0–100 pts).
   * Drives migration flows toward high-appeal settlements.
   */
  appealScore(settlementId: string, cohortClass: 'lower' | 'middle' | 'upper'): number {
    const t = this.settlements.find((s) => String(s.id) === String(settlementId));
    if (!t) return 0;
    const playerSettlements = this.settlements.filter((s) => s.factionId === this.playerFactionId);
    const maxWage = playerSettlements.reduce((m, s) => Math.max(m, this.avgWageOf(s)), 1);

    // Wages component (0–30 pts)
    const wageScore = (this.avgWageOf(t) / Math.max(1, maxWage)) * 30;

    // Housing cost component (0–20 pts): inversely proportional to size (bigger = more expensive)
    const pop = this.popOf(t);
    const housingScore = Math.max(0, 20 - (pop / Math.max(1, t.housing)) * 20);

    // Services component (0–20 pts): proportion of service buildings
    const maxBuildings = Math.max(1, REGION_BUILDINGS.length);
    const serviceScore = Math.min(20, (t.buildings.length / maxBuildings) * 20 * 3);

    // Safety component (0–15 pts): inverse of grievance
    const safetyScore = (1 - t.grievance / 100) * 15;

    // Liberty fit (0–15 pts): press freedom
    const libertyScore = (this.pressFreedom / 100) * 15;

    // Class-specific adjustments
    let classAdj = 0;
    if (cohortClass === 'upper') {
      // Upper class prefers low taxes and high services
      classAdj = this.taxRate < 0.1 ? 5 : -5;
    } else if (cohortClass === 'lower') {
      // Lower class weighs safety and services more
      classAdj = safetyScore > 10 ? 3 : -3;
    }

    return Math.max(0, Math.min(100, wageScore + housingScore + serviceScore + safetyScore + libertyScore + classAdj));
  }

  /** Projected skilled workforce fraction N years from now (from education pipeline lag). */
  projectedSkilledWorkforce(yearsAhead: number): number {
    const idx = Math.min(Math.max(0, Math.floor(yearsAhead)), 24);
    return this.educationLag[idx] ?? 0;
  }

  /**
   * Gini index (0–1) computed from wage distribution across cohort classes.
   * Uses income shares of lower and upper 30% approximation.
   */
  giniIndex(): number {
    const playerSettlements = this.settlements.filter((t) => t.factionId === this.playerFactionId);
    if (playerSettlements.length === 0) return 0;
    const totalPop = playerSettlements.reduce((s, t) => s + this.popOf(t), 0);
    if (totalPop === 0) return 0;
    // Average wage across player settlements
    const avgWage = playerSettlements.reduce((s, t) => s + this.avgWageOf(t) * this.popOf(t), 0) / totalPop;
    // Three cohort wage approximation
    const lowerWage = 0.4 * avgWage;
    const upperWage = 3.5 * avgWage;
    // Approximate class fractions: lower 40%, middle 40%, upper 20%
    const lowerPop = totalPop * 0.4;
    const middlePop = totalPop * 0.4;
    const upperPop = totalPop * 0.2;
    const totalIncome = lowerPop * lowerWage + middlePop * avgWage + upperPop * upperWage;
    if (totalIncome <= 0) return 0;
    const lowerIncomeFrac = (lowerPop * lowerWage) / totalIncome;
    const upperIncomeFrac = (upperPop * upperWage) / totalIncome;
    return Math.max(0, Math.min(1, upperIncomeFrac - lowerIncomeFrac));
  }

  /** HTML for the unrest ladder status indicator (used in Politics tab). */
  unrestLadderHtml(): string {
    const labels = ['Calm', 'Petitions', 'Strikes', 'Protests', 'Riots', 'Revolution'];
    const colors = ['#4CAF50', '#8BC34A', '#FFC107', '#FF9800', '#F44336', '#9C27B0'];
    const lvl = this.unrestLevel;
    const barItems = labels.map((lbl, i) => {
      const active = i <= lvl;
      return `<div class="unrest-rung${active ? ' unrest-active' : ''}" style="background:${active ? colors[i] : '#333'};flex:1;height:8px;margin:1px;border-radius:2px" title="${lbl}"></div>`;
    }).join('');
    return `<div style="margin-top:4px"><b>Unrest:</b> ${labels[lvl]} <small>(${this.unrestMonthsAtLevel} months)</small>` +
      `<div style="display:flex;margin-top:4px">${barItems}</div></div>`;
  }

  // ---- Phase 13: Monthly tick methods ----

  /** Sample annual stats for the Century Graph. Called each January from monthlyUpdate. */
  private tickStatsHistory(): void {
    const playerSettlements = this.settlements.filter((t) => t.factionId === this.playerFactionId);
    const pop = playerSettlements.reduce((s, t) => s + this.popOf(t), 0);
    const satisfaction =
      playerSettlements.length > 0
        ? playerSettlements.reduce((s, t) => s + t.satisfaction, 0) / playerSettlements.length
        : 0;
    this.statsHistory.push({
      year: this.year,
      gdp: this.gdpLastMonth * 12,
      pop,
      warmingC: this.warmingC,
      treasury: this.treasury,
      satisfaction,
    });
    if (this.statsHistory.length > STATS_HISTORY_MAX) this.statsHistory.shift();
  }

  /** Player action: crackdown on protests (rung 3). Workers relations −10. */
  crackdownProtests(): void {
    const workers = this.factions.find((f) => f.id === 'workers');
    if (workers) workers.support = Math.max(0, workers.support - 10);
    this.addLog('Crackdown ordered. Workers\' movement suppressed — for now.', 'info');
    // Briefly pause escalation
    this.unrestMonthsAtLevel = Math.max(0, this.unrestMonthsAtLevel - 1);
  }

  /** Player action: concede to protesters (rung 3). Cost 2% GDP, unrest −1 rung. */
  concedeToProtesters(): boolean {
    const gdp = Math.max(0, this.gdpLastMonth);
    const cost = gdp * 0.02;
    if (this.treasury < cost) return false;
    this.treasury -= cost;
    if (this.unrestLevel > 0) {
      this.unrestLevel = (this.unrestLevel - 1) as 0 | 1 | 2 | 3 | 4 | 5;
      this.unrestMonthsAtLevel = 0;
    }
    this.addLog(`Concessions granted. ${formatCurrency(Math.round(cost))} spent — unrest eases.`, 'good');
    return true;
  }

  /** Tick opinion dynamics: material drift, generational replacement, youthquakes. */
  tickOpinionDynamics(): void {
    const playerSettlements = this.settlements.filter((t) => t.factionId === this.playerFactionId);
    if (playerSettlements.length === 0) return;
    const totalPop = playerSettlements.reduce((s, t) => s + this.popOf(t), 0);
    if (totalPop === 0) return;

    // Estimate unemployment from strike/satisfaction proxy
    const avgSat = playerSettlements.reduce((s, t) => s + t.satisfaction * this.popOf(t), 0) / totalPop;
    // Proxy unemployment: low satisfaction + depression depth maps to unemployment
    const unemployment = Math.min(1, Math.max(0, (1 - avgSat / 100) * 0.3 + this.depressionDepth * 0.4));

    // 1. Material experience drift: unemployment → lower class ideology drifts to extremes
    const opinionVelocity = typeof (this as Record<string, unknown>).opinionVelocityFn === 'function'
      ? 1.0 : 1.0; // default 1.0 if Phase 12 not present
    if (unemployment > 0.15) {
      const drift = 0.5 * (unemployment) * opinionVelocity;
      // Apply as grievance pressure (proxy for ideology radicalization)
      for (const t of playerSettlements) {
        t.grievance = Math.min(100, t.grievance + drift * 0.3);
      }
    }

    // 2. Generational replacement: 1/40th of pop turns over each year (1/480 per month)
    const techResearchRate = this.researchRate();
    const genDriftInc = (1 / 480); // 1/40 per year / 12 months
    if (techResearchRate > 1.5) {
      this.generationalDrift = Math.min(1, this.generationalDrift + genDriftInc * 0.10); // 10% more progressive
    }

    // 3. 1968-analog youthquake (1965–1975, fires once)
    if (!this.youthquake1968Fired && this.year >= 1965 && this.year <= 1975) {
      if (this.generationalDrift > 0.3) {
        this.youthquake1968Fired = true;
        if (this.nationProclaimed) this.legitimacy = Math.max(0, this.legitimacy - 5);
        // Progressive faction surge
        const workers = this.factions.find((f) => f.id === 'workers');
        if (workers) workers.power = Math.min(100, workers.power + 8);
        this.addLog(
          'Youth movement reshapes national consciousness. A generation demands change — establishment legitimacy shaken.',
          'bad',
        );
      }
    }

    // 4. 2030s digital-generation youthquake (2028–2038, fires once)
    if (!this.youthquake2030Fired && this.year >= 2028 && this.year <= 2038) {
      if (this.automationUnemployment > 0.2) {
        this.youthquake2030Fired = true;
        if (this.nationProclaimed) this.legitimacy = Math.max(0, this.legitimacy - 5);
        const workers = this.factions.find((f) => f.id === 'workers');
        if (workers) {
          workers.power = Math.min(100, workers.power + 10);
          workers.support = Math.min(100, workers.support + 15);
        }
        this.addLog(
          'Digital generation demands restructuring. Automation-displaced workers demand a new social contract.',
          'bad',
        );
      }
    }

    // Update automation unemployment: rises post-2010 with information dominance
    if (this.year >= 2010) {
      const infoShare = playerSettlements.reduce((s, t) => s + t.sectors.information.share * this.popOf(t), 0) / Math.max(1, totalPop);
      this.automationUnemployment = Math.min(0.5, infoShare * 0.6);
    }

    // Apply Gini-driven unrest pressure
    const gini = this.giniIndex();
    if (gini > 0.4) {
      const extraPressure = Math.floor((gini - 0.4) * 10) * 0.1;
      for (const t of playerSettlements) {
        t.grievance = Math.min(100, t.grievance + extraPressure);
      }
    }
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
    if (def.coastal_only && !t.site.coastal) return { ok: false, reason: 'coastal settlements only' };
    if (this.buildingCount(t, def.id) >= def.max) return { ok: false, reason: 'already built' };
    if (def.unique && this.wonderClaimed(def.id, t)) {
      return { ok: false, reason: 'this wonder already stands elsewhere' };
    }
    const cost = this.cityBuildCost(def);
    if (this.treasury < cost) return { ok: false, reason: `needs ` + formatCurrency(cost) + `` };
    return { ok: true, reason: '' };
  }

  /** Break ground on a civic work. The treasury pays now; the bonus arrives
   *  when the scaffolding comes down. */
  buildCity(townId: number, defId: string, cell?: number): boolean {
    const t = this.settlement(townId);
    const def = REGION_BUILDINGS_MAP.get(defId);
    if (!t || !def || !this.cityBuildCheck(t, def).ok) return false;
    // Spatial-4X: a chosen cell must be a legal placement for this town; an
    // unspecified cell is auto-sited at completion (AI / legacy callers).
    if (cell !== undefined && !this.canPlaceBuildingAt(townId, cell)) return false;
    const cost = this.cityBuildCost(def);
    this.treasury -= cost;
    t.construction = { id: def.id, doneDay: this.day + def.days, cell };
    this.addLog(`Ground is broken for the ${def.name} at ${t.name} — ` + formatCurrency(cost) + `, ${def.days} days.`, 'info');
    return true;
  }

  /** Cost to zone a district at the current development level (mirrors building cost). */
  districtCost(def: DistrictDef): number {
    return Math.round(def.cost * this.devFactor());
  }

  /** How many of district `id` this town already hosts (district-scale `max` cap). */
  private districtCount(t: Settlement, id: string): number {
    let n = 0;
    for (const pd of t.placedDistricts) if (pd.id === id) n++;
    return n;
  }

  /** Can the player zone district `defId` at `townId` right now? Same gate shape as
   *  `cityBuildCheck` (own town, manageable, prereq, per-city max, treasury) — for
   *  the placement UI. Districts take effect on placement (no construction slot). */
  districtBuildCheck(t: Settlement, def: DistrictDef): { ok: boolean; reason: string } {
    if (t.factionId !== this.playerFactionId) return { ok: false, reason: 'not your town' };
    if (this.stateProclaimed) {
      const manage = this.canManageCity(t);
      if (!manage.ok) return manage;
    }
    if (def.prereq && !this.has(def.prereq)) {
      const node = TECH_TREE.find((n) => n.id === def.prereq);
      return { ok: false, reason: `requires ${node?.name ?? def.prereq}` };
    }
    if (this.districtCount(t, def.id) >= def.max) return { ok: false, reason: 'already zoned here' };
    const cost = this.districtCost(def);
    if (this.treasury < cost) return { ok: false, reason: `needs ` + formatCurrency(cost) };
    return { ok: true, reason: '' };
  }

  /** Zone a district on a chosen cell. The treasury pays now and the bonus takes
   *  effect immediately (a zoning designation, not a construction). Player-driven —
   *  the AI never zones, so the headless sim never reaches this path. Returns false
   *  on any failed gate or an illegal/occupied cell. */
  placeDistrict(townId: number, defId: string, cell: number): boolean {
    const t = this.settlement(townId);
    const def = DISTRICT_DEFS_MAP.get(defId);
    if (!t || !def || !this.districtBuildCheck(t, def).ok) return false;
    if (!this.canPlaceBuildingAt(townId, cell)) return false; // shares building legality
    const cost = this.districtCost(def);
    this.treasury -= cost;
    t.placedDistricts.push({ id: def.id, cell });
    this.addLog(`${t.name} zones a ${def.name} — ` + formatCurrency(cost) + `.`, 'good');
    this.townEvent(t, `A ${def.name} is zoned.`, 'good');
    return true;
  }

  /** Placement-time preview for a DISTRICT zone (spatial-4X Phase D): the sector
   *  output bonus the district `defId` WOULD earn if zoned on `cell` right now — its
   *  flat `bonus` plus the adjacency reward from same-sector buildings already sited
   *  next to the cell. Pure / read-only — mirrors `districtZoneBonus` exactly so the
   *  UI can show WHY one hex beats another. Returns null for an illegal cell or
   *  unknown def. */
  districtPlacementPreview(townId: number, cell: number, defId: string): PlacementPreview | null {
    const t = this.settlement(townId);
    if (!t) return null;
    const def = DISTRICT_DEFS_MAP.get(defId);
    if (!def) return null;
    if (!this.canPlaceBuildingAt(townId, cell)) return null;

    const col = Math.floor(cell / REGION_N), row = cell % REGION_N;
    let adj = 0;
    for (const [ax, ay] of hexNeighbors(col, row)) {
      const nCell = ax * REGION_N + ay;
      const pb = t.placedBuildings.find((p) => p.cell === nCell);
      if (!pb) continue;
      const bd = REGION_BUILDINGS_MAP.get(pb.id);
      if (bd && bd.sector === def.sector) adj++;
    }
    const districtBonus = Math.min(adj, RegionSim.DISTRICT_ZONE_CAP) * RegionSim.DISTRICT_ZONE_BONUS;
    // `terrainBonus` carries the district's flat themed bonus (reusing the preview
    // shape); `districtBonus` is the placement-sensitive adjacency reward. A district
    // never triggers another district's zone, so `zoneBonus` is always 0 here.
    return { sector: def.sector, terrainBonus: def.bonus, districtBonus, zoneBonus: 0, total: def.bonus + districtBonus };
  }

  /** Cell index for (col,row) and back — the key used by `placedBuildings`. */
  private cellIndex(col: number, row: number): number { return col * REGION_N + row; }

  /** Is `cell` a legal building site for this town? Within `CITY_WORK_RADIUS` hexes
   *  of the centre (but not the centre itself), on land, and not already occupied
   *  by another of the town's buildings or its pending construction. Render/economy-
   *  neutral — pure validation. */
  canPlaceBuildingAt(townId: number, cell: number): boolean {
    const t = this.settlement(townId);
    if (!t) return false;
    const col = Math.floor(cell / REGION_N), row = cell % REGION_N;
    if (col < 0 || col >= REGION_N || row < 0 || row >= REGION_N) return false;
    const c = this.map.coordToCell(t.x, t.y);
    const d = hexDistance(c.x, c.y, col, row);
    if (d < 1 || d > CITY_WORK_RADIUS) return false; // not the centre, within the ring
    if (this.map.isWater(col, row)) return false;
    if (t.placedBuildings.some((p) => p.cell === cell)) return false;
    if (t.placedDistricts.some((p) => p.cell === cell)) return false; // a zone occupies its hex
    if (t.construction?.cell === cell) return false;
    return true;
  }

  /** All legal placement cells in this town's worked ring (for the placement UI). */
  buildablePlacementCells(townId: number): number[] {
    const t = this.settlement(townId);
    if (!t) return [];
    const c = this.map.coordToCell(t.x, t.y);
    const out: number[] = [];
    for (let col = Math.max(0, c.x - CITY_WORK_RADIUS); col <= Math.min(REGION_N - 1, c.x + CITY_WORK_RADIUS); col++) {
      for (let row = Math.max(0, c.y - CITY_WORK_RADIUS); row <= Math.min(REGION_N - 1, c.y + CITY_WORK_RADIUS); row++) {
        const cell = this.cellIndex(col, row);
        if (this.canPlaceBuildingAt(townId, cell)) out.push(cell);
      }
    }
    return out;
  }

  /** Deterministically pick a worked-ring cell for an auto-sited building (AI /
   *  legacy / migration). Returns the nearest free legal cell, or -1 if the ring
   *  is full. No RNG — keeps the sim byte-deterministic. */
  private autoPlaceCell(t: Settlement): number {
    const cells = this.buildablePlacementCells(t.id);
    if (cells.length === 0) return -1;
    const c = this.map.coordToCell(t.x, t.y);
    let best = cells[0], bestD = Infinity;
    for (const cell of cells) {
      const col = Math.floor(cell / REGION_N), row = cell % REGION_N;
      const d = hexDistance(c.x, c.y, col, row) * 1000 + col * REGION_N + row; // tie-break by index
      if (d < bestD) { bestD = d; best = cell; }
    }
    return best;
  }

  /** Spatial-4X — deterministically choose the legal worked-ring cell that
   *  MAXIMIZES `scoreFn` (the spatial output bonus a building/district would earn
   *  there, via the placement previews). This is the AI's spatial brain: feed it a
   *  building's `placementPreview().total` and it sites on terrain-matching,
   *  same-sector-clustered, district-adjacent hexes instead of just the nearest
   *  free one. No RNG — the main stream is untouched. Ties fall back to the
   *  `autoPlaceCell` heuristic (nearest the centre, then lowest index) so a flat
   *  tie reproduces the old behaviour exactly. Returns -1 if the ring is full. */
  private bestPlacementCell(t: Settlement, scoreFn: (cell: number) => number): number {
    const cells = this.buildablePlacementCells(t.id);
    if (cells.length === 0) return -1;
    const c = this.map.coordToCell(t.x, t.y);
    let best = -1, bestScore = -Infinity, bestTie = Infinity;
    for (const cell of cells) {
      const score = scoreFn(cell);
      const col = Math.floor(cell / REGION_N), row = cell % REGION_N;
      const tie = hexDistance(c.x, c.y, col, row) * 1000 + col * REGION_N + row;
      if (score > bestScore + 1e-9 || (score > bestScore - 1e-9 && tie < bestTie)) {
        bestScore = score; best = cell; bestTie = tie;
      }
    }
    return best;
  }

  /** Reconcile `placedBuildings` with `buildings`: auto-site any building that has
   *  no placement yet (old saves, AI direct grants). Deterministic; render-only. */
  ensurePlacements(t: Settlement): void {
    if (!t.placedBuildings) t.placedBuildings = [];
    if (t.placedBuildings.length >= t.buildings.length) return;
    const placedCount = new Map<string, number>();
    for (const p of t.placedBuildings) placedCount.set(p.id, (placedCount.get(p.id) ?? 0) + 1);
    const seen = new Map<string, number>();
    for (const id of t.buildings) {
      const n = (seen.get(id) ?? 0) + 1; seen.set(id, n);
      if (n <= (placedCount.get(id) ?? 0)) continue; // already placed
      const cell = this.autoPlaceCell(t);
      if (cell >= 0) t.placedBuildings.push({ id, cell });
    }
  }

  static readonly SCOUT_BASE_COST = 10;
  /** Scout hire cost at the current development level. */
  scoutCost(): number {
    return this.flatCost(RegionSim.SCOUT_BASE_COST);
  }

  /** Hire a scout from one of the player's towns to explore the fog of war.
   *  Available pre-state; base £10, scaled by development. Max 2 active scouts. */
  sendPlayerScout(townId: number): { ok: boolean; reason: string } {
    const t = this.settlement(townId);
    if (!t || t.factionId !== this.playerFactionId) return { ok: false, reason: 'not your town' };
    const active = this.scouts.filter((s) => s.factionId === this.playerFactionId).length;
    if (active >= 2) return { ok: false, reason: 'already 2 scouts in the field' };
    const cost = this.scoutCost();
    if (this.treasury < cost) return { ok: false, reason: `need ${formatCurrency(cost)}` };
    this.treasury -= cost;
    const SCOUT_NAMES = ['Fox', 'Wren', 'Ash', 'Bram', 'Rook', 'Jade', 'Cole', 'Fern'];
    const playerScoutCount = this.scouts.filter((s) => s.factionId === this.playerFactionId).length;
    const scoutName = SCOUT_NAMES[playerScoutCount % SCOUT_NAMES.length];
    const scout: Scout = {
      id: this.nextScoutId++,
      factionId: this.playerFactionId,
      x: Math.max(0, Math.min(100, t.x + (this.rng.int(5) - 2))),
      y: Math.max(0, Math.min(100, t.y + (this.rng.int(5) - 2))),
      health: 100,
      maintenanceCost: 0,
      createdDay: this.day,
      expireDay: this.day + 200,
      targetMode: 'objective',
      name: scoutName,
      autoExplore: true,
    };
    this.scouts.push(scout);
    this.addLog(`${scoutName} the scout sets out from ${t.name} to map the surrounding lands.`, 'info');
    return { ok: true, reason: '' };
  }

  /** Toggle auto-explore mode for a player scout. */
  setScoutAutoExplore(scoutId: number, auto: boolean): void {
    const scout = this.scouts.find((s) => s.id === scoutId && s.factionId === this.playerFactionId);
    if (!scout) return;
    scout.autoExplore = auto;
    if (auto) { scout.manualTargetX = undefined; scout.manualTargetY = undefined; }
  }

  /** Send a player scout to a specific map coordinate (disables auto-explore). */
  setScoutTarget(scoutId: number, rx: number, ry: number): void {
    const scout = this.scouts.find((s) => s.id === scoutId && s.factionId === this.playerFactionId);
    if (!scout) return;
    scout.autoExplore = false;
    scout.manualTargetX = Math.max(0, Math.min(100, rx));
    scout.manualTargetY = Math.max(0, Math.min(100, ry));
  }

  /** Declare war on a rival regional faction (Phase C). */
  declareWarOnFaction(factionId: number): { ok: boolean; reason: string } {
    const faction = this.faction(factionId);
    if (!faction || faction.id === this.playerFactionId) return { ok: false, reason: 'invalid target' };
    if (this.playerRegionalWars.has(factionId)) return { ok: false, reason: 'already at war' };
    this.playerRegionalWars.add(factionId);
    faction.aggressiveness = Math.min(100, faction.aggressiveness + 30);
    this.addLog(`⚔ WAR DECLARED against ${faction.name}. Their settlements are now valid targets for annexation.`, 'bad');
    return { ok: true, reason: '' };
  }

  /** Offer a ceasefire to end a regional war. */
  makeRegionalPeace(factionId: number): { ok: boolean; reason: string } {
    if (!this.playerRegionalWars.has(factionId)) return { ok: false, reason: 'not at war' };
    this.playerRegionalWars.delete(factionId);
    const faction = this.faction(factionId);
    if (faction) faction.aggressiveness = Math.max(0, faction.aggressiveness - 20);
    this.addLog(`✦ Ceasefire agreed with ${faction?.name ?? 'the faction'}.`, 'info');
    return { ok: true, reason: '' };
  }

  /** Total strength the player can field in an assault: the summed militia
   *  garrisons of every player town, plus a bonus from standing militia funding. */
  playerFieldArmy(): number {
    let a = this.militiaLevel * 3;
    for (const t of this.settlements) {
      if (t.factionId === this.playerFactionId) a += t.garrisonStrength || 0;
    }
    return a;
  }

  /** A settlement's defensive strength against an assault: its garrison plus a
   *  small contribution from a loyal populace digging in. */
  private settlementDefense(t: Settlement): number {
    const loyalPop = this.popOf(t) * 0.01 * (t.loyaltyToFaction / 100);
    return Math.max(1, (t.garrisonStrength || 0) + loyalPop);
  }

  /** Preview an assault on an enemy settlement: attacker vs defender strength and
   *  the win probability, for the UI to surface before the player commits. */
  assaultOdds(targetId: number): { ok: boolean; reason: string; attack: number; defense: number; odds: number } {
    const target = this.settlement(targetId);
    const fail = (reason: string) => ({ ok: false, reason, attack: 0, defense: 0, odds: 0 });
    if (!target) return fail('no settlement');
    if (target.factionId === this.playerFactionId) return fail('your own town');
    if (!this.playerRegionalWars.has(target.factionId)) return fail('not at war with this faction');
    const attack = this.playerFieldArmy();
    const defense = this.settlementDefense(target);
    if (attack < 1) return fail('no garrison to field — drill militia first');
    return { ok: true, reason: '', attack: Math.round(attack), defense: Math.round(defense), odds: attack / (attack + defense) };
  }

  /** Distribute militia casualties across the player's town garrisons. */
  private bleedPlayerArmy(fraction: number): void {
    for (const t of this.settlements) {
      if (t.factionId !== this.playerFactionId) continue;
      t.garrisonStrength = Math.max(0, (t.garrisonStrength || 0) * (1 - fraction));
    }
  }

  /** Launch an assault on an enemy settlement during a regional war. A win annexes
   *  the town into the player's faction (and ends the war if it was their last);
   *  a loss bloodies the player's garrisons. Either way the defenders take losses
   *  too, so a determined siege wears a town down over repeated attempts. */
  assaultSettlement(targetId: number): { ok: boolean; won: boolean; reason: string } {
    const info = this.assaultOdds(targetId);
    if (!info.ok) return { ok: false, won: false, reason: info.reason };
    const target = this.settlement(targetId)!;
    const enemy = this.faction(target.factionId);
    const playerFaction = this.faction(this.playerFactionId);
    if (!enemy || !playerFaction) return { ok: false, won: false, reason: 'invalid faction' };

    const won = this.rng.chance(info.odds);
    if (won) {
      this.bleedPlayerArmy(0.12); // even a victory is paid for in blood
      enemy.settlementIds = enemy.settlementIds.filter((id) => id !== target.id);
      target.factionId = this.playerFactionId;
      playerFaction.settlementIds.push(target.id);
      // A conquered town starts cowed: gutted garrison, resentful, weak loyalty.
      target.garrisonStrength = 1;
      target.loyaltyToFaction = 40;
      target.grievance = Math.min(100, target.grievance + 30);
      this._territoryCache = null;
      this.addLog(`VICTORY: your militia storm ${target.name} — it is annexed into your realm.`, 'good');
      if (enemy.capital === target.id) enemy.capital = enemy.settlementIds[0] ?? -1;
      if (enemy.settlementIds.length === 0) {
        this.playerRegionalWars.delete(enemy.id);
        this.addLog(`${enemy.name} is wiped from the map — the war is won.`, 'good');
      }
      return { ok: true, won: true, reason: '' };
    }
    // Repelled: the attacker takes the heavier losses, the defenders a lighter one.
    this.bleedPlayerArmy(0.25);
    target.garrisonStrength = Math.max(0, (target.garrisonStrength || 0) - 1);
    this.addLog(`REPELLED: ${target.name}'s defenders throw back your assault — your militia are bloodied.`, 'bad');
    return { ok: true, won: false, reason: '' };
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

  // ---- Spatial-4X Phase C: tile yields → sector bonuses ----
  // These scale the mean terrain features of the worked ring (d=1..CITY_WORK_RADIUS
  // hexes, centre excluded — its fertility already lives in landTerm/landQuality)
  // into per-sector bonuses that plug into `buildingBonus` at the same seam as
  // the existing flat building bonuses.  Calibration: fertile plains → small +agri,
  // mountain ore → bigger +industry; coastal/river → +services.  An intentional
  // re-baseline — Phase C is the economy-activator the spatial-4X spec calls out.

  /** Scales mean-fertility deviation from 1.0 into an agriculture bonus. */
  private static readonly TILE_AGRI_SCALE = 0.20;
  /** River-cell fraction of the ring → agriculture bonus. */
  private static readonly TILE_RIVER_AGRI = 0.06;
  /** Ore-cell fraction of the ring → industry bonus. */
  private static readonly TILE_ORE_BONUS = 0.15;
  /** Rough-terrain (hills/mountains) fraction of the ring → industry bonus. */
  private static readonly TILE_ROUGH_BONUS = 0.10;
  /** Forest fraction of the ring → industry bonus (timber/paper). */
  private static readonly TILE_FOREST_BONUS = 0.06;
  /** River-cell fraction of the ring → services bonus (trade/transport). */
  private static readonly TILE_RIVER_SVC = 0.10;
  /** Coastal site → services bonus (applied once, not per cell). */
  private static readonly TILE_COASTAL_SVC = 0.08;
  /** Extra bonus per placed building sited on terrain that matches its sector. */
  private static readonly TILE_PLACE_BONUS = 0.05;
  /** Spatial-4X Phase D slice 2 — DISTRICTS. Output bonus a placed building earns
   *  for each same-sector building on an adjacent hex (the Civ-6 district-synergy
   *  hook: cluster like with like to specialise a quarter of the city). */
  private static readonly DISTRICT_ADJ_BONUS = 0.04;
  /** Adjacency count past which a single building stops earning the district bonus
   *  — keeps a tight cluster strong but the total bounded and legible. */
  private static readonly DISTRICT_ADJ_CAP = 2;
  /** Spatial-4X Phase D — a placed DISTRICT zone's per-adjacent-building synergy:
   *  each same-sector building on a hex adjacent to the district earns the town this
   *  much extra in that sector (the zoning reward — site the district among matching
   *  buildings). */
  private static readonly DISTRICT_ZONE_BONUS = 0.05;
  /** Adjacent same-sector buildings past which a district stops paying — bounds the
   *  zone bonus at DISTRICT_ZONE_CAP × DISTRICT_ZONE_BONUS on top of its flat bonus. */
  private static readonly DISTRICT_ZONE_CAP = 3;

  /** Per-sector tile yields from the worked ring around this town. Result is cached
   *  permanently — terrain never changes after worldgen.  The ring (d=1,2) is read
   *  from the live RegionMap; water cells are skipped.  Sector `information` is
   *  reserved for later eras and always returns 0 here. */
  private tileYieldFor(t: Settlement): Partial<Record<SectorId, number>> {
    if (!this._tileYieldCache) this._tileYieldCache = new Map();
    const cached = this._tileYieldCache.get(t.id);
    if (cached) return cached;

    const c = this.map.coordToCell(t.x, t.y);
    const cx = c.x, cy = c.y;

    let totalFertility = 0, oreCells = 0, roughCells = 0, forestCells = 0, riverCells = 0, count = 0;
    for (let col = Math.max(0, cx - CITY_WORK_RADIUS); col <= Math.min(REGION_N - 1, cx + CITY_WORK_RADIUS); col++) {
      for (let row = Math.max(0, cy - CITY_WORK_RADIUS); row <= Math.min(REGION_N - 1, cy + CITY_WORK_RADIUS); row++) {
        const d = hexDistance(cx, cy, col, row);
        if (d < 1 || d > CITY_WORK_RADIUS) continue; // ring only (exclude centre)
        const cell = this.map.at(col, row);
        if (cell.biome === 'sea' || cell.biome === 'lake') continue; // skip water
        count++;
        totalFertility += cell.fertility;
        if (cell.ore) oreCells++;
        if (cell.roughness > 0.35) roughCells++;
        if (cell.forest > 0.5) forestCells++;
        if (cell.river) riverCells++;
      }
    }

    const n = Math.max(1, count);
    const meanFertility = totalFertility / n;

    // Agriculture: fertile ring soil + river access
    const agri = Math.max(-0.15, Math.min(0.25,
      (meanFertility - 1.0) * RegionSim.TILE_AGRI_SCALE +
      (riverCells / n) * RegionSim.TILE_RIVER_AGRI));
    // Industry: rough terrain (mining), ore deposits, and timber
    const indust = Math.max(-0.05, Math.min(0.25,
      (roughCells / n) * RegionSim.TILE_ROUGH_BONUS +
      (oreCells / n) * RegionSim.TILE_ORE_BONUS +
      (forestCells / n) * RegionSim.TILE_FOREST_BONUS));
    // Services: river-trade access + coastal port bonus
    const svc = Math.max(0, Math.min(0.20,
      (riverCells / n) * RegionSim.TILE_RIVER_SVC +
      (t.site.coastal ? RegionSim.TILE_COASTAL_SVC : 0)));

    const result: Partial<Record<SectorId, number>> = {
      agriculture: agri,
      industry: indust,
      services: svc,
      information: 0,
    };
    this._tileYieldCache.set(t.id, result);
    return result;
  }

  /** Extra bonus per placed building whose cell terrain matches its sector.
   *  An agriculture building on a fertile/river cell, an industry building on
   *  ore/rough ground, or a services building near water each earn one pulse.
   *  Bonus scales with the number of well-sited buildings, capped by how many
   *  buildings the town can physically place (bounded by ring size). */
  private placedBuildingTerrainBonus(t: Settlement, sector: SectorId): number {
    let bonus = 0;
    for (const pb of t.placedBuildings) {
      const def = REGION_BUILDINGS_MAP.get(pb.id);
      if (!def) continue;
      if (def.sector !== sector && def.sector !== 'all') continue;
      const col = Math.floor(pb.cell / REGION_N);
      const row = pb.cell % REGION_N;
      const cell = this.map.at(col, row);
      if (sector === 'agriculture' && (cell.fertility > 1.05 || cell.river))
        bonus += RegionSim.TILE_PLACE_BONUS;
      if (sector === 'industry' && (cell.ore || cell.roughness > 0.35))
        bonus += RegionSim.TILE_PLACE_BONUS;
      if (sector === 'services' && (cell.river || t.site.coastal))
        bonus += RegionSim.TILE_PLACE_BONUS;
    }
    return bonus;
  }

  /** Phase D slice 2 — DISTRICT synergy. A placed building earns a bonus for every
   *  same-sector building on an adjacent hex: clustering like with like turns a
   *  cluster of placements into a specialised quarter (an industrial district, a
   *  farming belt). The bonus is per-building × min(neighbours, cap), so a tight
   *  three-building triangle pays the most while the total stays bounded. Mixed-
   *  sector or 'all' buildings never form a district (kept legible — only concrete
   *  same-sector neighbours count). Returns 0 for a town with <2 same-sector
   *  placements, so a sparse town is unaffected. Cached by placement count. */
  private districtAdjacencyBonus(t: Settlement, sector: SectorId): number {
    if (!this._districtCache) this._districtCache = new Map();
    const cached = this._districtCache.get(t.id);
    const len = t.placedBuildings.length;
    if (cached && cached.len === len) return cached.byS[sector] ?? 0;

    // Recompute all sectors in one pass (placements changed or first call).
    const byS = this.districtBonusByCells(this.districtCellsBySector(t.placedBuildings));
    this._districtCache.set(t.id, { len, byS });
    return byS[sector] ?? 0;
  }

  /** Group a town's placed buildings' cells by their concrete sector ('all' never
   *  forms a district, so it is excluded), preserving placement order. The input
   *  to `districtBonusByCells`; shared by the live bonus path and the placement
   *  preview so the two can never drift. */
  private districtCellsBySector(placed: PlacedBuilding[]): Map<SectorId, Set<number>> {
    const cellsBySector = new Map<SectorId, Set<number>>();
    for (const pb of placed) {
      const def = REGION_BUILDINGS_MAP.get(pb.id);
      if (!def || def.sector === 'all') continue;
      const s = def.sector as SectorId;
      let set = cellsBySector.get(s);
      if (!set) { set = new Set(); cellsBySector.set(s, set); }
      set.add(pb.cell);
    }
    return cellsBySector;
  }

  /** Pure core of the district-synergy sum: each building earns
   *  `min(same-sector neighbours, cap) × DISTRICT_ADJ_BONUS`; a sector with fewer
   *  than two placements scores 0. Iteration order matches the live path exactly,
   *  so routing `districtAdjacencyBonus` through it stays byte-identical. */
  private districtBonusByCells(cellsBySector: Map<SectorId, Set<number>>): Partial<Record<SectorId, number>> {
    const byS: Partial<Record<SectorId, number>> = {};
    for (const [s, cells] of cellsBySector) {
      if (cells.size < 2) { byS[s] = 0; continue; }
      let bonus = 0;
      for (const cell of cells) {
        const col = Math.floor(cell / REGION_N), row = cell % REGION_N;
        let adj = 0;
        for (const [ax, ay] of hexNeighbors(col, row)) {
          const nCell = ax * REGION_N + ay;
          if (nCell !== cell && cells.has(nCell)) adj++;
        }
        bonus += Math.min(adj, RegionSim.DISTRICT_ADJ_CAP) * RegionSim.DISTRICT_ADJ_BONUS;
      }
      byS[s] = bonus;
    }
    return byS;
  }

  /** Placement-time site preview (spatial-4X Phase D): the output bonus the building
   *  `defId` WOULD earn if sited on `cell` right now — a terrain-match pulse (the
   *  same rule as `placedBuildingTerrainBonus`) plus the MARGINAL district-synergy
   *  gain to the town from adding it (which includes the lift it gives its
   *  same-sector neighbours, not just what it earns itself). Pure / read-only — it
   *  mutates nothing, so the sim stays byte-identical; returns null for an illegal
   *  cell or unknown def. */
  placementPreview(townId: number, cell: number, defId: string): PlacementPreview | null {
    const t = this.settlement(townId);
    if (!t) return null;
    const def = REGION_BUILDINGS_MAP.get(defId);
    if (!def) return null;
    if (!this.canPlaceBuildingAt(townId, cell)) return null;

    const col = Math.floor(cell / REGION_N), row = cell % REGION_N;
    const tc = this.map.at(col, row);

    // Terrain-match pulse — mirror placedBuildingTerrainBonus exactly. An 'all'
    // building earns the pulse in every sector whose rule the cell satisfies.
    const matchesAgri = tc.fertility > 1.05 || tc.river;
    const matchesIndustry = tc.ore || tc.roughness > 0.35;
    const matchesServices = tc.river || t.site.coastal;
    let terrainBonus = 0;
    if (def.sector === 'agriculture') { if (matchesAgri) terrainBonus = RegionSim.TILE_PLACE_BONUS; }
    else if (def.sector === 'industry') { if (matchesIndustry) terrainBonus = RegionSim.TILE_PLACE_BONUS; }
    else if (def.sector === 'services') { if (matchesServices) terrainBonus = RegionSim.TILE_PLACE_BONUS; }
    else if (def.sector === 'all') {
      if (matchesAgri) terrainBonus += RegionSim.TILE_PLACE_BONUS;
      if (matchesIndustry) terrainBonus += RegionSim.TILE_PLACE_BONUS;
      if (matchesServices) terrainBonus += RegionSim.TILE_PLACE_BONUS;
    }

    // Marginal district synergy — recompute the town's district bonus with the
    // candidate hypothetically added, minus the current bonus. 0 for 'all'.
    let districtBonus = 0;
    if (def.sector !== 'all') {
      const s = def.sector as SectorId;
      const base = this.districtCellsBySector(t.placedBuildings);
      const baseBonus = this.districtBonusByCells(base)[s] ?? 0;
      const withCand = new Map<SectorId, Set<number>>();
      for (const [sec, set] of base) withCand.set(sec, new Set(set));
      let set = withCand.get(s);
      if (!set) { set = new Set(); withCand.set(s, set); }
      set.add(cell);
      const withBonus = this.districtBonusByCells(withCand)[s] ?? 0;
      districtBonus = Math.max(0, withBonus - baseBonus);
    }

    // Marginal district-ZONE lift — a same-sector building adjacent to a zoned
    // district raises that district's adjacency reward. Recompute the zone bonus
    // with the candidate building hypothetically added, minus the current one;
    // mirrors districtZoneBonus via the shared core. 0 for 'all' or no districts.
    let zoneBonus = 0;
    if (def.sector !== 'all' && t.placedDistricts.length > 0) {
      const s = def.sector as SectorId;
      const baseZone = this.districtZoneBonusFrom(t.placedDistricts, t.placedBuildings, s);
      const withZone = this.districtZoneBonusFrom(t.placedDistricts, [...t.placedBuildings, { id: defId, cell }], s);
      zoneBonus = Math.max(0, withZone - baseZone);
    }

    return { sector: def.sector, terrainBonus, districtBonus, zoneBonus, total: terrainBonus + districtBonus + zoneBonus };
  }

  /** Sum of building output bonuses for one sector in this town.
   *  Phase C extends this with spatial tile yields from the worked ring
   *  and adjacency bonuses for buildings sited on matching terrain;
   *  Phase D slice 2 adds the district-clustering synergy. */
  private buildingBonus(t: Settlement, sector: SectorId): number {
    return this.sectorBonusParts(t, sector).total;
  }

  /** Decompose a town's per-sector output bonus into its named spatial sources.
   *  The SINGLE SOURCE OF TRUTH for both the live economy (`buildingBonus`
   *  returns `.total`) and the city-panel readout (`sectorBonusBreakdown`), so
   *  the numbers the player sees can never drift from the ones driving output.
   *  The summation order is preserved exactly, so `.total` is bit-identical to
   *  the prior inline `buildingBonus` — the determinism harness + headless diff
   *  guard this. */
  private sectorBonusParts(t: Settlement, sector: SectorId): SectorBonusBreakdown {
    let buildings = 0;
    for (const id of t.buildings) {
      const def = REGION_BUILDINGS_MAP.get(id);
      if (def && (def.sector === sector || def.sector === 'all')) buildings += def.bonus;
    }
    // Phase C: terrain yields from the worked ring (static terrain, cached)
    const terrain = this.tileYieldFor(t)[sector] ?? 0;
    // Phase C: placed-building adjacency (building sited on matching terrain)
    const terrainMatch = this.placedBuildingTerrainBonus(t, sector);
    // Phase D slice 2: district synergy (same-sector buildings on adjacent hexes)
    const districtAdjacency = this.districtAdjacencyBonus(t, sector);
    // Phase D: placed-district zones (themed quarter + adjacency reward)
    const districtZone = this.districtZoneBonus(t, sector);
    // Phase D: empire-wide Wonder bonuses (one-per-empire global effects)
    const wonder = this.wonderBonus(t, sector);
    const total = buildings + terrain + terrainMatch + districtAdjacency + districtZone + wonder;
    return { sector, buildings, terrain, terrainMatch, districtAdjacency, districtZone, wonder, total };
  }

  /** Read-only decomposition of `townId`'s output bonus in `sector` — the city
   *  panel's "why does this sector produce what it does" readout. Pure: it reads
   *  the same idempotent caches the live tick does and mutates nothing, so the
   *  sim stays byte-identical. Returns null for an unknown town. */
  sectorBonusBreakdown(townId: number, sector: SectorId): SectorBonusBreakdown | null {
    const t = this.settlement(townId);
    if (!t) return null;
    return this.sectorBonusParts(t, sector);
  }

  /** Spatial-4X Phase D — output bonus this town gains from the DISTRICT zones it
   *  hosts in `sector`: each district's flat `bonus`, plus DISTRICT_ZONE_BONUS for
   *  every same-sector placed building on a hex adjacent to the district (capped at
   *  DISTRICT_ZONE_CAP), so the reward is to site the zone amid its matching cluster.
   *  Early-returns 0 for a town with no districts — autoplay never zones, so this is
   *  byte-identical to base (the proven Wonders-slice-1 pattern). Not cached: it is
   *  only ever non-zero for a handful of player towns. */
  private districtZoneBonus(t: Settlement, sector: SectorId): number {
    if (t.placedDistricts.length === 0) return 0;
    return this.districtZoneBonusFrom(t.placedDistricts, t.placedBuildings, sector);
  }

  /** Pure core of the district-zone sum, parameterised on the district + building
   *  sets so the live bonus and the placement preview share ONE source of truth
   *  (the proven `districtBonusByCells` pattern). Iteration order + arithmetic match
   *  the prior inline `districtZoneBonus` exactly, so routing through it is
   *  byte-identical. */
  private districtZoneBonusFrom(districts: PlacedBuilding[], buildings: PlacedBuilding[], sector: SectorId): number {
    let bonus = 0;
    for (const pd of districts) {
      const def = DISTRICT_DEFS_MAP.get(pd.id);
      if (!def || def.sector !== sector) continue;
      bonus += def.bonus;
      const col = Math.floor(pd.cell / REGION_N), row = pd.cell % REGION_N;
      let adj = 0;
      for (const [ax, ay] of hexNeighbors(col, row)) {
        const nCell = ax * REGION_N + ay;
        const pb = buildings.find((p) => p.cell === nCell);
        if (!pb) continue;
        const bd = REGION_BUILDINGS_MAP.get(pb.id);
        if (bd && bd.sector === sector) adj++;
      }
      bonus += Math.min(adj, RegionSim.DISTRICT_ZONE_CAP) * RegionSim.DISTRICT_ZONE_BONUS;
    }
    return bonus;
  }

  /** Phase D — empire-wide output bonus this town gains from Wonders its faction
   *  owns. A Wonder's effect applies to EVERY settlement of the owner (that is
   *  what distinguishes it from a building), routed through `empireBonus` so the
   *  per-building loop above never double-counts the host town. Returns 0 in a
   *  game with no Wonders, so autoplay stays byte-identical to base. */
  private wonderBonus(t: Settlement, sector: SectorId): number {
    let bonus = 0;
    for (const id in this.wonderOwner) {
      if (this.wonderOwner[id] !== t.factionId) continue;
      const def = REGION_BUILDINGS_MAP.get(id);
      if (def?.empireBonus && (def.empireSector === sector || def.empireSector === 'all')) {
        bonus += def.empireBonus;
      }
    }
    return bonus;
  }

  /** Phase D — a unique Wonder is "claimed" once any empire owns it OR has it
   *  under construction, making the build-race first-to-break-ground: neither a
   *  rival nor the player can start a Wonder another empire is already raising.
   *  `exceptTown` is excluded from the in-progress scan (a town's own project is
   *  already rejected by the `t.construction` guard above it in cityBuildCheck). */
  private wonderClaimed(id: string, exceptTown?: Settlement): boolean {
    if (this.wonderOwner[id] !== undefined) return true;
    for (const s of this.settlements) {
      if (s === exceptTown) continue;
      if (s.construction?.id === id) return true;
    }
    return false;
  }

  /** The world-year a Wonder's prereq tech becomes historically available — the
   *  era gate a rival uses in lieu of the player's researched-node set. */
  private wonderEraYear(def: RegionalBuildingDef): number {
    return this.prereqEraYear(def.prereq);
  }

  /** The world-year a prereq tech becomes historically available (its TECH_TREE
   *  `era`), or START_YEAR when there is no prereq. The era gate a rival uses for
   *  any prereq-locked building/district in lieu of the player's researched set. */
  private prereqEraYear(prereq?: string): number {
    if (!prereq) return START_YEAR;
    return TECH_TREE.find((n) => n.id === prereq)?.era ?? START_YEAR;
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
      // Phase D: placed districts keep their lights on too (empty in autoplay).
      for (const pd of t.placedDistricts) total += DISTRICT_DEFS_MAP.get(pd.id)?.upkeep ?? 0;
    }
    // Wagner tilt: the public sector's share of GDP rises as the nation develops.
    return total * this.devFactor() ** TUNING.wagnerExp;
  }

  // ---- Phase 14: Zoning, Infrastructure & City Services (GDD §5.1) ----

  /** Compute land value for a settlement (0–100). */
  computeLandValue(settlementId: number): number {
    const t = this.settlements.find((s) => s.id === settlementId);
    if (!t) return 30;
    let value = 20;
    // +30 for each adjacent route with condition > 50
    const adjacentRoutes = this.routes.filter((r) => (r.a === settlementId || r.b === settlementId) && r.condition > 50);
    value += adjacentRoutes.length * 30;
    // +20 if university building exists
    if (t.buildings.includes('university')) value += 20;
    // +15 if public market exists
    if (t.buildings.includes('market_hall')) value += 15;
    // +10 per service coverage point (health+edu+safety average) × 10
    const sc = t.serviceCoverage ?? { health: 0.3, education: 0.2, safety: 0.2 };
    const avgService = (sc.health + sc.education + sc.safety) / 3;
    value += avgService * 10 * 10;
    // -20 per 10 points of pollution
    const pollution = t.pollutionLevel ?? 0;
    value -= Math.floor(pollution / 10) * 20;
    return Math.max(0, Math.min(100, Math.round(value)));
  }

  /** Compute power balance for a settlement. */
  computePowerBalance(settlementId: number): { capacity: number; demand: number; surplus: number } {
    const t = this.settlements.find((s) => s.id === settlementId);
    if (!t) return { capacity: 0, demand: 0, surplus: 0 };
    let capacity = 0;
    // +100 if has coal_plant (power_station) building
    if (t.buildings.includes('power_station')) capacity += 100;
    // +80 if solar_wind_parity researched and pop >= 50
    if (this.has('solar_wind_parity') && this.popOf(t) >= 50) capacity += 80;
    const pop = this.popOf(t);
    // demand: pop × 0.05 MW (per 1 pop, not per 100)
    const demand = pop * 0.05;
    return { capacity, demand, surplus: capacity - demand };
  }

  /** Compute service coverage for a settlement. */
  computeServiceCoverage(settlementId: number): { health: number; education: number; safety: number } {
    const t = this.settlements.find((s) => s.id === settlementId);
    if (!t) return { health: 0.3, education: 0.2, safety: 0.2 };
    // Health: 0.2 base; +0.4 if hospital; +0.2 if clinic; +0.1 if public_health tech
    let health = 0.2;
    if (t.buildings.includes('hospital')) health += 0.4;
    if (t.buildings.includes('clinic')) health += 0.2;
    if (this.has('public_health')) health += 0.1;
    // Education: 0.1 base; +0.3 if school; +0.4 if university; +0.2 if public_education tech
    let education = 0.1;
    if (t.buildings.includes('schoolhouse')) education += 0.3;
    if (t.buildings.includes('university')) education += 0.4;
    if (this.has('public_education')) education += 0.2;
    // Safety: 0.2 base; +0.3 if garrison_barracks (barracks); +0.2 if militia > 2; +0.1 if civil_order tech
    let safety = 0.2;
    if (t.buildings.includes('barracks')) safety += 0.3;
    if ((t.garrisonStrength ?? 0) > 2) safety += 0.2;
    if (this.has('civil_order')) safety += 0.1;
    return {
      health: Math.max(0, Math.min(1, health)),
      education: Math.max(0, Math.min(1, education)),
      safety: Math.max(0, Math.min(1, safety)),
    };
  }

  /** Update pollution levels monthly for all player settlements. */
  /** Update utilities (power, water, waste) monthly for all player settlements. */
  private tickUtilities(): void {
    for (const t of this.settlements) {
      if (t.factionId !== this.playerFactionId) continue;
      const pop = this.popOf(t);
      // Power balance
      const pb = this.computePowerBalance(t.id);
      t.powerCapacity = pb.capacity;
      t.powerDemand = pb.demand;
      if (pb.demand > pb.capacity) {
        // Brownout: log once per year
        const lastBrownout = t.lastBrownoutYear ?? -999;
        if (this.year > lastBrownout) {
          t.lastBrownoutYear = this.year;
          this.townEvent(t, `Power demand exceeds supply — brownouts rolling across ${t.name}.`, 'bad');
        }
        t.satisfaction = Math.max(0, t.satisfaction - 5);
        // Industry output penalty applied via sector output mult (tracked via active event instead)
        // We model it as a monthly satisfaction drag and log the event
      }
      // Water coverage
      if (t.buildings.includes('waterworks')) {
        t.waterCoverage = 1.0;
      } else {
        t.waterCoverage = Math.min(0.5, pop / 200);
      }
      // Waste coverage
      if (t.buildings.includes('sanitation') || t.buildings.includes('market_hall')) {
        t.wasteCoverage = 1.0;
      } else {
        t.wasteCoverage = Math.min(0.3, pop / 500);
      }
      // Disease event: waterCoverage < 0.5 and pop > 100: 5% chance/month
      if ((t.waterCoverage ?? 0) < 0.5 && pop > 100 && this.rng.chance(0.05)) {
        this.townEvent(t, `Poor water supply in ${t.name} — disease spreads among the population.`, 'bad');
        t.satisfaction = Math.max(0, t.satisfaction - 3);
      }
    }
  }

  /** Update service coverage monthly for all player settlements. */
  // ---- Phase 4: Regional Events ----

  /** Fire and expire settlement-level events monthly. */
  private tickRegionalEvents(): void {
    for (const t of this.settlements) {
      // Expire events whose duration has run
      t.activeEvents = t.activeEvents.filter((ev) => ev.untilDay > this.day);
      // Roll each event definition per settlement
      // Phase 17: scale event probability by crisisFrequency difficulty knob
      const crisisScale = this.difficultySettings.crisisFrequency;
      for (const def of REGION_EVENT_DEFS) {
        if (def.minYear !== undefined && this.year < def.minYear) continue; // era-gated
        if (!this.rng.chance(def.probability * crisisScale)) continue;
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
  /** Settlement buyout cost based on population and base value. */
  private settlementBuyoutCost(s: Settlement): number {
    const pop = this.popOf(s) || 0;
    const base = 400;
    return Math.round(base + pop * 2);
  }

  /** Find the least-populated non-capital settlement a regional faction owns. */
  private findPurchasableSettlement(factionId: number): Settlement | null {
    const faction = this.faction(factionId);
    if (!faction) return null;

    const candidates = faction.settlementIds
      .map((id) => this.settlement(id))
      .filter((s): s is Settlement => s !== undefined && s.id !== faction.capital)
      .sort((a, b) => (this.popOf(a) || 0) - (this.popOf(b) || 0));

    return candidates[0] ?? null;
  }

  /** Check if player can purchase a settlement from a regional faction. */
  canBuyLand(factionId: number): { ok: boolean; reason: string } {
    const faction = this.faction(factionId);
    const playerFaction = this.faction(this.playerFactionId);

    if (!faction || !playerFaction) return { ok: false, reason: 'Invalid faction' };

    const purchasable = this.findPurchasableSettlement(factionId);
    if (!purchasable) return { ok: false, reason: 'No purchasable settlements' };

    const cost = this.settlementBuyoutCost(purchasable);
    if (this.treasury < cost) return { ok: false, reason: `Need £${cost}` };

    // Diplomatic grounds: trade agreement, friendly relations, or economic pressure
    // (using regional faction treasury as proxy for relations since regional factions
    // don't track relations; just check desperation)
    if (faction.treasury >= 150) {
      return { ok: false, reason: 'Faction not economically desperate (treasury ≥ £150)' };
    }

    return { ok: true, reason: formatCurrency(cost) };
  }

  /** Attempt to purchase a non-capital rival settlement. */
  buyLand(factionId: number): boolean {
    const can = this.canBuyLand(factionId);
    if (!can.ok) return false;

    const purchasable = this.findPurchasableSettlement(factionId);
    if (!purchasable) return false;

    const faction = this.faction(factionId)!;
    const cost = this.settlementBuyoutCost(purchasable);
    const playerFaction = this.faction(this.playerFactionId)!;

    // Transfer settlement
    purchasable.factionId = this.playerFactionId;
    playerFaction.settlementIds.push(purchasable.id);
    faction.settlementIds = faction.settlementIds.filter((id) => id !== purchasable.id);

    // Financial transaction
    this.treasury -= cost;
    faction.treasury += cost;

    this.addLog(
      `LAND PURCHASE: ${faction.name} cedes ${purchasable.name} for ${formatCurrency(cost)}.`,
      'good',
    );
    return true;
  }

  /** Check if player can claim an unclaimed land cell. Requires Proclamation. */
  canClaimCell(x: number, y: number): { ok: boolean; reason: string } {
    if (!this.stateProclaimed) return { ok: false, reason: 'Requires State tier' };

    const r = this.computeTerritoryGrid();
    const N = REGION_N;

    // Bounds check
    if (x < 0 || x >= N || y < 0 || y >= N) return { ok: false, reason: 'Out of bounds' };

    const idx = x * N + y;

    // Must be unclaimed land
    if (r.grid[idx] !== -1) {
      if (r.grid[idx] === -2) return { ok: false, reason: 'Water cannot be claimed' };
      return { ok: false, reason: 'Already claimed' };
    }

    // Must be adjacent to a player-controlled cell (6 hex neighbors)
    const adjacent = hexNeighbors(x, y).some(([ax, ay]) => {
      if (ax < 0 || ax >= N || ay < 0 || ay >= N) return false;
      return r.grid[ax * N + ay] === this.playerFactionId;
    });
    if (!adjacent) return { ok: false, reason: 'Not adjacent to your territory' };

    // Check treasury
    const COST = 25;
    if (this.treasury < COST) return { ok: false, reason: `Need £${COST}` };

    return { ok: true, reason: '' };
  }

  /** Claim an unclaimed land cell adjacent to player territory. */
  claimCell(x: number, y: number): boolean {
    const can = this.canClaimCell(x, y);
    if (!can.ok) return false;

    const r = this.computeTerritoryGrid();
    const N = REGION_N;
    const COST = 25;

    r.grid[x * N + y] = this.playerFactionId;
    this.treasury -= COST;
    this._territoryCache = null; // invalidate territory cache

    this.addLog(`Claimed land at (${x}, ${y}) for £${COST}`, 'good');
    return true;
  }

  // ---- Province Layer ----

  /** Compute province data from current settlements. One settlement = one province;
   *  the settlement is its own capital. Called by the UI province overlay. */
  computeProvinces(): Province[] {
    return this.settlements.map((s) => ({
      id: s.id,
      name: s.name,
      capitalId: s.id,
      factionId: s.factionId,
      centroidX: s.x,
      centroidY: s.y,
      totalPop: Math.round(this.popOf(s)),
      satisfaction: Math.round(s.satisfaction),
      militaryStrength: Math.round(s.garrisonStrength || 0),
      gdpContribution: Math.round(this.sectorOutputOf(s)),
      keyBuildings: s.buildings ?? [],
    }));
  }

  // ---- Phase 5: Province-level governance ----

  /** Get (or lazily initialise) the admin policy for a province. */
  getProvincePolicy(provinceId: number): HexProvincePolicy {
    if (!this.provincePolicies[provinceId]) {
      this.provincePolicies[provinceId] = { ...DEFAULT_PROVINCE_POLICY };
    }
    return this.provincePolicies[provinceId];
  }

  /** Update the administrative policy for a player-owned province. */
  setProvincePolicy(provinceId: number, patch: Partial<HexProvincePolicy>): boolean {
    const s = this.settlement(provinceId);
    if (!s || s.factionId !== this.playerFactionId) return false;
    if (!this.stateProclaimed) return false;
    const pol = this.getProvincePolicy(provinceId);
    if (patch.taxMultiplier !== undefined) pol.taxMultiplier = Math.max(0.5, Math.min(2.0, patch.taxMultiplier));
    if (patch.investmentLevel !== undefined) pol.investmentLevel = Math.max(0, Math.min(2, Math.round(patch.investmentLevel)));
    if (patch.autonomyLevel !== undefined) pol.autonomyLevel = Math.max(0, Math.min(2, Math.round(patch.autonomyLevel)));
    return true;
  }

  /** Monthly: apply province policy effects (autonomy satisfaction, investment garrison, tax multipliers). */
  private applyProvincePolicyEffects(): void {
    if (!this.stateProclaimed) return;
    for (const s of this.settlements) {
      if (s.factionId !== this.playerFactionId) continue;
      const pol = this.provincePolicies[s.id];
      if (!pol) continue;
      if (pol.autonomyLevel >= 2) {
        s.satisfaction = Math.min(100, s.satisfaction + 0.3);
        s.grievance = Math.max(0, s.grievance - 0.5);
      } else if (pol.autonomyLevel === 0 && s.satisfaction > 40) {
        s.satisfaction = Math.max(0, s.satisfaction - 0.1);
      }
      if (pol.investmentLevel >= 2 && this.treasury > 5) {
        this.treasury -= 2;
        s.garrisonStrength = Math.min(this.garrisonCap(s), s.garrisonStrength + 0.5);
      }
    }
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

  /** Finish any construction whose day has come. */
  private updateConstruction(): void {
    for (const t of this.settlements) {
      if (t.construction && this.day >= t.construction.doneDay) {
        const def = REGION_BUILDINGS_MAP.get(t.construction!.id);
        t.buildings.push(t.construction.id);
        // Record where it sits (chosen cell, or auto-sited in the worked ring).
        const cell = t.construction.cell !== undefined && this.canPlaceBuildingAt(t.id, t.construction.cell)
          ? t.construction.cell
          : this.autoPlaceCell(t);
        if (cell >= 0) t.placedBuildings.push({ id: t.construction.id, cell });
        t.construction = null;
        if (def) {
          // Phase D: a completed Wonder is claimed by its faction empire-wide
          // (keyed on completion, so ownership holds even if the cell relocated).
          if (def.unique) {
            this.wonderOwner[def.id] = t.factionId;
            if (t.factionId === this.playerFactionId) this.prestige += def.prestige ?? 0;
          }
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

  /** New Notables rise from the cohorts when a role falls vacant (GDD §2.4). */
  /** Public for systems/notables.ts (heir birth / vacancy fill). */
  mintNotable(
    role: NotableRole,
    settlementId: number,
    overrides?: {
      skill?: number;
      health?: number;
      backstory?: string;
      parentId?: number;
      factionAlignment?: string;
      age?: number;
      name?: string;
    },
  ): Notable {
    const t = this.settlement(settlementId);
    const first = ['Edda', 'Tomas', 'Sela', 'Bruno', 'Petra', 'Anders', 'Ivy', 'Casimir'][this.rng.int(8)];
    const last = ['Weller', 'Stroud', 'Halvorsen', 'Quint', 'Mercer', 'Dunmore'][this.rng.int(6)];
    const n: Notable = {
      id: this.nextId++,
      name: overrides?.name ?? `${first} ${last}`,
      age: overrides?.age ?? (25 + this.rng.int(20)),
      traits: [],
      role,
      settlementId,
      bio: t ? [`Rose to ${role} of ${t.name}, ${this.year}.`] : [`Rose to ${role}, ${this.year}.`],
      alive: true,
      skill: overrides?.skill ?? (30 + this.rng.int(70)),
      health: overrides?.health ?? (60 + this.rng.int(40)),
      children: [],
      loyalty: 80,
      factionAlignment: overrides?.factionAlignment,
      backstory: overrides?.backstory,
      yearEnteredRole: this.year,
      monthsIgnored: 0,
      parentId: overrides?.parentId,
    };
    this.notables.push(n);
    if (t) {
      this.addLog(`${n.name} rises to ${role} of ${t.name}.`, 'info');
    }
    return n;
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

  /** Calculate the treasury cost to found a new town based on number of existing settlements.
   *  Formula: 100 * (1.5 ^ numTowns) — costs grow exponentially to encourage dense settlement. */
  foundingCost(): number {
    const playerTowns = this.settlements.filter((s) => s.factionId === this.playerFactionId).length;
    const baseCost = 100;
    const multiplier = Math.pow(1.5, playerTowns);
    return Math.round(baseCost * multiplier);
  }

  canFoundTown(fromId: number): { ok: boolean; reason: string } {
    const t = this.settlement(fromId);
    if (!t) return { ok: false, reason: 'no settlement' };
    if (this.settlements.length + this.expeditions.length >= MAX_SETTLEMENTS) {
      return { ok: false, reason: 'region fully settled (see map-scale design)' };
    }
    const m = this.expansionCostMult();
    const needPop = Math.round(24 * m), needFood = Math.round(80 * m), needWood = Math.round(80 * m);
    const foundCost = this.foundingCost();
    if (this.treasury < foundCost) {
      return { ok: false, reason: `founding costs ${formatCurrency(foundCost)} (have ${formatCurrency(Math.floor(this.treasury))})` };
    }
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
    const foundCost = this.foundingCost();
    this.treasury -= foundCost;
    const e = this.expeditions[this.expeditions.length - 1];
    const days = e.arrivesDay - this.day;
    this.addLog(
      `An expedition of 8 sets out from ${t.name} for ${e.name} — ${days} days through ` +
      `${e.site.roughness > 0.5 ? 'hard country' : 'open country'}` +
      `${e.site.river ? ', bound for a river site' : ''}${e.site.coastal ? ', on the coast' : ''} ` +
      `(charter fee: ${formatCurrency(foundCost)}).`,
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

  /** Militia drill cost at the current development level. */
  militiaCost(): number {
    return this.flatCost(RegionSim.MILITIA_COST);
  }

  canRecruitMilitia(townId: number): { ok: boolean; reason: string } {
    const t = this.settlement(townId);
    if (!t) return { ok: false, reason: 'no settlement' };
    if (this.treasury < this.militiaCost()) {
      return { ok: false, reason: `needs ${formatCurrency(this.militiaCost())} (have ${formatCurrency(Math.floor(this.treasury))})` };
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
    this.treasury -= this.militiaCost();
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
          factionStrengths: new Map(activeFactions(this.year).map(f => [f.id, 50] as [NewFactionId, number])),
          sectors: defaultSectors(),
          buildings: [],
          placedBuildings: [],
          placedDistricts: [],
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
    this.rebuildPolicySet();
    return true;
  }

  /** Socket a researched civic/law into a named policy slot.
   *  Validates category match and that the gov type has this slot.
   *  Returns false on invalid input. */
  activatePolicySlot(category: string, cardId: string): boolean {
    if (!this.nationProclaimed || !this.govType) return false;
    const govDef = GOV_TYPES.find((g) => g.id === this.govType)!;
    const card = POLICY_CARDS.find((c) => c.id === cardId);
    if (!card) return false;
    if (card.domain !== category) return false;  // category must match
    if (!card.prereqs.every((p) => this.has(p))) return false;

    // Find a matching empty slot, or count available slots
    const slotsForCategory = govDef.policySlots.filter((d) => d === category).length;
    const occupied = this.policySlots.filter((s) => s.category === category).length;
    if (occupied >= slotsForCategory) return false;  // no room

    const slotId = `${category}_${this.policySlots.filter((s) => s.category === category).length}`;
    this.policySlots.push({ category, slotId, cardId });
    return true;
  }

  /** Remove a policy from a slot by slotId. */
  deactivatePolicySlot(slotId: string): boolean {
    const idx = this.policySlots.findIndex((s) => s.slotId === slotId);
    if (idx < 0) return false;
    this.policySlots.splice(idx, 1);
    return true;
  }

  private rebuildPolicySet(): void {
    this.activePolicySet = new Set(this.activePolicies.filter((x): x is string => x !== null));
  }

  policyActive(id: string): boolean {
    return this.activePolicySet.has(id);
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
      // Phase 11: carbon pricing laws immediately tighten faction factions
      case 'carbon_pricing':
        // Workers faction wary of energy cost increases; Landowners/industry lobby against
        for (const f of this.factions) {
          if (f.id === 'workers') f.support = Math.max(0, f.support - 5);
          if (f.id === 'merchants') f.support = Math.max(0, f.support - 10);
          if (f.id === 'landowners') f.support = Math.max(0, f.support - 15);
        }
        break;
      case 'universal_basic_support':
        this.enactUniversalBasicSupport();
        break;
    }

    this.addLog(`LAW ENACTED: "${law.name}". ${law.desc.split('.')[0]}.`, 'good');

    // Resignation check: ministers who oppose the law's faction alignment may resign
    const lawFaction = (law as any).factionAlignment as string | undefined;
    if (lawFaction) {
      for (let i = 0; i < this.ministers.length; i++) {
        const m = this.ministers[i];
        if (m.notableId === null) continue;
        const notable = this.notables.find((n) => n.id === m.notableId && n.alive);
        if (!notable || (notable.skill ?? 0) <= 50) continue;
        if (notable.factionAlignment && notable.factionAlignment !== lawFaction && this.rng.chance(0.05)) {
          this.addLog(`${notable.name}, ${m.title}, resigns in protest of "${law.name}".`, 'bad');
          m.notableId = null;
          this.selectSuccessor(i);
        }
      }
    }

    // Record portfolio action based on law domain (for advisor loyalty tracking)
    const domainToPortfolio: Record<string, MinisterRoleId> = {
      economic: 'treasury',
      social: 'interior',
      security: 'defence',
      information: 'press',
    };
    const portfolio = domainToPortfolio[(law as any).domain as string];
    if (portfolio) this.recordPortfolioAction(portfolio);

    return true;
  }

  // ---- Nation-tier: Constitutional Convention (GDD §2.2) ----

  /** True when the player may call the Constitutional Convention. */
  canCallConvention(): boolean {
    return this.canCallConventionGates().every(g => g.met);
  }

  /** Per-requirement breakdown for the Constitutional Convention, so the UI
   *  can show exactly which conditions are met and which still block the call. */
  /** Player commits to a recovery path when the crossroads event fires.
   *  Stimulus: faster depth decay, treasury drain for 24 months.
   *  Austerity: slower decay, services cut, grievance spike. */
  chooseRecoveryPath(path: 'stimulus' | 'austerity'): boolean {
    if (this.crashRecoveryChoice !== 'pending') return false;
    this.crashRecoveryChoice = path;
    if (path === 'stimulus') {
      this.stimulusMonthsLeft = 24;
      this.depressionDepth *= 0.5; // immediate recovery boost
      this.addLog(
        'STIMULUS: The state opens the treasury — public works, emergency credits, deficit bonds. ' +
        'Factories begin to stir. The recovery will cost; it is the correct cost.',
        'good',
      );
    } else {
      this.depressionDepth *= 0.8; // smaller immediate boost
      this.servicesLevel = Math.max(0, this.servicesLevel - 0.5);
      for (const t of this.settlements) {
        if (t.factionId !== this.playerFactionId) continue;
        t.grievance = Math.min(100, t.grievance + 15);
        t.satisfaction = Math.max(0, t.satisfaction - 10);
      }
      this.addLog(
        'AUSTERITY: The budget is balanced. Services cut, wages held. Markets stabilize ' +
        'slowly, painfully. The books are clean; the streets are not.',
        'info',
      );
    }
    return true;
  }

  /** Enact an emergency depression-response measure. Each is available once
   *  while a depression is active, giving the player real agency from the first
   *  month of the slump rather than only at the month-12 crossroads.
   *  Returns { ok, reason } so the UI can explain why a measure is unavailable. */
  enactDepressionMeasure(measure: DepressionMeasure): { ok: boolean; reason?: string } {
    if (this.depressionDepth <= 0.05) return { ok: false, reason: 'No active depression' };
    if (this.depressionMeasuresUsed.includes(measure)) return { ok: false, reason: 'Already enacted' };
    switch (measure) {
      case 'qe': {
        if (!this.passedLaws.has('central_bank_charter')) {
          return { ok: false, reason: 'Requires Central Bank Charter' };
        }
        this.policyRate = Math.max(MIN_POLICY_RATE, this.policyRate * 0.4);
        this.depressionDepth *= 0.80;
        this.confidence = Math.min(100, this.confidence + 6);
        this.inflationRate = Math.min(0.50, this.inflationRate + 0.03);
        this.depressionCeilingBonus += 8;
        this.addLog(
          'EMERGENCY EASING: The Central Bank slashes the policy rate and floods the banks ' +
          'with liquidity. Credit thaws and the worst of the panic eases — but cheap money ' +
          'is sowing tomorrow’s inflation.',
          'good',
        );
        break;
      }
      case 'gold': {
        this.setMonetaryRegime('float');
        this.exchangeRate = Math.max(0.45, this.exchangeRate * 0.75);
        this.depressionDepth *= 0.78;
        this.confidence = Math.max(5, this.confidence - 4);
        this.depressionCeilingBonus += 6;
        this.addLog(
          'OFF THE GOLD STANDARD: The currency floats free and devalues. Exporters roar back ' +
          'to life as their goods undercut the world — the surest road out of the slump, ' +
          'though savers and foreign creditors howl.',
          'good',
        );
        break;
      }
      case 'publicworks': {
        const cost = Math.round(this.gdpLastMonth * 0.5 + 60);
        if (this.treasury < cost) {
          return { ok: false, reason: `Needs ${formatCurrency(cost)} in the treasury` };
        }
        this.treasury -= cost;
        this.depressionDepth *= 0.82;
        this.confidence = Math.min(100, this.confidence + 4);
        this.depressionCeilingBonus += 6;
        for (const t of this.settlements) {
          if (t.factionId !== this.playerFactionId) continue;
          t.grievance = Math.max(0, t.grievance - 12);
          t.satisfaction = Math.min(100, t.satisfaction + 8);
          t.activeEvents = t.activeEvents.filter((ev) => ev.kind !== 'labor_shortage');
        }
        this.addLog(
          'PUBLIC WORKS: Dams, roads, and power lines rise across the nation. The idle go back ' +
          'to work — wages flow into dead towns and the bread lines shorten. The treasury pays ' +
          'the bill, and pays it gladly.',
          'good',
        );
        break;
      }
    }
    this.depressionMeasuresUsed.push(measure);
    return { ok: true };
  }

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
    if (def.maxYear !== undefined && this.year > def.maxYear) {
      // This regime can no longer be newly adopted past its historical
      // window (e.g. a fascist government after 1955).
      return;
    }
    this.nationName = name;
    this.govType = gov;
    this.legitimacy = def.startingLegitimacy;
    this.nationProclaimed = true;
    this.activePolicies = new Array(def.policySlots.length).fill(null);
    this.rebuildPolicySet();
    // Reset per-regime fields on proclamation
    this.planningOptimism = 0;
    this.schismRisk = 0;
    this.shareholderPatience = 80;
    this.policySlots = [];
    this.transitionChain = null;
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

  /** Appoint a new minister when a portfolio becomes vacant (death, defection, or resignation). */
  selectSuccessor(portfolioIndex: number): void {
    const portfolio = this.ministers[portfolioIndex];
    if (!portfolio) return;
    const occupiedIds = new Set(this.ministers.map((m) => m.notableId).filter((id) => id !== null));
    const currentMinister = portfolio.notableId !== null
      ? this.notables.find((n) => n.id === portfolio.notableId)
      : null;
    const preferredFaction = currentMinister?.factionAlignment;

    // Find candidates: alive, age >= 25, not already a minister
    const candidates = this.notables.filter(
      (n) => n.alive && n.age >= 25 && !occupiedIds.has(n.id),
    );

    let chosen: Notable | null = null;
    if (candidates.length > 0) {
      // Prefer same faction alignment, then highest skill
      const aligned = preferredFaction
        ? candidates.filter((c) => c.factionAlignment === preferredFaction)
        : [];
      const pool = aligned.length > 0 ? aligned : candidates;
      chosen = pool.reduce((best, c) => ((c.skill ?? 0) > (best.skill ?? 0) ? c : best));
    }

    if (!chosen) {
      // Mint a new notable if no candidates
      const settlementId = this.settlements[0]?.id ?? 0;
      chosen = this.mintNotable('Reeve', settlementId);
    }

    portfolio.notableId = chosen.id;
    chosen.yearEnteredRole = this.year;
    chosen.monthsIgnored = 0;
    this.addLog(`Parliament appoints ${chosen.name} as new ${portfolio.title}.`, 'info');
  }

  /** Compile dynasty tree from notables that have parent/child relationships. */
  buildDynastyTree(): DynastyNode[] {
    return this.notables
      .filter((n) => n.parentId !== undefined || n.children.length > 0)
      .map((n) => ({
        id: n.id,
        name: n.name,
        parentId: n.parentId,
        birthYear: Math.floor(this.year - n.age),
        deathYear: n.deathYear,
        role: n.role,
      }));
  }

  // ---- Phase 18: Advisor System Depth (GDD §8.7) ----

  /** Map a human-readable portfolio name to a MinisterRoleId (tolerant of aliases). */
  private portfolioToRole(portfolioName: string): MinisterRoleId | null {
    const norm = portfolioName.toLowerCase().replace(/\s+/g, '_');
    const map: Record<string, MinisterRoleId> = {
      treasury: 'treasury',
      finance: 'treasury',
      interior: 'interior',
      defence: 'defence',
      defense: 'defence',
      war: 'war',
      press: 'press',
      science: 'science',
      foreign: 'foreign',
      foreign_affairs: 'foreign',
    };
    return map[norm] ?? null;
  }

  /**
   * Skill-based forecast accuracy (GDD §8.7).
   * High skill (80) → ±6% noise; Low skill (20) → ±24% noise; no minister → ±30–60%.
   */
  advisorForecast(portfolioName: string, trueValue: number): number {
    const role = this.portfolioToRole(portfolioName);
    const minister = role ? this.ministerFor(role) : null;

    let noiseScale: number;
    if (minister) {
      const skill = minister.skill ?? 50;
      noiseScale = (1 - skill / 100) * Math.abs(trueValue) * 0.3;
    } else {
      noiseScale = Math.abs(trueValue) * (0.30 + Math.random() * 0.30);
    }
    const gaussian = (Math.random() + Math.random() + Math.random() - 1.5) * noiseScale;
    return trueValue + gaussian;
  }

  /**
   * Ideology-biased forecast — applies portfolio-specific bias on top of skill noise (GDD §8.7).
   * War minister underestimates cost; Press minister downplays gap; Interior overstates risk.
   */
  biasedForecast(portfolioName: string, trueValue: number, _metric: string): number {
    const norm = portfolioName.toLowerCase();
    let biased = trueValue;
    if (norm === 'war') {
      biased = trueValue * 0.75;
    } else if (norm === 'press') {
      biased = trueValue * 0.6;
    } else if (norm === 'interior') {
      biased = trueValue * 1.3;
    }
    return this.advisorForecast(portfolioName, biased);
  }

  private pushAdvisorBrief(portfolio: string, message: string): void {
    const cooldown = 12 * 30;
    const lastDay = this.advisorBriefLastDay[portfolio] ?? -Infinity;
    if (this.day - lastDay < cooldown) return;
    this.advisorBriefLastDay[portfolio] = this.day;
    this.advisorBriefs.unshift({ portfolio, message, day: this.day });
    if (this.advisorBriefs.length > 5) this.advisorBriefs.pop();
  }

  dismissAdvisorBriefs(): void {
    this.advisorBriefs = [];
  }

  generateAdvisorBriefs(): void {
    if (!this.nationProclaimed) return;
    const year = this.year;

    if (this.gdpLastMonth > 0 && this.nationalDebt > 0) {
      const annualRevenue = this.gdpLastMonth * this.taxRate * 12;
      const projectedDebtIn3 = this.nationalDebt * Math.pow(1 + this.bondRate, 3);
      const projectedService = projectedDebtIn3 * this.bondRate;
      if (annualRevenue > 0 && projectedService / annualRevenue > 0.20) {
        this.pushAdvisorBrief(
          'Treasury',
          `Your Excellency — on the current path, debt service will consume 20% of revenue by ${year + 3}. Immediate fiscal action is advised.`,
        );
      }
    }

    const poorHousingSettlements = this.settlements.filter(
      (t) => t.satisfaction < 30 && t.housing < this.popOf(t),
    );
    if (poorHousingSettlements.length >= 3) {
      this.pushAdvisorBrief(
        'Interior',
        `Interior briefing: housing satisfaction has collapsed in ${poorHousingSettlements.length} settlements. Unrest is likely within the year.`,
      );
    }

    if (this.rivals.length > 0) {
      const militaryTechs = ['steel_industry', 'military_reform', 'computing'];
      const playerHas = militaryTechs.filter((t) => this.has(t)).length;
      const rivalAhead = this.rivals.some((rv) => {
        const rvMilitary = (rv.weights?.expansion ?? 5) + (rv.weights?.risk ?? 5);
        return rvMilitary > 12 && playerHas < 2;
      });
      if (rivalAhead) {
        this.pushAdvisorBrief(
          'Science',
          `Science Ministry: rival nations are outpacing our military research in multiple fields. Recommend redirecting funding.`,
        );
      }
    }

    const hostileRival = this.rivals.find((rv) => rv.relations < -40);
    if (hostileRival) {
      this.pushAdvisorBrief(
        'Foreign Affairs',
        `Foreign Secretary: ${hostileRival.name} has become increasingly hostile. Recommend diplomatic engagement before tensions escalate.`,
      );
    }

    if (this.legitimacy < 40 && (100 - this.legitimacy) > 60) {
      this.pushAdvisorBrief(
        'Press',
        `Press Secretary: the credibility gap is widening. Public trust is eroding faster than our messaging can contain.`,
      );
    }
  }

  recordPortfolioAction(portfolio: MinisterRoleId): void {
    this.lastActionDay[portfolio] = this.day;
    const assignment = this.ministers.find((m) => m.role === portfolio);
    if (assignment?.notableId !== null && assignment?.notableId !== undefined) {
      const notable = this.notables.find((n) => n.id === assignment.notableId && n.alive);
      if (notable) {
        notable.monthsIgnored = 0;
        notable.loyalty = Math.min(100, (notable.loyalty ?? 100) + 5);
      }
    }
  }

  /** Start a government transition chain from the current gov to a target gov type.
   *  Returns false if no chain exists or prerequisites aren't met. */
  beginTransition(toGovType: string): boolean {
    if (!this.nationProclaimed || !this.govType) return false;
    const key = `${this.govType}:${toGovType}`;
    const steps = TRANSITION_CHAINS[key];
    if (!steps || steps.length === 0) return false;
    if (this.transitionChain) return false; // already in progress
    this.transitionChain = {
      fromGov: this.govType,
      toGov: toGovType,
      steps,
      currentStep: 0,
    };
    this.addLog(
      `TRANSITION BEGINS: The path from ${this.govType} to ${toGovType} starts now. ` +
      `Step 1: ${steps[0].description}.`,
      'info',
    );
    return true;
  }

  /** Confirm the current transition step. Returns false if cost can't be met.
   *  On the final step, changes govType. */
  advanceTransition(): boolean {
    if (!this.transitionChain) return false;
    const chain = this.transitionChain;
    const step = chain.steps[chain.currentStep];
    if (!step) return false;

    // Capital cost
    if (this.politicalCapital < step.capitalCost) return false;
    this.politicalCapital -= step.capitalCost;

    // Faction resistance effects
    for (const fr of step.factionResistance) {
      const faction = this.factions.find((f) => f.id === fr.factionId);
      if (faction) {
        faction.support = Math.max(0, (faction.support ?? 50) - fr.resistance);
      }
    }

    // Violence risk
    if (this.rng.chance(step.violenceRisk)) {
      for (const t of this.settlements) {
        t.grievance = Math.min(100, t.grievance + 15);
      }
      this.addLog(
        `UNREST: The transition triggers violence — troops clash with protesters in the streets.`,
        'bad',
      );
    }

    // International reaction
    if (step.internationalReaction !== 0) {
      for (const rv of this.rivals) {
        rv.relations = this.clampRel(rv.relations + step.internationalReaction);
      }
    }

    chain.currentStep++;

    // Final step: complete the transition
    if (chain.currentStep >= chain.steps.length) {
      const toGov = chain.toGov as GovType;
      const def = GOV_TYPES.find((g) => g.id === toGov);
      if (def) {
        this.govType = toGov;
        this.legitimacy = Math.min(100, this.legitimacy + 20);
        this.activePolicies = new Array(def.policySlots.length).fill(null);
        this.rebuildPolicySet();
      }
      this.addLog(
        `TRANSITION COMPLETE: The ${toGov.replace(/_/g, ' ')} is established. A new chapter begins.`,
        'good',
      );
      this.transitionChain = null;
    } else {
      this.addLog(
        `TRANSITION STEP ${chain.currentStep}: ${chain.steps[chain.currentStep].description}.`,
        'info',
      );
    }
    return true;
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
    comparison: string;
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

    // Power comparison relative to player's total population
    const playerPop = this.settlements.reduce((sum, t) => sum + t.cohorts.bands.reduce((a, b) => a + b, 0), 0);
    let comparison = '≈ equal strength';
    if (rv.pop > playerPop * 1.3) comparison = '⬆ stronger than you';
    else if (rv.pop < playerPop * 0.7) comparison = '⬇ weaker than you';

    // Show most recent history items
    const recentHistory = rv.history.slice(-3);

    const personality = RIVAL_ARCHETYPES[rv.archetype].name;

    return { personality, traits, recentHistory, approximateStrength: strength, comparison };
  }

  clampRel(v: number): number {
    return Math.max(-100, Math.min(100, v));
  }

  regimeOf(rv: RivalNation): RivalRegimeDef {
    return RIVAL_REGIMES.find((g) => g.id === rv.regime) ?? RIVAL_REGIMES[0];
  }

  /** The player's bloc, for ideology distance — null before the Proclamation. */
  playerBloc(): RegimeBloc | null {
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
   *  Public so scenarios and tests can seed the world directly.
   *  Prefers named rival nations from the roster, falls back to procedural generation. */
  spawnRival(archetype?: RivalArchetype): RivalNation | null {
    if (this.rivals.length >= MAX_RIVALS) return null;

    // Try to pick a named rival nation first
    let namedDef: RivalNationDef | null = null;
    const availableNamed = (rivalNationsJson as unknown as RivalNationDef[]).filter(
      (n) => !this.usedNamedRivals.has(n.id),
    );
    if (availableNamed.length > 0) {
      namedDef = availableNamed[this.rng.int(availableNamed.length)];
      this.usedNamedRivals.add(namedDef.id);
    }

    // Use named nation data if available, otherwise procedural
    let arch: RivalArchetype;
    let weights: RivalPersonality;
    let regime: RivalRegimeDef;
    let name: string;
    let leader: string;
    let agenda: string;

    if (namedDef) {
      arch = namedDef.archetype as RivalArchetype;
      weights = namedDef.personality;
      regime = RIVAL_REGIMES.find((r) => r.id === namedDef.regimeId) || this.pickRegime(namedDef.personality);
      name = namedDef.name;
      leader = namedDef.leader;
      agenda = namedDef.agenda;
    } else {
      // Fallback to procedural generation
      const kinds = Object.keys(RIVAL_ARCHETYPES) as RivalArchetype[];
      arch = archetype ?? kinds[this.rng.int(kinds.length)];
      const base = RIVAL_ARCHETYPES[arch].weights;
      const jitter = (v: number) => Math.max(0, Math.min(10, v + this.rng.int(3) - 1));
      weights = {
        expansion: jitter(base.expansion),
        commerce: jitter(base.commerce),
        ideology: jitter(base.ideology),
        risk: jitter(base.risk),
        honor: jitter(base.honor),
        grudge: jitter(base.grudge),
      };
      regime = this.pickRegime(weights);
      const names = RIVAL_NAMES.filter((n) => !this.rivals.some((rv) => rv.name === n));
      const leaders = RIVAL_LEADERS.filter((n) => !this.rivals.some((rv) => rv.leader === n));
      name = names[this.rng.int(names.length)] ?? `Power ${this.rivals.length + 1}`;
      leader = leaders[this.rng.int(leaders.length)] ?? 'the Directorate';
      agenda = RIVAL_AGENDAS[arch];
    }

    // banners stack, but spread the powers around the horizon first
    const counts = { north: 0, east: 0, south: 0, west: 0 };
    for (const rv of this.rivals) counts[rv.compass]++;
    const compass = (['north', 'east', 'south', 'west'] as const)
      .reduce((a, b) => (counts[b] < counts[a] ? b : a));

    const origin = namedDef ? namedDef.description : RIVAL_ORIGINS[this.rng.int(RIVAL_ORIGINS.length)];

    // Apply starting bonuses to initial population
    let popBonus = 1.0;
    if (namedDef && namedDef.startingBonuses.treasury) {
      popBonus = (namedDef.startingBonuses.treasury as number) || 1.0;
    }

    const rv: RivalNation = {
      id: this.nextId++,
      name,
      leader,
      archetype: arch,
      weights,
      regime: regime.id,
      agenda,
      compass,
      pop: Math.round((2500 + this.rng.int(3000)) * popBonus),
      relations: this.clampRel(10 + weights.commerce - weights.expansion - weights.grudge + this.rng.int(11) - 5),
      treaties: [],
      borderSettled: false,
      emergedYear: this.year,
      history: [`Proclaimed ${this.year}, ${COMPASS_FLAVOR[compass]} — ${origin}.`],
      lastEnvoyDay: -999,
      lastGiftDay: -999,
      flagData: namedDef ? namedDef.flag : undefined,
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
    const archetypeData = RIVAL_ARCHETYPES[arch];
    this.addLog(
      `A NEW POWER: ${COMPASS_FLAVOR[rv.compass]}, ${rv.leader} proclaims ${rv.name}, a ${regime.name.toLowerCase()} ` +
      `${origin} — ${archetypeData.name}. The envoys describe them as follows: "${archetypeData.desc}" Their stated agenda: "${rv.agenda}."`,
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

    // Archetype-driven negotiating tactics
    if (rv.archetype === 'trading_republic' && kind === 'trade_agreement') {
      ask -= 8; // merchants drive hard bargains on trade
    } else if (rv.archetype === 'hegemon' && kind === 'defensive_pact') {
      ask += 10; // hegemons avoid entangling alliances
    } else if (rv.archetype === 'hermit_kingdom' && kind === 'non_aggression') {
      ask -= 5; // hermits prize fences
    } else if (rv.archetype === 'crusader_state' && kind === 'defensive_pact') {
      ask -= 6; // crusaders build coalitions
    } else if (rv.archetype === 'opportunist') {
      ask += 5; // opportunists play hard to get
    }

    // Alliance stance (nation design): a coalition-builder's word is easier
    // to take; an isolationist's signature is worth less to everyone.
    if (this.allianceStance === 'coalition-builder') ask -= 5;
    else if (this.allianceStance === 'isolationist') ask += 5;
    return Math.round(ask);
  }

  // ---- the bargaining table (GDD §6.3): baskets, valuation, counter-offers ----

  /** How embattled a rival is, 0..1 (GDD §6.3). Currently: 1 while it is fighting
   *  a foreign war, else 0. An embattled power fears a second front and needs income
   *  and allies, so it comes to the player's table more readily (see
   *  `SITUATION_TREATY_BONUS`). Pure read off the already-serialized `foreignWars`
   *  ledger — no RNG, no mutation — and 0 in peacetime, so deal valuation is
   *  unchanged in all current play. Surfacing it lets the UI flag a keen partner. */
  rivalSituation(rv: RivalNation): number {
    return this.foreignWars.some((w) => w.a === rv.id || w.b === rv.id) ? 1 : 0;
  }

  /** What signing this treaty is worth *to the rival*, in diplomatic points —
   *  positive is appetite, negative is a concession it wants paying for. */
  treatyAppetite(rv: RivalNation, kind: TreatyKind): number {
    // Base personality-driven appetite
    let appetite = 0;
    switch (kind) {
      case 'trade_agreement':
        // Markets are most valuable to commerce-minded powers
        appetite = rv.weights.commerce * 1.6 - 4;
        // Trading republics and merchants prize this highest
        if (rv.archetype === 'trading_republic') appetite += 3;
        break;
      case 'non_aggression':
        appetite = (10 - rv.weights.risk) * 0.8 + rv.weights.honor * 0.3 - 3;
        // Hermit kingdoms and defensive-minded powers love these
        if (rv.archetype === 'hermit_kingdom') appetite += 2;
        if (rv.archetype === 'crusader_state') appetite += 1; // ideological protection
        // Hegemons and opportunists less interested
        if (rv.archetype === 'hegemon') appetite -= 2;
        if (rv.archetype === 'opportunist') appetite -= 1;
        break;
      case 'defensive_pact':
        // An entangling commitment: the honorable mean it, the rash resent it
        appetite = rv.weights.honor * 0.8 - rv.weights.risk * 0.5 - 5;
        // Crusader states and trading republics form defensive alliances
        if (rv.archetype === 'crusader_state') appetite += 2; // ideological alliance
        if (rv.archetype === 'trading_republic') appetite += 1; // mutual protection
        // Hegemons avoid entangling alliances
        if (rv.archetype === 'hegemon') appetite -= 3;
        // Opportunists avoid commitment
        if (rv.archetype === 'opportunist') appetite -= 2;
        break;
      case 'climate_accord':
        // Commerce-driven powers value stable, shared rules; expansion hawks balk
        appetite = rv.weights.commerce * 1.2 - rv.weights.expansion * 0.8 - 3;
        // Trading republics support environmental stability for trade
        if (rv.archetype === 'trading_republic') appetite += 2;
        // Hegemons resist external constraints
        if (rv.archetype === 'hegemon') appetite -= 2;
        break;
    }
    // An embattled rival (fighting a foreign war) is keener on protection and
    // income. Additive bonus, 0 at peace → byte-identical in all current play.
    appetite += (SITUATION_TREATY_BONUS[kind] ?? 0) * this.rivalSituation(rv);
    return appetite;
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
    const foreignBonus = this.ministerFor('foreign') ? 5 : 0;
    const gain = Math.max(1, 4 + Math.round(rv.weights.commerce * 0.3) + stanceBonus + foreignBonus);
    rv.relations = this.clampRel(rv.relations + gain);
    // Record this diplomatic outreach in rival history if it's a turning point
    if (rv.relations < -30 && rv.relations + gain >= -30) {
      this.noteHistory(rv, `Thaw in relations with ${this.stateName || 'the State'}, ${this.year}.`);
    }
    this.addLog(`An envoy rides for ${rv.name} with letters and samples of the valley's grain — relations warm (+${gain}).`, 'good');
    this.recordPortfolioAction('foreign'); // Phase 18: foreign secretary loyalty
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

  // ---- Espionage (GDD §5.5): the covert track parallel to open diplomacy ----

  /** The player's current intelligence penetration of a rival, 0..1. */
  intelOf(rivalId: number): number {
    return this.rival(rivalId)?.intel ?? 0;
  }

  /** Probability an operation succeeds, given current intel on the target. */
  espionageSuccessChance(rivalId: number, op: EspionageOp): number {
    const def = ESPIONAGE_OPS[op];
    const intel = this.intelOf(rivalId);
    return Math.max(0.05, Math.min(0.95, def.baseSuccess + (intel - def.intelRequired) * 0.4));
  }

  /** Whether a covert operation can be attempted right now. */
  canRunEspionage(rivalId: number, op: EspionageOp): { ok: boolean; reason: string } {
    const rv = this.rival(rivalId);
    const def = ESPIONAGE_OPS[op];
    if (!rv) return { ok: false, reason: 'No such rival' };
    if (!this.stateProclaimed) return { ok: false, reason: 'Proclaim a State first' };
    if (this.treasury < def.cost) return { ok: false, reason: `Need ${formatCurrency(def.cost)}` };
    if (this.day - (rv.lastEspionageDay ?? -ESPIONAGE_COOLDOWN_DAYS) < ESPIONAGE_COOLDOWN_DAYS) {
      return { ok: false, reason: 'Agents still in the field' };
    }
    if ((rv.intel ?? 0) < def.intelRequired) {
      return { ok: false, reason: `Needs intel ≥ ${Math.round(def.intelRequired * 100)}%` };
    }
    return { ok: true, reason: `${formatCurrency(def.cost)} · ${Math.round(this.espionageSuccessChance(rivalId, op) * 100)}% success` };
  }

  /** Run a covert operation. Rolls success and a separate exposure check; both
   *  use the AI stream so the open simulation stays reproducible. */
  runEspionage(rivalId: number, op: EspionageOp): EspionageResult {
    const can = this.canRunEspionage(rivalId, op);
    if (!can.ok) return { ok: false, success: false, exposed: false, reason: can.reason };
    const rv = this.rival(rivalId)!;
    const def = ESPIONAGE_OPS[op];
    this.treasury -= def.cost;
    rv.lastEspionageDay = this.day;
    const intel = rv.intel ?? 0;
    const success = this.aiRng.chance(this.espionageSuccessChance(rivalId, op));
    // Caught more often on a botched job; deep intel buys quieter agents.
    const exposureP = Math.max(0, Math.min(0.9, def.exposureRisk * (success ? 0.6 : 1.4) * (1 - intel * 0.5)));
    const exposed = this.aiRng.chance(exposureP);

    let outcome = '';
    if (success) {
      switch (op) {
        case 'gather_intel': {
          rv.intel = Math.min(1, intel + 0.25);
          outcome = `Intelligence on ${rv.name} deepens (${Math.round(rv.intel * 100)}%).`;
          break;
        }
        case 'steal_tech': {
          if (this.activeResearch) {
            const node = TECH_TREE.find((n) => n.id === this.activeResearch);
            const boost = node ? this.techCost(node) * 0.4 : 0;
            this.researchProgress += boost;
            outcome = `Stolen blueprints from ${rv.name} leap your research forward.`;
          } else {
            const windfall = 80 + Math.round(rv.weights.commerce * 12);
            this.treasury += windfall;
            outcome = `Lifted trade secrets from ${rv.name} — sold on for ${formatCurrency(windfall)}.`;
          }
          break;
        }
        case 'sabotage_economy': {
          rv.pop = Math.round(rv.pop * 0.95);
          this.noteHistory(rv, `Suffered industrial sabotage, ${this.year}.`);
          outcome = `A warehouse district of ${rv.name} burns — their economy stumbles.`;
          break;
        }
        case 'incite_unrest': {
          rv.pop = Math.round(rv.pop * 0.97);
          // Sow discord: fracture one of the rival's alliances if any exist.
          const ally = this.alliances.find((k) => k.split(':').map(Number).includes(rv.id));
          if (ally) {
            this.alliances = this.alliances.filter((k) => k !== ally);
            const partner = ally.split(':').map(Number).find((id) => id !== rv.id);
            const partnerName = partner != null ? this.rival(partner)?.name ?? 'a neighbour' : 'a neighbour';
            outcome = `Dissident funds split ${rv.name} from ${partnerName} — their alliance fractures.`;
          } else {
            outcome = `Unrest spreads through ${rv.name}'s streets.`;
          }
          break;
        }
      }
    } else {
      outcome = `The operation against ${rv.name} fails.`;
    }

    if (exposed) {
      const sting = op === 'gather_intel' ? 8 : op === 'steal_tech' ? 16 : 24;
      rv.relations = this.clampRel(rv.relations - (sting + rv.weights.grudge));
      this.noteHistory(rv, `Caught ${this.stateName || 'the State'} running agents, ${this.year}.`);
      this.addLog(`COVERT OP EXPOSED: ${rv.name} catches your hand in the ${def.name.toLowerCase()}. Relations sour.`, 'bad');
      // Phase 6: hostile rivals retaliate with sanctions when caught
      if (rv.relations < -20 && op !== 'gather_intel') this.rivalImposeSanction(rv);
    } else {
      this.addLog(`${def.name} against ${rv.name}: ${outcome}`, success ? 'good' : 'info');
    }
    return { ok: true, success, exposed, reason: outcome };
  }

  // ---- Trade blocs (GDD §6.5): player-founded economic unions ----

  /** The single trade bloc the player has founded, if any. */
  playerTradeBloc(): TradeBloc | null {
    return this.tradeBlocs[0] ?? null;
  }

  /** Rivals eligible to join a bloc: warm enough and holding a trade agreement. */
  blocEligibleRivals(): RivalNation[] {
    return this.rivals.filter(
      (rv) => rv.relations >= BLOC_RELATIONS_FLOOR && rv.treaties.includes('trade_agreement'),
    );
  }

  /** Whether a new bloc can be founded right now. */
  canFormTradeBloc(): { ok: boolean; reason: string } {
    if (!this.stateProclaimed) return { ok: false, reason: 'Proclaim a State first' };
    if (this.playerTradeBloc()) return { ok: false, reason: 'You already lead a bloc' };
    if (this.treasury < BLOC_FORM_COST) return { ok: false, reason: `Need ${formatCurrency(BLOC_FORM_COST)}` };
    if (this.blocEligibleRivals().length === 0) {
      return { ok: false, reason: `Need a trade partner at relations ≥ ${BLOC_RELATIONS_FLOOR}` };
    }
    return { ok: true, reason: `Found a bloc (${formatCurrency(BLOC_FORM_COST)})` };
  }

  /** Found a trade bloc, enrolling every currently-eligible partner. */
  formTradeBloc(name?: string): boolean {
    if (!this.canFormTradeBloc().ok) return false;
    this.treasury -= BLOC_FORM_COST;
    const members = this.blocEligibleRivals();
    const bloc: TradeBloc = {
      id: this.nextBlocId++,
      name: name?.trim() || `${this.stateName || 'Concordat'} Trade Union`,
      memberRivalIds: members.map((rv) => rv.id),
      foundedYear: this.year,
      sharedTariff: 0.1,
    };
    this.tradeBlocs.push(bloc);
    for (const rv of members) {
      rv.relations = this.clampRel(rv.relations + 6);
      this.noteHistory(rv, `Joined the ${bloc.name}, ${this.year}.`);
    }
    this.addLog(`TRADE BLOC: the ${bloc.name} is founded with ${members.map((m) => m.name).join(', ')}.`, 'good');
    return true;
  }

  /** Invite an eligible rival into the existing bloc. */
  inviteToBloc(rivalId: number): boolean {
    const bloc = this.playerTradeBloc();
    const rv = this.rival(rivalId);
    if (!bloc || !rv) return false;
    if (bloc.memberRivalIds.includes(rivalId)) return false;
    if (rv.relations < BLOC_RELATIONS_FLOOR || !rv.treaties.includes('trade_agreement')) return false;
    bloc.memberRivalIds.push(rivalId);
    rv.relations = this.clampRel(rv.relations + 6);
    this.noteHistory(rv, `Joined the ${bloc.name}, ${this.year}.`);
    this.addLog(`TRADE BLOC: ${rv.name} accedes to the ${bloc.name}.`, 'good');
    return true;
  }

  /** Dissolve the player's bloc. */
  leaveTradeBloc(): boolean {
    const bloc = this.playerTradeBloc();
    if (!bloc) return false;
    this.tradeBlocs = this.tradeBlocs.filter((b) => b !== bloc);
    this.addLog(`TRADE BLOC: the ${bloc.name} is dissolved.`, 'info');
    return true;
  }

  /** Set the bloc's shared external tariff (0..0.5). */
  setBlocTariff(v: number): void {
    const bloc = this.playerTradeBloc();
    if (!bloc) return;
    bloc.sharedTariff = Math.max(0, Math.min(0.5, v));
  }

  /** Monthly extra export earnings the bloc yields beyond the bilateral pacts. */
  blocTradeBonus(): number {
    const bloc = this.playerTradeBloc();
    if (!bloc) return 0;
    const live = bloc.memberRivalIds.filter((id) => this.rival(id));
    const per = Math.min(8, this.gdpLastMonth * 0.012);
    return live.length * per * (1 + bloc.sharedTariff);
  }

  /** A nation's bio stays readable: cap the beats, keep the founding line. */
  noteHistory(rv: RivalNation, text: string): void {
    rv.history.push(text);
    if (rv.history.length > 16) rv.history.splice(1, 1);
  }

  /** Write a WarScar when a war ends; call before nulling playerWar. */
  private recordWarScar(w: PlayerWar, rv: RivalNation, outcome: WarScar['outcome']): void {
    const durationMonths = Math.round((this.day - w.startedDay) / 30);
    this.warScars.push({
      rivalId: rv.id,
      rivalName: rv.name,
      yearEnded: this.year,
      outcome,
      occupied: w.occupied,
      casualties: w.casualties,
      durationMonths,
    });
    // Post-war relations shift: the loser resents, the winner grows confident.
    if (outcome === 'victory') {
      // Defeated rival resents the player; grudge scales with occupation depth.
      rv.relations = this.clampRel(rv.relations - 30 - w.occupied * 5);
      this.noteHistory(rv, `Defeated by ${this.stateName || 'the State'} in ${this.year} — the wound festers.`);
    } else if (outcome === 'defeat') {
      // Victor gains leverage; the player's humiliation emboldens them.
      rv.relations = this.clampRel(rv.relations + 15);
      this.noteHistory(rv, `Defeated ${this.stateName || 'the State'} in ${this.year}.`);
    }
    // negotiated and status_quo leave relations unchanged — both sides agreed.
  }

  /** A rival's government falls — by slow drift or by losing a war. The
   *  era gates what replaces it: the interwar pool leans autocratic. */
  changeRegime(rv: RivalNation, cause: 'drift' | 'defeat'): void {
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

  /** Monthly tariff friction applied to player export earnings from rival bloc members. */
  rivalBlocTariffFriction(): number {
    let friction = 0;
    for (const bloc of this.rivalTradeBlocs) {
      const tradeMembers = bloc.memberRivalIds.filter((id) => {
        const rv = this.rival(id);
        return rv && rv.treaties.includes('trade_agreement');
      });
      friction += tradeMembers.length * bloc.tariff * 0.25;
    }
    return Math.min(0.3, friction);
  }

  // ---- Phase 6: Economic sanctions ----

  /** Active sanctions the player is either imposing or suffering. */
  activeSanctions(): Sanction[] {
    return this.sanctions.filter((s) => s.untilDay < 0 || s.untilDay > this.day);
  }

  /** Impose an economic sanction on a rival. */
  imposeSanction(rivalId: number): { ok: boolean; reason: string } {
    const rv = this.rival(rivalId);
    if (!rv) return { ok: false, reason: 'No such rival' };
    if (!this.stateProclaimed) return { ok: false, reason: 'Proclaim a State first' };
    if (this.sanctions.some((s) => s.imposerId === 0 && s.targetId === rivalId &&
        (s.untilDay < 0 || s.untilDay > this.day))) {
      return { ok: false, reason: 'Sanction already active' };
    }
    this.sanctions.push({ imposerId: 0, targetId: rivalId, startDay: this.day, untilDay: this.day + 365, tradeReduction: 0.4 });
    rv.relations = this.clampRel(rv.relations - 10);
    this.noteHistory(rv, `Subjected to our trade sanctions, ${this.year}.`);
    this.addLog(`SANCTIONS: Trade sanctions imposed on ${rv.name} — their exports barred from our markets.`, 'info');
    return { ok: true, reason: 'Sanctions active for 1 year' };
  }

  /** Lift a player-imposed sanction on a rival. */
  liftSanction(rivalId: number): boolean {
    const before = this.sanctions.length;
    this.sanctions = this.sanctions.filter((s) => !(s.imposerId === 0 && s.targetId === rivalId));
    if (this.sanctions.length === before) return false;
    const rv = this.rival(rivalId);
    if (rv) {
      rv.relations = this.clampRel(rv.relations + 5);
      this.addLog(`Sanctions on ${rv.name} are lifted — relations may warm.`, 'info');
    }
    return true;
  }

  /** Fraction 0..1 of export earnings suppressed by rival sanctions against the player. */
  sanctionPressureOnPlayer(): number {
    const active = this.sanctions.filter(
      (s) => s.targetId === 0 && (s.untilDay < 0 || s.untilDay > this.day),
    );
    return Math.min(0.5, active.reduce((sum, s) => sum + s.tradeReduction, 0));
  }

  /** A rival imposes retaliatory sanctions on the player after an espionage exposure. */
  private rivalImposeSanction(rv: RivalNation): void {
    if (this.sanctions.some((s) => s.imposerId === rv.id && s.targetId === 0 &&
        (s.untilDay < 0 || s.untilDay > this.day))) return;
    this.sanctions.push({ imposerId: rv.id, targetId: 0, startDay: this.day, untilDay: this.day + 180, tradeReduction: 0.25 });
    this.addLog(`SANCTIONS: ${rv.name} imposes retaliatory trade sanctions on us.`, 'bad');
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

  // ---- The nation at war (GDD §7) ----

  /** Casus belli on the table against a rival (GDD §7.1): fabrication is
   *  always available; honest grievances must be earned by their hostility. */
  availableCasusBelli(rv: RivalNation): CasusBelli[] {
    const list: CasusBelli[] = [];
    if (rv.relations < -40 && !rv.treaties.includes('non_aggression')) list.push('sponsored_raids');
    if (rv.relations < -20 && !rv.borderSettled) list.push('border_dispute'); // a signed survey leaves nothing to dispute
    list.push('fabricated');
    // Revanchism: available if we lost a war against this rival — warScars records it.
    if (this.warScars.some((s) => s.rivalId === rv.id && s.outcome === 'defeat')) {
      list.push('revanchism');
    }
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

  startPlayerWar(rv: RivalNation, cb: CasusBelli, defensive: boolean): void {
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
    if (type === 'warship' && !this.hasHarbor()) {
      this.addLog('Warships require a Harbor — build one in a coastal settlement first.', 'info');
      return null;
    }

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

  // ---- Phase 7: Inter-provincial unit movement ----

  /** All player armies currently stationed in a province (not in transit). */
  armiesAt(provinceId: number): ProvincialArmy[] {
    return this.provincialArmies.filter((a) => a.ownerId === 0 && a.provinceId === provinceId && !a.destinationId);
  }

  /** Order a player army from one province to march to another.
   *  Draws units from garrisoned or war-recruited pools. */
  deployArmy(fromId: number, toId: number, type: ArmyUnitType, count: number): { ok: boolean; reason: string } {
    if (!this.stateProclaimed) return { ok: false, reason: 'Proclaim a State first' };
    const from = this.settlement(fromId);
    const to = this.settlement(toId);
    if (!from || !to) return { ok: false, reason: 'Province not found' };
    if (from.factionId !== this.playerFactionId) return { ok: false, reason: 'Not your province' };
    // Source units: prioritise stationed units, then active war army
    const stationed = from.stationedUnits.find((u) => u.type === type);
    let sourced = false;
    if (stationed && stationed.count >= count) {
      stationed.count -= count;
      if (stationed.count <= 0) from.stationedUnits = from.stationedUnits.filter((u) => u.type !== type);
      sourced = true;
    } else if (this.playerWar) {
      const warUnit = this.playerWar.units.find((u) => u.type === type);
      if (warUnit && warUnit.count >= count) { warUnit.count -= count; sourced = true; }
    } else if (!sourced) {
      // Detach from garrison (militia only)
      if (type === 'militia' && from.garrisonStrength >= count * 2) {
        from.garrisonStrength -= count;
        sourced = true;
      }
    }
    if (!sourced) return { ok: false, reason: `Need ${count} ${type} unit(s) stationed here` };
    const dx = from.x - to.x;
    const dy = from.y - to.y;
    const speed = type === 'cavalry' ? 1.4 : type === 'warship' ? 0.7 : 1.0;
    const days = Math.max(7, Math.round((7 + Math.hypot(dx, dy) * 0.5) / speed));
    this.provincialArmies.push({
      id: this.nextArmyId++,
      ownerId: 0,
      provinceId: fromId,
      destinationId: toId,
      transitDays: days,
      units: [{ type, count, morale: 90, suppliedDays: 60 }],
      supply: 2,
    });
    this.addLog(`Army marching from ${from.name} to ${to.name} — ${days} days' march.`, 'info');
    return { ok: true, reason: `Marching to ${to.name} (${days} days)` };
  }

  /** Cancel a player army's movement order; the force stands fast. */
  cancelArmyMovement(armyId: number): boolean {
    const army = this.provincialArmies.find((a) => a.id === armyId && a.ownerId === 0);
    if (!army || !army.destinationId) return false;
    army.destinationId = null;
    army.transitDays = 0;
    this.addLog('Army movement cancelled — forces hold position.', 'info');
    return true;
  }

  // ---- Phase 16: Warfare System Depth (GDD §7) ----

  /** Generate available casus belli against a rival (Phase 16 CB system). */
  generateCasusBelli(rivalId: number): CBDef[] {
    const rv = this.rival(rivalId);
    if (!rv) return [];
    const result: CBDef[] = [];
    // border_dispute: always available if sharing a border province
    const playerSettlements = this.settlements.filter((s) => s.factionId === this.playerFactionId);
    const rivalSettlements = this.settlements.filter((s) => s.factionId === rivalId);
    const sharesBorder = playerSettlements.some((ps) =>
      rivalSettlements.some((rs) => Math.hypot(ps.x - rs.x, ps.y - rs.y) < 30)
    ) || rv.relations < 0; // rivals with negative relations have border tensions
    if (sharesBorder || rivalSettlements.length > 0 || rv.compass !== undefined) {
      result.push({
        type: 'border_dispute',
        targetRivalId: rivalId,
        warSupportBonus: 5,
        reputationCost: 0,
      });
    }
    // treaty_violation: if rival has broken a treaty
    if (rv.treaties.length === 0 && rv.relations < -20 && this.treatiesBroken > 0) {
      result.push({
        type: 'treaty_violation',
        targetRivalId: rivalId,
        warSupportBonus: 25,
        reputationCost: 0,
      });
    }
    // protect_ideology: if rival's regime bloc differs greatly from player's
    const playerBloc = this.playerBloc() ?? 'liberal';
    const rivalBloc = this.regimeOf(rv).bloc;
    if (blocAffinity(playerBloc, rivalBloc) < 0) {
      result.push({
        type: 'protect_ideology',
        targetRivalId: rivalId,
        warSupportBonus: 10,
        reputationCost: 0,
      });
    }
    // resource_denial: if rival controls a resource-rich province
    const rivalRich = rivalSettlements.some((s) => s.food > 50 || s.wood > 50 || s.landQuality > 0.7);
    if (rivalRich || rv.pop > 50) {
      result.push({
        type: 'resource_denial',
        targetRivalId: rivalId,
        warSupportBonus: 15,
        reputationCost: 0,
      });
    }
    // revanchism: available if we previously lost a war against this rival
    if (this.warScars.some((s) => s.rivalId === rivalId && s.outcome === 'defeat')) {
      result.push({
        type: 'revanchism',
        targetRivalId: rivalId,
        warSupportBonus: 25,
        reputationCost: 0,
      });
    }
    // fabricated: always available
    result.push({
      type: 'fabricated',
      targetRivalId: rivalId,
      warSupportBonus: -20,
      reputationCost: 25,
    });
    return result;
  }

  /** Set mobilization level (Phase 16). Returns true if successful. */
  setMobilizationLevel(level: 0 | 1 | 2): boolean {
    if (this.mobilizationLevel === level) return false;
    const decreasing = level < this.mobilizationLevel;
    const atWar = this.playerWar !== null;
    // Can only increase during war
    if (!decreasing && !atWar) {
      this.addLog('Mobilization can only be increased during active war.', 'info');
      return false;
    }
    // Decreasing costs war support
    if (decreasing && atWar) {
      this.warSupport = Math.max(0, this.warSupport - 10);
      this.addLog(`Demobilization undermines war morale — war support -10 (now ${Math.round(this.warSupport)}).`, 'bad');
    }
    const old = this.mobilizationLevel;
    this.mobilizationLevel = level;
    this.mobilizationMonths = 0;
    if (level === 1 && old === 0) {
      // Level 0→1: selective draft — militia +2 per settlement; manufacturing output ×1.15
      for (const s of this.settlements) {
        if (s.factionId === this.playerFactionId) {
          s.garrisonStrength += 2;
          s.sectors.industry.output *= 1.15;
        }
      }
      this.addLog('PARTIAL MOBILIZATION: selective draft called — militia strengthened, manufacturing +15%.', 'info');
    } else if (level === 2 && old < 2) {
      // Level 1→2: total mobilization — workforce -15%; manufacturing ×1.4; treasury cost; warSupport drain
      for (const s of this.settlements) {
        if (s.factionId === this.playerFactionId) {
          // Reduce workforce (pull workers into army)
          s.cohorts.bands[1] *= 0.85;
          s.cohorts.bands[2] *= 0.85;
          s.sectors.industry.output *= (old === 0 ? 1.4 : 1.4 / 1.15); // net to ×1.4 from base
        }
      }
      this.addLog('TOTAL MOBILIZATION: the whole economy is the war — workforce -15%, manufacturing ×1.4.', 'bad');
    } else if (level === 0) {
      this.addLog('DEMOBILIZATION: forces stand down to peacetime footing.', 'info');
    }
    return true;
  }

  /** Compute combat power for an Army Group (Phase 16 formula). */
  computeCombatPower(army: ArmyGroup): number {
    return (
      Math.pow(army.manpower, 0.6) *
      (army.equipmentLevel / 100) *
      army.supply *
      (army.doctrine / 100 + 0.5) *
      (army.morale / 100 + 0.3)
    );
  }

  /** Set occupation policy for a province occupied by the player (Phase 16). */
  setOccupationPolicyForProvince(provinceId: number, policy: 'conciliatory' | 'normal' | 'brutal'): boolean {
    const occ = this.provincialOccupations[provinceId];
    if (!occ) return false;
    occ.occupationPolicy = policy;
    if (policy === 'brutal') {
      this.addLog(`Brutal occupation policy set for ${this.settlement(provinceId)?.name ?? 'province'} — resistance grows faster but garrison costs halved.`, 'bad');
    } else if (policy === 'conciliatory') {
      this.addLog(`Conciliatory policy in ${this.settlement(provinceId)?.name ?? 'province'} — resistance grows but locals cooperate more.`, 'info');
    }
    return true;
  }

  /** Compute war score from battlefield situation (Phase 16). */
  computeWarScore(): number {
    let score = 0;
    // +5 per rival province under occupation
    const rivalProvinces = new Set(
      this.rivals.flatMap((rv) =>
        this.settlements.filter((s) => s.factionId === rv.id).map((s) => s.id)
      )
    );
    const playerArmiesAtRival = this.armyGroups.filter(
      (ag) => ag.ownerId === 0 && rivalProvinces.has(ag.provinceId)
    );
    score += playerArmiesAtRival.length * 5;
    // -5 per player province under occupation
    const playerProvinces = new Set(
      this.settlements.filter((s) => s.factionId === this.playerFactionId).map((s) => s.id)
    );
    const rivalArmiesAtPlayer = this.armyGroups.filter(
      (ag) => ag.ownerId !== 0 && playerProvinces.has(ag.provinceId)
    );
    score -= rivalArmiesAtPlayer.length * 5;
    // Also count official occupation records
    for (const [provIdStr, occ] of Object.entries(this.provincialOccupations)) {
      const provId = Number(provIdStr);
      if (this.settlements.find((s) => s.id === provId && s.factionId !== this.playerFactionId)) {
        score += 5; // player occupying rival province
      } else {
        score -= 5; // rival occupying player province
      }
      void occ; // suppress unused variable warning
    }
    // +10 if naval blockade active
    if (this.playerWar?.blockade) score += 10;
    // Also include existing war score
    if (this.playerWar) score += this.playerWar.score / 10;
    return Math.max(-100, Math.min(100, Math.round(score)));
  }

  /** Propose peace terms (Phase 16 structured peace). Returns true if accepted. */
  proposePeace(terms: PeaceTermDef[]): boolean {
    const w = this.playerWar;
    const rv = w ? this.rival(w.rivalId) : null;
    if (!w || !rv) return false;
    const totalCost = terms.reduce((s, t) => s + t.warScoreCost, 0);
    const warScore = this.computeWarScore();
    if (totalCost > warScore) {
      this.addLog(`Peace terms rejected — war score ${warScore} insufficient for cost ${totalCost}.`, 'bad');
      return false;
    }
    // Apply each term
    const annexCount = terms.filter((t) => t.type === 'annex_province').length;
    for (const term of terms) {
      if (term.type === 'annex_province' && term.provinceId !== undefined) {
        // Transfer province to player
        const prov = this.settlement(term.provinceId);
        if (prov) {
          prov.factionId = this.playerFactionId;
          const faction = this.faction(this.playerFactionId);
          if (faction && !faction.settlementIds.includes(prov.id)) {
            faction.settlementIds.push(prov.id);
          }
        }
      } else if (term.type === 'reparations') {
        const amount = term.amount ?? 200;
        this.treasury += amount;
        this.addLog(`Reparations: ${rv.name} pays £${amount} in war reparations.`, 'good');
      } else if (term.type === 'dmz') {
        rv.borderSettled = true;
        this.addLog(`DMZ established: demilitarized border zone created with ${rv.name}.`, 'info');
      } else if (term.type === 'puppet') {
        rv.relations = this.clampRel(rv.relations - 30);
        this.addLog(`${rv.name} becomes a vassal state — the puppet strings are tied.`, 'good');
      } else if (term.type === 'status_quo') {
        this.addLog('Status quo peace: the guns fall silent; the maps stay as they were.', 'info');
      }
    }
    // Grudge for excessive annexation
    if (annexCount > 2) {
      rv.weights.grudge = Math.min(10, rv.weights.grudge + 9);
      this.addLog(`Revanchism: ${rv.name} seethes — too many provinces taken; a generation will not forget.`, 'bad');
    }
    // End the war
    this.recordWarScar(w, rv, 'victory');
    this.playerWar = null;
    this.mobilizationLevel = 0;
    this.mobilizationMonths = 0;
    rv.relations = this.clampRel(rv.relations + 10);
    this.addLog(`PEACE TREATY: the war with ${rv.name} ends on agreed terms.`, 'good');
    return true;
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
    this.recordWarScar(w, rv, 'negotiated');
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
    this.recordWarScar(w, rv, 'defeat');
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

  removePop(t: Settlement, count: number): void {
    const pop = this.popOf(t);
    if (pop <= 0) return;
    const frac = Math.min(1, count / pop);
    for (let i = 0; i < t.cohorts.bands.length; i++) t.cohorts.bands[i] *= 1 - frac;
  }

  // ---- Phase 12: Media & Misinformation System (GDD §8.3) ----

  /**
   * Update `mediaReach` based on current year and researched technologies.
   * Called during the monthly tick. Transitions are one-way (no regression).
   */
  updateMediaReach(): void {
    const y = this.year;
    switch (this.mediaReach) {
      case 'word_of_mouth':
        if (y >= 1925) this.mediaReach = 'press';
        break;
      case 'press':
        if (y >= 1935 && this.has('radio_broadcasting')) this.mediaReach = 'radio';
        break;
      case 'radio':
        if (y >= 1950 && this.has('television')) this.mediaReach = 'television';
        break;
      case 'television':
        if (y >= 1995 && this.has('digital_economy')) this.mediaReach = 'internet';
        break;
      case 'internet':
        if (y >= 2015 && this.misinformationEra) this.mediaReach = 'algorithmic';
        break;
      // 'algorithmic' is the terminal stage
    }
  }

  /**
   * Opinion velocity multiplier for the current media reach stage.
   * Applied to ideology drift events and grievance accumulation from political shocks.
   */
  opinionVelocity(): number {
    switch (this.mediaReach) {
      case 'word_of_mouth': return 0.2;
      case 'press':         return 0.5;
      case 'radio':         return 0.8;
      case 'television':    return 1.0;
      case 'internet':      return 1.5;
      case 'algorithmic':   return 2.5;
    }
  }

  /**
   * The full monthly media tick — called from monthlyUpdate().
   * Updates media reach, press freedom effects, credibility gap, and misinformation era.
   */
  private tickMedia(): void {
    // 1. Check for misinformation era trigger (once only)
    if (!this.misinformationEra && this.year >= 2015 && this.has('digital_economy')) {
      this.misinformationEra = true;
      this.addLog(
        'ALGORITHMIC MISINFORMATION ERA: Social media algorithms optimise for outrage. ' +
        'Polarization accelerates. Counter-measures are available in the State panel.',
        'bad',
      );
    }

    // 2. Advance media reach
    this.updateMediaReach();

    // 3. Press freedom mechanics
    if (this.pressFreedom > 50) {
      // Free press: credibility gap decays 1/month
      const decayRate = this.publicMediaFunded ? 2 : 1;
      this.credibilityGap = Math.max(0, this.credibilityGap - decayRate);

      // Corruption scandal: 0.5% chance/month if corruption would be high.
      // (Corruption is proxied by low legitimacy + high grievance in existing model.)
      const avgGrievance = this.settlements.length > 0
        ? this.settlements.reduce((s, t) => s + t.grievance, 0) / this.settlements.length
        : 0;
      if (avgGrievance > 40 && this.rng.chance(0.005)) {
        this.legitimacy = Math.max(0, this.legitimacy - 5);
        this.addLog('PRESS SCANDAL: Investigative reporting exposes government malfeasance. Legitimacy −5.', 'bad');
      }
    } else if (this.pressFreedom < 35) {
      // Controlled press: credibility gap grows monthly
      const growth = 1.5 * this.propagandaNarrative * (1 - this.pressFreedom / 100);
      this.credibilityGap = Math.min(100, this.credibilityGap + growth);
    }

    // 4. Credibility gap spark events → legitimacy cliff drop
    if (this.credibilityGap >= 80) {
      let sparkFired = false;
      // Check spark conditions: year disaster, treasury negative, war loss, or high grievance
      const hasDisasterEvent = this.settlements.some(t =>
        t.activeEvents.some(ev => ['drought', 'flood', 'plague', 'earthquake', 'pandemic_wave', 'wildfire', 'cholera_outbreak'].includes(ev.kind))
      );
      const avgGrievance = this.settlements.length > 0
        ? this.settlements.reduce((s, t) => s + t.grievance, 0) / this.settlements.length
        : 0;
      const hasSpark =
        hasDisasterEvent ||
        this.treasury < 0 ||
        (this.playerWar !== null && this.playerWar.occupied > 0) ||
        avgGrievance > 70;
      if (hasSpark) {
        this.legitimacy = Math.max(0, this.legitimacy - 30);
        this.credibilityGap = Math.max(0, this.credibilityGap - 20); // partial reset
        sparkFired = true;
        this.addLog(
          'LEGITIMACY COLLAPSE: Years of propaganda meet a real crisis. ' +
          'The credibility gap has exploded — legitimacy plummets −30.',
          'bad',
        );
      }
      void sparkFired; // suppress unused-variable lint
    }

    // 5. Misinformation era ongoing effects
    if (this.misinformationEra) {
      // Polarization grows monthly
      let polGrowth = 0.01;
      if (this.platformRegulationEnacted) polGrowth -= 0.005;
      this.polarization = Math.min(1.0, this.polarization + polGrowth);

      // Media literacy 15-year lag: reduce polarization permanently after 15 years
      if (this.mediaLiteracyInvested && !this.mediaLiteracyApplied && this.mediaLiteracyYear >= 0) {
        if (this.year >= this.mediaLiteracyYear + 15) {
          this.polarization = Math.max(0, this.polarization - 0.15);
          this.mediaLiteracyApplied = true;
          this.addLog(
            'MEDIA LITERACY DIVIDEND: A generation raised with critical thinking skills. ' +
            'Polarization permanently reduced by 0.15.',
            'good',
          );
        }
      }

      // Public media funding: credibility gap decays 2× faster (already handled above in free press block)
      // (the publicMediaFunded check above in the pressFreedom > 50 block handles the 2× rate)

      // Populist ideology swings amplify (applied via opinionVelocity multiplier in event handlers)
    }

    // 6. Effective approval: propaganda buffers approval for controlled press
    // (this is a display-only effect in the UI — not a separate field on region)
  }

  /** Compute effective approval, buffered by propaganda when press is controlled. */
  get effectiveApproval(): number {
    const base = this.avgSatisfaction();
    if (this.pressFreedom < 35) {
      return Math.min(95, base + this.propagandaNarrative * 25);
    }
    return base;
  }

  // ---- Phase 12: Player actions ----

  /**
   * Set press freedom level (0–100). Requires State tier.
   * Used directly; civic actions grantPressLicense / censorMedia call this.
   */
  setPressFreedom(value: number): { ok: boolean; reason?: string } {
    if (!this.stateProclaimed) return { ok: false, reason: 'Requires State tier' };
    this.pressFreedom = Math.max(0, Math.min(100, value));
    return { ok: true };
  }

  /**
   * Set propaganda narrative strength (0–1). Only effective when pressFreedom < 50.
   */
  setPropagandaNarrative(value: number): void {
    this.propagandaNarrative = Math.max(0, Math.min(1, value));
  }

  /**
   * Civic action: liberalise press (+20 pressFreedom). Costs political capital.
   * Faction effects: merchants +5 power, military −5 power.
   */
  grantPressLicense(): { ok: boolean; reason?: string } {
    if (!this.stateProclaimed) return { ok: false, reason: 'Requires State tier' };
    const cost = 15;
    if (this.politicalCapital < cost) return { ok: false, reason: `Requires ${cost} political capital` };
    this.politicalCapital -= cost;
    this.pressFreedom = Math.min(100, this.pressFreedom + 20);
    // Faction effects
    const merchants = this.factions.find((f) => f.id === 'merchants');
    const landowners = this.factions.find((f) => f.id === 'landowners');
    if (merchants) merchants.power = Math.min(100, merchants.power + 5);
    if (landowners) landowners.power = Math.max(0, landowners.power - 5);
    this.addLog(`PRESS LIBERALISED: Press freedom +20 (now ${Math.round(this.pressFreedom)}). Merchants gain influence.`, 'good');
    return { ok: true };
  }

  /**
   * Civic action: censor media (−20 pressFreedom). Costs political capital.
   * Faction effects: merchants −10, military/landowners +10.
   */
  censorMedia(): { ok: boolean; reason?: string } {
    if (!this.stateProclaimed) return { ok: false, reason: 'Requires State tier' };
    const cost = 15;
    if (this.politicalCapital < cost) return { ok: false, reason: `Requires ${cost} political capital` };
    this.politicalCapital -= cost;
    this.pressFreedom = Math.max(0, this.pressFreedom - 20);
    // Faction effects
    const merchants = this.factions.find((f) => f.id === 'merchants');
    const landowners = this.factions.find((f) => f.id === 'landowners');
    if (merchants) merchants.power = Math.max(0, merchants.power - 10);
    if (landowners) landowners.power = Math.min(100, landowners.power + 10);
    this.addLog(`MEDIA CENSORED: Press freedom −20 (now ${Math.round(this.pressFreedom)}). State tightens its grip.`, 'bad');
    return { ok: true };
  }

  /**
   * Enact platform regulation — reduces polarization growth by 0.005/month.
   * Requires digital_economy tech. One-time, permanent.
   */
  enactPlatformRegulation(): { ok: boolean; reason?: string } {
    if (this.platformRegulationEnacted) return { ok: false, reason: 'Already enacted' };
    if (!this.has('digital_economy')) return { ok: false, reason: 'Requires Digital Economy tech' };
    const cost = 20;
    if (this.politicalCapital < cost) return { ok: false, reason: `Requires ${cost} political capital` };
    this.politicalCapital -= cost;
    this.platformRegulationEnacted = true;
    // Angers tech-leaning merchants
    const merchants = this.factions.find((f) => f.id === 'merchants');
    if (merchants) merchants.power = Math.max(0, merchants.power - 8);
    this.addLog(
      'PLATFORM REGULATION: Algorithmic amplification is capped. Polarization growth slows by 0.005/month.',
      'good',
    );
    return { ok: true };
  }

  /**
   * Fund public media — credibility gap decays 2× faster.
   * Requires State tier. Costs 0.8% GDP/month (handled in monthlyEconomy).
   * One-time, permanent.
   */
  fundPublicMedia(): { ok: boolean; reason?: string } {
    if (this.publicMediaFunded) return { ok: false, reason: 'Already funded' };
    if (!this.stateProclaimed) return { ok: false, reason: 'Requires State tier' };
    const cost = 25;
    if (this.politicalCapital < cost) return { ok: false, reason: `Requires ${cost} political capital` };
    this.politicalCapital -= cost;
    this.publicMediaFunded = true;
    this.addLog(
      'PUBLIC MEDIA FUNDED: An independent broadcaster serves the public interest. ' +
      'Credibility gap decays 2× faster.',
      'good',
    );
    return { ok: true };
  }

  /**
   * Invest in media literacy — after a 15-year lag, reduces polarization by 0.15 permanently.
   * Costs 5% of GDP upfront. One-time.
   */
  investMediaLiteracy(): { ok: boolean; reason?: string } {
    if (this.mediaLiteracyInvested) return { ok: false, reason: 'Already invested' };
    const gdp = this.gdpLastMonth > 0 ? this.gdpLastMonth : 1;
    const cost = gdp * 0.05;
    if (this.treasury < cost) return { ok: false, reason: `Requires ${Math.round(cost)} treasury funds` };
    this.treasury -= cost;
    this.mediaLiteracyInvested = true;
    this.mediaLiteracyYear = this.year;
    this.addLog(
      `MEDIA LITERACY INVESTMENT: Critical thinking programmes enter the curriculum. ` +
      `Polarization will fall by 0.15 in 15 years (${this.year + 15}).`,
      'good',
    );
    return { ok: true };
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
      auxRng: this.auxRng.getState(),
      minute: this.minute,
      settlements: this.settlements.map(s => ({
        ...s,
        factionStrengths: Object.fromEntries(s.factionStrengths),
        // Normalize the Phase-14 fields the runtime founding sites never set, so a
        // save byte-matches the form deserialize() restores (lossless round-trip).
        ...cityServiceFields(s),
      })),
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
      routeBudget: this.routeBudget,
      estateTaxActive: this.estateTaxActive,
      nationProclaimed: this.nationProclaimed,
      nationName: this.nationName,
      govType: this.govType,
      legitimacy: this.legitimacy,
      ministers: this.ministers,
      activePolicies: this.activePolicies,
      rivals: this.rivals,
      usedNamedRivals: [...this.usedNamedRivals],
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
      beatOilBarons: this.beatOilBarons,
      centuryReport: this.centuryReport,
      statsHistory: this.statsHistory,
      seaRiseAnnounced: this.seaRiseAnnounced,
      lastTidalLogDay: this.lastTidalLogDay,
      lastRefugeesLogDay: this.lastRefugeesLogDay,
      lastExtremeWeatherDay: this.lastExtremeWeatherDay,
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
      depressionDepth: this.depressionDepth,
      crashMonthCounter: this.crashMonthCounter,
      crashRecoveryChoice: this.crashRecoveryChoice,
      stimulusMonthsLeft: this.stimulusMonthsLeft,
      depressionMeasuresUsed: this.depressionMeasuresUsed,
      depressionCeilingBonus: this.depressionCeilingBonus,
      worldWarFired: this.worldWarFired,
      oilShockFired: this.oilShockFired,
      pandemicFired: this.pandemicFired,
      nextId: this.nextId,
      nextEventDay: this.nextEventDay,
      townNamePool: this.townNamePool,
      // Phase 0: factions, scouts, currency — the map packs to one char per tile
      explorationMap: this.explorationMap.map((row) => row.map((v) => (v === 'fogged' ? '0' : '1')).join('')),
      scouts: this.scouts,
      playerRegionalWars: [...this.playerRegionalWars],
      contactedFactionIds: [...this.contactedFactionIds],
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
      epilogueShown: this.epilogueShown,
      loggedTreasuryMilestones: [...this.loggedTreasuryMilestones],
      tradeBlocs: this.tradeBlocs,
      nextBlocId: this.nextBlocId,
      // Phase 5-7 state
      provincePolicies: this.provincePolicies,
      rivalTradeBlocs: this.rivalTradeBlocs,
      nextRivalBlocId: this.nextRivalBlocId,
      sanctions: this.sanctions,
      provincialArmies: this.provincialArmies,
      nextArmyId: this.nextArmyId,
      // Phase 11: Renewables, Automation & Carbon Pricing
      strandedAssetLoss: this.strandedAssetLoss,
      speculativeBranch: this.speculativeBranch,
      ubsActive: this.ubsActive,
      // Phase 12: Media & Misinformation System
      mediaReach: this.mediaReach,
      pressFreedom: this.pressFreedom,
      propagandaNarrative: this.propagandaNarrative,
      credibilityGap: this.credibilityGap,
      polarization: this.polarization,
      misinformationEra: this.misinformationEra,
      platformRegulationEnacted: this.platformRegulationEnacted,
      publicMediaFunded: this.publicMediaFunded,
      mediaLiteracyInvested: this.mediaLiteracyInvested,
      mediaLiteracyYear: this.mediaLiteracyYear,
      mediaLiteracyApplied: this.mediaLiteracyApplied,
      // Phase 13: Population & Society Depth
      demographicPhase: this.demographicPhase,
      agingCrisisActive: this.agingCrisisActive,
      refugeeWaveActive: this.refugeeWaveActive,
      refugeeWaveOrigin: this.refugeeWaveOrigin,
      educationLag: this.educationLag,
      unrestLevel: this.unrestLevel,
      unrestMonthsAtLevel: this.unrestMonthsAtLevel,
      generationalDrift: this.generationalDrift,
      youthquake1968Fired: this.youthquake1968Fired,
      youthquake2030Fired: this.youthquake2030Fired,
      automationUnemployment: this.automationUnemployment,
      dynastyTree: this.buildDynastyTree(),
      advisorBriefs: this.advisorBriefs,
      advisorBriefLastDay: this.advisorBriefLastDay,
      lastActionDay: this.lastActionDay,
      researchBottleneckActive: this.researchBottleneckActive,
      // Phase 16: Warfare System Depth
      armyGroups: this.armyGroups,
      nextArmyGroupId: this.nextArmyGroupId,
      mobilizationLevel: this.mobilizationLevel,
      mobilizationMonths: this.mobilizationMonths,
      warSupport: this.warSupport,
      warScars: this.warScars,
      provincialOccupations: this.provincialOccupations,
      lastBattleWon: this.lastBattleWon,
      // Phase 17: Historical Scenarios & Alternate Starts
      activeScenario: this.activeScenario ?? null,
      scenarioGoalsCompleted: this.scenarioGoalsCompleted ?? [],
      govLockExpiry: this.govLockExpiry ?? null,
      difficultySettings: this.difficultySettings ?? { ...DEFAULT_DIFFICULTY_SETTINGS },
      // Phase 15: Extended Economy & FX
      // Note: intermediate-goods stocks are now per-settlement and ride the
      // `settlements` spread above — no top-level field. Old saves that carry a
      // top-level `intermediateGoodStocks` are migrated to the capital in
      // `restoreGoodStocks` during deserialize.
      sectorOutputNorm: this.sectorOutputNorm,
      rawEmbargoes: this.rawEmbargoes,
      supplyChainHealth: this.supplyChainHealth,
      // The two one-month-lagged supply-shock caches: set in tickIntermediateGoods
      // and read the NEXT month (supplyShockMult by updateSectors, the disrupted
      // flag by the research multiplier) before being recomputed. Persisting them
      // keeps a save reloaded mid-shock byte-identical on the next tick; old saves
      // backfill to the no-shock defaults (1 / false), the same values healthy play
      // always holds, so the format gain is inert outside an active shock.
      supplyShockMult: this.supplyShockMult,
      // PR-3 slice 3: the local-goods scarcity index — a third one-month-lagged
      // cache set in tickIntermediateGoods and read next month by the cost-push +
      // industry drag. Backfills to 0 (healthy/single-town value) for old saves.
      localGoodsScarcity: this.localGoodsScarcity,
      wonderOwner: this.wonderOwner,
      prestige: this.prestige,
      electronicsDisrupted: this._electronicsDisrupted,
      tradeFlows: this.tradeFlows,
      currencyRegime: this.currencyRegime,
      currencyUnionPartnerId: this.currencyUnionPartnerId,
      fxBoost: this.fxBoost,
      // Phase 9: Government Type System
      planningOptimism: this.planningOptimism,
      reportedGDP: this.reportedGDP,
      schismRisk: this.schismRisk,
      shareholderPatience: this.shareholderPatience,
      transitionChain: this.transitionChain,
      policySlots9: this.policySlots,
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
    r.settlements = (d.settlements as Settlement[]).map(({ goodStocks, lastEmergencyGrainDay, ...s }) => ({
      ...s,
      prices: s.prices ?? defaultPrices(),
      recentEvents: s.recentEvents ?? [],
      factionId: s.factionId ?? 0,
      garrisonStrength: s.garrisonStrength ?? 2,
      stationedUnits: s.stationedUnits ?? [],
      loyaltyToFaction: s.loyaltyToFaction ?? 100,
      factionStrengths: new Map(Object.entries(s.factionStrengths ?? {}) as [NewFactionId, number][]),
      sectors: s.sectors ?? defaultSectors(),
      buildings: s.buildings ?? [],
      placedBuildings: s.placedBuildings ?? [],
      placedDistricts: s.placedDistricts ?? [],
      construction: s.construction ?? null,
      focus: s.focus ?? 'balanced',
      activeEvents: s.activeEvents ?? [],
      policies: s.policies ?? { ...DEFAULT_CITY_POLICIES },
      // Phase 14: Zoning, Infrastructure & City Services — defaulted via the same
      // helper serialize() uses, so old saves migrate AND the round-trip stays
      // lossless (serialize emits these same normalized fields).
      ...cityServiceFields(s),
      // goodStocks and lastEmergencyGrainDay are created lazily during play, so
      // their key position in `...s` differs between a continued run and a reload.
      // Pin them LAST (consistently) so the canonical save round-trip is byte-stable
      // — the determinism harness compares serialized bytes, not just values.
      ...(goodStocks !== undefined ? { goodStocks } : {}),
      ...(lastEmergencyGrainDay !== undefined ? { lastEmergencyGrainDay } : {}),
    }));
    // Spatial-4X migration: site any building that has no placement yet (pre-Phase-B
    // saves, or AI grants) into the worked ring — deterministic, render-only.
    for (const t of r.settlements) r.ensurePlacements(t);
    // Spread `...n` FIRST, then backfill missing fields — preserving the original
    // key order so a save round-trips byte-for-byte. (Defaults-before-spread would
    // hoist skill/health/children/loyalty to the front, reordering a present
    // notable's keys and breaking the lossless round-trip the harness checks.)
    r.notables = (d.notables ?? []).map((n: any) => ({
      ...n,
      skill: n.skill ?? 50,
      health: n.health ?? 80,
      children: n.children ?? [],
      loyalty: n.loyalty ?? 80,
    }));
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
    r.routeBudget = d.routeBudget ?? 1.0;
    r.estateTaxActive = d.estateTaxActive ?? false;
    r.nationProclaimed = d.nationProclaimed ?? false;
    r.nationName = d.nationName ?? '';
    r.govType = d.govType ?? null;
    r.legitimacy = d.legitimacy ?? 0;
    // Backfill any minister roles added after the save was written (old saves only had 3 roles)
    const savedMinisters: MinisterAssignment[] = d.ministers ?? [];
    r.ministers = MINISTER_ROLES.map((mr) => savedMinisters.find((m) => m.role === mr.id) ?? { role: mr.id, title: mr.title, notableId: null });
    if (d.activePolicies) {
      r.activePolicies = d.activePolicies;
    } else if (d.govType) {
      const govDef = GOV_TYPES.find((g) => g.id === d.govType);
      r.activePolicies = new Array(govDef?.policySlots.length ?? 0).fill(null);
    }
    r.rebuildPolicySet();
    // pre-diplomacy saves carry no rivals: the world is still empty
    r.rivals = (d.rivals ?? []).map((rv: RivalNation) => ({ ...rv, borderSettled: rv.borderSettled ?? false }));
    r.usedNamedRivals = new Set(d.usedNamedRivals ?? []);
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
    r.beatOilBarons = d.beatOilBarons ?? false;
    r.centuryReport = d.centuryReport ?? null;
    r.statsHistory = d.statsHistory ?? [];
    r.seaRiseAnnounced = d.seaRiseAnnounced ?? false;
    r.lastTidalLogDay = d.lastTidalLogDay ?? -999;
    r.lastRefugeesLogDay = d.lastRefugeesLogDay ?? -999;
    r.lastExtremeWeatherDay = d.lastExtremeWeatherDay ?? -999;
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
    r.depressionDepth = d.depressionDepth ?? 0;
    r.crashMonthCounter = d.crashMonthCounter ?? 0;
    r.crashRecoveryChoice = d.crashRecoveryChoice ?? null;
    r.stimulusMonthsLeft = d.stimulusMonthsLeft ?? 0;
    r.depressionMeasuresUsed = d.depressionMeasuresUsed ?? [];
    r.depressionCeilingBonus = d.depressionCeilingBonus ?? 0;
    r.worldWarFired = d.worldWarFired ?? false;
    r.oilShockFired = d.oilShockFired ?? false;
    r.pandemicFired = d.pandemicFired ?? false;
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
    // Phase 11: Renewables, Automation & Carbon Pricing
    r.strandedAssetLoss = d.strandedAssetLoss ?? 0;
    r.speculativeBranch = d.speculativeBranch ?? null;
    r.ubsActive = d.ubsActive ?? false;
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
        // Re-attach the goal's successCondition (JSON dropped the function). Without
        // this the yearly goal-check scores differently after a reload — a real
        // determinism divergence once rivals actively pursue goals.
        if (f.currentGoal && typeof f.currentGoal.successCondition !== 'function') {
          f.currentGoal.successCondition = GOAL_CONDITION_BY_ID[f.currentGoal.id] ?? (() => false);
        }
      }
      r.playerFactionId = d.playerFactionId ?? 0;
      r.aiDifficulty = d.aiDifficulty ?? 'normal';
      r.factionAlliances = d.factionAlliances ?? [];
      r.scouts = d.scouts ?? [];
      r.playerRegionalWars = new Set(d.playerRegionalWars ?? []);
      r.contactedFactionIds = new Set(d.contactedFactionIds ?? []);
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
    // Recompute exploredCount from restored map (revealTiles above already increments for the else branch)
    if (d.explorationMap) {
      r.exploredCount = r.explorationMap.reduce((sum, col) => sum + col.filter((v) => v !== 'fogged').length, 0);
    }
    // Phase 18: Advisor System Depth — backfill with empty defaults for pre-Phase-18 saves
    r.advisorBriefs = d.advisorBriefs ?? [];
    r.advisorBriefLastDay = d.advisorBriefLastDay ?? {};
    r.lastActionDay = d.lastActionDay ?? {};
    r.researchBottleneckActive = d.researchBottleneckActive ?? false;
    // last: the constructor consumed a draw scheduling its event day
    r.rng.setState(d.rng);
    // restore the AI stream too (older saves predate it — derive from main seed)
    if (typeof d.aiRng === 'number') r.aiRng.setState(d.aiRng);
    // restore the incidental stream too (older saves predate it — keep the
    // constructor-derived seed, which is deterministic from the main seed)
    if (typeof d.auxRng === 'number') r.auxRng.setState(d.auxRng);
    // restore epilogue events (post-2100 flavor)
    r.triggeredEpilogueEvents = new Set(d.triggeredEpilogueEvents ?? []);
    r.epilogueShown = d.epilogueShown ?? false;
    r.loggedTreasuryMilestones = new Set(d.loggedTreasuryMilestones ?? []);
    // restore trade blocs (GDD §6.5)
    r.tradeBlocs = (d.tradeBlocs ?? []).map((b: TradeBloc) => ({ ...b, sharedTariff: b.sharedTariff ?? 0.1 }));
    r.nextBlocId = d.nextBlocId ?? (r.tradeBlocs.reduce((m, b) => Math.max(m, b.id), 0) + 1);
    // Phase 5-7 state (pre-Phase5 saves default to empty)
    r.provincePolicies = d.provincePolicies ?? {};
    r.rivalTradeBlocs = (d.rivalTradeBlocs ?? []).map((b: RivalTradeBloc) => ({ ...b }));
    r.nextRivalBlocId = d.nextRivalBlocId ?? (r.rivalTradeBlocs.reduce((m: number, b: RivalTradeBloc) => Math.max(m, b.id), 0) + 1);
    r.sanctions = d.sanctions ?? [];
    r.provincialArmies = d.provincialArmies ?? [];
    r.nextArmyId = d.nextArmyId ?? 1;
    // Phase 12: Media & Misinformation System (old-save backfill)
    r.mediaReach = d.mediaReach ?? 'word_of_mouth';
    r.pressFreedom = d.pressFreedom ?? 60;
    r.propagandaNarrative = d.propagandaNarrative ?? 0;
    r.credibilityGap = d.credibilityGap ?? 0;
    r.polarization = d.polarization ?? 0;
    r.misinformationEra = d.misinformationEra ?? false;
    r.platformRegulationEnacted = d.platformRegulationEnacted ?? false;
    r.publicMediaFunded = d.publicMediaFunded ?? false;
    r.mediaLiteracyInvested = d.mediaLiteracyInvested ?? false;
    r.mediaLiteracyYear = d.mediaLiteracyYear ?? -1;
    r.mediaLiteracyApplied = d.mediaLiteracyApplied ?? false;
    // Phase 13: Population & Society Depth (backfill defaults for older saves)
    r.demographicPhase = d.demographicPhase ?? 'pre_transition';
    r.agingCrisisActive = d.agingCrisisActive ?? false;
    r.refugeeWaveActive = d.refugeeWaveActive ?? false;
    r.refugeeWaveOrigin = d.refugeeWaveOrigin ?? '';
    r.educationLag = d.educationLag ?? new Array(25).fill(0);
    r.unrestLevel = d.unrestLevel ?? 0;
    r.unrestMonthsAtLevel = d.unrestMonthsAtLevel ?? 0;
    r.generationalDrift = d.generationalDrift ?? 0;
    r.youthquake1968Fired = d.youthquake1968Fired ?? false;
    r.youthquake2030Fired = d.youthquake2030Fired ?? false;
    r.automationUnemployment = d.automationUnemployment ?? 0;
    // Phase 16: Warfare System Depth — backfill with safe defaults for old saves
    r.armyGroups = (d.armyGroups ?? []).map((ag: ArmyGroup) => ({
      ...ag,
      manpower: ag.manpower ?? 100,
      equipmentLevel: ag.equipmentLevel ?? 50,
      supply: ag.supply ?? 1.0,
      doctrine: ag.doctrine ?? 50,
      morale: ag.morale ?? 80,
    }));
    r.nextArmyGroupId = d.nextArmyGroupId ?? 1;
    r.mobilizationLevel = d.mobilizationLevel ?? 0;
    r.mobilizationMonths = d.mobilizationMonths ?? 0;
    r.warSupport = d.warSupport ?? 60;
    r.warScars = d.warScars ?? [];
    r.lastBattleWon = d.lastBattleWon ?? false;
    if (d.provincialOccupations) {
      r.provincialOccupations = Object.fromEntries(
        Object.entries(d.provincialOccupations as Record<string, { occupiedBy: number; resistanceLevel: number; occupationPolicy: 'conciliatory' | 'normal' | 'brutal'; brutalPolicyPenalty: number }>).map(([k, v]) => [
          k,
          {
            ...v,
            resistanceLevel: v.resistanceLevel ?? 0,
            occupationPolicy: v.occupationPolicy ?? 'normal',
            brutalPolicyPenalty: v.brutalPolicyPenalty ?? 0,
          },
        ])
      );
    } else {
      r.provincialOccupations = {};
    }
    // Phase 17: Historical Scenarios & Alternate Starts — backfill for old saves
    r.activeScenario = d.activeScenario ?? null;
    r.scenarioGoalsCompleted = d.scenarioGoalsCompleted ?? [];
    r.govLockExpiry = d.govLockExpiry ?? null;
    r.difficultySettings = {
      ...DEFAULT_DIFFICULTY_SETTINGS,
      ...(d.difficultySettings ?? {}),
    };
    // Phase 15: Extended Economy & FX (pre-Phase15 saves default to safe values)
    r.restoreGoodStocks(d.intermediateGoodStocks);
    // Trailing output norms for the graded raw proxy. Pre-graded saves lack them;
    // backfill to 0 (unwarmed) so the norm re-seeds from live output, parity-clean.
    r.sectorOutputNorm = {
      industry: d.sectorOutputNorm?.industry ?? 0,
      agriculture: d.sectorOutputNorm?.agriculture ?? 0,
    };
    // Embargoes gained a `cut` fraction when raw availability went graded. A
    // pre-graded save stored a bare `until` day (always a total cut) — migrate
    // each numeric entry to `{ until, cut: 1 }`; pass graded entries through.
    r.rawEmbargoes = {};
    const savedEmbargoes = d.rawEmbargoes ?? {};
    for (const raw of Object.keys(savedEmbargoes)) {
      const v = savedEmbargoes[raw];
      r.rawEmbargoes[raw] = typeof v === 'number'
        ? { until: v, cut: 1 }
        : { until: v.until, cut: v.cut ?? 1 };
    }
    r.supplyChainHealth = d.supplyChainHealth ?? 1.0;
    r.supplyShockMult = d.supplyShockMult ?? 1;            // no-shock default
    r.localGoodsScarcity = d.localGoodsScarcity ?? 0;      // no-shortage default
    r.wonderOwner = d.wonderOwner ?? {};                   // Phase D: no Wonders default
    r.prestige = d.prestige ?? 0;
    r._electronicsDisrupted = d.electronicsDisrupted ?? false;
    // Pre-transit-pipeline flows carried no pendingIncome — backfill to 0 (they
    // simply transit out without a payout); pre-cargo flows carried no physical
    // units — backfill cargo to 0 (their goodId/volume were decorative); new flows
    // round-trip both unchanged.
    r.tradeFlows = (d.tradeFlows ?? []).map((f: { pendingIncome?: number; cargo?: number }) => ({ ...f, pendingIncome: f.pendingIncome ?? 0, cargo: f.cargo ?? 0 }));
    r.currencyRegime = d.currencyRegime ?? 'fiat';
    r.currencyUnionPartnerId = d.currencyUnionPartnerId ?? undefined;
    r.fxBoost = d.fxBoost ?? 1.0;
    // Phase 9 backfill
    r.planningOptimism = d.planningOptimism ?? 0;
    r.reportedGDP = d.reportedGDP ?? 0;
    r.schismRisk = d.schismRisk ?? 0;
    r.shareholderPatience = d.shareholderPatience ?? 80;
    r.transitionChain = d.transitionChain ?? null;
    r.policySlots = d.policySlots9 ?? [];
    // Recompute cached perf fields after full restore.
    r.activeRailRoutes = r.routes.filter((rt) => rt.kind === 'rail' && rt.condition > 50).length;
    let tf = 0, tw = 0, mg = 0;
    for (const s of r.settlements) { tf += s.food; tw += s.wood; if (s.grievance > mg) mg = s.grievance; }
    r.totalFood = tf; r.totalWood = tw; r.maxGrievance = mg;
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
      id: this.auxRng.next(), // seeded, not Math.random — loan ids are serialized
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
    if (!this.hasCentralBank()) {
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

  /** Farm-economy output multiplier from realized warming (GDD §8.2). The
   *  agriculture sector's £/month output erodes linearly past
   *  `AGRI_CLIMATE_THRESHOLD`°C, capped at `AGRI_CLIMATE_MAX_DRAG`; exactly 1.0
   *  below the threshold. Distinct from the subsistence-food drag in dailyUpdate
   *  (a different variable — the granary, not the cash-crop economy). Pure read,
   *  no RNG, and a sink (warming is emissions-driven), so it can't diverge. */
  agriClimateMult(): number {
    return 1 - Math.min(AGRI_CLIMATE_MAX_DRAG, Math.max(0, this.warmingC - AGRI_CLIMATE_THRESHOLD) * AGRI_CLIMATE_SLOPE);
  }

  /** Industrial brownout drag: at ≥3°C sustained warming, grid reliability degrades
   *  and heat stress cuts manufacturing productivity. Linear above the threshold,
   *  capped at 30%. Exactly 1.0 below INDUSTRY_BROWNOUT_THRESHOLD. */
  industryClimateMult(): number {
    return 1 - Math.min(INDUSTRY_BROWNOUT_MAX_DRAG, Math.max(0, this.warmingC - INDUSTRY_BROWNOUT_THRESHOLD) * INDUSTRY_BROWNOUT_SLOPE);
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
        const sc = faction.currentGoal.successCondition;
        const succeeded = typeof sc === 'function' ? sc(faction, this) : false;
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
    // techSpeed reads the (now real, much larger) treasury, so it is CAPPED at
    // RIVAL_TECH_CAP — `techProgress` feeds `militaryStrength` (×(1+tech·0.05)),
    // and an uncapped float would balloon into an unbeatable army once rivals run
    // a real economy. The cap (~a fully-teched nation) keeps rivals strong but
    // their strength pop-bounded, and still clears every goal threshold (≥8).
    const techSpeed = (faction.treasury * 0.0001 + factionPop * 0.00001) * knobs.techMult;
    faction.techProgress = Math.min(
      RIVAL_TECH_CAP,
      faction.techProgress + techSpeed * (faction.currentGoal?.sectorFocus === 'technology' ? 1.5 : 1),
    );

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

    // Treasury income: a rival now collects tax from the REAL sector output of
    // its own towns — parity with the player's monthlyEconomy — instead of the
    // near-zero tech-only trickle it earned before (factionPop·0.002·techProgress,
    // which started at ~0 and never escaped the vicious cycle). This is the
    // keystone that lets rivals accumulate wealth → expand, advance their tech
    // (techProgress feeds off treasury above), field armies, and contest Wonders.
    // Scaled to the staggered update period so income is cadence-independent.
    let rivalOutput = 0;
    for (const id of faction.settlementIds) {
      const t = this.settlement(id);
      if (t) rivalOutput += this.sectorOutputOf(t);
    }
    const periodMonths = faction.updateFrequency / 30;
    faction.treasury += Math.round(rivalOutput * RIVAL_TAX_RATE * periodMonths);

    // Spatial-4X — develop a town: raise a building on its best hex, or zone a
    // district on an established cluster. This is what makes the AI actually PLAY
    // SPATIALLY. It runs BEFORE the state-cost skim so it spends the fresh tax
    // surplus (the skim would otherwise hold the treasury down at the reserve,
    // leaving nothing to build with); it is itself reserve-gated, so neither sink
    // ever touches the famine buffer. aiRng-gated → the main RNG stream is
    // untouched (intentional headless re-baseline).
    this.maybeDevelopFactionTown(faction, knobs, rivalOutput);

    // Phase D slice 1b — Wonder build-race. A rich, era-ready rival may break
    // ground on an unclaimed Wonder, reusing the player's construction pipeline
    // (and its completion claim in updateConstruction) so a finished rival Wonder
    // grants that empire the same realm-wide bonus. aiRng-gated → the main RNG
    // stream is untouched (this is an intentional headless re-baseline).
    this.maybeBuildRivalWonder(faction, knobs);

    // Wagner-style state-cost sink. Rivals lack the player's policy/services/
    // welfare/central-bank machinery, so without a recurring drain they bank
    // nearly the whole tax take and balloon. The sink spends down only the
    // surplus above a prudent, output-scaled reserve (and stands down below it),
    // so it caps the hoard without ever starving the famine buffer. Cadence-
    // scaled like the tax; the treasury can never go negative. Runs last so it
    // skims whatever development and the Wonder race leave above the reserve.
    faction.treasury = Math.max(0, faction.treasury - this.rivalStateCost(faction, rivalOutput, periodMonths));

    // Check for goal conflicts with other factions (Phase 3a)
    this.checkFactionGoalConflicts(faction);
  }

  /** Wagner-style recurring state cost a rival pays each AI update (admin +
   *  services + defence). The state spends down only the SURPLUS above a prudent
   *  reserve that scales with the economy (`RIVAL_RESERVE_MONTHS` of output), so
   *  it caps the hoard without ever draining the buffer the rival needs to fund
   *  emergency grain during a famine — when the treasury is below that reserve
   *  the skim stands down and only the flat per-settlement admin is charged.
   *  Scaled to the update period like the tax; always ≥0 and never below 0. */
  private rivalStateCost(faction: RegionalFaction, rivalOutput: number, periodMonths: number): number {
    const reserve = rivalOutput * RIVAL_RESERVE_MONTHS;
    const surplus = Math.max(0, faction.treasury - reserve);
    const admin = faction.settlementIds.length * RIVAL_ADMIN_PER_TOWN;
    const monthly = surplus * RIVAL_SURPLUS_SKIM + admin;
    return Math.max(0, Math.min(faction.treasury, Math.round(monthly * periodMonths)));
  }

  /** Phase D slice 1b — a rival faction's bid for a Wonder. Gated on the era,
   *  a still-unclaimed Wonder, an idle host town, and a treasury that can pay up
   *  front (mirroring the player's pay-on-break-ground). aiRng draws only. */
  private maybeBuildRivalWonder(faction: RegionalFaction, knobs: typeof AI_DIFFICULTY[AiDifficulty]): void {
    if (faction.settlementIds.length === 0) return;
    if (!this.aiRng.chance(RIVAL_WONDER_CHANCE * knobs.techMult)) return;
    // Raise it in the capital, else the most populous town; skip if it's busy.
    const host = this.rivalWonderHost(faction);
    if (!host || host.construction) return;
    // Affordable (full price — rivals now fund their own economy), era-ready,
    // still-unclaimed Wonders.
    let pick: RegionalBuildingDef | null = null;
    for (const b of REGION_BUILDINGS) {
      if (!b.unique || faction.treasury < b.cost) continue;
      if (this.year < this.wonderEraYear(b) || this.wonderClaimed(b.id)) continue;
      // Chase the prize: the highest-prestige Wonder within reach.
      if (!pick || (b.prestige ?? 0) > (pick.prestige ?? 0)) pick = b;
    }
    if (!pick) return;
    faction.treasury -= pick.cost;
    host.construction = { id: pick.id, doneDay: this.day + pick.days };
    this.addLog(`${faction.name} breaks ground on the ${pick.name} at ${host.name}.`, 'info');
  }

  /** The town a rival raises a Wonder in: its capital if held, else its most
   *  populous settlement. */
  private rivalWonderHost(faction: RegionalFaction): Settlement | null {
    const cap = faction.capital >= 0 ? this.settlement(faction.capital) : null;
    if (cap) return cap;
    let best: Settlement | null = null, bestPop = -1;
    for (const id of faction.settlementIds) {
      const s = this.settlement(id);
      if (!s) continue;
      const p = this.popOf(s);
      if (p > bestPop) { bestPop = p; best = s; }
    }
    return best;
  }

  /** The purse a faction develops FROM: the national `treasury` for the player
   *  faction (what a human spends when building via the UI), the faction's own
   *  `treasury` for a rival. This is the single seam that lets `maybeDevelopFactionTown`
   *  serve both — for a rival it reads/writes exactly `faction.treasury` in the same
   *  order as before, so the rival path stays byte-identical. */
  private factionDevPurse(faction: RegionalFaction): number {
    return faction.id === this.playerFactionId ? this.treasury : faction.treasury;
  }
  private spendFactionDev(faction: RegionalFaction, cost: number): void {
    if (faction.id === this.playerFactionId) this.treasury -= cost;
    else faction.treasury -= cost;
  }
  /** Credit `amount` to the faction identified by `factionId` — the national treasury
   *  for the player, the faction's own treasury for a rival (the public complement of
   *  the private factionDevPurse / spendFactionDev seam, used by the arbitrage subsystem
   *  to route trade-flow profits to the correct purse). */
  public addFactionTreasury(factionId: number, amount: number): void {
    if (factionId === this.playerFactionId) this.treasury += amount;
    else {
      const fac = this.faction(factionId);
      if (fac) fac.treasury += amount;
    }
  }

  /** Spatial-4X — a faction develops one of its towns this update: it raises a
   *  building on its best-fitting hex, or (once a same-sector cluster exists) zones
   *  a district to multiply it. This is the change that makes the AI actually PLAY
   *  SPATIALLY — before it, factions held land but never built on it, so the
   *  terrain-match / district-adjacency / district-zone bonuses were all dormant in
   *  autoplay. Used for rivals every update, and (when `autoDevelopPlayer` is set)
   *  for the player faction too so the headless balance signal exercises the player's
   *  own spatial path. aiRng-gated (main stream untouched) and funded ONLY from the
   *  surplus above the famine reserve (drawn from the faction's purse — the national
   *  treasury for the player, the faction treasury for a rival), so it can never drain
   *  the buffer that feeds the people (the same discipline as `rivalStateCost`).
   *  Intentional headless re-baseline. */
  private maybeDevelopFactionTown(faction: RegionalFaction, knobs: typeof AI_DIFFICULTY[AiDifficulty], output: number): void {
    if (faction.settlementIds.length === 0) return;
    if (!this.aiRng.chance(RIVAL_BUILD_CHANCE * knobs.techMult)) return;
    // Only ever spend what sits ABOVE a famine floor — emergency grain is paid from
    // this same purse, so development must never dip below it (the death-spiral
    // lesson behind rivalStateCost). The floor is far below the state-cost reserve
    // (which holds the hoard near 1.5mo, leaving no surplus a 1.5mo gate could see)
    // yet still ~50× the actual grain draw, so it builds freely without risk.
    const reserve = output * RIVAL_DEV_RESERVE_MONTHS;
    // Develop the LEAST-built idle town the faction holds (spreads growth across
    // the realm), tie-broken by id — fully deterministic, no RNG.
    let town: Settlement | null = null, fewest = Infinity;
    for (const id of faction.settlementIds) {
      const s = this.settlement(id);
      if (!s || s.construction) continue; // one project at a time per town
      const n = s.placedBuildings.length + s.placedDistricts.length;
      if (n < fewest) { fewest = n; town = s; }
    }
    if (!town) return;
    // Prefer zoning a district once a cluster exists to reward (a force-multiplier
    // on an established quarter); otherwise raise the best-fitting building.
    if (this.tryZoneRivalDistrict(faction, town, reserve)) return;
    this.tryBuildRivalBuilding(faction, town, reserve);
  }

  /** Personality-driven sector lean for a rival faction's spatial buildout. Derived
   *  PURELY from existing serialized faction fields (regime bloc + tech focus +
   *  belligerence) — no RNG, no new serialized state — so the determinism and
   *  save-size gates stay green. It is a modest thumb on the scale (each term ≤ a
   *  strong terrain yield), added to the terrain-fit score in `tryBuildRivalBuilding`:
   *  a rival still builds to its land, but a liberal Merchant Republic leans commerce
   *  (services + knowledge), a traditional Absolute Monarchy leans the land (agri),
   *  an autocratic Military Junta leans industry, and a revolutionary People's Republic
   *  mobilizes both industry and knowledge. This is what makes rival town economies
   *  DIVERGE by who the rival is instead of every faction building the same
   *  terrain-optimal town — an intentional headless re-baseline. */
  private factionBuildLean(faction: RegionalFaction): Record<SectorId, number> {
    const lean: Record<SectorId, number> = { agriculture: 0, industry: 0, services: 0, information: 0 };
    const bloc = RIVAL_REGIMES.find((g) => g.id === faction.regime)?.bloc ?? 'traditional';
    switch (bloc) {
      case 'liberal':       lean.services += BUILD_LEAN_BLOC; lean.information += BUILD_LEAN_BLOC * 0.6; break;
      case 'traditional':   lean.agriculture += BUILD_LEAN_BLOC; break;
      case 'autocratic':    lean.industry += BUILD_LEAN_BLOC; break;
      case 'revolutionary': lean.industry += BUILD_LEAN_BLOC * 0.75; lean.information += BUILD_LEAN_BLOC * 0.5; break;
    }
    switch (faction.techFocus) {
      case 'mining':   lean.industry += BUILD_LEAN_FOCUS; break;
      case 'forestry': lean.industry += BUILD_LEAN_FOCUS * 0.6; break;
      case 'farming':  lean.agriculture += BUILD_LEAN_FOCUS; break;
    }
    // A belligerent power runs a war economy — extra weight on industry.
    if (faction.aggressiveness >= BUILD_LEAN_AGGR_THRESHOLD) lean.industry += BUILD_LEAN_AGGR;
    return lean;
  }

  /** Pick the era-ready, under-max, affordable building that best fits a rival
   *  town's land (its flat bonus plus the town's terrain yield in that sector) AND
   *  its personality (the `factionBuildLean` thumb on the scale), then break ground
   *  on the hex that MAXIMIZES the realized spatial bonus (terrain match + same-sector
   *  clustering). Pays the player's real `cityBuildCost`, drawn from the surplus above
   *  `reserve`. Returns true if a project was started. */
  private tryBuildRivalBuilding(faction: RegionalFaction, t: Settlement, reserve: number): boolean {
    const yields = this.tileYieldFor(t);
    const lean = this.factionBuildLean(faction);
    let pick: RegionalBuildingDef | null = null, pickScore = -Infinity;
    for (const b of REGION_BUILDINGS) {
      if (b.unique) continue; // Wonders go through the build-race path
      if (this.buildingCount(t, b.id) >= b.max) continue;
      if (b.coastal_only && !t.site.coastal) continue;
      if (b.prereq && this.year < this.prereqEraYear(b.prereq)) continue;
      if (this.factionDevPurse(faction) - this.cityBuildCost(b) < reserve) continue; // surplus-only
      const sectorYield = b.sector === 'all' ? 0 : (yields[b.sector] ?? 0);
      const sectorLean = b.sector === 'all' ? 0 : (lean[b.sector] ?? 0);
      // Fit the building to the town's terrain (yield), then let the faction's
      // personality (lean) tip close calls — so WHO the rival is shapes its towns.
      const score = b.bonus + sectorYield + sectorLean;
      if (score > pickScore) { pickScore = score; pick = b; }
    }
    if (!pick) return false;
    const def = pick;
    const cell = this.bestPlacementCell(t, (c) => this.placementPreview(t.id, c, def.id)?.total ?? -Infinity);
    if (cell < 0) return false;
    this.spendFactionDev(faction, this.cityBuildCost(def));
    t.construction = { id: def.id, doneDay: this.day + def.days, cell };
    this.addLog(`${faction.name} breaks ground on a ${def.name} at ${t.name}.`, 'info');
    return true;
  }

  /** Zone a district for a rival town when a same-sector building cluster already
   *  exists to reward (so the zone's adjacency bonus actually fires). Picks the
   *  district sitting on the largest cluster, sites it on the hex adjacent to the
   *  most same-sector buildings, pays the player's real `districtCost` from the
   *  surplus above `reserve`. Districts take effect on placement (no construction
   *  slot). Returns true if a district was zoned. */
  private tryZoneRivalDistrict(faction: RegionalFaction, t: Settlement, reserve: number): boolean {
    const lean = this.factionBuildLean(faction);
    let pick: DistrictDef | null = null, bestScore = -Infinity;
    for (const d of DISTRICT_DEFS) {
      if (this.districtCount(t, d.id) >= d.max) continue;
      if (d.prereq && this.year < this.prereqEraYear(d.prereq)) continue;
      if (this.factionDevPurse(faction) - this.districtCost(d) < reserve) continue; // surplus-only
      let cluster = 0;
      for (const p of t.placedBuildings) {
        if (REGION_BUILDINGS_MAP.get(p.id)?.sector === d.sector) cluster++;
      }
      if (cluster < 2) continue; // need a ≥2 same-sector cluster to bother zoning
      // Score by cluster size first (the zone bonus only pays where a cluster exists),
      // then let personality tip BETWEEN comparable clusters — the lean (< 1) can never
      // outweigh a strictly larger cluster, so it only decides close calls. So a liberal
      // power zones its commercial quarter where an autocrat would zone its industrial
      // one, given equal-size clusters in each sector.
      const score = cluster + (lean[d.sector] ?? 0);
      if (score > bestScore) { bestScore = score; pick = d; }
    }
    if (!pick) return false;
    const def = pick;
    const cell = this.bestPlacementCell(t, (c) => this.districtPlacementPreview(t.id, c, def.id)?.total ?? -Infinity);
    if (cell < 0) return false;
    this.spendFactionDev(faction, this.districtCost(def));
    t.placedDistricts.push({ id: def.id, cell });
    this.addLog(`${faction.name} zones a ${def.name} at ${t.name}.`, 'info');
    return true;
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
    const sc = goal.successCondition;
    const succeeded = typeof sc === 'function' ? sc(faction, this) : false;
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

  /** Update settlement-level faction strengths based on laws, policies, and economic conditions.
   *  Factions gain strength when the player enacts laws they support, and lose when blocked. */
  private updateSettlementFactions(): void {
    for (const settlement of this.settlements) {
      // Get active factions for this year
      const activeFacs = activeFactions(this.year);

      for (const factionDef of activeFacs) {
        const currentStrength = settlement.factionStrengths.get(factionDef.id) ?? 50;
        let newStrength = currentStrength;

        // Faction gains 20 strength when player passes a law they promote
        for (const law of factionDef.promotes) {
          if (this.passedLaws.has(law)) {
            newStrength += 2;
          }
        }

        // Faction loses 15 strength when player passes a law they oppose
        for (const law of factionDef.opposes) {
          if (this.passedLaws.has(law)) {
            newStrength -= 2;
          }
        }

        // Tech research boosts faction strength (if they have modifiers for that tech)
        // Example: environmentalists boost when solar/wind researched
        if (factionDef.id === 'environmentalists' && (this.has('solar_cells') || this.has('wind_power'))) {
          newStrength += 1;
        }
        if (factionDef.id === 'oil_barons' && (this.has('coal_mining') || this.has('oil_refining'))) {
          newStrength += 1;
        }
        if (factionDef.id === 'scientists' && (this.has('computing') || this.has('automation'))) {
          newStrength += 1;
        }

        // Economic conditions affect factions
        // Industrialists grow stronger during high GDP growth
        if (factionDef.id === 'industrialists' && this.gdpLastMonth > 50000) {
          newStrength += 0.5;
        }
        // Pacifists gain strength during peace
        if (factionDef.id === 'pacifists' && !this.playerWar) {
          newStrength += 0.5;
        }
        // Militarists gain during war
        if (factionDef.id === 'militarists' && this.playerWar) {
          newStrength += 0.5;
        }

        // Natural decay if faction goals are being ignored (very slow)
        newStrength *= 0.99;

        // Clamp to 0-100
        newStrength = Math.max(0, Math.min(100, newStrength));

        settlement.factionStrengths.set(factionDef.id, newStrength);
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
      if (faction.id === this.playerFactionId) {
        // The player faction never runs the full rival AI (no procedural goals,
        // expansion, military or diplomacy — those are the human's to drive). But
        // in autoplay (flag-gated; OFF for live human play) it DOES exercise its
        // own spatial path: develop the player's town(s) on the same cadence,
        // funded from the national treasury and reserve-gated like a rival. This
        // is what makes the headless balance signal reflect a player who actually
        // builds, instead of one bare town carrying the whole economy on raw yields.
        if (this.autoDevelopPlayer && this.day - faction.lastUpdateDay >= faction.updateFrequency) {
          this.maybeDevelopFactionTown(faction, this.aiKnobs(), this.factionTownOutput(faction));
          faction.lastUpdateDay = this.day;
        }
        continue;
      }
      if (this.day - faction.lastUpdateDay >= faction.updateFrequency) {
        this.updateFactionAI(faction);
        faction.lastUpdateDay = this.day;
      }
    }
  }

  /** Total monthly sector output across a faction's towns — the reserve basis for
   *  `maybeDevelopFactionTown` (development spends only the surplus above a fraction
   *  of this). Mirrors the inline `rivalOutput` sum in `updateFactionAI`. */
  private factionTownOutput(faction: RegionalFaction): number {
    let output = 0;
    for (const id of faction.settlementIds) {
      const t = this.settlement(id);
      if (t) output += this.sectorOutputOf(t);
    }
    return output;
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
      !this.playerWar && this.aiRng.chance(this.aggroChance(0.012))
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
    // Personality terrain pull: the faction's sector lean (the SAME factionBuildLean
    // that steers what it builds) gravitates it toward the terrain that feeds its
    // signature sector — so a Merchant Republic settles the coast, a Military Junta the
    // hills, an Absolute Monarchy the fertile plains. Derived purely from faction fields
    // (no RNG draw) → the aiRng stream is untouched; only WHERE it lands changes.
    const lean = this.factionBuildLean(faction);

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

      // Penalty: too close to ANY existing settlement (own or foreign) — keep
      // cities spread out instead of clustering. Euclidean, not per-axis.
      for (const s of this.settlements) {
        if (Math.hypot(s.x - x, s.y - y) < MIN_SETTLEMENT_SPACING) { score -= 100; break; }
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

      // Personality terrain pull (see `lean` above): map the sector lean onto the
      // terrain that feeds it. Bounded by EXPAND_LEAN_SCALE so it only tips close calls.
      let leanPull = 0;
      if (isPlains || isRiver) leanPull += lean.agriculture;
      if (isMountain || isForest) leanPull += lean.industry;
      if (isCoastal || isRiver) leanPull += lean.services;
      score += leanPull * EXPAND_LEAN_SCALE;

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

    // Don't found within the minimum spacing radius of any existing settlement.
    if (this.settlements.some((s) => Math.hypot(s.x - x, s.y - y) < MIN_SETTLEMENT_SPACING)) {
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
      factionStrengths: new Map(activeFactions(this.year).map(f => [f.id, 50] as [NewFactionId, number])),
      sectors: defaultSectors(),
      buildings: [],
      placedBuildings: [],
      placedDistricts: [],
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
    for (const scout of this.scouts) {
      if (this.day < scout.expireDay) {
        const oldX = scout.x, oldY = scout.y;
        // Player scouts use deterministic movement (no AI RNG consumed).
        if (scout.factionId === this.playerFactionId) {
          this.movePlayerScout(scout);
        } else {
          this.moveScout(scout);
        }
        if (Math.abs(scout.x - oldX) > 0.1 || Math.abs(scout.y - oldY) > 0.1) {
          this.invalidateFactionVisibility(scout.factionId);
        }
      }
    }
    this.scouts = this.scouts.filter((s) => this.day < s.expireDay);
    // Auto-spawn only for rival factions; player hires scouts manually.
    for (const faction of this.regionalFactions) {
      if (faction.id === this.playerFactionId) continue;
      if (this.rng.chance(0.1)) this.spawnScout(faction);
    }
  }

  /** Deterministic movement for player scouts — no RNG consumed. */
  private movePlayerScout(scout: Scout): void {
    // Manual waypoint: move toward it, clear when arrived.
    if (scout.manualTargetX !== undefined && scout.manualTargetY !== undefined) {
      const dx = scout.manualTargetX - scout.x;
      const dy = scout.manualTargetY - scout.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 2) {
        scout.manualTargetX = undefined;
        scout.manualTargetY = undefined;
      } else {
        scout.x += (dx / dist) * 2.5;
        scout.y += (dy / dist) * 2.5;
      }
      scout.x = Math.max(0, Math.min(100, scout.x));
      scout.y = Math.max(0, Math.min(100, scout.y));
      return;
    }
    if (scout.autoExplore === false) return; // parked by player
    const target = this.findNearestUnexplored(scout.x, scout.y);
    if (target) {
      const dx = target.x - scout.x;
      const dy = target.y - scout.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 0) {
        scout.x += (dx / dist) * 2.5;
        scout.y += (dy / dist) * 2.5;
      }
    } else {
      scout.x = Math.min(100, scout.x + 1.5);
    }
    scout.x = Math.max(0, Math.min(100, scout.x));
    scout.y = Math.max(0, Math.min(100, scout.y));
  }

  /** Scan outward from (fromX, fromY) to find the nearest unexplored tile. */
  private findNearestUnexplored(fromX: number, fromY: number): { x: number; y: number } | null {
    const E = this.explorationMap.length;
    for (let step = 4; step <= 64; step += 4) {
      for (let di = -step; di <= step; di += step === 4 ? 2 : step) {
        for (let dj = -step; dj <= step; dj += step === 4 ? 2 : step) {
          const rx = Math.max(0, Math.min(100, fromX + di));
          const ry = Math.max(0, Math.min(100, fromY + dj));
          const ex = Math.min(E - 1, Math.floor((rx / 100) * E));
          const ey = Math.min(E - 1, Math.floor((ry / 100) * E));
          if (this.explorationMap[ex][ey] === 'fogged') return { x: rx, y: ry };
        }
      }
    }
    return null;
  }

  // ---- Faction Visibility Cache (Phase 2c: deferred per-faction visibility) ----

  /** Visibility cache: tiles visible to each faction (lazily computed, weekly rebuild). */
  private factionVisibilityCache: Map<number, Set<number>> = new Map();
  private lastVisibilityRebuild: Map<number, number> = new Map();

  /** Check if a tile is visible to a faction (cache hits are O(1)). */
  isVisibleToFaction(x: number, y: number, factionId: number): boolean {
    // Rebuild cache if stale (weekly rebuild)
    const lastRebuild = this.lastVisibilityRebuild.get(factionId) ?? -999;
    if (this.day - lastRebuild >= 7) {
      this.rebuildFactionVisibility(factionId);
    }

    const cache = this.factionVisibilityCache.get(factionId);
    return cache ? cache.has(Math.round(x) * 101 + Math.round(y)) : false;
  }

  /** Mark faction visibility cache as dirty (rebuild on next check). */
  private invalidateFactionVisibility(factionId: number): void {
    this.lastVisibilityRebuild.set(factionId, -999); // force rebuild
  }

  /** Rebuild faction visibility cache from settlements + scouts. O(settlements² + scouts × radius²). */
  private rebuildFactionVisibility(factionId: number): void {
    const faction = this.faction(factionId);
    if (!faction) return;

    const cache = new Set<number>();
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
              cache.add(Math.round(nx) * 101 + Math.round(ny));
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
              cache.add(Math.round(nx) * 101 + Math.round(ny));
            }
          }
        }
      }
    }

    this.factionVisibilityCache.set(factionId, cache);
    this.lastVisibilityRebuild.set(factionId, this.day);
    this.visibilityVersion++;
  }
}
