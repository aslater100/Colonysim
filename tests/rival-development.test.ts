import { describe, it, expect } from 'vitest';
import { RegionSim, REGION_BUILDINGS, DISTRICT_DEFS, REGION_MINUTES_PER_TICK } from '../src/sim/region';
import { RegionMap } from '../src/sim/worldgen';
import { Weather } from '../src/sim/weather';
import { Rng } from '../src/sim/rng';
import { MINUTES_PER_DAY, START_YEAR } from '../src/sim/defs';

/**
 * Spatial-4X — rivals PLAY SPATIALLY. Before this, the AI owned land but never
 * built on it: in autoplay no faction ever raised a regular building or zoned a
 * district, so every spatial bonus (terrain-match, district adjacency, district
 * zones) was dormant and the headless balance suite tested a different game than
 * a human plays. Now a rival faction develops its towns each AI update — it
 * raises the era-ready building that best fits a town's land on the hex that
 * MAXIMIZES the realized spatial bonus, and zones a district once a same-sector
 * cluster exists to reward. Funded ONLY from the surplus above a famine floor
 * (RIVAL_DEV_RESERVE_MONTHS), aiRng-gated so the main RNG stream is untouched.
 * Intentional headless re-baseline.
 */

const ticksPerDay = MINUTES_PER_DAY / REGION_MINUTES_PER_TICK;
function runDays(r: RegionSim, days: number): void {
  for (let i = 0; i < days * ticksPerDay; i++) r.tick();
}

type Sector = 'agriculture' | 'industry' | 'services' | 'information';
type Faction = {
  treasury: number; settlementIds: number[];
  regime?: string; techFocus?: string; aggressiveness?: number;
  name?: string; aiGoal?: string; currentGoal?: { settlementBias?: string[] } | null;
};
type Settle = {
  id: number; factionId: number; site: { coastal: boolean };
  buildings: string[];
  placedBuildings: { id: string; cell: number }[];
  placedDistricts: { id: string; cell: number }[];
  construction: { id: string; doneDay: number; cell?: number } | null;
};
type Priv = {
  prereqEraYear: (prereq?: string) => number;
  bestPlacementCell: (t: Settle, scoreFn: (cell: number) => number) => number;
  autoPlaceCell: (t: Settle) => number;
  tileYieldFor: (t: Settle) => Record<Sector, number>;
  tryBuildRivalBuilding: (f: Faction, t: Settle, reserve: number) => boolean;
  tryZoneRivalDistrict: (f: Faction, t: Settle, reserve: number) => boolean;
  factionBuildLean: (f: Faction) => Record<Sector, number>;
  findBestExpansionSite: (f: Faction, samples?: number) => { x: number; y: number; score: number } | null;
  buildingCount: (t: Settle, id: string) => number;
  cityBuildCost: (def: { cost: number }) => number;
  districtCost: (def: { cost: number }) => number;
  placementPreview: (townId: number, cell: number, defId: string) => { total: number } | null;
};
const priv = (r: RegionSim) => r as unknown as Priv;

/** Build a test faction, defaulting the personality fields factionBuildLean reads.
 *  A 'farming'/low-aggression default keeps the lean off industry unless asked. */
function mkFaction(o: Partial<Faction> & { treasury: number; settlementIds: number[] }): Faction {
  return { regime: 'parliamentary', techFocus: 'farming', aggressiveness: 0, ...o };
}

function colony(seed: number): RegionSim {
  return RegionSim.foundColony(new Rng(seed), new RegionMap(seed), new Weather(seed), {});
}
const byId = (id: string) => REGION_BUILDINGS.find((b) => b.id === id)!;
const districtById = (id: string) => DISTRICT_DEFS.find((d) => d.id === id)!;

/** A fresh colony whose founding town has a non-empty worked ring (so placement
 *  logic has somewhere to go) — most seeds qualify; assert it to be explicit. */
