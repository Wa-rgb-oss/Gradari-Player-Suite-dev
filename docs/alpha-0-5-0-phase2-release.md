# Gradari Mireris — Alpha 0.5.0 Phase 2 Release Notes
Date: 2026-10-29

## Delivery targets
Repository `Wa-rgb-oss/Gradari-Player-Suite-dev`, branch `main`.
Production Supabase project `tgszdvvitdijzkkbrlpl`.
This release extends existing systems rather than replacing player data or the established map engine.

## Delivered
- **Ship construction:** Three starter blueprints, existing Naval Yard facilities, verified faction military authority, treasury debit, Aetherite stockpile debit, crew converted from civilian population, world-hour construction scheduling, completion through world heartbeat, and ship commission into `ships`.
- **Fleets:** Formation in faction-held territory, ship assignment when co-located, automatic destination-based hex movement, public map location updates and daily fleet Aureum upkeep.
- **Army command:** New combined Military Command panel for movement, raids and conquest. Calls existing authorized RPCs, avoiding a duplicate battle command engine.
- **Daily army logistics:** Army recruitment and upkeep, food and energy drawn from reachable friendly populated supply hubs (up to three hexes along non-hostile paths), supply reports, and prohibition on offensives when isolated.
- **Battle simulation:** Scheduled ground and naval engagements resolved by the existing world heartbeat, attrition, unit/vessel damage, destroyed unit state and resulting battle reports.
- **Personnel accounting:** Ground casualty counts reduce enrolled military population at the system where troops were recruited. Destroyed commissioned vessels debit their crew from the originating system.
- **War and diplomacy:** Active two-faction war records, war score for raids/conquests and naval engagements, tracked territorial occupation, peace offers, accept/reject, and negotiated restoration/retention of occupied systems.
- **Contextual Actions:** New `fleet` context in Supabase; map and Player Suite selectors include fleets. Existing map military actions open the unified console.
- **Admin testing:** Server-validated Game Master military authority, without manufacturing faction members or changing existing faction leadership.
- **UI migration:** Existing legacy Army Orders visually retire only when modern Military Command successfully loads, preserving their code as fallback.

## Initial tuning
- Recruitment: 25 A per enlisted soldier, 0.50 A per soldier per 36-hour in-game day.
- Enlistment cap: 20% of combined system civilian and military population, leaving at least 100 civilians.
- Ship building: 20 A per hull strength, plus 5/15/30 Aetherite for corvette/frigate/cruiser.
- Ship building time: 2/4/8 × 36 in-game hours for those starter hulls.
- Fleet movement: 8 in-game hours per hex (direct destination selection).
- Fleet upkeep: 0.05 A per point of active ship strength per 36-hour in-game day.
- Army supplies: friendly supply corridor up to 3 hexes; 0.0002 food and 0.0001 energy per soldier per day, with small minimums.
These values are experimental and should be rebalanced after tests.

## Verified
- Database migrations applied successfully; RPC authorization checks show the restricted write functions are not callable by anonymous clients.
- The world heartbeat includes fleet movement/commission, ground and naval battle resolution, daily army and fleet upkeep and supply provisioning.
- Supabase function smoke tests ran successfully with no queued fleets, battles, or ship orders.
- Capital `HEX_-2_-2` resolves to a same-system friendly supply source.
- Frontend script syntax and active page structure checked during release.
- No simulated units, fleet orders, wars or peace agreements were left in the live database.

## Browser testing recommended
1. Log in as a Game Master; select the capital on Map and open Military.
2. Create a new army from local civilian population. Confirm army strength, population, treasury and ledger.
3. Issue a movement order to a nonadjacent hex; check world-clock travel progress.
4. At a friendly Naval Yard, build a Patrol Corvette. Verify Aetherite and Aureum were debited and completion produces a ship.
5. Create a fleet, assign the commissioned ship, and select a distant destination. Verify move and arrival.
6. Inspect army supplies and daily military and naval upkeep after a world day.
7. With another faction and contested hex available, test raids, conquest, battle reports, war score, naval engagement, peace offers and negotiated settlement.
8. Review mobile layouts and Contextual Actions on selected hexes, fleets, armies and factions.

## Current limitations
- Source-level and backend smoke checks do not substitute for authenticated, end-to-end browser testing or confirm GitHub Pages CDN publication.
- Ground and naval battle formulae are simplified strategic simulations, not a detailed equipment/commander/morale model.
- War-score values track outcomes but do not automatically force surrender; acceptance by an authorized opposing faction is required.
- The starter ship blueprint catalog uses deliberately small resource costs. Additional hull types, fleet cargo/transport and advanced blockade mechanics remain future balancing and feature work.
- Persistent shortage reports are available; extended morale/desertion and multiplayer notification experiences can follow after initial test feedback.
