/**
 * Raid — periodic hostile incursions against a `TownCore` colony (build-system
 * B-6 parity port).
 *
 * The fat-object `Simulation` models raiders as tile-pathing agents that bash
 * palisades, trip spike traps and trade blows with armed settlers (see
 * `sim.ts` `startRaid` / `updateRaiders`). That fidelity is welded to the tile
 * world, A* paths and the discrete-building stores, none of which the SoA core
 * has. This module is the same threat at the core's altitude: a small band of
 * raiders converges on the living agents, painted walls (`BuildGrid`) slow them
 * by forcing them to bash through, spike traps (`BuildGrid.trap`) bite the first
 * raider onto them, and any nearby awake settler fights back — harder if armed
 * with a forged weapon or improvised spear from the stores. Raiders that run out
 * the clock — or out of targets — flee off the map.
 *
 * Pure and DOM-free like the modules it sits beside: it mutates only the
 * `AgentStore` health/wound columns and the `BuildGrid` it's handed, draws all
 * randomness from the caller's `Rng`, and round-trips through a plain save shape.
 * `TownCore` owns the schedule (when a raid musters); this owns one raid's life.
 *
 * Run the self-check:  npx tsx src/sim/raid.ts
 */
import { AgentStore, AState } from './agents';
import { BuildGrid } from './build';
import { Rng } from './rng';
import { MINUTES_PER_TICK, TUNING } from './defs';

const HOURS_PER_TICK = MINUTES_PER_TICK / 60;
/** Reach at which a raider lands a blow — it must close to melee (tiles). */
const ENGAGE_RANGE = 1.4;
/**
 * Reach at which an awake settler joins the defense. Wider than melee: the colony
 * rallies as a militia and converges on raiders the moment they near the homes,
 * standing in for the fat sim's guards/spear-bearers rushing the threat.
 */
const DEFEND_REACH = 6;
/** Tiles a raider advances per tick while attacking / while fleeing. */
const ADVANCE_SPEED = 0.4;
const FLEE_SPEED = 0.55;
/** Wall hit-points a raider must chew through before a palisade tile falls. */
const WALL_HP = TUNING.wallMaxHp;
/** Defender melee: base damage/hour, plus craft `skill` standing in for grit. */
const DEFENDER_DAMAGE_PER_HOUR = TUNING.combatDamagePerHour;
const DEFENDER_DAMAGE_PER_SKILL = TUNING.combatDamagePerSkill;

/**
 * Melee damage per hour a settler deals — base + craft skill (grit) + a flat bonus
 * for whatever weapon they grabbed when the horn sounded (forged > improvised
 * spear > bare hands). Mirrors the fat sim's `settlerDamagePerHour`. Shared by the
 * raid defense and the wolf-pack defense so both threats face the same militia.
 */
export function settlerMeleeDamagePerHour(agents: AgentStore, i: number): number {
  let dmg = DEFENDER_DAMAGE_PER_HOUR + agents.skill[i] * DEFENDER_DAMAGE_PER_SKILL;
  const arm = agents.armed[i];
  if (arm === 2) dmg += TUNING.forgedWeaponBonus;       // forged weapon from the armoury stores
  else if (arm === 1) dmg += TUNING.spearDamageBonus;   // improvised spear whittled from wood
  return dmg;
}

export interface Raider {
  id: number;
  x: number;
  y: number;
  health: number;
  /** 1..4 melee skill, scales the blow they land (mirrors the fat sim). */
  combat: number;
  /** true once the raid times out or the colony is empty — head for an edge. */
  fleeing: boolean;
}

export interface RaidForceSave {
  active: boolean;
  until: number;
  raiders: Raider[];
  /** transient palisade damage: [tileIndex, remainingHp] while the raid lasts. */
  wallHp: [number, number][];
  nextId: number;
}

/**
 * Raiders mustered for one raid: prosperity and time grow the threat, but a
 * dwindling colony is a poor target. Mirrors `Simulation.raidSize()` exactly so
 * the two cores escalate in step.
 */
export function raidSize(wealth: number, day: number, pop: number): number {
  const byWealth = 2 + Math.floor(wealth / TUNING.raidWealthPerRaider);
  const byTime = 2 + Math.floor(Math.max(0, day - TUNING.firstRaidDay) / TUNING.raidRampDays);
  const byPop = Math.ceil(pop * TUNING.raidPopFactor);
  return Math.max(1, Math.min(TUNING.raidMaxRaiders, byWealth, byTime, byPop));
}

/** One raid's lifecycle: muster → converge/fight → flee → done. */
export class RaidForce {
  raiders: Raider[] = [];
  active = false;
  /** tick at/after which attackers give up and flee. */
  until = 0;
  /** raiders slain this raid — for logs / parity assertions. */
  slain = 0;
  private wallHp = new Map<number, number>();
  private nextId = 1;

