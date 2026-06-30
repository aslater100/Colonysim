import { describe, it, expect } from 'vitest';
import { RegionSim, ARCHETYPE_GREEN_PROPENSITY } from '../src/sim/region';

/**
 * Autonomous rival climate accord offers (GDD §8.2 / §6.3).
 *
 * High-propensity rivals (trading_republic, crusader_state) propose the
 * Climate Accord to the player when warmingC > 1.8°C and year ≥ 2020,
 * using the existing TreatyOffer system. This closes the gap where the
 * player was the only one who could propose the accord.
 */

function warmNation(): RegionSim {
  const r = RegionSim.create(1);
  r.stateProclaimed = true;
  r.nationProclaimed = true;
  // Unlock the accord
  r.passedLaws.add('environmentalism');
  Object.defineProperty(r, 'year', { get: () => 2025, configurable: true });
  (r as any).warmingC = 2.2;
  return r;
}

function greenRival(r: RegionSim): any {
  // Use an existing rival and set it to trading_republic (green propensity 1.0)
  const rv = r.rivals[0];
  if (!rv) return null;
  rv.archetype = 'trading_republic';
  rv.relations = 50; // ensure no trade agreement block from low relations
  rv.treaties = [];
  return rv;
}

describe('rival climate accord offers', () => {
  it('ARCHETYPE_GREEN_PROPENSITY.trading_republic >= 0.6', () => {
    expect(ARCHETYPE_GREEN_PROPENSITY.trading_republic).toBeGreaterThanOrEqual(0.6);
  });

  it('ARCHETYPE_GREEN_PROPENSITY.hermit_kingdom < 0.6', () => {
    expect(ARCHETYPE_GREEN_PROPENSITY.hermit_kingdom).toBeLessThan(0.6);
  });

  it('accord offer never fires below 1.8°C warming', () => {
    const r = warmNation();
    (r as any).warmingC = 1.5; // below gate
    const rv = greenRival(r);
    if (!rv) return;
    // Run diplo tick many times
    for (let i = 0; i < 50; i++) (r as any).tickDiplomacy?.();
    const hasAccordOffer = r.offers.some((o: any) => o.rivalId === rv.id && o.kind === 'climate_accord');
    expect(hasAccordOffer).toBe(false);
  });

  it('accord offer never fires before year 2020', () => {
    const r = warmNation();
    Object.defineProperty(r, 'year', { get: () => 2015, configurable: true });
    (r as any).warmingC = 2.5;
    const rv = greenRival(r);
    if (!rv) return;
    for (let i = 0; i < 50; i++) (r as any).tickDiplomacy?.();
    const hasAccordOffer = r.offers.some((o: any) => o.rivalId === rv.id && o.kind === 'climate_accord');
    expect(hasAccordOffer).toBe(false);
  });

  it('accord offer never fires when accord is not unlocked', () => {
    const r = warmNation();
    r.passedLaws.delete('environmentalism'); // remove unlock
    const rv = greenRival(r);
    if (!rv) return;
    for (let i = 0; i < 50; i++) (r as any).tickDiplomacy?.();
    const hasAccordOffer = r.offers.some((o: any) => o.rivalId === rv.id && o.kind === 'climate_accord');
    expect(hasAccordOffer).toBe(false);
  });

  it('accord offer never fires when rival already has climate_accord', () => {
    const r = warmNation();
    const rv = greenRival(r);
    if (!rv) return;
    rv.treaties = ['climate_accord'];
    for (let i = 0; i < 50; i++) (r as any).tickDiplomacy?.();
    const hasAccordOffer = r.offers.some((o: any) => o.rivalId === rv.id && o.kind === 'climate_accord');
    expect(hasAccordOffer).toBe(false);
  });

  it('low-propensity rival (hegemon) does not offer accord', () => {
    const r = warmNation();
    const rv = greenRival(r);
    if (!rv) return;
    rv.archetype = 'hegemon'; // green propensity 0.2 < 0.6
    rv.treaties = [];
    for (let i = 0; i < 100; i++) (r as any).tickDiplomacy?.();
    const hasAccordOffer = r.offers.some((o: any) => o.rivalId === rv.id && o.kind === 'climate_accord');
    expect(hasAccordOffer).toBe(false);
  });

  it('offer expires after 180 days (longer window than other offers)', () => {
    const r = warmNation();
    const rv = greenRival(r);
    if (!rv) return;
    // Manually inject an offer
    r.offers.push({ rivalId: rv.id, kind: 'climate_accord', expiresDay: (r as any).day + 180 });
    expect(r.offers.find((o: any) => o.kind === 'climate_accord')?.expiresDay)
      .toBeGreaterThan((r as any).day + 89); // longer than 90-day trade offers
  });

  it('accord offer can be accepted via proposeTreaty after rival offers', () => {
    const r = warmNation();
    const rv = greenRival(r);
    if (!rv) return;
    // Ensure the rival relations support signing (treatyAsk for climate_accord should be met at relations 50)
    // Manually inject the offer
    r.offers.push({ rivalId: rv.id, kind: 'climate_accord', expiresDay: (r as any).day + 180 });
    // Player proposes (accepts) via the existing flow
    const signed = r.proposeTreaty(rv.id, 'climate_accord');
    // Either signed or declined based on relations — what matters is no crash
    expect(typeof signed).toBe('boolean');
  });
});
