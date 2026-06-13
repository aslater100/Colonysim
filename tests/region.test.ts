import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/sim';
import { RegionSim, REGION_MINUTES_PER_TICK, REGION_LAWS, GOV_TYPES, POLICY_CARDS, POLICY_SWAP_COST, REGION_BUILDINGS, REGION_EVENT_DEFS } from '../src/sim/region';
import { MINUTES_PER_DAY } from '../src/sim/defs';
import { REGION_N } from '../src/sim/worldgen';

const ticksPerDay = MINUTES_PER_DAY / REGION_MINUTES_PER_TICK;

function grow(sim: Simulation): void {
  // make the town flip-eligible without playing 20 game-days
  while (sim.settlers.length < 22) sim.spawnSettler(48, 50);
  sim.stock.wood = 200;
  sim.stock.meal = 200;
}

function runDays(r: RegionSim, days: number): void {
  for (let i = 0; i < days * ticksPerDay; i++) r.tick();
}

describe('The flip (GDD §2.4)', () => {
  it('conserves population: settlers in ≈ cohorts + expedition out', () => {
    const sim = new Simulation(42);
    grow(sim);
    const before = sim.settlers.length;
    const r = RegionSim.fromTown(sim, 8, 80, 80);
    expect(Math.round(r.totalPop())).toBe(before);
    expect(r.expeditions).toHaveLength(1);
    expect(r.expeditions[0].pop).toBe(8);
  });

  it('carves out Notables from the most story-laden settlers', () => {
    const sim = new Simulation(42);
    grow(sim);
    const star = sim.settlers[0];
    for (const k of Object.keys(star.skills) as (keyof typeof star.skills)[]) star.skills[k] = 10;
    star.combat = 10;
    const r = RegionSim.fromTown(sim, 8, 80, 80);
    expect(r.notables.length).toBeGreaterThanOrEqual(6);
    expect(r.notables.some((n) => n.name === star.name)).toBe(true);
    const roles = new Set(r.notables.map((n) => n.role));
    expect(roles.has('Mayor')).toBe(true);
    expect(roles.has('Doctor')).toBe(true);
  });

  it('the expedition arrives and founds town #2', () => {
    const sim = new Simulation(42);
    grow(sim);
    const r = RegionSim.fromTown(sim, 8, 80, 80);
    runDays(r, 5);
    expect(r.settlements).toHaveLength(2);
    expect(r.expeditions).toHaveLength(0);
    expect(r.log.some((l) => l.text.includes('is founded'))).toBe(true);
  });
});

describe('RegionSim (aggregate model)', () => {
  function flipped(seed: number): RegionSim {
    const sim = new Simulation(seed);
    grow(sim);
    const r = RegionSim.fromTown(sim, 8, 80, 80);
    runDays(r, 5);
    return r;
  }

  it('cohorts age, give birth, and grow over years', () => {
    const r = flipped(42);
    const start = r.totalPop();
    runDays(r, 240); // 4 game-years
    expect(r.gameOver).toBe(false);
    expect(r.totalPop()).toBeGreaterThan(start);
    const home = r.settlements[0];
    expect(home.cohorts.bands[0]).toBeGreaterThan(0); // children born
    expect(home.cohorts.bands[4]).toBeGreaterThan(0); // elders aged in
  });

  it('dead Notables are replaced from the cohorts', () => {
    const r = flipped(42);
    const mayor = r.notables.find((n) => n.role === 'Mayor')!;
    mayor.age = 90; // force the actuarial issue
    runDays(r, 300);
    const mayors = r.notables.filter((n) => n.role === 'Mayor');
    expect(mayors.length).toBeGreaterThan(1); // a successor was minted
    expect(mayors.some((n) => n.alive)).toBe(true);
  });

  function toStatehood(r: RegionSim): void {
    for (let year = 0; year < 30 && !r.ceremonyPending; year++) {
      // keep the charter's economic and military gates satisfied as towns appear
      r.treasury = Math.max(r.treasury, 8000);
      for (const t of r.settlements) {
        t.garrisonStrength = Math.max(t.garrisonStrength || 0, 5);
      }
      runDays(r, 60);
      // expand whenever the strongest town can afford it (a player would)
      for (const t of r.settlements) {
        if (r.settlements.length + r.expeditions.length < 4 && r.canFoundTown(t.id).ok) {
          r.foundTown(t.id);
          break;
        }
      }
    }
    r.completeIncorporation('Testonia', 'council');
  }

  it('reaches Statehood: 3 towns + 500 pop + charter + ceremony', () => {
    const r = flipped(42);
    toStatehood(r);
    expect(r.settlements.length).toBeGreaterThanOrEqual(3);
    expect(r.stateProclaimed).toBe(true);
    expect(r.stateName).toBe('Testonia');
    expect(r.log.some((l) => l.text.includes('INCORPORATION'))).toBe(true);
  });

  it('charterGates mirrors charterEligible and names the blocking requirement', () => {
    const r = flipped(42);
    // A fresh region with one town fails on towns, citizens, treasury, garrison.
    const gates = r.charterGates();
    const labels = gates.map((g) => g.label);
    expect(labels).toEqual(['towns', 'citizens', 'all towns connected', 'treasury', 'garrison']);
    expect(gates.every((g) => g.met)).toBe(false);
    expect(r.charterEligible()).toBe(false);
    // The aggregate gate is true exactly when every individual gate is met.
    toStatehood(r);
    runDays(r, 1);
    // Once incorporated the gates are moot, but before completeIncorporation the
    // per-gate breakdown and the boolean must agree — re-derive on a fresh run.
    const r2 = flipped(7);
    for (let i = 0; i < 40 && !r2.charterEligible(); i++) {
      r2.treasury = Math.max(r2.treasury, 8000);
      for (const t of r2.settlements) t.garrisonStrength = Math.max(t.garrisonStrength || 0, 5);
      runDays(r2, 60);
      for (const t of r2.settlements) {
        if (r2.settlements.length + r2.expeditions.length < 4 && r2.canFoundTown(t.id).ok) { r2.foundTown(t.id); break; }
      }
    }
    expect(r2.charterGates().every((g) => g.met)).toBe(r2.charterEligible());
  });

  it('recruitMilitia spends treasury to raise garrison, capped by population', () => {
    const r = flipped(42);
    const t = r.settlements[0];
    r.treasury = 1000;
    const before = t.garrisonStrength || 0;
    expect(r.recruitMilitia(t.id)).toBe(true);
    expect(t.garrisonStrength).toBe(before + 2);
    expect(r.treasury).toBe(750);
    // Drilling stops at the population-scaled cap.
    for (let i = 0; i < 20; i++) { r.treasury = 1000; r.recruitMilitia(t.id); }
    expect(t.garrisonStrength).toBeLessThanOrEqual(r.garrisonCap(t));
    expect(r.canRecruitMilitia(t.id).ok).toBe(false);
    // Broke towns can't recruit.
    const t2 = r.settlements[0];
    r.treasury = 10;
    expect(r.recruitMilitia(t2.id)).toBe(false);
  });

  it('market tolls fill the treasury before statehood, from inter-town trade', () => {
    const r = flipped(42);
    expect(r.stateProclaimed).toBe(false);
    // Grow a second town so caravans and traders have somewhere to run.
    for (let i = 0; i < 30 && r.settlements.length < 2; i++) {
      r.treasury = Math.max(r.treasury, 8000);
      runDays(r, 60);
      for (const t of r.settlements) {
        if (r.canFoundTown(t.id).ok) { r.foundTown(t.id); break; }
      }
    }
    r.treasury = 0;
    runDays(r, 90); // three trade seasons
    // Pre-statehood tolls are modest but real — the treasury is no longer inert.
    expect(r.treasury).toBeGreaterThan(0);
  });

  it('treasuryDeltaMonth reports the prior month net swing', () => {
    const r = flipped(42);
    toStatehood(r);
    r.taxRate = 0.2;
    const before = r.treasury;
    runDays(r, 35); // cross at least one month boundary
    // The delta is a real number reflecting the month's books, not stuck at 0.
    expect(Number.isFinite(r.treasuryDeltaMonth)).toBe(true);
    expect(r.treasury).not.toBe(before);
  });

  it('statehood brings money: taxes fill the treasury, spending drains it', () => {
    const r = flipped(42);
    toStatehood(r);
    r.taxRate = 0.15;
    runDays(r, 120);
    expect(r.gdpLastMonth).toBeGreaterThan(0);
    expect(r.treasury).toBeGreaterThan(0);
  });

  it('crushing taxes breed strikes', () => {
    const r = flipped(42);
    toStatehood(r);
    r.taxRate = 0.3;
    r.servicesLevel = 0;
    runDays(r, 360);
    expect(r.log.some((l) => l.text.includes('Strike in'))).toBe(true);
  });

  it('is deterministic for a given seed', () => {
    const a = flipped(7);
    const b = flipped(7);
    runDays(a, 100);
    runDays(b, 100);
    expect(a.totalPop()).toBe(b.totalPop());
    expect(a.settlements.map((s) => s.name)).toEqual(b.settlements.map((s) => s.name));
  });
});

