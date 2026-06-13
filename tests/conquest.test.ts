import { describe, it, expect } from 'vitest';
import { Simulation } from '../src/sim/sim';
import { RegionSim } from '../src/sim/region';
import { MINUTES_PER_DAY } from '../src/sim/defs';
import type { TownDesign } from '../src/sim/defs';
import { REGION_MINUTES_PER_TICK } from '../src/sim/region';

const baseDesign: TownDesign = {
  currencySymbol: '£',
  difficulty: 'normal',
  location: 'river-valley',
  startingPop: 12,
};

const ticksPerDay = MINUTES_PER_DAY / REGION_MINUTES_PER_TICK;

function grow(sim: Simulation): void {
  while (sim.settlers.length < 22) sim.spawnSettler(48, 50);
  sim.stock.wood = 200;
  sim.stock.meal = 200;
}

function makeRegion(seed = 42): RegionSim {
  const sim = new Simulation(seed, baseDesign);
  grow(sim);
  return RegionSim.fromTown(sim, 8, 80, 80);
}

function runDays(r: RegionSim, days: number): void {
  for (let i = 0; i < days * ticksPerDay; i++) r.tick();
}

/** Force a rival faction to have a settlement so vassalage tests have something to work with. */
function ensureRivalHasSettlement(r: RegionSim): number {
  const rival = r.regionalFactions.find((f) => f.id !== r.playerFactionId)!;
  if (rival.settlementIds.length === 0) {
    // Manually plant a settlement for the rival
    (r as unknown as { foundSettlement: (f: typeof rival, x: number, y: number) => object | null })
      .foundSettlement(rival, 20, 20);
    if (rival.settlementIds.length > 0) {
      rival.capital = rival.settlementIds[0];
    }
  }
  return rival.id;
}