function townWithRing(seed: number): { r: RegionSim; t: Settle } {
  const r = colony(seed);
  const t = r.settlements[0] as unknown as Settle;
  expect(r.buildablePlacementCells(t.id).length, 'founding town should have a worked ring').toBeGreaterThan(0);
  return { r, t };
}

/** Reference re-implementation of tryBuildRivalBuilding's pick, for an independent
 *  expectation of WHICH building a rival raises (best fit = flat bonus + the town's
 *  terrain yield in that sector + the faction's personality lean). First-wins on
 *  ties, mirroring the loop. Uses the real factionBuildLean as the single source of
 *  truth for the personality term. */
function refPickBuilding(r: RegionSim, t: Settle, faction: Faction, reserve: number): { id: string } | null {
  const P = priv(r);
  const yields = P.tileYieldFor(t);
  const lean = P.factionBuildLean(faction);
  let pick: { id: string } | null = null, score = -Infinity;
  for (const b of REGION_BUILDINGS) {
    if (b.unique) continue;
    if (P.buildingCount(t, b.id) >= b.max) continue;
    if (b.coastal_only && !t.site.coastal) continue;
    if (b.prereq && r.year < P.prereqEraYear(b.prereq)) continue;
    if (faction.treasury - P.cityBuildCost(b) < reserve) continue;
    const sy = b.sector === 'all' ? 0 : (yields[b.sector as Sector] ?? 0);
    const sl = b.sector === 'all' ? 0 : (lean[b.sector as Sector] ?? 0);
    const s = b.bonus + sy + sl;
    if (s > score) { score = s; pick = b; }
  }
  return pick;
}

// ---- 1. The era gate (rivals lack a researched-node set) ----

describe('rival development — prereq era gate', () => {
  it('maps a prereq tech to its era-year; no prereq → START_YEAR', () => {
    const P = priv(colony(1));
    expect(P.prereqEraYear(undefined)).toBe(START_YEAR);
    expect(P.prereqEraYear('mass_production')).toBe(1922);
    expect(P.prereqEraYear('computing')).toBe(1965);
  });
});

// ---- 2. bestPlacementCell — the AI's spatial brain ----

describe('bestPlacementCell — deterministic max-score siting', () => {
  it('returns the single highest-scoring legal cell', () => {
    const { r, t } = townWithRing(7);
    const cells = r.buildablePlacementCells(t.id);
    const target = cells[Math.floor(cells.length / 2)];
    const best = priv(r).bestPlacementCell(t, (c) => (c === target ? 1 : 0));
    expect(best).toBe(target);
  });

  it('falls back to the autoPlaceCell heuristic (nearest-centre, then index) on a flat tie', () => {
    const { r, t } = townWithRing(7);
    expect(priv(r).bestPlacementCell(t, () => 0)).toBe(priv(r).autoPlaceCell(t));
  });

  it('returns -1 when the worked ring is full', () => {
    const { r, t } = townWithRing(7);
    for (const cell of r.buildablePlacementCells(t.id)) t.placedBuildings.push({ id: 'waterworks', cell });
    expect(priv(r).bestPlacementCell(t, () => 1)).toBe(-1);
  });
});

// ---- 3. tryBuildRivalBuilding — terrain-fit choice + spatial siting ----

