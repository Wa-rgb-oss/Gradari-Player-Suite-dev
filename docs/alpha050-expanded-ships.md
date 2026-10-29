# Expanded Naval & Civilian Vessels — Alpha 0.5.0

## Canonical vessels retained
Existing warship roster: Auris Doctrine Frigate, Severan Line Destroyer, Cindarion Siege Cruiser, Aurelian Assault Cruiser, Virelion Command Carrier.

## Canonical strike craft added
Source: Ranks of Fiction, printed pp. 104–105.
- Falx-IV Spireblade (interceptor, crew 1)
- Kireth-7 Doctrine Fang (assault fighter, crew 1)
- Morvex-Class Weighing Hammer (strategic bomber, crew 3)
- Volthera Tithe Drop (dropship, 24–36 soldier capacity / one Domitium walker; prototype uses 36, crew 4)

## Newly coined Gradari-class names
These names are **game-original additions**, not claims about Ranks of Fiction primary canon.
- **Surneth-Class Logistics Tender** — carries fleet supplies; cargo 2,000
- **Varion-Class Troop Transport** — capacity 10,000 soldiers; cargo 600
- **Kelvar-Class Repair Tender** — repairs allied ships using faction ship components; cargo 900
- **Sereth-Class Reconnaissance Vessel** — reconnaissance designation; cargo 120
- **Lorak-Class Merchant Freighter** — bulk civilian cargo transport; cargo 6,000

## Current mechanics
- All nine newly added blueprints are available in the existing faction shipyard production workflow, alongside five canonical warships.
- `ship_blueprints.vessel_category` divides Warships, Military Support, Strike Craft and Civilian.
- New capacities/metadata describe crew, hangars, cargo, doctrinal role, and canon status.
- Fighter/dropship hangar assignment to eligible host vessels is enforced by faction authorization and available hangar slots.
- Cargo loading/unloading consumes/returns resources in the faction stockpile; only in friendly-held territory and not during fleet movement. Cargo remains with each ship.
- Troop embark/disembark works on colocated faction transport-capable ships. Embarked armies follow the transport fleet between hexes and cannot independently move or launch ground operations.
- Repair tender restores damaged allied ship hull using 1 ship component per 10 strength restored (rounded up).
- Existing naval combat/shipyard mechanics continue to apply basic strength to ships.

## Current gaps / future polish
- Reconnaissance does not yet reveal fog-of-war or provide intelligence bonuses.
- Logistics tenders carry resources but do not automatically transfer them into army supply corridors outside friendly territory.
- Strike craft are produced as individual `ships`, not squadron bundles; launch/recovery and class-specific combat bonuses are not modeled.
- Civilian freighters currently use the faction-owned shipyard and military command flow; independent player civilian shipping, trade route orders, and player-operated cargo ownership need a separate economy/permissions design.
- Capital-ship canon hangar capacity currently uses the minimum canon strike-craft count.
- New costs/strength/build durations and support-vessel names are deliberately provisional gameplay design and not primary-document canon.
- No automated production/combat end-to-end test was executed on production; no ships or build orders were created.

## Test sequence
1. On Map > Military, choose one of the four blueprint categories and see its vessel list.
2. At a faction naval yard, queue one support vessel or fighter.
3. After production completes, form a fleet and assign a host vessel.
4. Embark strike craft into a ship with hangar slots; verify capacity.
5. Load cargo from faction resources, move to friendly territory, unload and compare faction stockpiles.
6. Embark an army, move fleet, confirm the army arrives attached to its transport, then disembark.
7. Damage a vessel in combat and test the repair tender if supplies are present.
8. Verify the experience on mobile and that old gameplay actions remain usable.