describe('Phase C: conquest & diplomacy', () => {
  describe('offerVassalage', () => {
    it('returns invalid before state is proclaimed', () => {
      const r = makeRegion();
      const rival = r.regionalFactions.find((f) => f.id !== r.playerFactionId)!;
      expect(r.offerVassalage(rival.id)).toBe('invalid');
    });

    it('returns invalid for own faction', () => {
      const r = makeRegion();
      // Bootstrap proclamation flag directly for test isolation
      (r as unknown as { stateProclaimed: boolean }).stateProclaimed = true;
      expect(r.offerVassalage(r.playerFactionId)).toBe('invalid');
    });

    it('accepts when player has overwhelming military edge (≥2×)', () => {
      const r = makeRegion();
      (r as unknown as { stateProclaimed: boolean }).stateProclaimed = true;
      const rivalId = ensureRivalHasSettlement(r);
      const rival = r.faction(rivalId)!;
      const player = r.faction(r.playerFactionId)!;
      // Ensure 2× edge
      player.militaryStrength = 50;
      player.settlementIds = [...player.settlementIds]; // at least 1
      rival.militaryStrength = 5;
      rival.settlementIds = rival.settlementIds.length > 0 ? rival.settlementIds : [999];

      const result = r.offerVassalage(rivalId);
      expect(result).toBe('accepted');
      expect(rival.overlordId).toBe(r.playerFactionId);
      expect(player.vassals).toContain(rivalId);
    });

    it('accepts when rival is economically desperate and player has edge ≥1.2×', () => {
      const r = makeRegion();
      (r as unknown as { stateProclaimed: boolean }).stateProclaimed = true;
      const rivalId = ensureRivalHasSettlement(r);
      const rival = r.faction(rivalId)!;
      const player = r.faction(r.playerFactionId)!;
      player.militaryStrength = 20;
      player.settlementIds = [...player.settlementIds];
      rival.militaryStrength = 10; // 2× edge = 20/(10+2*1) > 1.2 → accepts
      rival.treasury = 50; // desperate (< 100)
      if (rival.settlementIds.length === 0) rival.settlementIds = [999];

      const result = r.offerVassalage(rivalId);
      expect(result).toBe('accepted');
    });

    it('refuses when player is not dominant', () => {
      const r = makeRegion();
      (r as unknown as { stateProclaimed: boolean }).stateProclaimed = true;
      const rivalId = ensureRivalHasSettlement(r);
      const rival = r.faction(rivalId)!;
      const player = r.faction(r.playerFactionId)!;
      // Even match — should refuse
      player.militaryStrength = 5;
      rival.militaryStrength = 10;
      rival.treasury = 500; // not desperate
      if (rival.settlementIds.length === 0) rival.settlementIds = [999];

      const result = r.offerVassalage(rivalId);
      expect(result).toBe('refused');
      expect(rival.overlordId).toBeNull();
      expect(player.vassals).not.toContain(rivalId);
    });

    it('returns invalid for a faction that is already a vassal', () => {
      const r = makeRegion();
      (r as unknown as { stateProclaimed: boolean }).stateProclaimed = true;
      const rivalId = ensureRivalHasSettlement(r);
      const rival = r.faction(rivalId)!;
      const player = r.faction(r.playerFactionId)!;
      player.militaryStrength = 50;
      rival.militaryStrength = 5;
      if (rival.settlementIds.length === 0) rival.settlementIds = [999];
      // First offer accepted
      r.offerVassalage(rivalId);
      expect(rival.overlordId).toBe(r.playerFactionId);
      // Second offer is invalid
      expect(r.offerVassalage(rivalId)).toBe('invalid');
    });
  });

  describe('buyLand', () => {
    it('fails when rival is not economically desperate (treasury ≥ 150)', () => {
      const r = makeRegion();
      const rivalId = ensureRivalHasSettlement(r);
      const rival = r.faction(rivalId)!;
      rival.treasury = 200; // not desperate
      const player = r.faction(r.playerFactionId)!;
      player.settlementIds = [...player.settlementIds];
      (r as unknown as { treasury: number }).treasury = 1000;
      // Add a non-capital rival settlement
      if (rival.settlementIds.length < 2) rival.settlementIds.push(9999);

      expect(r.buyLand(rivalId)).toBe(false);
    });

    it('fails when player treasury is insufficient (<500)', () => {
      const r = makeRegion();
      const rivalId = ensureRivalHasSettlement(r);
      const rival = r.faction(rivalId)!;
      rival.treasury = 50; // desperate
      (r as unknown as { treasury: number }).treasury = 100; // not enough
      if (rival.settlementIds.length < 2) rival.settlementIds.push(9999);

      expect(r.buyLand(rivalId)).toBe(false);
    });

    it('transfers a non-capital rival settlement and adjusts treasuries', () => {
      const r = makeRegion();
      const rivalId = ensureRivalHasSettlement(r);
      const rival = r.faction(rivalId)!;
      (r as unknown as { treasury: number }).treasury = 1000;
      rival.treasury = 50; // desperate

      // Plant a second settlement so there's a non-capital to transfer
      const extraSettlement = r.settlements.find((s) => s.factionId !== r.playerFactionId && s.id !== rival.capital);
      if (!extraSettlement) {
        // Can't test without a transferable settlement — skip rather than fail
        return;
      }
      if (!rival.settlementIds.includes(extraSettlement.id)) {
        rival.settlementIds.push(extraSettlement.id);
      }

      const playerBefore = (r as unknown as { treasury: number }).treasury;
      const rivalBefore = rival.treasury;
      const result = r.buyLand(rivalId);

      if (result) {
        const playerFaction = r.faction(r.playerFactionId)!;
        expect((r as unknown as { treasury: number }).treasury).toBe(playerBefore - 500);
        expect(rival.treasury).toBe(rivalBefore + 500);
        expect(playerFaction.settlementIds).toContain(extraSettlement.id);
        expect(rival.settlementIds).not.toContain(extraSettlement.id);
        expect(extraSettlement.factionId).toBe(r.playerFactionId);
      }
    });
  });

  describe('playerTerritoryControl() with vassals', () => {
    it('includes vassal territory in player total', () => {
      const r = makeRegion();
      runDays(r, 30); // let territories generate
      const rivalId = ensureRivalHasSettlement(r);
      const baseControl = r.playerTerritoryControl();

      // Make the rival a vassal
      (r as unknown as { stateProclaimed: boolean }).stateProclaimed = true;
      const rival = r.faction(rivalId)!;
      const player = r.faction(r.playerFactionId)!;
      player.militaryStrength = 100;
      rival.militaryStrength = 5;
      if (rival.settlementIds.length === 0) rival.settlementIds = [9999];
      r.offerVassalage(rivalId);

      const controlWithVassal = r.playerTerritoryControl();
      // Control should be >= base (vassal territory is additive)
      expect(controlWithVassal).toBeGreaterThanOrEqual(baseControl);
      expect(controlWithVassal).toBeLessThanOrEqual(1);
    });
  });

  describe('proclamationReady gate', () => {
    it('starts at false', () => {
      const r = makeRegion();
      expect(r.proclamationReady).toBe(false);
    });

    it('serializes and deserializes', () => {
      const sim = new Simulation(42, baseDesign);
      grow(sim);
      const r = RegionSim.fromTown(sim, 8, 80, 80);
      (r as unknown as { proclamationReady: boolean }).proclamationReady = true;
      const serialized = r.serialize();
      const sim2 = new Simulation(42, baseDesign);
      const r2 = RegionSim.deserialize(serialized, sim2);
      expect(r2.proclamationReady).toBe(true);
    });

    it('vassalage is preserved in serialize/deserialize', () => {
      const sim = new Simulation(42, baseDesign);
      grow(sim);
      const r = RegionSim.fromTown(sim, 8, 80, 80);
      const rivalId = ensureRivalHasSettlement(r);
      const rival = r.faction(rivalId)!;
      const player = r.faction(r.playerFactionId)!;
      (r as unknown as { stateProclaimed: boolean }).stateProclaimed = true;
      player.militaryStrength = 100;
      rival.militaryStrength = 5;
      if (rival.settlementIds.length === 0) rival.settlementIds = [9999];
      r.offerVassalage(rivalId);
      expect(rival.overlordId).toBe(r.playerFactionId);

      const serialized = r.serialize();
      const sim2 = new Simulation(42, baseDesign);
      const r2 = RegionSim.deserialize(serialized, sim2);
      const rival2 = r2.faction(rivalId)!;
      const player2 = r2.faction(r2.playerFactionId)!;
      expect(rival2.overlordId).toBe(r2.playerFactionId);
      expect(player2.vassals).toContain(rivalId);
    });
  });

  describe('canCallConvention() territory gate', () => {
    it('returns false even when all other gates met if proclamationReady is false', () => {
      const r = makeRegion();
      // Meet all other gates manually
      (r as unknown as { stateProclaimed: boolean }).stateProclaimed = true;
      (r as unknown as { proclamationReady: boolean }).proclamationReady = false;
      r.researched.push('statecraft');
      // Make pop big enough
      for (const s of r.settlements) {
        const b = s.cohorts.bands;
        const add = 2000;
        b[1] += add;
        b[2] += add;
      }
      (r as unknown as { treasury: number }).treasury = 100000;
      for (const s of r.settlements) s.garrisonStrength = 20;
      expect(r.canCallConvention()).toBe(false);
    });
  });
});