describe('tryBuildRivalBuilding — builds to the land, sites on the best hex', () => {
  it('breaks ground on the best-fit building, on the bonus-maximizing cell, debiting the real cost', () => {
    const { r, t } = townWithRing(7);
    const faction: Faction = { treasury: 100_000, settlementIds: [t.id] };
    const expectDef = refPickBuilding(r, t, faction, 0)!;
    expect(expectDef, 'a no-prereq building is available at game start').toBeTruthy();
    // The bonus-maximizing cell, computed on the still-clean ring (before the
    // pending construction occupies it).
    const bestCell = priv(r).bestPlacementCell(t, (c) => priv(r).placementPreview(t.id, c, expectDef.id)?.total ?? -Infinity);

    const before = faction.treasury;
    const ok = priv(r).tryBuildRivalBuilding(faction, t, 0);
    expect(ok).toBe(true);
    expect(t.construction).toBeTruthy();
    expect(t.construction!.id).toBe(expectDef.id);
    expect(t.construction!.cell).toBe(bestCell);
    // paid the player's real (dev-scaled) build cost
    expect(faction.treasury).toBe(before - priv(r).cityBuildCost(byId(expectDef.id)));
  });

  it('respects the per-building max (will not start one already built/under way)', () => {
    const { r, t } = townWithRing(7);
    const faction: Faction = { treasury: 100_000, settlementIds: [t.id] };
    // Pre-stock every non-unique buildable type to its max.
    for (const b of REGION_BUILDINGS) {
      if (b.unique) continue;
      if (b.coastal_only && !t.site.coastal) continue;
      if (b.prereq && r.year < priv(r).prereqEraYear(b.prereq)) continue;
      for (let i = 0; i < b.max; i++) t.buildings.push(b.id);
    }
    expect(priv(r).tryBuildRivalBuilding(faction, t, 0)).toBe(false);
    expect(t.construction).toBeNull();
  });

  it('charges nothing when the ring is full (no legal cell to site on)', () => {
    const { r, t } = townWithRing(7);
    const faction: Faction = { treasury: 100_000, settlementIds: [t.id] };
    // Fill the ring so no legal cell remains → no build, no charge.
    for (const cell of r.buildablePlacementCells(t.id)) t.placedBuildings.push({ id: 'waterworks', cell });
    const before = faction.treasury;
    expect(priv(r).tryBuildRivalBuilding(faction, t, 0)).toBe(false);
    expect(faction.treasury).toBe(before);
  });
});

// ---- 4. The famine-buffer guarantee (the death-spiral lesson) ----

describe('rival development — never spends below the famine floor', () => {
  it('builds NOTHING when the whole treasury sits at/below the reserve', () => {
    const { r, t } = townWithRing(7);
    const faction: Faction = { treasury: 100_000, settlementIds: [t.id] };
    const before = faction.treasury;
    // reserve above the entire treasury → no building is affordable above it.
    const ok = priv(r).tryBuildRivalBuilding(faction, t, faction.treasury + 1);
    expect(ok).toBe(false);
    expect(t.construction).toBeNull();
    expect(faction.treasury).toBe(before); // buffer untouched
  });

  it('zones NOTHING below the reserve even with a qualifying cluster', () => {
    const { r, t } = townWithRing(7);
    const cells = r.buildablePlacementCells(t.id);
    // a 2-building agriculture cluster (qualifies a farming_district by sector)
    t.placedBuildings.push({ id: 'grain_exchange', cell: cells[0] });
    t.placedBuildings.push({ id: 'grain_exchange', cell: cells[1] });
    const faction: Faction = { treasury: 100_000, settlementIds: [t.id] };
    const before = faction.treasury;
    expect(priv(r).tryZoneRivalDistrict(faction, t, faction.treasury + 1)).toBe(false);
    expect(t.placedDistricts.length).toBe(0);
    expect(faction.treasury).toBe(before);
  });
});

// ---- 5. tryZoneRivalDistrict — zones onto an established cluster ----

