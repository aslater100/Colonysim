/**
 * Research (GDD §2.3) — Track-C tick subsystem lifted to fn(r: RegionSim). Body
 * VERBATIM (this.→r.) ⇒ byte-identical RNG order (guarded by serialize-determinism);
 * tick() dispatches; state + serialize() stay on RegionSim. The queries it reads
 * (researchRate / techCost / the researched set) stay on RegionSim, reached via r.
 */
import type { RegionSim } from '../region';
import { TECH_TREE } from '../region';

  /** Called once per game-day; drains the rate into the active node. */
export function tickResearch(r: RegionSim): void {
    if (!r.activeResearch) return;
    const node = TECH_TREE.find((n) => n.id === r.activeResearch);
    if (!node) { r.activeResearch = null; return; }
    r.researchProgress += r.researchRate();
    if (r.researchProgress >= r.techCost(node)) {
      r.researched.add(r.activeResearch);
      const label = node.tree === 'tech' ? 'Technology' : 'Civics';
      r.addLog(`${label} breakthrough: "${node.name}". ${node.desc.split('.')[0]}.`, 'good');
      r.activeResearch = null;
      r.researchProgress = 0;
    }
  }
