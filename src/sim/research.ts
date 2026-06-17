/**
 * ResearchBook — lightweight tech-tree for the SoA TownCore.
 *
 * Points accumulate daily from `education` capacity (library desks). The player
 * calls `core.research(techId)` to spend points and unlock effects; prereqs must
 * be met first. Effects are applied inside TownCore's production/combat/harvest
 * methods via `core.researchBook.hasTech(id)` checks.
 *
 * The book is pure and DOM-free, lives on TownCore, and serializes at save v7.
 */

/** One entry in the colony's town-tier tech tree. */
export interface CoreTechDef {
  id: string;
  name: string;
  /** Research points required to unlock (desks × RESEARCH_PER_DESK_PER_DAY ÷ day). */
  cost: number;
  prereqs: string[];
  /** One-line description of the mechanical effect for UI display. */
  desc: string;
}

/** Research points produced per library desk per game-day. */
export const RESEARCH_PER_DESK_PER_DAY = 10;

/**
 * Town-tier techs for TownCore.  Costs are in research points;
 * with one desk running `cost ÷ RESEARCH_PER_DESK_PER_DAY` days to unlock.
 *
 * Effects are applied by TownCore internals (hasTech checks) so renderers and
 * tests never need to hard-code numeric bonuses.
 */
export const CORE_TECHS: CoreTechDef[] = [
  // Tier 0 — free at colony start
  {
    id: 'crop_rotation', name: 'Crop Rotation', cost: 0, prereqs: [],
    desc: 'Field zones yield 25% more grain',
  },
  // Tier 1 — no prereqs, accessible early
  {
    id: 'textile_farming', name: 'Textile Farming', cost: 60, prereqs: [],
    desc: 'Looms and rope-walks run 25% faster',
  },
  {
    id: 'herbalism', name: 'Herbalism', cost: 60, prereqs: [],
    desc: 'Herb tables produce medicine 30% faster',
  },
  {
    id: 'militia_training', name: 'Militia Training', cost: 60, prereqs: [],
    desc: 'Settlers deal 30% more damage in raids and wolf attacks',
  },
  {
    id: 'carpentry', name: 'Carpentry', cost: 80, prereqs: [],
    desc: 'Saw benches and carpentry benches run 25% faster',
  },
  {
    id: 'forestry', name: 'Forestry', cost: 60, prereqs: [],
    desc: 'Woodcutter zones yield 25% more wood',
  },
  {
    id: 'mining', name: 'Mining', cost: 80, prereqs: [],
    desc: 'Quarry zones yield 30% more stone and ore',
  },
  {
    id: 'fishing', name: 'Fishing', cost: 60, prereqs: [],
    desc: 'Fishery zones land 25% more food',
  },
  {
    id: 'animal_husbandry', name: 'Animal Husbandry', cost: 80, prereqs: [],
    desc: 'Animal pens produce 30% more dairy',
  },
  {
    id: 'ceramics', name: 'Ceramics', cost: 90, prereqs: [],
    desc: 'Kilns and coke ovens run 25% faster',
  },
  {
    id: 'blacksmithing', name: 'Blacksmithing', cost: 100, prereqs: [],
    desc: 'Anvils and weapon benches run 25% faster',
  },
  // Tier 2 — prereqs
  {
    id: 'milling', name: 'Milling', cost: 100, prereqs: ['crop_rotation'],
    desc: 'Millstones run 30% faster',
  },
  {
    id: 'fermentation', name: 'Fermentation', cost: 100, prereqs: ['crop_rotation'],
    desc: 'Brew vats produce 30% more ale',
  },
  {
    id: 'baking', name: 'Baking', cost: 100, prereqs: ['milling'],
    desc: 'Ovens and baking ovens run 25% faster',
  },
  {
    id: 'food_preservation', name: 'Food Preservation', cost: 110, prereqs: ['crop_rotation'],
    desc: 'Smoke racks preserve 40% more food',
  },
  {
    id: 'first_aid', name: 'First Aid', cost: 80, prereqs: ['herbalism'],
    desc: 'Wound infection chance reduced by 40%',
  },
  {
    id: 'iron_smelting', name: 'Iron Smelting', cost: 150, prereqs: ['blacksmithing'],
    desc: 'Smelters run 30% faster',
  },
  {
    id: 'fortification', name: 'Fortification', cost: 120, prereqs: ['militia_training'],
    desc: 'Trap damage +50%; raiders bash walls 20% slower',
  },
  // Tier 3 — deep prereqs
  {
    id: 'germ_theory', name: 'Germ Theory', cost: 180, prereqs: ['first_aid'],
    desc: 'Infection clears 2× faster; medicine heals 50% more HP',
  },
  {
    id: 'crop_science', name: 'Crop Science', cost: 200, prereqs: ['milling', 'crop_rotation'],
    desc: 'Field zones yield an additional 20% grain (stacks with Crop Rotation)',
  },
  {
    id: 'mechanization', name: 'Mechanization', cost: 240, prereqs: ['blacksmithing', 'carpentry'],
    desc: 'Every workstation runs an additional 15% faster',
  },
  {
    id: 'provincial_roads', name: 'Provincial Roads', cost: 160, prereqs: ['carpentry'],
    desc: 'Trunk roads to your holdings raise their daily tribute by 50%',
  },
];