describe('tryZoneRivalDistrict — rewards an existing cluster', () => {
  it('zones the district matching a ≥2 same-sector cluster, debiting the real cost', () => {
    const { r, t } = townWithRing(7);
    const cells = r.buildablePlacementCells(t.id);
    t.placedBuildings.push({ id: 'grain_exchange', cell: cells[0] });
    t.buildings.push('grain_exchange');
    t.placedBuildings.push({ id: 'grain_exchange', cell: cells[1] }); // 2 agri → farming cluster
    t.buildings.push('grain_exchange');
    const faction: Faction = { treasury: 100_000, settlementIds: [t.id] };
    const before = faction.treasury;

    const ok = priv(r).tryZoneRivalDistrict(faction, t, 0);
    expect(ok).toBe(true);
    expect(t.placedDistricts.length).toBe(1);
    expect(t.placedDistricts[0].id).toBe('farming_district');
    expect(r.canPlaceBuildingAt(t.id, t.placedDistricts[0].cell)).toBe(false); // the zone now occupies its hex
    expect(faction.treasury).toBe(before - priv(r).districtCost(districtById('farming_district')));
  });

  it('does NOT zone without a cluster (a lone same-sector building is not enough)', () => {
    const { r, t } = townWithRing(7);
    const cells = r.buildablePlacementCells(t.id);
    t.placedBuildings.push({ id: 'grain_exchange', cell: cells[0] }); // only 1 agri
    t.buildings.push('grain_exchange');
    const faction: Faction = { treasury: 100_000, settlementIds: [t.id] };
    expect(priv(r).tryZoneRivalDistrict(faction, t, 0)).toBe(false);
    expect(t.placedDistricts.length).toBe(0);
  });

  it('does NOT zone an era-locked district even with its cluster (research_campus needs computing, 1965)', () => {
    const { r, t } = townWithRing(7);
    expect(r.year).toBeLessThan(1965);
    const cells = r.buildablePlacementCells(t.id);
    // an information cluster — the only matching district is research_campus, era-locked
    t.placedBuildings.push({ id: 'university', cell: cells[0] });
    t.buildings.push('university');
    t.placedBuildings.push({ id: 'university', cell: cells[1] });
    t.buildings.push('university');
    const faction: Faction = { treasury: 100_000, settlementIds: [t.id] };
    expect(priv(r).tryZoneRivalDistrict(faction, t, 0)).toBe(false);
    expect(t.placedDistricts.length).toBe(0);
  });
});

// ---- 5b. tryZoneRivalDistrict — personality tips the choice between equal clusters ----
//
// When a town holds equal-size same-sector clusters, WHICH district a rival zones now
// depends on who the rival is (the same factionBuildLean that steers building choice),
// instead of always falling to the first sector in DISTRICT_DEFS order.

/** Seed a town with two equal-size clusters: `nAgri` agriculture + `nServices`
 *  services placed buildings, on distinct ring cells. Returns the town. */
function seedTwoClusters(r: RegionSim, t: Settle, nAgri: number, nServices: number): void {
  const cells = r.buildablePlacementCells(t.id);
  expect(cells.length, 'need enough ring cells for both clusters').toBeGreaterThanOrEqual(nAgri + nServices);
  let c = 0;
  for (let i = 0; i < nAgri; i++, c++) { t.placedBuildings.push({ id: 'grain_exchange', cell: cells[c] }); t.buildings.push('grain_exchange'); }
  for (let i = 0; i < nServices; i++, c++) { t.placedBuildings.push({ id: 'waterworks', cell: cells[c] }); t.buildings.push('waterworks'); }
}

describe('tryZoneRivalDistrict — personality decides between comparable clusters', () => {
  it('a traditional (agri-leaning) power zones its farming district on equal clusters', () => {
    const { r, t } = townWithRing(7);
    seedTwoClusters(r, t, 2, 2); // agri cluster 2 == services cluster 2
    const trad = mkFaction({ treasury: 100_000, settlementIds: [t.id], regime: 'abs_monarchy', techFocus: 'none', aggressiveness: 0 });
    expect(priv(r).tryZoneRivalDistrict(trad, t, 0)).toBe(true);
    expect(t.placedDistricts[0].id).toBe('farming_district');
  });

  it('a liberal (services-leaning) power zones its commercial district on the SAME equal clusters', () => {
    const { r, t } = townWithRing(7);
    seedTwoClusters(r, t, 2, 2);
    const liberal = mkFaction({ treasury: 100_000, settlementIds: [t.id], regime: 'parliamentary', techFocus: 'none', aggressiveness: 0 });
    expect(priv(r).tryZoneRivalDistrict(liberal, t, 0)).toBe(true);
    expect(t.placedDistricts[0].id).toBe('commercial_district'); // diverges from the traditional power
  });

  it('a strictly larger cluster still wins — the lean only tips ties, never overrides size', () => {
    const { r, t } = townWithRing(7);
    seedTwoClusters(r, t, 3, 2); // agri cluster 3 > services cluster 2
    // A liberal power leans services, but the lean (< 1) cannot outweigh the bigger agri cluster.
    const liberal = mkFaction({ treasury: 100_000, settlementIds: [t.id], regime: 'parliamentary', techFocus: 'none', aggressiveness: 0 });
    expect(priv(r).tryZoneRivalDistrict(liberal, t, 0)).toBe(true);
    expect(t.placedDistricts[0].id).toBe('farming_district');
  });
});

