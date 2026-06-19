# Spec 08: Land Purchase Mechanics (1930–2100)

## Summary

Players gain two complementary pathways to expand territory beyond settlement founding:

1. **Unclaimed land purchase** — Pay a per-cell cost to claim adjacent unclaimed hexes, expanding your faction's influence radius and territorial control without building a settlement.
2. **Enhanced land negotiation** — Improve the diplomatic UI for purchasing rival settlements, with conditions based on relations and economic pressure rather than just raw treasury thresholds.

This adds agency and strategic depth to territorial expansion and late-game border management.

---

## 1. Unclaimed Land Purchase

### Mechanic

At **Nation tier** (or when **Proclamation** is researched), the player can purchase unclaimed land cells (marked -1 in the territory grid) adjacent to any of their settlements.

- **Cost:** £25 per cell (tunable)
- **Constraint:** Must be contiguous (horizontally or vertically adjacent) to a player-controlled cell
- **Effect:** Claims the cell as player territory (sets grid cell to playerFactionId), instantly expanding the territory control percentage
- **UI:** Click mode activated via "Claim Land" button in the State panel; click on unclaimed cells in the map viewport to purchase them

### Implementation

#### Model (`src/sim/region.ts`)

Add method:

```typescript
canClaimCell(x: number, y: number): CanResult {
  const r = this.computeTerritoryGrid();
  const N = REGION_N;
  const idx = x * N + y;
  
  // Must be unclaimed land
  if (r.grid[idx] !== -1) return { ok: false, reason: 'Already claimed' };
  
  // Must be adjacent to a player cell
  const adjacent = [
    [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]
  ].some(([ax, ay]) => {
    if (ax < 0 || ax >= N || ay < 0 || ay >= N) return false;
    return r.grid[ax * N + ay] === this.playerFactionId;
  });
  if (!adjacent) return { ok: false, reason: 'Not adjacent to your territory' };
  
  // Check treasury
  if (this.treasury < 25) return { ok: false, reason: `Insufficient funds (need £25)` };
  
  return { ok: true };
}

claimCell(x: number, y: number): boolean {
  const can = this.canClaimCell(x, y);
  if (!can.ok) return false;
  
  const N = REGION_N;
  const r = this.computeTerritoryGrid();
  r.grid[x * N + y] = this.playerFactionId;
  this.treasury -= 25;
  this._territoryCache = null; // invalidate cache
  this.addLog(`Claimed land at (${x}, ${y})`, 'diplomatic');
  return true;
}
```

#### UI (`src/ui/regionview.ts`)

1. Add a "Claim Land" toggle button to the State panel
2. When active, pointer clicks on unclaimed cells invoke `r.claimCell(x, y)`
3. Show visual feedback: highlight claimable cells on the map with a distinct color

---

## 2. Enhanced Land Negotiation

### Current State

`buyLand(rivalId)` currently:
- Requires rival treasury < £150 (very narrow condition)
- Transfers the rival's least-populated non-capital settlement
- Costs £500

### Improvements

#### Diplomatic Conditions

Replace the hard treasury threshold with a **relations-based model**:

- **Hostile (relations < 0):** Cannot purchase land
- **Cold peace (0–30):** Can purchase only with significant economic pressure (rival deficit > 0 *and* player surplus > £200)
- **Neutral (30–60):** Can purchase with trade agreement in place
- **Friendly (60–100):** Can purchase more freely; may even offer settlements

#### Variable Cost

Make the cost scale with the settlement's population and value:

```typescript
settlementBuyoutCost(t: Settlement): number {
  const pop = this.popOf(t);
  const base = 400;
  return Math.round(base + pop * 2); // £400 + £2/pop
}
```

#### Improved buyLand()