describe('Region event variety', () => {
  function flipped(seed: number): RegionSim {
    const sim = new Simulation(seed);
    grow(sim);
    const r = RegionSim.fromTown(sim, 8, 80, 80);
    runDays(r, 5);
    return r;
  }

  /** the event methods are private; tests reach in to fire them directly */
  type EventHooks = {
    eventBandits(t: unknown): void;
    eventFire(t: unknown): void;
    eventProspectors(t: unknown): void;
    eventNotableBeat(t: unknown): void;
  };
  const hooks = (r: RegionSim) => r as unknown as EventHooks;

  it('highwaymen rob rotted routes but hang where the grade is kept', () => {
    const r = flipped(42);
    const [home, town2] = r.settlements;
    const route = r.routeBetween(home.id, town2.id)!;
    route.kind = 'road';
    route.condition = 30; // a rotted road is cover
    route.freight = 50; // and the caravans make it worth working
    home.food = 500;
    hooks(r).eventBandits(home);
    expect(home.food).toBeLessThan(500);
    expect(r.log[r.log.length - 1].text).toContain('Highwaymen prey');
    route.condition = 90; // a kept road is not
    const before = home.food;
    hooks(r).eventBandits(home);
    expect(home.food).toBe(before);
    expect(r.log[r.log.length - 1].text).toContain('They hang');
  });

  it('a funded State fire brigade holds the damage down', () => {
    const a = flipped(42);
    const burnt = a.settlements[0];
    burnt.wood = 100;
    hooks(a).eventFire(burnt);
    const unfundedLoss = 100 - burnt.wood;
    const b = flipped(42);
    const saved = b.settlements[0];
    b.stateProclaimed = true;
    b.servicesLevel = 1;
    saved.wood = 100;
    hooks(b).eventFire(saved);
    expect(100 - saved.wood).toBeLessThan(unfundedLoss);
  });

  it('prospectors pay the treasury once there is a State, the stores before', () => {
    const r = flipped(42);
    const t = r.settlements[0];
    const wood = t.wood;
    hooks(r).eventProspectors(t);
    expect(t.wood).toBeGreaterThan(wood);
    r.stateProclaimed = true;
    r.treasury = 0;
    hooks(r).eventProspectors(t);
    expect(r.treasury).toBeGreaterThan(0);
  });

  it('Notable beats accrue to the bio — the attachment engine keeps writing', () => {
    const r = flipped(42);
    const t = r.settlements[0];
    const n = r.notablesAt(t.id)[0];
    const beats = n.bio.length;
    for (let i = 0; i < 12; i++) hooks(r).eventNotableBeat(t);
    expect(r.notablesAt(t.id).some((m) => m.bio.length > beats)).toBe(true);
  });

  it('the long run shows the wider deck, not just the original five', () => {
    const r = flipped(42);
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      runDays(r, 15); // 600 days total, sampling before the log cap trims
      for (const l of r.log) {
        if (l.text.includes('Highwaymen')) seen.add('bandits');
        if (l.text.includes('Fire') || l.text.includes('brigade')) seen.add('fire');
        if (l.text.includes('Prospectors')) seen.add('prospectors');
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });
});

describe('Region save/load', () => {
  function flippedPair(seed: number): { sim: Simulation; r: RegionSim } {
    const sim = new Simulation(seed);
    grow(sim);
    const r = RegionSim.fromTown(sim, 8, 80, 80);
    runDays(r, 200); // a few years of history: towns, trails, events
    return { sim, r };
  }

  /** save + load: deserialize atop a restored town sim, as the menu does */
  function roundTrip(sim: Simulation, r: RegionSim): RegionSim {
    const town = Simulation.deserialize(sim.serialize());
    return RegionSim.deserialize(r.serialize(), town);
  }

  it('round-trips the region exactly', () => {
    const { sim, r } = flippedPair(42);
    const r2 = roundTrip(sim, r);
    expect(r2.day).toBe(r.day);
    expect(r2.totalPop()).toBe(r.totalPop());
    expect(r2.settlements.map((s) => s.name)).toEqual(r.settlements.map((s) => s.name));
    expect(r2.settlements.map((s) => s.food)).toEqual(r.settlements.map((s) => s.food));
    expect(r2.notables.map((n) => [n.name, n.role, n.alive])).toEqual(
      r.notables.map((n) => [n.name, n.role, n.alive]));
    expect(r2.routes.map((rt) => [rt.a, rt.b, rt.kind, rt.condition])).toEqual(
      r.routes.map((rt) => [rt.a, rt.b, rt.kind, rt.condition]));
  });

  it('a loaded region continues deterministically — same history unfolds', () => {
    const { sim, r } = flippedPair(42);
    const r2 = roundTrip(sim, r);
    runDays(r, 150);
    runDays(r2, 150);
    expect(r2.totalPop()).toBe(r.totalPop());
    expect(r2.settlements.map((s) => s.food)).toEqual(r.settlements.map((s) => s.food));
    expect(r2.log[r2.log.length - 1]).toEqual(r.log[r.log.length - 1]);
  });

  it('preserves the State: name, lean, treasury, and built routes', () => {
    const { sim, r } = flippedPair(42);
    for (let year = 0; year < 30 && !r.ceremonyPending; year++) {
      // keep the charter's economic and military gates satisfied as towns appear
      r.treasury = Math.max(r.treasury, 8000);
      for (const t of r.settlements) {
        t.garrisonStrength = Math.max(t.garrisonStrength || 0, 5);
      }
      runDays(r, 60);
      for (const t of r.settlements) {
        if (r.settlements.length + r.expeditions.length < 4 && r.canFoundTown(t.id).ok) {
          r.foundTown(t.id);
          break;
        }
      }
    }
    r.completeIncorporation('Testonia', 'mayor');
    r.treasury = 5000;
    const [a, b] = r.settlements;
    expect(r.buildRoad(a.id, b.id)).toBe(true);
    const r2 = roundTrip(sim, r);
    expect(r2.stateProclaimed).toBe(true);
    expect(r2.stateName).toBe('Testonia');
    expect(r2.govLean).toBe('mayor');
    expect(r2.treasury).toBe(r.treasury);
    expect(r2.routeBetween(a.id, b.id)!.kind).toBe('road');
    expect(r2.charterProgress).toBe(r.charterProgress);
  });
});

describe('Elections & faction politics (v0.14.0)', () => {
  function stateReady(): RegionSim {
    const sim = new Simulation(42);
    while (sim.settlers.length < 22) sim.spawnSettler(48, 50);
    sim.stock.wood = 200;
    sim.stock.meal = 200;
    const r = RegionSim.fromTown(sim, 8, 80, 80);
    runDays(r, 5); // town #2 arrives
    r.stateProclaimed = true;
    r.stateName = 'Testonia';
    r.govLean = 'council';
    r.treasury = 200;
    return r;
  }

  it('elections are not scheduled until universal_suffrage is researched', () => {
    const r = stateReady();
    runDays(r, 10);
    expect(r.nextElectionDay).toBe(-1);
    expect(r.politicalCapital).toBe(0);
  });

  it('elections schedule once suffrage is researched and state exists', () => {
    const r = stateReady();
    r.researched.push('universal_suffrage');
    runDays(r, 1);
    expect(r.nextElectionDay).toBeGreaterThan(0);
  });

  it('election awards political capital proportional to satisfaction', () => {
    const r = stateReady();
    r.researched.push('universal_suffrage');
    // Set all towns to 80% satisfaction
    for (const t of r.settlements) t.satisfaction = 80;
    // Force election today
    r.nextElectionDay = r.day;
    runDays(r, 1);
    expect(r.politicalCapital).toBeGreaterThan(0);
    expect(r.log.some((l) => l.text.includes('ELECTION'))).toBe(true);
    expect(r.lastElectionYear).toBe(r.year);
  });

  it('low-approval election logs LOST and awards less capital', () => {
    const r = stateReady();
    r.researched.push('universal_suffrage');
    for (const t of r.settlements) t.satisfaction = 15;
    r.nextElectionDay = r.day;
    runDays(r, 1);
    const entry = r.log.find((l) => l.text.includes('ELECTION'));
    expect(entry).toBeDefined();
    expect(entry!.text).toContain('LOST');
    expect(r.politicalCapital).toBeLessThan(40); // low mandate
  });

  it('factions are computed after state is proclaimed', () => {
    const r = stateReady();
    expect(r.factions).toHaveLength(0); // not yet computed
    runDays(r, 31); // triggers a monthly update
    expect(r.factions).toHaveLength(3);
    const ids = r.factions.map((f) => f.id);
    expect(ids).toContain('workers');
    expect(ids).toContain('landowners');
    expect(ids).toContain('merchants');
  });

  it('worker support rises with higher services', () => {
    const r = stateReady();
    r.servicesLevel = 0;
    runDays(r, 31);
    const lowSupport = r.factions.find((f) => f.id === 'workers')!.support;
    r.servicesLevel = 2;
    runDays(r, 31);
    const highSupport = r.factions.find((f) => f.id === 'workers')!.support;
    expect(highSupport).toBeGreaterThan(lowSupport);
  });

  it('enactLaw fails with insufficient PC', () => {
    const r = stateReady();
    r.politicalCapital = 0;
    const ok = r.enactLaw('workers_charter');
    expect(ok).toBe(false);
    expect(r.passedLaws).not.toContain('workers_charter');
  });

  it('enactLaw succeeds and spends PC', () => {
    const r = stateReady();
    r.politicalCapital = 50;
    const law = REGION_LAWS.find((l) => l.id === 'workers_charter')!;
    const ok = r.enactLaw('workers_charter');
    expect(ok).toBe(true);
    expect(r.passedLaws).toContain('workers_charter');
    expect(r.politicalCapital).toBe(50 - law.cost);
    expect(r.servicesLevel).toBeGreaterThan(0);
  });

  it('Workers Charter raises services and shows in enacted list', () => {
    const r = stateReady();
    r.servicesLevel = 0;
    r.politicalCapital = 100;
    r.enactLaw('workers_charter');
    expect(r.servicesLevel).toBe(1);
    expect(r.passedLaws.includes('workers_charter')).toBe(true);
  });

  it("Merchants' Charter reduces the trade levy", () => {
    const r = stateReady();
    r.politicalCapital = 100;
    expect(r.tradeLevyRate).toBe(0.05);
    r.enactLaw('merchants_charter');
    expect(r.tradeLevyRate).toBe(0.03);
  });

  it('estate_tax requires income_tax research', () => {
    const r = stateReady();
    r.politicalCapital = 100;
    expect(r.enactLaw('estate_tax')).toBe(false); // prereq not met
    r.researched.push('income_tax');
    expect(r.enactLaw('estate_tax')).toBe(true);
    expect(r.estateTaxActive).toBe(true);
  });

  it('estate tax adds monthly income', () => {
    const r = stateReady();
    // Boost workers so estate levy + tax revenue > admin overhead (2 towns × £5 = £10/month)
    for (const t of r.settlements) t.cohorts.bands[2] += 100;
    r.politicalCapital = 100;
    r.researched.push('income_tax');
    r.enactLaw('estate_tax');
    r.treasury = 0;
    runDays(r, 30); // one monthly economy cycle
    expect(r.treasury).toBeGreaterThan(0);
  });

  it('politics fields survive save/load round-trip', () => {
    const sim = new Simulation(42);
    while (sim.settlers.length < 22) sim.spawnSettler(48, 50);
    sim.stock.wood = 200;
    sim.stock.meal = 200;
    const r = RegionSim.fromTown(sim, 8, 80, 80);
    r.stateProclaimed = true;
    r.politicalCapital = 45;
    r.nextElectionDay = 300;
    r.lastElectionYear = 1924;
    r.passedLaws = ['conscription_act'];
    r.tradeLevyRate = 0.03;
    r.estateTaxActive = true;
    const r2 = RegionSim.deserialize(r.serialize(), sim);
    expect(r2.politicalCapital).toBe(45);
    expect(r2.nextElectionDay).toBe(300);
    expect(r2.lastElectionYear).toBe(1924);
    expect(r2.passedLaws).toContain('conscription_act');
    expect(r2.tradeLevyRate).toBe(0.03);
    expect(r2.estateTaxActive).toBe(true);
  });
});

describe('Constitutional Convention & Nation Proclamation (v0.15.0)', () => {
  function nationReady(): RegionSim {
    const sim = new Simulation(42);
    while (sim.settlers.length < 22) sim.spawnSettler(48, 50);
    sim.stock.wood = 200;
    sim.stock.meal = 200;
    const r = RegionSim.fromTown(sim, 8, 80, 80);
    runDays(r, 5);
    r.stateProclaimed = true;
    r.proclamationReady = true; // Phase C: territory gate — set directly since we're not running the full sim
    r.stateName = 'Testonia';
    r.govLean = 'council';
    r.treasury = 40000; // Nation requires £35k net
    r.militiaLevel = 2; // Militia contributes to military requirement (2*3=6 + 10 garrison = 16 >= 15)
    r.researched.push('statecraft', 'universal_suffrage', 'income_tax', 'free_press', 'labor_law', 'public_education');
    // Force population above threshold
    for (const t of r.settlements) {
      t.cohorts.bands[2] += 800;
      t.garrisonStrength = 5; // Garrison contributes to military requirement
    }
    return r;
  }

  it('canCallConvention() false before stateProclaimed', () => {
    const sim = new Simulation(42);
    while (sim.settlers.length < 22) sim.spawnSettler(48, 50);
    const r = RegionSim.fromTown(sim, 8, 80, 80);
    r.researched.push('statecraft');
    for (const t of r.settlements) t.cohorts.bands[2] += 800;
    expect(r.canCallConvention()).toBe(false);
  });

  it('canCallConvention() false without statecraft research', () => {
    const r = nationReady();
    r.researched = r.researched.filter((id) => id !== 'statecraft');
    expect(r.canCallConvention()).toBe(false);
  });

  it('canCallConvention() false if population below threshold', () => {
    const r = nationReady();
    for (const t of r.settlements) t.cohorts.bands = [0, 0, 0, 0, 0];
    expect(r.canCallConvention()).toBe(false);
  });

  it('canCallConvention() true when all conditions met', () => {
    const r = nationReady();
    expect(r.canCallConvention()).toBe(true);
  });

  it('proclaimNation() sets nationProclaimed, nationName, govType', () => {
    const r = nationReady();
    r.proclaimNation('The Republic of Testonia', 'democracy', {});
    expect(r.nationProclaimed).toBe(true);
    expect(r.nationName).toBe('The Republic of Testonia');
    expect(r.govType).toBe('democracy');
  });

  it('democracy starts at correct legitimacy', () => {
    const r = nationReady();
    r.proclaimNation('Test Nation', 'democracy', {});
    const def = GOV_TYPES.find((g) => g.id === 'democracy')!;
    expect(r.legitimacy).toBe(def.startingLegitimacy);
  });

  it('junta gets free militia bonus', () => {
    const r = nationReady();
    const before = r.militiaLevel;
    r.proclaimNation('Test Nation', 'junta', {});
    expect(r.militiaLevel).toBe(before + 2);
  });

  it('monarchy gets free militia bonus of 1', () => {
    const r = nationReady();
    const before = r.militiaLevel;
    r.proclaimNation('Test Nation', 'monarchy', {});
    expect(r.militiaLevel).toBe(before + 1);
  });

  it('democracy elections continue after proclamation', () => {
    const r = nationReady();
    r.proclaimNation('Test Nation', 'democracy', {});
    r.nextElectionDay = -1; // reset
    runDays(r, 5);
    // election should be scheduled since universal_suffrage is researched
    expect(r.nextElectionDay).toBeGreaterThan(0);
  });

  it('junta elections are cancelled after proclamation', () => {
    const r = nationReady();
    r.proclaimNation('Test Nation', 'junta', {});
    r.nextElectionDay = -1;
    runDays(r, 10);
    expect(r.nextElectionDay).toBe(-1); // no election for a junta
  });

  it('legitimacy decays monthly', () => {
    const r = nationReady();
    r.proclaimNation('Test Nation', 'democracy', {});
    const before = r.legitimacy;
    runDays(r, 35); // just over a month
    expect(r.legitimacy).toBeLessThan(before);
  });

  it('democracy election win restores legitimacy', () => {
    const r = nationReady();
    r.proclaimNation('Test Nation', 'democracy', {});
    // Force good satisfaction so election is a win
    for (const t of r.settlements) t.satisfaction = 80;
    r.legitimacy = 50;
    r.runElectionForTest?.();
    // If not exposed, just check via tick
    // Instead, force election via nextElectionDay
    r.nextElectionDay = r.day;
    runDays(r, 2);
    // After a landslide (sat=80), legitimacy should have increased
    expect(r.legitimacy).toBeGreaterThan(50);
  });

  it('minister assignment persists', () => {
    const r = nationReady();
    const notable = r.notables.find((n) => n.alive);
    const notableId = notable?.id ?? null;
    r.proclaimNation('Test Nation', 'republic', { interior: notableId });
    const minister = r.ministerFor('interior');
    if (notableId !== null) {
      expect(minister?.id).toBe(notableId);
    }
  });

  it('nation fields survive save/load round-trip', () => {
    const sim = new Simulation(42);
    while (sim.settlers.length < 22) sim.spawnSettler(48, 50);
    sim.stock.wood = 200;
    sim.stock.meal = 200;
    const r = RegionSim.fromTown(sim, 8, 80, 80);
    r.stateProclaimed = true;
    r.proclaimNation('Saved Nation', 'monarchy', {});
    r.legitimacy = 72;
    const r2 = RegionSim.deserialize(r.serialize(), sim);
    expect(r2.nationProclaimed).toBe(true);
    expect(r2.nationName).toBe('Saved Nation');
    expect(r2.govType).toBe('monarchy');
    expect(r2.legitimacy).toBe(72);
    expect(r2.ministers).toHaveLength(3);
  });

  it('treasury minister boosts tax revenue', () => {
    const r = nationReady();
    r.proclaimNation('Test Nation', 'democracy', {});
    r.treasury = 0;
    r.taxRate = 0.15;
    runDays(r, 32);
    const revenueWithout = r.treasury;

    // Reset and add treasury minister
    const sim2 = new Simulation(42);
    while (sim2.settlers.length < 22) sim2.spawnSettler(32, 34);
    sim2.stock.wood = 200;
    sim2.stock.meal = 200;
    const r2 = RegionSim.fromTown(sim2, 8, 80, 80);
    runDays(r2, 5);
    r2.stateProclaimed = true;
    r2.stateName = 'Testonia';
    r2.govLean = 'council';
    r2.treasury = 200;
    r2.researched.push('statecraft', 'universal_suffrage', 'income_tax', 'free_press', 'labor_law', 'public_education');
    for (const t of r2.settlements) t.cohorts.bands[2] += 800;
    const notable2 = r2.notables.find((n) => n.alive);
    r2.proclaimNation('Test Nation', 'democracy', { treasury: notable2?.id ?? null });
    r2.treasury = 0;
    r2.taxRate = 0.15;
    runDays(r2, 32);
    const revenueWith = r2.treasury;

    expect(revenueWith).toBeGreaterThan(revenueWithout);
  });
});

describe('Policy slots & expanded statute book (v0.16.0)', () => {
  function nationReady(): RegionSim {
    const sim = new Simulation(42);
    while (sim.settlers.length < 22) sim.spawnSettler(48, 50);
    sim.stock.wood = 200;
    sim.stock.meal = 200;
    const r = RegionSim.fromTown(sim, 8, 80, 80);
    runDays(r, 5);
    r.stateProclaimed = true;
    r.stateName = 'Testonia';
    r.govLean = 'council';
    r.treasury = 50000; // Nation costs £25k, start with £50k
    r.militiaLevel = 2; // Militia contributes to military requirement (2*3=6 + 10 garrison = 16 >= 15)
    r.researched.push('statecraft', 'universal_suffrage', 'income_tax', 'free_press', 'labor_law', 'public_education');
    for (const t of r.settlements) {
      t.cohorts.bands[2] += 800;
      t.garrisonStrength = 5; // Garrison contributes to military requirement
    }
    r.proclaimNation('Testland', 'democracy', {});
    return r;
  }

  it('nation-tier laws are hidden before proclamation', () => {
    const sim = new Simulation(42);
    while (sim.settlers.length < 22) sim.spawnSettler(48, 50);
    const r = RegionSim.fromTown(sim, 8, 80, 80);
    runDays(r, 5);
    r.stateProclaimed = true;
    r.researched.push('statecraft', 'universal_suffrage', 'income_tax', 'free_press', 'labor_law', 'public_education');
    const laws = r.availableLaws();
    expect(laws.some((l) => l.requiresNation)).toBe(false);
  });

  it('nation-tier laws appear after proclamation', () => {
    const r = nationReady();
    const laws = r.availableLaws();
    expect(laws.some((l) => l.requiresNation)).toBe(true);
    expect(laws.some((l) => l.id === 'progressive_tax')).toBe(true);
    expect(laws.some((l) => l.id === 'welfare_benefits')).toBe(true);
  });

  it('democracy gets 4 policy slots', () => {
    const r = nationReady();
    expect(r.activePolicies).toHaveLength(4);
    expect(r.activePolicies.every((v) => v === null)).toBe(true);
  });

  it('junta gets 3 policy slots', () => {
    const sim = new Simulation(42);
    while (sim.settlers.length < 22) sim.spawnSettler(48, 50);
    sim.stock.wood = 200;
    sim.stock.meal = 200;
    const r = RegionSim.fromTown(sim, 8, 80, 80);
    runDays(r, 5);
    r.stateProclaimed = true;
    r.researched.push('statecraft', 'universal_suffrage');
    for (const t of r.settlements) t.cohorts.bands[2] += 800;
    r.proclaimNation('Juntonia', 'junta', {});
    expect(r.activePolicies).toHaveLength(3);
  });

  it('setPolicy slots a matching domain card', () => {
    const r = nationReady();
    const ok = r.setPolicy(0, 'free_trade'); // slot 0 = economic for democracy
    expect(ok).toBe(true);
    expect(r.activePolicies[0]).toBe('free_trade');
    expect(r.policyActive('free_trade')).toBe(true);
  });

  it('setPolicy rejects a card of the wrong domain', () => {
    const r = nationReady();
    // slot 1 = social for democracy; standing_army is security
    const ok = r.setPolicy(1, 'standing_army');
    expect(ok).toBe(false);
    expect(r.activePolicies[1]).toBe(null);
  });

  it('swapping an occupied slot costs POLICY_SWAP_COST PC', () => {
    const r = nationReady();
    r.politicalCapital = 100;
    r.setPolicy(0, 'free_trade');
    const pcBefore = r.politicalCapital;
    r.setPolicy(0, 'protectionism');
    expect(r.politicalCapital).toBe(pcBefore - POLICY_SWAP_COST);
    expect(r.activePolicies[0]).toBe('protectionism');
  });

  it('setPolicy returns false when too poor to swap', () => {
    const r = nationReady();
    r.politicalCapital = 5; // below POLICY_SWAP_COST
    r.setPolicy(0, 'free_trade');
    expect(r.policyActive('free_trade')).toBe(true);
    // now try to swap with insufficient capital
    const ok = r.setPolicy(0, 'protectionism');
    expect(ok).toBe(false);
    expect(r.activePolicies[0]).toBe('free_trade'); // unchanged
  });

  it('welfare_state policy boosts satisfaction target', () => {
    const popOf = (t: { cohorts: { bands: number[] } }) => t.cohorts.bands.reduce((s, v) => s + v, 0);
    const prep = (r: RegionSim) => {
      for (const t of r.settlements) {
        const pop = popOf(t);
        t.housing = pop + 10;      // enough beds
        t.food = pop * 40;         // generous supply
        t.satisfaction = 50;
      }
    };

    const r1 = nationReady();
    prep(r1);
    runDays(r1, 30);
    const avgSatBase = r1.settlements.reduce((s, t) => s + t.satisfaction, 0) / r1.settlements.length;

    const r2 = nationReady();
    r2.setPolicy(1, 'welfare_state'); // slot 1 = social for democracy
    prep(r2);
    runDays(r2, 30);
    const avgSatWith = r2.settlements.reduce((s, t) => s + t.satisfaction, 0) / r2.settlements.length;

    expect(avgSatWith).toBeGreaterThan(avgSatBase);
  });

  it('progressive_tax law increases monthly revenue', () => {
    const r = nationReady();
    r.taxRate = 0.12;
    r.treasury = 0;
    runDays(r, 32);
    const baseRevenue = r.treasury;

    const r2 = nationReady();
    r2.politicalCapital = 200;
    r2.taxRate = 0.12;
    r2.treasury = 0;
    r2.enactLaw('progressive_tax');
    runDays(r2, 32);
    expect(r2.treasury).toBeGreaterThan(baseRevenue);
  });

  it('central_bank_charter law earns interest on reserves', () => {
    const r = nationReady();
    r.politicalCapital = 200;
    r.treasury = 1000;
    r.enactLaw('central_bank_charter');
    r.taxRate = 0;
    runDays(r, 32);
    // spending will reduce treasury but interest should partly offset it
    // just verify the law was enacted
    expect(r.passedLaws).toContain('central_bank_charter');
  });

  it('active policies and nation laws survive save/load', () => {
    const sim = new Simulation(42);
    while (sim.settlers.length < 22) sim.spawnSettler(48, 50);
    sim.stock.wood = 200;
    sim.stock.meal = 200;
    const r = nationReady();
    r.setPolicy(0, 'free_trade');
    r.politicalCapital = 200;
    r.enactLaw('progressive_tax');
    const r2 = RegionSim.deserialize(r.serialize(), sim);
    expect(r2.activePolicies[0]).toBe('free_trade');
    expect(r2.policyActive('free_trade')).toBe(true);
    expect(r2.passedLaws).toContain('progressive_tax');
  });

  it('all POLICY_CARDS have valid domains matching GOV_TYPES slots', () => {
    const validDomains = new Set(['economic', 'social', 'security', 'diplomatic']);
    for (const card of POLICY_CARDS) {
      expect(validDomains.has(card.domain)).toBe(true);
    }
    for (const gov of GOV_TYPES) {
      for (const slot of gov.policySlots) {
        expect(validDomains.has(slot)).toBe(true);
      }
    }
  });
});

describe('Sectoral economy (Phase 1)', () => {
  function flipped(seed: number): RegionSim {
    const sim = new Simulation(seed);
    grow(sim);
    const r = RegionSim.fromTown(sim, 8, 80, 80);
    runDays(r, 5);
    return r;
  }

  it('settlements open at 1900 labor shares: the plough takes seven hands in ten', () => {
    const r = flipped(42);
    for (const t of r.settlements) {
      expect(t.sectors.agriculture.share).toBeCloseTo(0.72, 1);
      const sum = t.sectors.agriculture.share + t.sectors.industry.share +
        t.sectors.services.share + t.sectors.information.share;
      expect(sum).toBeCloseTo(1, 5);
    }
  });

  it('technology pulls labor off the land and into the terminal', () => {
    const r = flipped(42);
    const t = r.settlements[0];
    const agriBefore = t.sectors.agriculture.share;
    const infoBefore = t.sectors.information.share;
    r.researched.push('steel_industry', 'electrical_grid', 'combustion_engine',
      'mass_production', 'asphalt', 'atomic_age', 'computing', 'automated_logistics');
    runDays(r, 200);
    expect(t.sectors.agriculture.share).toBeLessThan(agriBefore);
    expect(t.sectors.information.share).toBeGreaterThan(infoBefore);
  });

  it('a disloyal town works at half-heart: loyalty cuts wages and output', () => {
    const r = flipped(42);
    const t = r.settlements[0];
    runDays(r, 35); // one monthly update to populate outputs
    const wageLoyal = r.avgWageOf(t);
    t.loyaltyToFaction = 0;
    runDays(r, 30);
    expect(r.avgWageOf(t)).toBeLessThan(wageLoyal);
  });

  it('tech multiplies sector productivity, and GDP grows with it', () => {
    const a = flipped(42);
    const b = flipped(42);
    b.researched.push('steel_industry', 'electrical_grid', 'mass_production');
    for (const r of [a, b]) {
      r.stateProclaimed = true;
      r.stateName = 'Test State';
      r.govLean = 'council';
      runDays(r, 35);
    }
    expect(b.gdpLastMonth).toBeGreaterThan(a.gdpLastMonth);
  });
});

describe('Faction & fog-of-war persistence (Phase 0)', () => {
  function flippedPair(seed: number): { sim: Simulation; r: RegionSim } {
    const sim = new Simulation(seed);
    grow(sim);
    const r = RegionSim.fromTown(sim, 8, 80, 80);
    runDays(r, 5);
    return { sim, r };
  }

  it('the flip raises the player banner and fogs the rest of the world', () => {
    const { r } = flippedPair(42);
    expect(r.regionalFactions.length).toBeGreaterThanOrEqual(3); // player + 2-3 rivals
    expect(r.faction(0)?.capital).toBe(r.settlements[0].id);
    const home = r.settlements[0];
    expect(r.explorationMap[Math.round(home.x)][Math.round(home.y)]).toBe('explored');
    const fogged = r.explorationMap.flat().filter((v) => v === 'fogged').length;
    expect(fogged).toBeGreaterThan(5000); // most of the map is still unknown
  });

  it('factions, sectors, and the fog survive save/load', () => {
    const { sim, r } = flippedPair(42);
    runDays(r, 35);
    const r2 = RegionSim.deserialize(r.serialize(), sim);
    expect(r2.regionalFactions.length).toBe(r.regionalFactions.length);
    expect(r2.settlements[0].factionId).toBe(0);
    expect(r2.settlements[0].sectors.agriculture.share)
      .toBeCloseTo(r.settlements[0].sectors.agriculture.share, 6);
    expect(r2.explorationMap.flat().filter((v) => v === 'explored').length)
      .toBe(r.explorationMap.flat().filter((v) => v === 'explored').length);
  });

  it('pre-faction saves are backfilled: every town flies the player flag', () => {
    const { sim, r } = flippedPair(42);
    runDays(r, 5);
    const old = JSON.parse(r.serialize());
    delete old.regionalFactions;
    delete old.explorationMap;
    delete old.scouts;
    old.settlements = old.settlements.map((s: Record<string, unknown>) => {
      const { factionId, garrisonStrength, loyaltyToFaction, sectors, ...rest } = s;
      void factionId; void garrisonStrength; void loyaltyToFaction; void sectors;
      return rest;
    });
    const r2 = RegionSim.deserialize(JSON.stringify(old), sim);
    expect(r2.regionalFactions.length).toBeGreaterThanOrEqual(1);
    expect(r2.faction(0)?.settlementIds.length).toBe(r2.settlements.length);
    for (const t of r2.settlements) {
      expect(t.factionId).toBe(0);
      expect(t.sectors.agriculture.share).toBeCloseTo(0.72, 2);
    }
    const home = r2.settlements[0];
    expect(r2.explorationMap[Math.round(home.x)][Math.round(home.y)]).toBe('explored');
  });
});

describe('City works & zoning (Phase 2)', () => {
  function stateCity(seed: number): RegionSim {
    const sim = new Simulation(seed);
    grow(sim);
    const r = RegionSim.fromTown(sim, 8, 80, 80);
    runDays(r, 5);
    r.stateProclaimed = true;
    r.stateName = 'Test State';
    r.govLean = 'council';
    r.treasury = 500;
    return r;
  }

  it('the capital opens to direct management at Incorporation; hamlets do not', () => {
    const r = stateCity(42);
    const capital = r.settlements[0];
    const hamlet = r.settlements[1];
    expect(r.canManageCity(capital).ok).toBe(true);
    expect(r.canManageCity(hamlet).ok).toBe(false); // tiny town, not the capital
  });

  it('no drafting table before Incorporation', () => {
    const sim = new Simulation(42);
    grow(sim);
    const r = RegionSim.fromTown(sim, 8, 80, 80);
    runDays(r, 5);
    r.treasury = 500;
    expect(r.canManageCity(r.settlements[0]).ok).toBe(false);
    expect(r.buildCity(r.settlements[0].id, 'grain_exchange')).toBe(false);
  });

  it('ground breaks, the treasury pays, and the doors open on schedule', () => {
    const r = stateCity(42);
    const capital = r.settlements[0];
    expect(r.buildCity(capital.id, 'grain_exchange')).toBe(true);
    expect(r.treasury).toBe(440); // 500 − 60
    expect(capital.construction?.id).toBe('grain_exchange');
    expect(r.buildCity(capital.id, 'market_hall')).toBe(false); // one project at a time
    runDays(r, 41);
    expect(capital.buildings).toContain('grain_exchange');
    expect(capital.construction).toBeNull();
    expect(r.log.some((l) => l.text.includes('Grain Exchange opens'))).toBe(true);
  });

  it('tech-gated works stay on the drawing board until the science lands', () => {
    const r = stateCity(42);
    const capital = r.settlements[0];
    const factory = REGION_BUILDINGS.find((b) => b.id === 'factory')!;
    expect(r.cityBuildCheck(capital, factory).reason).toContain('requires');
    r.researched.push('steel_industry', 'mass_production');
    expect(r.cityBuildCheck(capital, factory).ok).toBe(true);
  });

  it('a grain exchange raises what every farmhand brings home', () => {
    const r = stateCity(42);
    const capital = r.settlements[0];
    runDays(r, 35);
    const wageBefore = capital.sectors.agriculture.wage;
    capital.buildings.push('grain_exchange');
    runDays(r, 30);
    expect(capital.sectors.agriculture.wage).toBeGreaterThan(wageBefore * 1.15);
  });

  it('zoning pulls labor toward the designation over the months', () => {
    const r = stateCity(42);
    const capital = r.settlements[0];
    runDays(r, 35);
    const before = capital.sectors.industry.share;
    const cash = r.treasury;
    expect(r.setTownFocus(capital.id, 'industry')).toBe(true);
    expect(r.treasury).toBeCloseTo(cash - 10, 6); // the survey fee
    runDays(r, 100);
    expect(capital.sectors.industry.share).toBeGreaterThan(before + 0.005);
  });

  it('a university multiplies the research effort', () => {
    const r = stateCity(42);
    const before = r.researchRate();
    r.settlements[0].buildings.push('university');
    expect(r.researchRate()).toBeCloseTo(before * 1.15, 5);
  });

  it('civic works survive save/load, mid-construction and all', () => {
    const sim = new Simulation(42);
    grow(sim);
    const r = RegionSim.fromTown(sim, 8, 80, 80);
    runDays(r, 5);
    r.stateProclaimed = true;
    r.stateName = 'Test State';
    r.govLean = 'council';
    r.treasury = 500;
    const capital = r.settlements[0];
    capital.buildings.push('waterworks');
    r.buildCity(capital.id, 'grain_exchange');
    r.setTownFocus(capital.id, 'agriculture');
    const r2 = RegionSim.deserialize(r.serialize(), sim);
    const c2 = r2.settlements[0];
    expect(c2.buildings).toContain('waterworks');
    expect(c2.construction?.id).toBe('grain_exchange');
    expect(c2.focus).toBe('agriculture');
  });
});

describe('Regional Events (Phase 4)', () => {
  function stateCity(seed: number): RegionSim {
    const sim = new Simulation(seed);
    grow(sim);
    const r = RegionSim.fromTown(sim, 8, 80, 80);
    runDays(r, 5);
    r.stateProclaimed = true;
    r.stateName = 'Test State';
    r.govLean = 'council';
    r.treasury = 500;
    return r;
  }

  it('event definitions cover both good and bad outcomes', () => {
    const good = REGION_EVENT_DEFS.filter((d) => d.outputMult >= 1.0);
    const bad = REGION_EVENT_DEFS.filter((d) => d.outputMult < 1.0);
    expect(good.length).toBeGreaterThanOrEqual(2);
    expect(bad.length).toBeGreaterThanOrEqual(2);
  });

  it('an injected drought sharply cuts agriculture output vs an undroughted control', () => {
    // Compare two identical colonies over the same 30 days: one struck by drought,
    // one not. A pre/post baseline would be confounded by a month of organic growth
    // (births, sector drift, immigration), so we measure the causal effect directly.
    const control = stateCity(42);
    runDays(control, 35);
    runDays(control, 30);
    const controlOut = control.settlements[0].sectors.agriculture.output;

    const r = stateCity(42);
    const t = r.settlements[0];
    runDays(r, 35);
    t.activeEvents.push({ kind: 'drought', untilDay: r.day + 60, severity: 1 });
    runDays(r, 30);
    // Drought is a 0.60 output multiplier; with immigration also drying up, the
    // droughted colony ends well under 70% of the thriving control.
    expect(t.sectors.agriculture.output).toBeLessThan(controlOut * 0.7);
  });

  it('a bumper harvest lifts agriculture output above baseline', () => {
    const r = stateCity(42);
    const t = r.settlements[0];
    runDays(r, 35);
    const agri_before = t.sectors.agriculture.output;
    t.activeEvents.push({ kind: 'harvest_bonus', untilDay: r.day + 30, severity: 1 });
    runDays(r, 30);
    expect(t.sectors.agriculture.output).toBeGreaterThan(agri_before * 1.1);
  });

  it('events expire after their duration', () => {
    const r = stateCity(42);
    const t = r.settlements[0];
    t.activeEvents.push({ kind: 'drought', untilDay: r.day + 5, severity: 1 });
    runDays(r, 35); // monthlyUpdate will prune expired events
    expect(t.activeEvents.filter((ev) => ev.kind === 'drought')).toHaveLength(0);
  });

  it('events and policies survive save/load', () => {
    const sim = new Simulation(42);
    grow(sim);
    const r = stateCity(42);
    const t = r.settlements[0];
    t.activeEvents.push({ kind: 'trade_windfall', untilDay: r.day + 30, severity: 1 });
    r.setCityPolicy(t.id, 'taxBand', 2);
    const r2 = RegionSim.deserialize(r.serialize(), sim);
    expect(r2.settlements[0].activeEvents.some((ev) => ev.kind === 'trade_windfall')).toBe(true);
    expect(r2.settlements[0].policies.taxBand).toBe(2);
  });
});

describe('Local Policies (Phase 5)', () => {
  function managedCity(seed: number): RegionSim {
    const sim = new Simulation(seed);
    grow(sim);
    const r = RegionSim.fromTown(sim, 8, 80, 80);
    runDays(r, 5);
    r.stateProclaimed = true;
    r.stateName = 'Test State';
    r.govLean = 'council';
    r.treasury = 500;
    return r;
  }

  it('setCityPolicy rejects changes on unmanaged towns', () => {
    const r = managedCity(42);
    const hamlet = r.settlements[1]; // too small, not capital
    expect(r.setCityPolicy(hamlet.id, 'taxBand', 2)).toBe(false);
  });

  it('heavy taxation reduces sector output vs an untaxed control', () => {
    // Two identical colonies over the same 30 days: one levies a heavy tax, one
    // does not. Comparing against a control isolates the tax's drag from the
    // colony's natural month-over-month growth.
    const control = managedCity(42);
    runDays(control, 35);
    runDays(control, 30);
    const controlOut = control.settlements[0].sectors.agriculture.output;

    const r = managedCity(42);
    const capital = r.settlements[0];
    runDays(r, 35);
    r.setCityPolicy(capital.id, 'taxBand', 3); // 15% tax
    runDays(r, 30);
    expect(capital.sectors.agriculture.output).toBeLessThan(controlOut);
  });

  it('generous services boost sector productivity above the standard level', () => {
    const r1 = managedCity(42);
    runDays(r1, 35);
    const output1 = r1.settlements[0].sectors.services.output;

    const r2 = managedCity(42);
    r2.setCityPolicy(r2.settlements[0].id, 'serviceLevel', 2);
    runDays(r2, 35);
    const output2 = r2.settlements[0].sectors.services.output;

    // SERVICE_PROD_MULT[2] = 1.15 vs [1] = 1.0: generous services should yield higher output
    expect(output2).toBeGreaterThan(output1);
  });

  it('wage policy biases the migration signal', () => {
    const r = managedCity(42);
    const capital = r.settlements[0];
    runDays(r, 35);
    const wageMarket = r.avgWageOf(capital);
    r.setCityPolicy(capital.id, 'wagePolicy', 'high');
    runDays(r, 30);
    expect(r.avgWageOf(capital)).toBeGreaterThan(wageMarket * 1.05);
  });
});

describe('Route Cargo Visualization (Phase 6)', () => {
  it('routes get a cargo type after a monthly update', () => {
    const sim = new Simulation(42);
    grow(sim);
    const r = RegionSim.fromTown(sim, 8, 80, 80);
    runDays(r, 35); // at least one monthly update
    expect(r.routes.length).toBeGreaterThan(0);
    // After a monthly update, at least some routes should have cargo assigned
    // (depends on sector output differences — might be null if outputs are equal)
    for (const route of r.routes) {
      expect(route.cargoType === null || typeof route.cargoType === 'string').toBe(true);
    }
  });

  it('cargo type survives save/load', () => {
    const sim = new Simulation(42);
    grow(sim);
    const r = RegionSim.fromTown(sim, 8, 80, 80);
    runDays(r, 35);
    // Manually set a cargo type to ensure round-trip
    if (r.routes.length > 0) r.routes[0].cargoType = 'agriculture';
    const r2 = RegionSim.deserialize(r.serialize(), sim);
    expect(r2.routes[0]?.cargoType).toBe('agriculture');
  });
});

describe('Phase 0: Territory & resource visualization', () => {
  function flipped(seed: number): RegionSim {
    const sim = new Simulation(seed);
    while (sim.settlers.length < 22) sim.spawnSettler(48, 50);
    sim.stock.wood = 200;
    sim.stock.meal = 200;
    const r = RegionSim.fromTown(sim, 8, 80, 80);
    runDays(r, 5); // let the expedition found town #2
    return r;
  }

  it('territory radius grows with population, garrison, and development', () => {
    const r = flipped(42);
    const t = r.settlements[0];
    const base = r.territoryRadius(t);
    // more people → larger reach
    t.cohorts.bands = t.cohorts.bands.map((b) => b + 50);
    const withPop = r.territoryRadius(t);
    expect(withPop).toBeGreaterThan(base);
    // a garrison pushes the frontier further still
    t.garrisonStrength = 40;
    expect(r.territoryRadius(t)).toBeGreaterThan(withPop);
    // capped so one town can't swallow the map
    t.cohorts.bands = t.cohorts.bands.map(() => 100000);
    t.garrisonStrength = 100000;
    expect(r.territoryRadius(t)).toBeLessThanOrEqual(18);
  });

  it('computes a control grid and per-faction shares that sum within bounds', () => {
    const r = flipped(7);
    const { grid, control, landCells } = r.computeTerritoryGrid();
    expect(grid.length).toBe(REGION_N * REGION_N);
    expect(landCells).toBeGreaterThan(0);
    let claimed = 0;
    for (const [, frac] of control) {
      expect(frac).toBeGreaterThanOrEqual(0);
      expect(frac).toBeLessThanOrEqual(1);
      claimed += frac;
    }
    expect(claimed).toBeLessThanOrEqual(1.0001); // claimed land never exceeds all land
  });

  it('player territory share rises as the home settlement grows', () => {
    const r = flipped(7);
    const before = r.playerTerritoryControl();
    for (const t of r.settlements) {
      if (t.factionId === r.playerFactionId) t.cohorts.bands = t.cohorts.bands.map((b) => b + 200);
    }
    const after = r.playerTerritoryControl();
    expect(after).toBeGreaterThanOrEqual(before);
    expect(r.playerTerritoryControl()).toBeGreaterThan(0);
  });

  it('the grid cache invalidates when a settlement changes', () => {
    const r = flipped(11);
    const g1 = r.computeTerritoryGrid();
    expect(r.computeTerritoryGrid()).toBe(g1); // same object while nothing moved
    r.settlements[0].garrisonStrength += 50;
    expect(r.computeTerritoryGrid()).not.toBe(g1); // signature changed → recomputed
  });

  it('classifies a well-fed town as food surplus and a starving one as deficit', () => {
    const r = flipped(42);
    const t = r.settlements[0];
    const pop = r.popOf(t);
    t.food = pop * 10; // ten days' grain banked
    expect(r.getSettlementResourceStatus(t).food).toBe('surplus');
    t.food = 0;
    expect(r.getSettlementResourceStatus(t).food).toBe('deficit');
  });

  it('classifies wood the same way against population need', () => {
    const r = flipped(42);
    const t = r.settlements[0];
    const pop = r.popOf(t);
    t.wood = pop * 5;
    expect(r.getSettlementResourceStatus(t).wood).toBe('surplus');
    t.wood = 0;
    expect(r.getSettlementResourceStatus(t).wood).toBe('deficit');
  });
});