// ---- 6. End-to-end: rivals actually build over a real run, deterministically ----

function placementTotals(r: RegionSim): { buildings: number; districts: number; rivalBuildings: number } {
  let buildings = 0, districts = 0, rivalBuildings = 0;
  for (const t of r.settlements) {
    buildings += t.placedBuildings?.length ?? 0;
    districts += t.placedDistricts?.length ?? 0;
    if (t.factionId !== r.playerFactionId) rivalBuildings += t.buildings.length;
  }
  return { buildings, districts, rivalBuildings };
}

describe('rival development — integration', () => {
  it('rivals raise placed buildings (and zone districts) over a century of autoplay', () => {
    const r = colony(1000);
    runDays(r, 60 * 120); // ~120 compressed game-years
    const tot = placementTotals(r);
    expect(tot.rivalBuildings, 'rivals should have raised real buildings').toBeGreaterThan(5);
    expect(tot.buildings, 'those buildings should be spatially placed').toBeGreaterThan(5);
    expect(tot.districts, 'an established cluster should eventually be zoned').toBeGreaterThan(0);
  });

  it('is deterministic — two same-seed runs reach identical placement counts and player markers', () => {
    const a = colony(1007); runDays(a, 60 * 80);
    const b = colony(1007); runDays(b, 60 * 80);
    expect(placementTotals(a)).toEqual(placementTotals(b));
    expect(a.treasury).toBe(b.treasury);
    expect(a.playerPop()).toBe(b.playerPop());
  });
});

// ---- 7. factionBuildLean — personality steers the spatial buildout ----
//
// Before this, every rival picked buildings by pure terrain fit, so a Merchant
// Republic and a Military Junta on the same land built the same town. The lean is a
// modest, deterministic thumb on the terrain-fit score, derived purely from existing
// faction fields (regime bloc + tech focus + belligerence) — no RNG, no new
// serialized state — so rival town economies finally diverge by who the rival is.

describe('factionBuildLean — regime bloc signature sector', () => {
  // A neutral focus/aggression so the bloc term is isolated.
  const neutral = { treasury: 0, settlementIds: [], techFocus: 'none', aggressiveness: 0 };

  it('a liberal bloc leans commerce (services, then knowledge)', () => {
    const lean = priv(colony(1)).factionBuildLean(mkFaction({ ...neutral, regime: 'parliamentary' }));
    expect(lean.services).toBeGreaterThan(0);
    expect(lean.information).toBeGreaterThan(0);
    expect(lean.services).toBeGreaterThan(lean.information); // commerce first, knowledge a half-step behind
    expect(lean.agriculture).toBe(0);
    expect(lean.industry).toBe(0);
  });

  it('a traditional bloc leans the land (agriculture only)', () => {
    const lean = priv(colony(1)).factionBuildLean(mkFaction({ ...neutral, regime: 'abs_monarchy' }));
    expect(lean.agriculture).toBeGreaterThan(0);
    expect(lean.industry).toBe(0);
    expect(lean.services).toBe(0);
    expect(lean.information).toBe(0);
  });

  it('an autocratic bloc leans industry only', () => {
    const lean = priv(colony(1)).factionBuildLean(mkFaction({ ...neutral, regime: 'junta' }));
    expect(lean.industry).toBeGreaterThan(0);
    expect(lean.agriculture).toBe(0);
    expect(lean.services).toBe(0);
    expect(lean.information).toBe(0);
  });

  it('a revolutionary bloc mobilizes industry AND knowledge', () => {
    const lean = priv(colony(1)).factionBuildLean(mkFaction({ ...neutral, regime: 'peoples_republic' }));
    expect(lean.industry).toBeGreaterThan(0);
    expect(lean.information).toBeGreaterThan(0);
    expect(lean.agriculture).toBe(0);
    expect(lean.services).toBe(0);
  });

  it('an unknown/empty regime falls back to the traditional (land) lean', () => {
    const lean = priv(colony(1)).factionBuildLean(mkFaction({ ...neutral, regime: 'not_a_regime' }));
    expect(lean.agriculture).toBeGreaterThan(0);
    expect(lean.industry + lean.services + lean.information).toBe(0);
  });
});

