/**
 * Wolves — periodic predator packs that prowl a `TownCore` colony (build-system
 * B-6 parity port).
 *
 * The fat-object `Simulation` spawns wolf packs that slip in from a map edge,
 * stalk the nearest stray settler (or deer), maul whoever they catch, and slink
 * back to the treeline after a couple of days or once mauled (see `sim.ts`
 * `spawnWolfPack` / `updateWolf`). That fidelity rides on the tile world, A*
 * paths and the deer herd — none of which the SoA core has. This module is the
 * same threat at the core's altitude, deliberately a smaller sibling of
 * `RaidForce`: a handful of wolves converge on the living agents, bite anyone
 * they reach, and the bitten fight back (sharing the militia's melee math). A
 * wolf that is mauled, or that overstays its welcome, heads for the nearest edge
 * and vanishes.
 *
 * Pure and DOM-free like the modules it sits beside: it mutates only the
 * `AgentStore` health/wound columns, draws all randomness from the caller's
 * `Rng`, and round-trips through a plain save shape. Unlike raiders, wolves don't
 * bash walls — they're outside threats that pick off strays, so they move freely
 * and simply chase whoever is nearest. `TownCore` owns the schedule (when a pack
 * shows up); this owns one pack's life.
 *
 * Run the self-check:  npx tsx src/sim/wolves.ts
 */
import { AgentStore, AState } from './agents';
import { settlerMeleeDamagePerHour } from './raid';
import { Rng } from './rng';
import { MINUTES_PER_TICK, MINUTES_PER_DAY, TUNING } from './defs';

const HOURS_PER_TICK = MINUTES_PER_TICK / 60;
const TICKS_PER_DAY = MINUTES_PER_DAY / MINUTES_PER_TICK;
/** Reach at which a wolf lands a bite — it must close to melee (tiles). */
const BITE_RANGE = 1.3;
/** Health below which a wolf gives up and slinks back to the treeline. */
const MAUL_THRESHOLD = 20;
/** Tiles a wolf advances per tick while stalking / while fleeing. */
const STALK_SPEED = 0.55;
const FLEE_SPEED = 0.55;
const WANDER_SPEED = 0.3;

export interface Wolf {
  id: number;
  x: number;
  y: number;
  health: number;
  /** true once mauled or overstayed — head for the nearest edge and vanish. */
  leaving: boolean;
}

export interface WolfPackSave {
  active: boolean;
  until: number;
  wolves: Wolf[];
  slain: number;
  nextId: number;
}

/** One pack's lifecycle: arrive → stalk/bite → flee → gone. */
export class WolfPack {
  wolves: Wolf[] = [];
  active = false;
  /** tick at/after which the pack leaves regardless of the hunt. */
  until = 0;
  /** wolves killed this visit — for logs / parity assertions. */
  slain = 0;
  private nextId = 1;

  /**
   * Loose `n` wolves in from one random map edge and start the prowl clock. They
   * appear at the treeline and converge on whoever strays closest.
   */
  start(n: number, mapW: number, mapH: number, rng: Rng, tickNo: number): void {
    const side = rng.int(4);
    for (let i = 0; i < n; i++) {
      const along = 4 + rng.int(Math.max(1, (side < 2 ? mapW : mapH) - 8));
      const x = side === 0 ? along : side === 1 ? along : side === 2 ? 0 : mapW - 1;
      const y = side === 0 ? 0 : side === 1 ? mapH - 1 : along;
      this.wolves.push({ id: this.nextId++, x, y, health: TUNING.wolfHealth, leaving: false });
    }
    this.active = this.wolves.length > 0;
    this.until = tickNo + TUNING.wolfStayDays * TICKS_PER_DAY;
  }

  /**
   * Advance the pack one tick. Each wolf stalks the nearest settler within its
   * aggro radius and bites whoever it reaches; the bitten fight back. Wolves that
   * are mauled or have overstayed flee to an edge and leave. Mutates agent
   * health/wounds. Clears `active` when the last wolf falls or escapes. Returns
   * the number of agents freshly wounded this tick.
   */
  tick(grid: { width: number; height: number }, agents: AgentStore, tickNo: number, rng: Rng, defenderDamageMult = 1.0): number {
    if (!this.active) return 0;
    const overstayed = tickNo >= this.until;

    let wounded = 0;
    const surviving: Wolf[] = [];
    for (const w of this.wolves) {
      if (w.health <= 0) { this.slain++; continue; }
      if (overstayed || w.health < MAUL_THRESHOLD) w.leaving = true;

      if (w.leaving) {
        this.stepToEdge(w, grid);
        if (w.x <= 0 || w.y <= 0 || w.x >= grid.width - 1 || w.y >= grid.height - 1) continue;
        surviving.push(w);
        continue;
      }

      const target = nearestAgentWithin(agents, w.x, w.y, TUNING.wolfAggroRadius);
      if (target < 0) {
        // Nothing close: prowl a short random hop, looking for a stray.
        w.x += (rng.next() * 2 - 1) * WANDER_SPEED;
        w.y += (rng.next() * 2 - 1) * WANDER_SPEED;
        surviving.push(w);
        continue;
      }

      const dx = agents.posX[target] - w.x;
      const dy = agents.posY[target] - w.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= BITE_RANGE) {
        const fresh = agents.woundUntreated[target] === 0;
        agents.health[target] -= TUNING.wolfDamagePerHour * HOURS_PER_TICK;
        agents.inflictWound(target, tickNo);
        if (fresh) wounded++;
        // The bitten fight back — most wolves regret testing a colonist.
        if (agents.state[target] !== AState.Sleeping) {
          w.health -= settlerMeleeDamagePerHour(agents, target) * HOURS_PER_TICK * defenderDamageMult;
        }
      } else {
        w.x += (dx / dist) * STALK_SPEED;
        w.y += (dy / dist) * STALK_SPEED;
      }
      surviving.push(w);
    }
    this.wolves = surviving;

