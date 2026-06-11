# Milestone 2 — Raids, Medicine & Relationships (COMPLETE)

## Raids

First raid day 11–15; every 8–12 days after. Raider count = min(2+wealth/400, 2+days-since-first/15), cap 9. Wealth = grain+meals+**0.2×wood**+8×pop+15×buildings — wood discounted to 0.2× after pre-fix where chopped stockpiles summoned 8 raiders at day 12 (5–7 deaths, grief death-spiral). Calendar cap stops early snowballing.

Raider AI: advance on the nearest settler who stands their ground (hiders only hunted when no one fights); if walled out, chew through nearest palisade (50 dmg/h, 80 hp); flee at 18 h timeout. Settler auto-response: fight if combat ≥ 3 + health > 50, else flee indoors. Combat stat 0–10 grows in battle; damage = (30+6×combat)/hour both sides. Palisade (3 wood, 1×1) blocks all movement — kill-box play emerges from pathfinding.

## Medicine

Wounds → bleed 0.8 hp/h until treated; untreated 12 h → 25% infection (−1.2 hp/h, lethal if ignored); untreated 24 h → scars over. Fever event: 1–3 settlers, −0.5 hp/h, ×0.6 work, 2–3 days. `medic` work (30 min at location): stops bleeding, cures infection, halves fever. Below 50 hp → bed rest (hunger still wakes them — M1 lesson kept).

## Relationships

Opinion +0.8/h when co-recreating within 3 tiles; ≥15 = friendship. Friend death: −18 mood × 6 days vs −8 × 4 days for strangers. This relationship data is the direct input to Notables scoring in M3 (total skills + combat + 5×friendships).