describe('factionBuildLean — tech focus and belligerence nudges', () => {
  // Use a liberal bloc (touches only services/information) so a focus/aggression
  // nudge onto agriculture or industry is isolated from the bloc term.
  const base = { treasury: 0, settlementIds: [], regime: 'parliamentary', techFocus: 'none', aggressiveness: 0 };

  it('a mining focus adds industry weight', () => {
    const lean = priv(colony(1)).factionBuildLean(mkFaction({ ...base, techFocus: 'mining' }));
    expect(lean.industry).toBeGreaterThan(0);
  });

  it('a forestry focus adds (less) industry weight than mining', () => {
    const P = priv(colony(1));
    const mining = P.factionBuildLean(mkFaction({ ...base, techFocus: 'mining' }));
    const forestry = P.factionBuildLean(mkFaction({ ...base, techFocus: 'forestry' }));
    expect(forestry.industry).toBeGreaterThan(0);
    expect(forestry.industry).toBeLessThan(mining.industry);
  });

  it('a farming focus adds agriculture weight', () => {
    const lean = priv(colony(1)).factionBuildLean(mkFaction({ ...base, techFocus: 'farming' }));
    expect(lean.agriculture).toBeGreaterThan(0);
  });

  it('belligerence (≥ threshold) adds a war-economy industry nudge', () => {
    const P = priv(colony(1));
    const calm = P.factionBuildLean(mkFaction({ ...base, aggressiveness: 0 }));
    const warlike = P.factionBuildLean(mkFaction({ ...base, aggressiveness: 80 }));
    expect(calm.industry).toBe(0);
    expect(warlike.industry).toBeGreaterThan(0);
  });

  it('the nudges stack on the bloc term (autocratic + mining + belligerent is most industrial)', () => {
    const P = priv(colony(1));
    const bloc = P.factionBuildLean(mkFaction({ treasury: 0, settlementIds: [], regime: 'junta', techFocus: 'none', aggressiveness: 0 }));
    const stacked = P.factionBuildLean(mkFaction({ treasury: 0, settlementIds: [], regime: 'junta', techFocus: 'mining', aggressiveness: 80 }));
    expect(stacked.industry).toBeGreaterThan(bloc.industry);
  });

  it('is pure — equal inputs give an equal lean and the call mutates nothing', () => {
    const P = priv(colony(1));
    const f = mkFaction({ treasury: 0, settlementIds: [], regime: 'junta', techFocus: 'mining', aggressiveness: 80 });
    expect(P.factionBuildLean(f)).toEqual(P.factionBuildLean(f));
    expect(f.regime).toBe('junta'); // untouched
  });
});

