/**
 * Design screens: the player shapes the colony at each tier transition.
 *  - Game start: town characteristics (size, currency, location, difficulty)
 *  - Region flip: regional doctrine (expansion, trade, policy levers)
 *  - Nation flip: national identity (economic system, military doctrine,
 *    alliances) — and the one sanctioned chance to re-pick the currency.
 */
import './screens.css';
import type { CurrencySymbol, RegionDesign, NationDesign } from '../sim/defs';
import { CURRENCY_SYMBOLS } from '../sim/defs';

export type { RegionDesign, NationDesign };

interface Choice<T extends string> {
  value: T;
  label: string;
  desc: string;
}

const REGION_EXPANSION: Choice<RegionDesign['expansionSpeed']>[] = [
  { value: 'cautious', label: 'Cautious', desc: 'Slow settlement, stable satisfaction.' },
  { value: 'steady', label: 'Steady', desc: 'Balanced growth.' },
  { value: 'aggressive', label: 'Aggressive', desc: 'Fast expansion, higher grievance risk.' },
];

const REGION_TRADE: Choice<RegionDesign['tradeOpenness']>[] = [
  { value: 'protectionist', label: 'Protectionist', desc: 'Higher levies, shielded industries.' },
  { value: 'balanced', label: 'Balanced', desc: 'Standard tariffs.' },
  { value: 'free-trade', label: 'Free Trade', desc: 'Low levies, more trade volume.' },
];

const NATION_ECONOMY: Choice<NationDesign['economicSystem']>[] = [
  { value: 'laissez-faire', label: 'Laissez-Faire', desc: 'Markets lead. GDP +10%, services cost more.' },
  { value: 'mixed', label: 'Mixed Economy', desc: 'Pragmatic balance of market and state.' },
  { value: 'planned', label: 'Planned Economy', desc: 'State directs industry. Stability up, dynamism down.' },
];

const NATION_MILITARY: Choice<NationDesign['militaryDoctrine']>[] = [
  { value: 'defensive', label: 'Defensive', desc: 'Cheaper garrisons, no first strikes.' },
  { value: 'professional', label: 'Professional', desc: 'Balanced standing force.' },
  { value: 'expansionist', label: 'Expansionist', desc: 'Stronger offense, costlier upkeep, nervous neighbors.' },
];

const NATION_ALLIANCE: Choice<NationDesign['allianceStance']>[] = [
  { value: 'isolationist', label: 'Isolationist', desc: 'Few entanglements, slower diplomacy.' },
  { value: 'opportunist', label: 'Opportunist', desc: 'Deals when they pay.' },
  { value: 'coalition-builder', label: 'Coalition Builder', desc: 'Easier treaties, shared obligations.' },
];

/**
 * Full-screen modal. One instance per showing; removes itself on confirm.
 * Selection state lives in closures (no globals), buttons re-render on click.
 */
export class DesignScreen {
  private overlay: HTMLElement;
  private box: HTMLElement;

  constructor() {
    this.overlay = document.createElement('div');
    this.overlay.className = 'design-overlay';
    this.box = document.createElement('div');
    this.box.className = 'design-box';
    this.overlay.appendChild(this.box);
  }

  private open(): void {
    document.body.appendChild(this.overlay);
  }

  private close(): void {
    this.overlay.remove();
  }

  /** A titled row of mutually-exclusive choice buttons. Returns a getter. */
  private choiceRow<T extends string>(title: string, choices: Choice<T>[], initial: T): { el: HTMLElement; get: () => T } {
    let selected = initial;
    const wrap = document.createElement('div');
    wrap.className = 'design-row';
    const h = document.createElement('p');
    h.innerHTML = `<strong>${title}</strong>`;
    h.className = 'design-row-title';
    wrap.appendChild(h);
    const row = document.createElement('div');
    row.className = 'design-choices';
    const buttons: HTMLButtonElement[] = [];
    const desc = document.createElement('p');
    desc.className = 'design-desc';
    const paint = () => {
      buttons.forEach((b, i) => {
        const on = choices[i].value === selected;
        b.classList.toggle('design-choice-on', on);
        if (on) desc.textContent = choices[i].desc;
      });
    };
    for (const c of choices) {
      const b = document.createElement('button');
      b.textContent = c.label;
      b.className = 'design-choice';
      b.addEventListener('click', () => { selected = c.value; paint(); });
      buttons.push(b);
      row.appendChild(b);
    }
    wrap.appendChild(row);
    wrap.appendChild(desc);
    paint();
    return { el: wrap, get: () => selected };
  }

