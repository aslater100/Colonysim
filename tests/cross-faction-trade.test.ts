import { describe, expect, it } from 'vitest';
import { RegionSim, INTERMEDIATE_GOODS, type Settlement, type RegionalFaction } from '../src/sim/region';
import { tickPriceArbitrage } from '../src/sim/systems/arbitrage';
import { DAYS_PER_MONTH } from '../src/sim/defs';

/**
 * Cross-faction trade — global-world leg 1 step (a).
 *
 * Previously `tickPriceArbitrage` filtered to only the player's settlements
 * (`s.factionId === r.playerFactionId`), so rival towns traded in no market
 * and inter-rival surplus/shortage stayed unresolved. The change:
 *   1. All settlements (every faction) participate in arbitrage.
 *   2. Delivery credits the SOURCE faction's treasury via `addFactionTreasury`,
 *      not always `r.treasury`.
 *   3. `RegionSim.addFactionTreasury` — the new public seam — routes to
 *      `this.treasury` (player) or `faction.treasury` (rival), mirroring the
 *      private `factionDevPurse` / `spendFactionDev` pair.
 *
 * In balanced autoplay towns are self-sufficient → world scarcity 0 → no
 * price gaps → no flows → BYTE-IDENTICAL (the pattern every goods-economy
 * change preserves). The tests exercise a *specialised* two-town setup to
 * make the gaps fire.
 */

const RIVAL_ID = 99;

/** Minimal `RegionalFaction` shape sufficient for `addFactionTreasury`. */
function rivalFaction(treasury = 0): RegionalFaction {
  return {
    id: RIVAL_ID, name: 'Testia', capital: -1,
    settlementIds: [], treasury, techProgress: 0, techFocus: 'farming',
    militaryStrength: 0, aggressiveness: 30, expansion: 30, commerce: 50,
    honor: 50, risk: 30, regime: 'democracy', agendaId: null, goals: [],
    history: [], allies: [], lastUpdateDay: 0, updateFrequency: 30,
    color: '#aaa',
  } as unknown as RegionalFaction;
}

/** Add a settlement belonging to a given factionId to the sim. */
function addSettlement(r: RegionSim, factionId: number, name: string): Settlement {
  const base = r.settlements[0];
  const s = structuredClone(base) as Settlement;
  s.id = r.settlements.length + 100; // avoid collisions with the built-in IDs
  s.name = name;
  s.factionId = factionId;
  s.goodStocks = {};
  r.settlements.push(s);
  return s;
}

/** A cheap road (tariff 0.1 → below any real price gap). */
function link(r: RegionSim, a: Settlement, b: Settlement): void {
  r.routes.push({
    a: a.id, b: b.id, kind: 'road', condition: 100,
    path: Array.from({ length: 10 }, () => ({ x: 0, y: 0 })),
    terrainCost: 10, freight: 0, cargoType: null, cargoPriority: null,
  });
}

/** Saturate a town on every unlocked good so it prices at base (no false gaps). */
function stockFull(r: RegionSim, t: Settlement): void {
  t.goodStocks ??= {};
  for (const g of INTERMEDIATE_GOODS) if (r.year >= g.eraUnlock) t.goodStocks[g.id] = 9999;
}

/** Build a sim with two RIVAL towns and no player towns in the pool.
 *  (Player's original settlement is kept in the sim but has no route to the
 *   rival towns and is stocked-full so it opens no gaps.) */
function rivalSim(rivalTreasury = 0) {
  const r = RegionSim.create(7);
  Object.defineProperty(r, 'year', { get: () => 2000, configurable: true });

  // Stock the player's existing town fully so it opens no price gaps.
  stockFull(r, r.settlements[0]);

  // Add a rival faction.
  const faction = rivalFaction(rivalTreasury);
  r.regionalFactions.push(faction);

  // Two rival towns: agri-dominant source (flush textiles) and industry-dominant
  // market (starved of textiles → high price). Set sector outputs so that
  // `localGoodDemand` creates a meaningful price gap.
  const src = addSettlement(r, RIVAL_ID, 'Rival-Src');
  const mkt = addSettlement(r, RIVAL_ID, 'Rival-Mkt');

  // Both own agriculture + industry output so demand for goods exists.
  src.sectors.industry.output = 10;
  src.sectors.agriculture.output = 100;
  mkt.sectors.industry.output = 100;
  mkt.sectors.agriculture.output = 10;

  // Stock src with textiles (agri-produced), mkt with none → gap.
  stockFull(r, src);
  stockFull(r, mkt);
  mkt.goodStocks!['textiles'] = 0; // mkt is starved → prices textiles at 2× base

  // Connect the two rival towns with a road.
  link(r, src, mkt);

  return { r, faction, src, mkt };
}

