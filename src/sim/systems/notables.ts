/**
 * Notables lifecycle (GDD §2.4) — the twelfth `region.ts` tick subsystem lifted to the
 * Track-C free-function form `fn(r: RegionSim)`. See systems/pollution.ts for the
 * rationale: the body runs VERBATIM against the same RegionSim so the RNG-consumption
 * order is byte-identical (auxRng for health degradation, rng for mortality / heirs /
 * minister defection / scandal — in that exact order), `tick()` dispatches, and all
 * state + serialize() stay on RegionSim. Guarded by tests/serialize-determinism.
 *
 * The helpers it drives — mintNotable (vacancy fill / heir birth) and selectSuccessor
 * (minister replacement) — stay on RegionSim and are reached through `r`; mintNotable
 * was made public for this seam.
 */
import type { RegionSim } from '../region';

export function tickNotableLifecycle(r: RegionSim): void {
    // --- age, health degradation, death ---
    for (const n of r.notables) {
      if (!n.alive) continue;
      n.age += 1 / 12;

      // Health degrades monthly (scaled from annual rates). Seeded (auxRng), not
      // Math.random — a notable's health is serialized, so a non-deterministic
      // draw made the save non-reproducible for a fixed seed.
      const healthDecay = (r.auxRng.next() * 2 + (n.age > 70 ? 3 : 0)) / 12;
      n.health = Math.max(0, (n.health ?? 80) - healthDecay);

      // Death risk blended from age-based mortality and health
      const annualRisk = n.age > 75 ? 0.12 : n.age > 60 ? 0.03 : 0.004;
      const healthRisk = n.health < 20 ? 0.08 : n.health < 40 ? 0.02 : 0;
      if (r.rng.chance((annualRisk + healthRisk) / 12)) {
        n.alive = false;
        n.deathYear = r.year;
        n.bio.push(`Died ${r.year}, aged ${Math.floor(n.age)}.`);
        r.addLog(`${n.name}, ${n.role} of ${r.settlement(n.settlementId)?.name ?? 'the colony'}, has died, aged ${Math.floor(n.age)}.`, 'bad');
        // If minister, select a successor
        const mIdx = r.ministers.findIndex((m) => m.notableId === n.id);
        if (mIdx >= 0) {
          r.selectSuccessor(mIdx);
        } else {
          r.mintNotable(n.role, n.settlementId);
        }
      }
    }

    // --- birth of heirs (5% annual = ~0.417%/month) ---
    const alive = r.notables.filter((n) => n.alive);
    for (const n of alive) {
      if (n.age >= 25 && n.age <= 50 && r.rng.chance(0.05 / 12)) {
        const child = r.mintNotable(n.role, n.settlementId, { parentId: n.id, age: 0 });
        child.bio = [`Born to ${n.name}, ${r.year}.`];
        child.age = 0;
        n.children = n.children ?? [];
        n.children.push(child.id);
        r.addLog(`${n.name} welcomes a child, ${child.name}, born ${r.year}.`, 'info');
      }
    }

    // --- minister loyalty decay and defection ---
    if (r.nationProclaimed) {
      for (const m of r.ministers) {
        if (m.notableId === null) continue;
        const notable = r.notables.find((n) => n.id === m.notableId && n.alive);
        if (!notable) continue;

        // Loyalty decays 0.5/month for all ministers
        notable.loyalty = Math.max(0, (notable.loyalty ?? 80) - 0.5);
        notable.monthsIgnored = (notable.monthsIgnored ?? 0) + 1;

        // Defection: loyalty < 20 and 5% annual = ~0.4%/month chance
        if ((notable.loyalty ?? 80) < 20 && r.rng.chance(0.05 / 12)) {
          const mIdx = r.ministers.indexOf(m);
          r.addLog(`${notable.name}, ${m.title}, has defected — disillusioned with the government.`, 'bad');
          r.legitimacy = Math.max(0, r.legitimacy - 5);
          // Boost rival faction power if one exists
          const factionId = notable.factionAlignment ?? 'workers';
          const rivalFaction = r.factions?.find((f) => f.id === factionId);
          if (rivalFaction) rivalFaction.support = Math.min(100, (rivalFaction.support ?? 0) + 8);
          m.notableId = null;
          r.selectSuccessor(mIdx);
        }
      }

      // --- scandal: 2% annual per minister in role 5+ years (~0.17%/month) ---
      for (const m of r.ministers) {
        if (m.notableId === null) continue;
        const notable = r.notables.find((n) => n.id === m.notableId && n.alive);
        if (!notable) continue;
        const yearsInRole = r.year - (notable.yearEnteredRole ?? r.year);
        if (yearsInRole >= 5 && r.rng.chance(0.02 / 12)) {
          r.legitimacy = Math.max(0, r.legitimacy - 3);
          // Reduce satisfaction in notable's home settlement
          const t = r.settlement(notable.settlementId);
          if (t) t.satisfaction = Math.max(0, (t.satisfaction ?? 50) - 5);
          r.addLog(`SCANDAL: ${notable.name}, ${m.title}, embroiled in scandal. Public trust shaken.`, 'bad');
        }
      }
    }
  }