  private confirmButton(label: string, onClick: () => void): HTMLElement {
    const b = document.createElement('button');
    b.textContent = label;
    b.className = 'design-confirm btn-gold';
    b.addEventListener('click', onClick);
    return b;
  }

  private title(text: string, sub: string): void {
    this.box.innerHTML = '';
    const h = document.createElement('h2');
    h.textContent = text;
    h.className = 'design-heading';
    const p = document.createElement('p');
    p.textContent = sub;
    p.className = 'design-sub';
    this.box.appendChild(h);
    this.box.appendChild(p);
  }

  showRegionDesign(cb: (d: RegionDesign) => void): void {
    this.title('REGIONAL CHARTER', 'Town #2 is founded. Set the region\'s course.');

    const expansion = this.choiceRow('Expansion', REGION_EXPANSION, 'steady');
    const trade = this.choiceRow('Trade Posture', REGION_TRADE, 'balanced');
    const services = this.choiceRow(
      'Services Funding',
      [
        { value: '0', label: 'Minimal', desc: 'Low cost, higher mortality and unrest.' },
        { value: '1', label: 'Standard', desc: 'Clinics and schools at par.' },
        { value: '2', label: 'Generous', desc: 'Costs more; people live longer and complain less.' },
      ],
      '1',
    );

    let taxRate = 0.10;
    const taxWrap = document.createElement('div');
    taxWrap.className = 'design-row';
    taxWrap.innerHTML = `<p class="design-row-title"><strong>Tax Rate: <span id="ds-tax">10%</span></strong></p>`;
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '5';
    slider.max = '30';
    slider.value = '10';
    slider.className = 'design-slider';
    slider.addEventListener('input', () => {
      taxRate = parseInt(slider.value) / 100;
      const span = taxWrap.querySelector('#ds-tax')!;
      span.textContent = `${slider.value}%`;
    });
    taxWrap.appendChild(slider);

    this.box.appendChild(expansion.el);
    this.box.appendChild(trade.el);
    this.box.appendChild(taxWrap);
    this.box.appendChild(services.el);
    this.box.appendChild(
      this.confirmButton('ESTABLISH CHARTER', () => {
        this.close();
        cb({
          expansionSpeed: expansion.get(),
          tradeOpenness: trade.get(),
          taxRate,
          servicesLevel: parseInt(services.get()) as RegionDesign['servicesLevel'],
        });
      }),
    );
    this.open();
  }

  showNationDesign(currentCurrency: CurrencySymbol, cb: (d: NationDesign) => void): void {
    this.title('CONSTITUTIONAL CONVENTION', 'A nation takes its shape — and its coin.');

    const economy = this.choiceRow('Economic System', NATION_ECONOMY, 'mixed');
    const military = this.choiceRow('Military Doctrine', NATION_MILITARY, 'professional');
    const alliance = this.choiceRow('Alliance Stance', NATION_ALLIANCE, 'opportunist');

    const KEEP = '__keep__';
    const currencyChoices: Choice<string>[] = [
      { value: KEEP, label: `Keep ${currentCurrency}`, desc: 'No disruption. Markets stay calm.' },
      ...CURRENCY_SYMBOLS.filter((s) => s !== currentCurrency).map((s) => ({
        value: s as string,
        label: `Switch to ${s}`,
        desc: 'Capital flight, efficiency dip, months of volatility. Announcing ahead and deep reserves soften it.',
      })),
    ];
    const currency = this.choiceRow('Currency Standard', currencyChoices, KEEP);

    const warn = document.createElement('div');
    warn.className = 'design-warn';
    warn.innerHTML =
      '<strong>⚠ Currency changes carry penalties.</strong> A switch without cause reads as caprice: ' +
      'expect 20–30% efficiency loss and 10–15% capital flight, recovering over 2–3 years. ' +
      'Crisis-driven or well-telegraphed switches are forgiven faster.';

    this.box.appendChild(economy.el);
    this.box.appendChild(military.el);
    this.box.appendChild(alliance.el);
    this.box.appendChild(warn);
    this.box.appendChild(currency.el);
    this.box.appendChild(
      this.confirmButton('PROCLAIM THE NATION', () => {
        this.close();
        const cur = currency.get();
        cb({
          economicSystem: economy.get(),
          militaryDoctrine: military.get(),
          allianceStance: alliance.get(),
          currencySymbol: cur === KEEP ? undefined : (cur as CurrencySymbol),
        });
      }),
    );
    this.open();
  }
}