export const CORE_TECH_MAP = new Map<string, CoreTechDef>(CORE_TECHS.map(t => [t.id, t]));

export interface ResearchBookSave {
  points: number;
  researched: string[];
  /** Optional: which tech the colony is currently working toward (UI hint). */
  queue?: string;
}

/** Manages the colony's tech unlocks. Lives on TownCore as `researchBook`. */
export class ResearchBook {
  points = 0;
  private readonly _researched = new Set<string>();
  /** If set, the auto-research target (TownCore.research() prioritises this). */
  queue: string | null = null;

  constructor() {
    // crop_rotation is free and starts unlocked — the colony knows basic farming.
    this._researched.add('crop_rotation');
  }

  /** True if `id` has been researched. */
  hasTech(id: string): boolean {
    return this._researched.has(id);
  }

  /**
   * True if `id` exists, is not yet researched, has all prereqs met, and the
   * colony has enough points.
   */
  canResearch(id: string): boolean {
    const def = CORE_TECH_MAP.get(id);
    if (!def || this._researched.has(id)) return false;
    return def.prereqs.every(p => this._researched.has(p)) && this.points >= def.cost;
  }

  /**
   * Spend points and unlock `id`. Returns true on success, false if prereqs
   * are not met, already researched, or not enough points.
   */
  research(id: string): boolean {
    const def = CORE_TECH_MAP.get(id);
    if (!def || this._researched.has(id)) return false;
    if (!def.prereqs.every(p => this._researched.has(p))) return false;
    if (this.points < def.cost) return false;
    this.points -= def.cost;
    this._researched.add(id);
    if (this.queue === id) this.queue = null;
    return true;
  }

  /**
   * Accumulate points from education slots (library desks). Call once per day.
   * One desk × RESEARCH_PER_DESK_PER_DAY = points per day.
   */
  addPoints(deskCount: number): void {
    this.points += deskCount * RESEARCH_PER_DESK_PER_DAY;
  }

  /**
   * If a `queue` target is set and now affordable, auto-research it.
   * Returns the tech id if a research happened, null otherwise.
   */
  autoResearch(): string | null {
    if (this.queue && this.canResearch(this.queue)) {
      const id = this.queue;
      this.research(id); // clears this.queue
      return id;
    }
    return null;
  }

  /** All currently unlocked tech ids. */
  all(): string[] {
    return [...this._researched];
  }

  /** All tech defs that have their prereqs met (regardless of points). */
  available(): CoreTechDef[] {
    return CORE_TECHS.filter(t => !this._researched.has(t.id) && t.prereqs.every(p => this._researched.has(p)));
  }

  serialize(): ResearchBookSave {
    return {
      points: this.points,
      researched: [...this._researched],
      ...(this.queue ? { queue: this.queue } : {}),
    };
  }

  static deserialize(data: ResearchBookSave): ResearchBook {
    const rb = new ResearchBook();
    rb._researched.clear();
    for (const id of data.researched) rb._researched.add(id);
    rb.points = data.points;
    rb.queue = data.queue ?? null;
    return rb;
  }
}