// ============================================================
// 1. addFactionTreasury — the public seam
// ============================================================
describe('addFactionTreasury', () => {
  it('credits the player national treasury when factionId === playerFactionId', () => {
    const r = RegionSim.create(7);
    const before = r.treasury;
    r.addFactionTreasury(r.playerFactionId, 500);
    expect(r.treasury).toBe(before + 500);
  });

  it('credits the rival faction treasury when factionId is a rival id', () => {
    const r = RegionSim.create(7);
    const fac = rivalFaction(1000);
    r.regionalFactions.push(fac);
    const before = fac.treasury;
    r.addFactionTreasury(RIVAL_ID, 250);
    expect(fac.treasury).toBe(before + 250);
  });

  it('does not affect player treasury when crediting a rival', () => {
    const r = RegionSim.create(7);
    const fac = rivalFaction(0);
    r.regionalFactions.push(fac);
    const playerBefore = r.treasury;
    r.addFactionTreasury(RIVAL_ID, 300);
    expect(r.treasury).toBe(playerBefore);
  });

  it('silently no-ops for an unknown faction id (does not throw)', () => {
    const r = RegionSim.create(7);
    const before = r.treasury;
    expect(() => r.addFactionTreasury(9999, 100)).not.toThrow();
    expect(r.treasury).toBe(before);
  });
});

// ============================================================
// 2. Dispatch — rival towns trade with each other
// ============================================================
describe('cross-faction dispatch: rival towns participate in arbitrage', () => {
  it('dispatches a flow between rival towns when a route and price gap exist', () => {
    const { r } = rivalSim();
    tickPriceArbitrage(r);
    // At least one flow should be dispatched between the two rival towns.
    const rivalFlows = r.tradeFlows.filter((f) => {
      const s = r.settlement(f.fromSettlementId);
      return s?.factionId === RIVAL_ID;
    });
    expect(rivalFlows.length).toBeGreaterThan(0);
    expect(rivalFlows[0].goodId).toBe('textiles');
  });

  it('dispatches no flows when rival towns have no route between them', () => {
    const { r } = rivalSim();
    r.routes = []; // strip all routes
    tickPriceArbitrage(r);
    expect(r.tradeFlows).toHaveLength(0);
  });

  it('dispatches no flows when rival towns are self-sufficient', () => {
    const { r, mkt } = rivalSim();
    mkt.goodStocks!['textiles'] = 9999; // close the gap
    tickPriceArbitrage(r);
    expect(r.tradeFlows).toHaveLength(0);
  });
});

