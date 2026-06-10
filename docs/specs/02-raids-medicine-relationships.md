# Milestone 2 Spec — Raids, Medicine & Relationships

Completes the Tier-1 threat class from the GDD (§8.4: "raids, disease,
famine, harsh weather") and starts the relationship layer that the
Notables system (GDD §2.4) will later inherit.

## Raids & defense

- **Scheduling:** first raid day 11–15, then every 8–12 days.
- **Scaling — wealth and time:** raiders = min(2 + wealth/400, 2 + days-since-first/15),
  capped at 9. Wealth = grain + meals + 0.2·wood + 8·pop + 15·buildings —
  prosperity attracts trouble, but the calendar cap stops early snowballing
  (a rich day-12 colony still only sees 2 raiders).
- **Raider AI:** approach from a map edge → advance on the nearest settler
  *who is standing their ground* (hiders are only hunted when no one
  fights); if walled out, break the nearest palisade (50 dmg/h, palisade
  80 hp); flee at timeout (18 h) or when the colony kills them.
- **Settler response (automatic):** combat ≥ 3 and health > 50 → fight;
  otherwise flee indoors. Combat is a separate 0–10 stat that grows in
  battle. Damage for both sides: (30 + 6·combat)/hour in melee.
- **Palisade** (3 wood, 1×1): blocks all movement when built. Players leave
  gaps and create choke points; raiders path through gaps or chew through
  walls — kill-box play emerges from the pathfinding, not from script.

## Medicine

- **Wounds:** any combat damage leaves a wound — bleed 0.8 hp/h until
  treated; untreated 12 h → 25% infection (−1.2 hp/h, lethal if ignored);
  untreated 24 h → scars over on its own (you can gamble).
- **Fever event:** 1–3 settlers sick for 2–3 days: −0.5 hp/h, work ×0.6.
- **`medic` work type:** treats the wounded/infected/feverish where they
  lie (30 min work): stops bleeding, cures infection, halves fever.
- **Bed rest:** below 50 hp settlers put themselves to bed and stay there
  (hunger still wakes them — Milestone 1's lesson, kept).

## Relationships

- Pairwise opinion grows 0.8/h when settlers recreate together (≤3 tiles);
  ≥15 = friendship, shown in the inspector.
- A friend's death is −18 mood for 6 days vs −8 for 4 — grief now has a
  social structure, which is the seed of the Notables attachment carve-out.

## Balance evidence

- 60-day default scenario: raids of 2→4 raiders arrive on ramp; colony
  repels them with ~1 death (wounds) — drama without wipeout.
- Pre-fix failure worth remembering: raid size keyed on raw wealth let
  chopped wood stockpiles summon 8 raiders on day 12 (5–7 deaths, then a
  death-spiral of grief-driven mental breaks). The 0.2 wood discount and
  the calendar cap are the fix.

## Deferred

Player-drafted combat (settlers auto-respond for now), ranged weapons,
graves/funerals, rival-town raid sponsorship (arrives with the Tier-2
proto-diplomacy), animal threats.
