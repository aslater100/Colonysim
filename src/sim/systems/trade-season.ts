/**
 * The monthly trade season (GDD §5.2) — Track-C tick subsystems lifted to
 * fn(sim: RegionSim). Bodies VERBATIM (this.→sim.) ⇒ byte-identical RNG order
 * (guarded by serialize-determinism); dispatched monthly; state + serialize()
 * stay on RegionSim. (The parameter is `sim`, not `r`, because both loops bind
 * a route/leg to `r`.) `traders` clears markets on price margin; `caravans`
 * provisions hungry towns from surplus larders. Both are public entry points
 * tests/harness call directly.
 */
import type { RegionSim } from '../region';
import { TRADE_GOODS, type Settlement } from '../region';

/** Traders chase the widest margin across the route network, once a month. */
export function traders(sim: RegionSim): void {
    if (sim.settlements.length < 2) return;
    sim._routePathCache.clear(); // fresh route memo: this is also a direct test entry point
    let turnover = 0;
    for (const g of TRADE_GOODS) {
      // dearest market first: traders chase the widest margin
      const dear = [...sim.settlements].sort((a, b) => b.prices[g] - a.prices[g]);
      for (const buyer of dear) {
        // cheapest market that isn't the buyer — a linear scan, not a copy+sort per buyer
        let seller: Settlement | undefined;
        let sellerPrice = Infinity;
        for (const s of sim.settlements) {
          if (s === buyer) continue;
          if (s.prices[g] < sellerPrice) { sellerPrice = s.prices[g]; seller = s; }
        }
        if (!seller) continue;
        const legs = sim.routePath(seller.id, buyer.id);
        if (!legs || legs.length === 0) continue; // traders need a route
        const freightRate = 0.01 * legs.length; // £/unit per hop on the wagon
        const margin = buyer.prices[g] - seller.prices[g];
        if (margin <= freightRate * 1.5) continue; // not worth the trip
        const surplus = sim.stockOf(seller, g) - sim.monthNeed(seller, g);
        const capLeft = sim.legCapacity(legs);
        const volume = Math.min(surplus * 0.25, capLeft, 80);
        if (volume < 1) continue;
        sim.addStock(seller, g, -volume);
        sim.addStock(buyer, g, volume * 0.95); // handling and spillage
        for (const r of legs) r.freight += volume;
        turnover += volume * (seller.prices[g] + buyer.prices[g]) / 2;
        if (volume > 30 && sim.rng.chance(0.25)) {
          sim.addLog(`${g === 'food' ? 'Grain' : 'Timber'} is dear in ${buyer.name} — traders run the route from ${seller.name}.`, 'info');
        }
      }
    }
    sim.tradeValueLastMonth = turnover;
    if (turnover > 0) {
      // Free Trade policy removes the levy entirely; otherwise use the configured rate.
      const baseRate = sim.policyActive('free_trade') ? 0 : sim.tradeLevyRate;
      // Before the State exists the Mayor still collects market tolls on every
      // caravan — at a gentler rate — so connecting and trading between towns
      // visibly builds the treasury toward the Charter's economic gate.
      const effectiveLevyRate = sim.stateProclaimed ? baseRate : baseRate * 0.8;
      sim.treasury += turnover * effectiveLevyRate;
    }
  }

/** Grain caravans ride the route network (M6b): surplus towns provision
 *  hungry ones, but every leg clamps to its route's remaining capacity —
 *  a famine behind a goat trail is now possible, and fixable with money. */
export function caravans(sim: RegionSim): void {
    if (sim.settlements.length < 2) return;
    sim._routePathCache.clear(); // fresh route memo: this is also a direct test entry point
    for (const r of sim.routes) r.freight = 0;
    for (const needy of sim.settlements) {
      const need = sim.popOf(needy) * 0.75 * 20 - needy.food; // 20-day buffer target
      if (need <= 0) continue;
      // fullest larder in the same faction — a linear scan, not a copy+filter+sort per needy town
      let donor: Settlement | undefined;
      let donorFood = -Infinity;
      for (const t of sim.settlements) {
        if (t === needy || t.factionId !== needy.factionId) continue;
        if (t.food <= sim.popOf(t) * 0.75 * 60) continue;
        if (t.food > donorFood) { donorFood = t.food; donor = t; }
      }
      if (!donor) continue;
      const surplus = donor.food - sim.popOf(donor) * 0.75 * 60;
      const legs = sim.routePath(donor.id, needy.id);
      if (legs && legs.length > 0) {
        const cap = sim.legCapacity(legs);
        const sent = Math.max(0, Math.min(need, surplus, cap));
        if (sent <= 0) continue;
        donor.food -= sent;
        needy.food += sent * 0.9; // the road takes its tithe
        for (const r of legs) r.freight += sent;
        if (sent < Math.min(need, surplus) - 1 && sim.rng.chance(0.4)) {
          sim.addLog(`The route to ${needy.name} is choked — wagons turn back with grain still wanted.`, 'bad');
        } else if (sent > 40 && sim.rng.chance(0.4)) {
          sim.addLog(`Grain caravans roll from ${donor.name} to ${needy.name}.`, 'info');
        }
      } else {
        // No route at all: smugglers and peddlers move a trickle, at a price
        const sent = Math.min(need, surplus);
        if (sent <= 0) continue;
        donor.food -= sent;
        needy.food += sent * 0.3;
        if (sim.rng.chance(0.3)) {
          sim.addLog(`Peddlers carry what they can to ${needy.name} — no road reaches it.`, 'bad');
        }
      }
    }
  }