```typescript
canBuyLand(rivalId: number): CanResult {
  const rival = this.rival(rivalId);
  const playerFaction = this.faction(this.playerFactionId);
  
  if (!rival || !playerFaction) return { ok: false, reason: 'Invalid rival' };
  if (rival.relations < 0) return { ok: false, reason: 'Relations too hostile' };
  
  // Find a purchasable settlement
  const purchasable = this.findPurchasableSettlement(rivalId);
  if (!purchasable) return { ok: false, reason: 'No purchasable settlements' };
  
  const cost = this.settlementBuyoutCost(purchasable);
  if (this.treasury < cost) return { ok: false, reason: `Insufficient funds (need £${cost})` };
  
  // Check diplomatic grounds
  const hasTradeAgreement = rival.treaties.includes('trade_agreement');
  const hasFriendlyRelations = rival.relations >= 60;
  const economicPressure = rival.deficit > 0 && this.treasury > 200;
  
  if (!hasTradeAgreement && !hasFriendlyRelations && !economicPressure) {
    return { ok: false, reason: 'Insufficient diplomatic standing' };
  }
  
  return { ok: true, reason: `£${cost}` };
}

buyLand(rivalId: number): boolean {
  const can = this.canBuyLand(rivalId);
  if (!can.ok) return false;
  
  const purchasable = this.findPurchasableSettlement(rivalId);
  if (!purchasable) return false;
  
  const rival = this.rival(rivalId)!;
  const cost = this.settlementBuyoutCost(purchasable);
  const playerFaction = this.faction(this.playerFactionId)!;
  const rivalFaction = this.faction(rivalId)!;
  
  // Transfer
  purchasable.factionId = this.playerFactionId;
  playerFaction.settlementIds.push(purchasable.id);
  rivalFaction.settlementIds = rivalFaction.settlementIds.filter((id) => id !== purchasable.id);
  
  // Treasury
  this.treasury -= cost;
  rival.treasury += cost;
  rival.relations += 5; // slight goodwill boost for peaceful transfer
  
  this.addLog(`Purchased ${purchasable.name} from ${rival.name} for £${cost}`, 'diplomatic');
  return true;
}

private findPurchasableSettlement(rivalId: number): Settlement | null {
  const rival = this.rival(rivalId);
  if (!rival) return null;
  
  // Prefer non-capitals, lower population, lower production
  const candidates = rival.settlementIds
    .map((id) => this.settlement(id)!)
    .filter((s) => s.id !== rival.capital)
    .sort((a, b) => this.popOf(a) - this.popOf(b));
  
  return candidates[0] ?? null;
}
```

#### UI Updates

In `drawRivalPanel()`, update the "Buy Land" button:

```typescript
const canBuyLand = r.canBuyLand(fid);
this.rivalPanel.innerHTML += 
  canBuyLand.ok
    ? `<button id="rival-buy-land-btn">Buy Settlement (${canBuyLand.reason})</button><br>`
    : `<button disabled title="${canBuyLand.reason}">Buy Settlement</button><br>`;
```

Show the cost dynamically based on which settlement would be purchased.

---

## 3. Tests

Add to `tests/conquest.test.ts`:

### Unclaimed Land

- [ ] `canClaimCell()` returns false for water
- [ ] `canClaimCell()` returns false for already-claimed cells
- [ ] `canClaimCell()` requires adjacency to player territory
- [ ] `canClaimCell()` requires £25 treasury
- [ ] `claimCell()` claims the cell and deducts treasury
- [ ] Territory grid updates immediately after claim

### Enhanced Land Negotiation

- [ ] `canBuyLand()` blocks hostile relations
- [ ] `canBuyLand()` requires diplomatic standing (trade agreement OR friendly relations OR economic pressure)
- [ ] Cost scales with settlement population
- [ ] Relations increase by +5 after successful purchase
- [ ] Least-populated non-capital settlement is selected

---

## 4. Balance Notes

- **Unclaimed land purchase at £25/cell:** This provides steady, predictable territorial expansion without combat. The cost ensures it's not free (meaningful treasury drain) but cheap enough to feel like a viable strategy by late game.
- **Economic pressure condition:** Allows player to exploit rival deficit without strict treasury threshold, rewarding economic mastery.
- **Relations bump on purchase:** Reflects the goodwill of buying rather than conquering; facilitates future deals.

---

## 5. Future Extensions (Phase 2+)

- **Disputed territory events** — Random border friction when player territory approaches rival territory
- **Strategic competition for unclaimed land** — AI rivals also purchase unclaimed land, creating races for key chokepoints
- **Land value fluctuation** — Cost changes based on local resources, trade routes, climate events