    // Cull the freshly killed so a slain wolf can't bite again next tick.
    const alive = this.wolves.filter((w) => { if (w.health <= 0) { this.slain++; return false; } return true; });
    this.wolves = alive;
    if (this.wolves.length === 0) this.active = false;
    return wounded;
  }

  /** Fleeing: walk straight toward the nearest map edge. */
  private stepToEdge(w: Wolf, grid: { width: number; height: number }): void {
    const distLeft = w.x, distRight = grid.width - 1 - w.x;
    const distTop = w.y, distBottom = grid.height - 1 - w.y;
    const minH = Math.min(distLeft, distRight), minV = Math.min(distTop, distBottom);
    if (minH < minV) w.x += (distLeft < distRight ? -1 : 1) * FLEE_SPEED;
    else w.y += (distTop < distBottom ? -1 : 1) * FLEE_SPEED;
  }

  serialize(): WolfPackSave {
    return {
      active: this.active,
      until: this.until,
      wolves: this.wolves.map((w) => ({ ...w })),
      slain: this.slain,
      nextId: this.nextId,
    };
  }

  static deserialize(data: WolfPackSave): WolfPack {
    const p = new WolfPack();
    p.active = data.active;
    p.until = data.until;
    p.wolves = data.wolves.map((w) => ({ ...w }));
    p.slain = data.slain ?? 0;
    p.nextId = data.nextId ?? p.wolves.length + 1;
    return p;
  }
}

/** Nearest living agent within `range` of (x,y), or -1. */
function nearestAgentWithin(agents: AgentStore, x: number, y: number, range: number): number {
  let best = -1, bd = range;
  for (let i = 0; i < agents.count; i++) {
    if (agents.health[i] <= 0) continue;
    const d = Math.hypot(agents.posX[i] - x, agents.posY[i] - y);
    if (d <= bd) { bd = d; best = i; }
  }
  return best;
}

// --- self-check: npx tsx src/sim/wolves.ts ---
if (typeof process !== 'undefined' && process.argv[1]?.endsWith('/wolves.ts')) {
  // A lone wolf bites a stray settler, who bleeds.
  const a = new AgentStore(8);
  const s = a.spawn(48, 48);
  a.skill[s] = 2;
  const pack = new WolfPack();
  pack.start(3, 96, 96, new Rng(1), 0);
  const grid = { width: 96, height: 96 };
  let t = 0;
  while (pack.active && t < 4000) {
    pack.tick(grid, a, t, new Rng(1000 + t));
    for (let i = a.count - 1; i >= 0; i--) if (a.health[i] <= 0) a.remove(i);
    t++;
  }
  console.assert(!pack.active, 'the pack resolves (mauled or overstayed → gone)');

  // Determinism: identical packs resolve to identical survivor health.
  const runOnce = (seed: number): number => {
    const ag = new AgentStore(8); const k = ag.spawn(48, 48); ag.skill[k] = 3;
    const wp = new WolfPack(); wp.start(2, 96, 96, new Rng(seed), 0);
    let tt = 0;
    while (wp.active && tt < 4000) {
      wp.tick({ width: 96, height: 96 }, ag, tt, new Rng(seed + tt));
      for (let i = ag.count - 1; i >= 0; i--) if (ag.health[i] <= 0) ag.remove(i);
      tt++;
    }
    return ag.count > 0 ? Math.round(ag.health[0]) : -1;
  };
  console.assert(runOnce(5) === runOnce(5), 'same seed → same outcome');

  // Round-trip an in-progress pack.
  const p2 = new WolfPack();
  p2.start(3, 96, 96, new Rng(2), 0);
  const twin = WolfPack.deserialize(p2.serialize());
  console.assert(twin.wolves.length === p2.wolves.length && twin.active === p2.active, 'pack round-trips');

  console.log('wolves.ts self-check OK — pack resolved at tick', t, 'wolves slain', pack.slain);
}