  /**
   * Muster `n` raiders along one random map edge and start the clock. They
   * appear clear of the colony anchor and converge on whoever they find.
   */
  start(n: number, mapW: number, mapH: number, rng: Rng, tickNo: number): void {
    const side = rng.int(4);
    for (let i = 0; i < n; i++) {
      const along = 2 + rng.int(Math.max(1, (side < 2 ? mapW : mapH) - 4));
      const x = side === 0 ? along : side === 1 ? along : side === 2 ? 0 : mapW - 1;
      const y = side === 0 ? 0 : side === 1 ? mapH - 1 : along;
      this.raiders.push({ id: this.nextId++, x, y, health: TUNING.raiderHealth, combat: 1 + rng.int(4), fleeing: false });
    }
    this.active = this.raiders.length > 0;
    this.until = tickNo + Math.round((TUNING.raidTimeoutHours * 60) / MINUTES_PER_TICK);
  }

  /**
   * Advance the raid one tick. Raiders converge on the nearest living agent,
   * bashing through any wall in the way; awake settlers within reach fight back.
   * Mutates agent health/wounds and the grid's walls. Clears `active` when the
   * last raider falls or escapes. Returns the number of agents freshly wounded.
   *
   * `defenderDamageMult` scales settler melee damage (e.g. 1.3 for militia_training).
   * `trapDamageMult` scales spike-trap hit damage (1.5 with fortification).
   * `wallBashMult` scales how fast raiders damage walls (0.8 = 20% slower with fortification).
   */
  tick(grid: BuildGrid, agents: AgentStore, tickNo: number, defenderDamageMult = 1.0, trapDamageMult = 1.0, wallBashMult = 1.0): number {
    if (!this.active) return 0;
    if (tickNo >= this.until) for (const r of this.raiders) r.fleeing = true;

    let wounded = 0;
    const surviving: Raider[] = [];
    for (const r of this.raiders) {
      if (r.health <= 0) { this.slain++; continue; }

      if (r.fleeing) {
        this.stepToEdge(r, grid, trapDamageMult, wallBashMult);
        // Off the edge → gone.
        if (r.x <= 0 || r.y <= 0 || r.x >= grid.width - 1 || r.y >= grid.height - 1) continue;
        surviving.push(r);
        continue;
      }

      const target = nearestAgent(agents, r.x, r.y);
      if (target < 0) { r.fleeing = true; surviving.push(r); continue; }

      const dx = agents.posX[target] - r.x;
      const dy = agents.posY[target] - r.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= ENGAGE_RANGE) {
        const dmg = (TUNING.combatDamagePerHour + r.combat * TUNING.combatDamagePerSkill) * HOURS_PER_TICK;
        const fresh = agents.woundUntreated[target] === 0;
        agents.health[target] -= dmg;
        agents.inflictWound(target, tickNo);
        if (fresh) wounded++;
      } else {
        this.advance(r, dx / dist, dy / dist, ADVANCE_SPEED, grid, trapDamageMult, wallBashMult);
      }
      surviving.push(r);
    }
    this.raiders = surviving;

    // Defenders: every awake settler within rallying reach of a raider strikes it.
    for (let i = 0; i < agents.count; i++) {
      if (agents.state[i] === AState.Sleeping || agents.health[i] <= 0) continue;
      const r = nearestRaider(this.raiders, agents.posX[i], agents.posY[i], DEFEND_REACH);
      if (!r) continue;
      r.health -= settlerMeleeDamagePerHour(agents, i) * HOURS_PER_TICK * defenderDamageMult;
    }