// ============================================================
// 3. Delivery — profit goes to the SOURCE faction's treasury
// ============================================================
describe('cross-faction delivery: profit routes to the source faction', () => {
  it("credits the rival treasury when a rival-sourced flow delivers", () => {
    const { r, faction, src, mkt } = rivalSim(0);

    tickPriceArbitrage(r); // dispatch a rival→rival flow
    expect(r.tradeFlows.length).toBeGreaterThan(0);
    const rivalFlow = r.tradeFlows.find((f) => f.fromSettlementId === src.id)!;
    expect(rivalFlow).toBeDefined();

    // Force the flow to deliver on the next call by zeroing transit time.
    rivalFlow.transitDays = 1; // < DAYS_PER_MONTH → delivers

    const treasuryBefore = faction.treasury;
    const playerBefore = r.treasury;

    tickPriceArbitrage(r); // delivery pass

    // Rival treasury gained the profit; player treasury is unchanged.
    expect(faction.treasury).toBeGreaterThan(treasuryBefore);
    expect(r.treasury).toBe(playerBefore);
  });

  it("credits the player treasury when a player-sourced flow delivers", () => {
    // Two PLAYER towns: one flush with textiles, one starved.
    const r = RegionSim.create(7);
    Object.defineProperty(r, 'year', { get: () => 2000, configurable: true });

    const base = r.settlements[0];
    const s2 = structuredClone(base) as Settlement;
    s2.id = base.id + 50;
    s2.name = 'Player-Mkt';
    s2.factionId = r.playerFactionId;
    s2.sectors.industry.output = 100;
    s2.sectors.agriculture.output = 10;
    r.settlements.push(s2);

    stockFull(r, base);
    stockFull(r, s2);
    s2.goodStocks!['textiles'] = 0;

    link(r, base, s2);

    tickPriceArbitrage(r);
    expect(r.tradeFlows.length).toBeGreaterThan(0);
    const flow = r.tradeFlows[0];
    flow.transitDays = 1;

    const playerBefore = r.treasury;
    tickPriceArbitrage(r);
    expect(r.treasury).toBeGreaterThan(playerBefore);
  });

  it('does not credit player treasury when only rival flows deliver', () => {
    const { r, faction } = rivalSim(0);

    tickPriceArbitrage(r);
    const rivalFlow = r.tradeFlows.find((f) => {
      const s = r.settlement(f.fromSettlementId);
      return s?.factionId === RIVAL_ID;
    });
    expect(rivalFlow).toBeDefined();
    rivalFlow!.transitDays = 1;

    const playerBefore = r.treasury;
    tickPriceArbitrage(r);
    expect(r.treasury).toBe(playerBefore);
  });
});

// ============================================================
// 4. Cross-faction route (player ↔ rival on one route)
// ============================================================
describe('cross-faction dispatch: player and rival trade across a shared route', () => {
  it('dispatches a flow from a rival-surplus town to a player-starved town when a route exists', () => {
    const r = RegionSim.create(7);
    Object.defineProperty(r, 'year', { get: () => 2000, configurable: true });

    const fac = rivalFaction(0);
    r.regionalFactions.push(fac);

    const playerTown = r.settlements[0];
    playerTown.sectors.industry.output = 100;
    playerTown.sectors.agriculture.output = 10;
    stockFull(r, playerTown);
    playerTown.goodStocks!['textiles'] = 0; // player is short

    const rivalTown = addSettlement(r, RIVAL_ID, 'Rival-Flush');
    rivalTown.sectors.industry.output = 10;
    rivalTown.sectors.agriculture.output = 100;
    stockFull(r, rivalTown);
    rivalTown.goodStocks!['textiles'] = 9999; // rival has surplus

    link(r, rivalTown, playerTown);

    tickPriceArbitrage(r);

    // A flow from the rival town to the player town should be dispatched.
    const crossFlow = r.tradeFlows.find(
      (f) => f.fromSettlementId === rivalTown.id && f.toSettlementId === playerTown.id,
    );
    expect(crossFlow).toBeDefined();
    expect(crossFlow!.goodId).toBe('textiles');
  });
});

// ============================================================
// 5. Inert in balanced (self-sufficient) play
// ============================================================
describe('inert when all settlements are self-sufficient', () => {
  it('dispatches nothing and touches no treasury when every town holds its demand', () => {
    const { r, faction } = rivalSim(500);
    // Close the gap we created.
    const mkt = r.settlements.find((s) => s.name === 'Rival-Mkt')!;
    mkt.goodStocks!['textiles'] = 9999;

    const playerBefore = r.treasury;
    const rivalBefore = faction.treasury;
    tickPriceArbitrage(r);
    expect(r.tradeFlows).toHaveLength(0);
    expect(r.treasury).toBe(playerBefore);
    expect(faction.treasury).toBe(rivalBefore);
  });
});

// ============================================================
// 6. Determinism
// ============================================================
describe('determinism', () => {
  it('produces identical tradeFlows across two independent runs with the same seed', () => {
    function run() {
      const { r } = rivalSim(0);
      tickPriceArbitrage(r);
      return r.tradeFlows;
    }
    const a = run();
    const b = run();
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });
});
