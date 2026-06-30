/**
 * Progression gates — victory checks (GDD §2.6) and the nationhood-proclamation
 * gate (GDD §2.2) — Track-C tick subsystem lifted to fn(r: RegionSim). Bodies
 * VERBATIM (this.→r.); checked monthly; state + serialize() stay on RegionSim.
 * (Century-end legacy/domination wins stay on RegionSim via checkCenturyWins,
 * which buildCenturyReport drives.)
 */
import type { RegionSim } from '../region';
import { tickAdvisorLoyalty, tickAdvisorEvents } from './regime';

/** Solarpunk + unification victory checks, monthly. */
export function checkWinConditions(r: RegionSim): void {
    if (r.winCondition) return; // already won — don't overwrite

    // Solarpunk: democratic + warm satisfaction + clean sky — can win from 2040 onward
    if (r.eraBranch === 'solarpunk') {
      r.winCondition = {
        path: 'solarpunk',
        year: r.year,
        details: `The grid hums clean. ${Math.round(r.warmingC * 10) / 10}°C above baseline — the gardens hold.`,
      };
      r.addLog('VICTORY — THE GARDEN PATH: solarpunk conditions achieved. The century belongs to you.', 'good');
      return;
    }

    // Unification: control 75%+ of region by 2070, or 90%+ at any point
    if (r.nationProclaimed) {
      const terr = r.playerTerritoryControl();
      if ((terr >= 0.75 && r.year <= 2070) || terr >= 0.9) {
        r.winCondition = {
          path: 'unification',
          year: r.year,
          details: `${Math.round(terr * 100)}% of the region under one banner.`,
        };
        r.addLog('VICTORY — UNIFICATION: the region bends to your flag. The era of division is over.', 'good');
        return;
      }
    }
  }

/** Opens the nationhood path once the State holds >half the region; also drives
 *  the Phase-18 advisor-brief generation that piggybacks on this monthly gate. */
export function checkProclamationGate(r: RegionSim): void {
    if (r.proclamationReady || !r.stateProclaimed) return;
    if (r.playerTerritoryControl() >= 0.5) {
      r.proclamationReady = true;
      r.addLog(
        'REGIONAL HEGEMON: Your state controls more than half the known territory. ' +
        'The path to nationhood lies before you — open the State panel to Proclaim the Nation.',
        'good',
      );
    }
    // Phase 18: Advisor System Depth (GDD §8.7)
    r.generateAdvisorBriefs();
    tickAdvisorLoyalty(r);
    tickAdvisorEvents(r);
  }