    // Cull the freshly killed so a slain raider can't deal a parting blow next tick.
    const alive = this.raiders.filter((r) => { if (r.health <= 0) { this.slain++; return false; } return true; });
    this.raiders = alive;
    if (this.raiders.length === 0) { this.active = false; this.wallHp.clear(); }
    return wounded;
  }

  /** Step one move toward (ux,uy), bashing through a wall tile if one blocks it. */
  private advance(r: Raider, ux: number, uy: number, speed: number, grid: BuildGrid, trapDamageMult = 1.0, wallBashMult = 1.0): void {
    const nx = r.x + ux * speed;
    const ny = r.y + uy * speed;
    const tx = Math.round(nx);
    const ty = Math.round(ny);
    if (grid.inBounds(tx, ty) && !grid.passable(tx, ty)) {
      const idx = ty * grid.width + tx;
      const hp = (this.wallHp.get(idx) ?? WALL_HP) - TUNING.wallDamagePerHour * HOURS_PER_TICK * wallBashMult;
      if (hp <= 0) { grid.clearWall(tx, ty); this.wallHp.delete(idx); }
      else this.wallHp.set(idx, hp);
      return; // bashing costs the move
    }
    r.x = nx;
    r.y = ny;
    // Spike trap: the first raider onto an armed tile takes a heavy one-shot hit.
    if (grid.tripTrap(Math.round(r.x), Math.round(r.y))) r.health -= TUNING.trapDamage * trapDamageMult;
  }

  /** Fleeing: walk straight toward the nearest map edge, bashing out if walled. */
  private stepToEdge(r: Raider, grid: BuildGrid, trapDamageMult = 1.0, wallBashMult = 1.0): void {
    const distLeft = r.x, distRight = grid.width - 1 - r.x;
    const distTop = r.y, distBottom = grid.height - 1 - r.y;
    const minH = Math.min(distLeft, distRight), minV = Math.min(distTop, distBottom);
    let ux = 0, uy = 0;
    if (minH < minV) ux = distLeft < distRight ? -1 : 1;
    else uy = distTop < distBottom ? -1 : 1;
    this.advance(r, ux, uy, FLEE_SPEED, grid, trapDamageMult, wallBashMult);
  }

  serialize(): RaidForceSave {
    return {
      active: this.active,
      until: this.until,
      raiders: this.raiders.map((r) => ({ ...r })),
      wallHp: [...this.wallHp.entries()],
      nextId: this.nextId,
    };
  }

  static deserialize(data: RaidForceSave): RaidForce {
    const f = new RaidForce();
    f.active = data.active;
    f.until = data.until;
    f.raiders = data.raiders.map((r) => ({ ...r }));
    f.wallHp = new Map(data.wallHp);
    f.nextId = data.nextId ?? f.raiders.length + 1;
    return f;
  }
}

/** Nearest living agent index to (x,y), or -1 if the colony is empty. */
function nearestAgent(agents: AgentStore, x: number, y: number): number {
  let best = -1, bd = Infinity;
  for (let i = 0; i < agents.count; i++) {
    if (agents.health[i] <= 0) continue;
    const d = Math.hypot(agents.posX[i] - x, agents.posY[i] - y);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/** Nearest living raider within `range` of (x,y), or null. */
function nearestRaider(raiders: Raider[], x: number, y: number, range: number): Raider | null {
  let best: Raider | null = null, bd = range;
  for (const r of raiders) {
    if (r.health <= 0) continue;
    const d = Math.hypot(r.x - x, r.y - y);
    if (d <= bd) { bd = d; best = r; }
  }
  return best;
}

// --- self-check: npx tsx src/sim/raid.ts ---
if (typeof process !== 'undefined' && process.argv[1]?.endsWith('/raid.ts')) {
  // raidSize escalates with wealth/time/pop but never exceeds the cap.
  console.assert(raidSize(0, 0, 1) === 1, 'tiny colony → a lone raider');
  console.assert(raidSize(1e9, 9999, 999) === TUNING.raidMaxRaiders, 'rich + late + crowded → capped');

  // An open colony of six takes casualties from a four-raider band.
  const open = new AgentStore(16);
  for (let i = 0; i < 6; i++) { const k = open.spawn(48 + (i % 3), 48 + ((i / 3) | 0)); open.skill[k] = 2; }
  const openGrid = new BuildGrid(96, 96);
  const openRaid = new RaidForce();
  openRaid.start(4, 96, 96, new Rng(1), 0);
  let t = 0;
  while (openRaid.active && t < 600) { openRaid.tick(openGrid, open, t); for (let i = open.count - 1; i >= 0; i--) if (open.health[i] <= 0) open.remove(i); t++; }
  console.assert(!openRaid.active, 'the raid resolves');
  console.assert(openRaid.slain > 0, 'defenders slay at least one raider');

  // Determinism: two identical raids resolve to the same survivor count.
  const mk = () => { const a = new AgentStore(16); for (let i = 0; i < 6; i++) { const k = a.spawn(48, 48); a.skill[k] = 2; } return a; };
  const runOnce = (seed: number) => {
    const a = mk(); const g = new BuildGrid(96, 96); const f = new RaidForce();
    f.start(4, 96, 96, new Rng(seed), 0);
    let tt = 0;
    while (f.active && tt < 600) { f.tick(g, a, tt); for (let i = a.count - 1; i >= 0; i--) if (a.health[i] <= 0) a.remove(i); tt++; }
    return a.count;
  };
  console.assert(runOnce(5) === runOnce(5), 'same seed → same survivors');

  // Round-trip the active raid mid-fight.
  const f2 = new RaidForce();
  f2.start(3, 96, 96, new Rng(2), 0);
  const twin = RaidForce.deserialize(f2.serialize());
  console.assert(twin.raiders.length === f2.raiders.length && twin.active === f2.active, 'raid round-trips');

  console.log('raid.ts self-check OK — open-colony survivors', runOnce(5), 'of 6, raiders slain', openRaid.slain);
}