describe('personality steers the building pick — divergence by who the rival is', () => {
  it('the chosen building matches the lean-aware reference for distinct personalities', () => {
    const { r, t } = townWithRing(7);
    // A land-leaning traditional/farming power and a commerce-leaning liberal power.
    const agrarian = mkFaction({ treasury: 100_000, settlementIds: [t.id], regime: 'abs_monarchy', techFocus: 'farming', aggressiveness: 0 });
    const merchant = mkFaction({ treasury: 100_000, settlementIds: [t.id], regime: 'parliamentary', techFocus: 'none', aggressiveness: 0 });

    const expAgrarian = refPickBuilding(r, t, agrarian, 0)!;
    const okA = priv(r).tryBuildRivalBuilding(agrarian, t, 0);
    expect(okA).toBe(true);
    expect(t.construction!.id).toBe(expAgrarian.id);

    // Fresh town for the merchant so the pick isn't constrained by the first build.
    const { r: r2, t: t2 } = townWithRing(7);
    const merchant2 = mkFaction({ ...merchant, settlementIds: [t2.id] });
    const expMerchant = refPickBuilding(r2, t2, merchant2, 0)!;
    expect(priv(r2).tryBuildRivalBuilding(merchant2, t2, 0)).toBe(true);
    expect(t2.construction!.id).toBe(expMerchant.id);
  });

  it('different personalities diverge on the SAME land for at least some seeds (non-vacuous)', () => {
    let diverged = 0, examined = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const r = colony(seed);
      const t = r.settlements[0] as unknown as Settle;
      if (r.buildablePlacementCells(t.id).length === 0) continue;
      examined++;
      const agrarian = mkFaction({ treasury: 100_000, settlementIds: [t.id], regime: 'abs_monarchy', techFocus: 'farming', aggressiveness: 0 });
      const industrial = mkFaction({ treasury: 100_000, settlementIds: [t.id], regime: 'junta', techFocus: 'mining', aggressiveness: 80 });
      const a = refPickBuilding(r, t, agrarian, 0);
      const b = refPickBuilding(r, t, industrial, 0);
      if (a && b && a.id !== b.id) diverged++;
    }
    expect(examined).toBeGreaterThan(0);
    // The whole point of the lean: who the rival is changes what it builds.
    expect(diverged).toBeGreaterThan(0);
  });
});

// ---- 8. findBestExpansionSite — personality steers WHERE a rival settles ----
//
// The same lean now pulls a faction toward the terrain that feeds its signature
// sector (agri→fertile/river, industry→mountain/forest, services→coastal/river) when
// it sites a new town. Derived purely from faction fields (no extra RNG draw), so the
// aiRng stream's draw order is untouched — only the chosen tile moves. Both factions
// below evaluate the SAME sampled tiles with the SAME noise (fresh same-seed colony,
// settlementIds: [] → identical bootstrap sample count), so the lean is the ONLY
// differentiator: any divergence is the personality pull alone.

function expandFaction(o: Partial<Faction>): Faction {
  return { name: 'Probe', treasury: 1_000, settlementIds: [], regime: 'parliamentary', techFocus: 'none', aggressiveness: 0, aiGoal: '', currentGoal: null, ...o };
}
function expansionSite(seed: number, f: Faction) {
  return priv(colony(seed)).findBestExpansionSite(f, 8);
}

describe('findBestExpansionSite — personality steers where a rival settles', () => {
  it('is deterministic — same faction + seed reaches the identical site', () => {
    const f = expandFaction({ regime: 'junta', techFocus: 'mining', aggressiveness: 80 });
    expect(expansionSite(1234, f)).toEqual(expansionSite(1234, f));
  });

  it('an agrarian vs an industrial power diverge on WHERE to settle for some seeds (non-vacuous)', () => {
    const agrarian = expandFaction({ regime: 'abs_monarchy', techFocus: 'farming', aggressiveness: 0 });
    const industrial = expandFaction({ regime: 'junta', techFocus: 'mining', aggressiveness: 80 });
    let diverged = 0, examined = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const a = expansionSite(seed, agrarian);
      const b = expansionSite(seed, industrial);
      if (!a || !b) continue;
      examined++;
      if (a.x !== b.x || a.y !== b.y) diverged++;
    }
    expect(examined).toBeGreaterThan(0);
    expect(diverged).toBeGreaterThan(0);
  });

  it('the lean only tips close calls — it never pushes a site below the spacing penalty', () => {
    // Any returned site must still clear the hard gates (score > 0, spaced out): the
    // lean is a bounded thumb on the scale, not an override.
    const f = expandFaction({ regime: 'junta', techFocus: 'mining', aggressiveness: 80 });
    const site = expansionSite(7, f);
    if (site) expect(site.score).toBeGreaterThan(0);
  });
});
