# Alpha 0.5.0 Phase 1: Implementation and QA

Date: October 26, 2026. Gradari Supabase project: tgszdvvitdijzkkbrlpl.

## Backend implemented
- RLS-secured contracts, objectives, deadlines, cooldowns, verified and transaction-safe shared rewards.
- Temporary three-player parties, friendship invitations, membership, leadership succession.
- Server-validated visits, local food/energy deliveries, and political activity contracts. Seven starting assignments.
- Civilian reputation and career-specific research-perk bonuses.
- Population cap, growth, food and energy consumption, shortage decline, governmental taxation, local supply transfer, daily audit ledger.
- Seven populated canon systems (total 112,000 civilians), starting food/energy reserves, 631 configurable hex stability/difficulty records.
- Population tick integrated once per 36-hour in-game day; removed duplicate legacy industry-cycle population growth.
- Hex-by-hex adjacent movement, difficulty-dependent ETA, server-rolled variable piracy travel delays.
- Research branches for exploration/navigation, politics and general specialization; existing industrial research retained.
- Dynamic proximity events, first-discovery rewards and cooperative nearby discovery sharing.

## Frontend implemented
- Player Suite Contracts & Assignments: contract board, career filter, accept/cancel/verify, timed countdowns, resource deliveries, reputation, temporary party creation and invites.
- Map HUD: population, capacity, food, energy, demand, taxes, stability, movement difficulty, piracy, and nearby discovery markers.
- Map Character: adjacent travel restriction, difficulty ETA and piracy incident notification.
- Research: three-column tier layout extended for additional branches.

## Initial balance
- Growth 0.3 percent per full-supply game day, reduced by stability and proximity to capacity.
- Decline 0.1 percent under shortage; food/energy need 0.001 units per civilian per day.
- Tax 0.02 Aureum per civilian per day, scaled by stability and lowered under shortage.
- Capital starts at 40,000/80,000 civilians/capacity; six other developed locations start at 12,000/30,000 each.
- Initial population reserves cover approximately ten game days. All values are provisional for Alpha testing.

## QA performed
- Rollback-only signed-in contract acceptance, successful 100-Aureum claim, cooldown enforcement.
- Rollback-only party creation, friend invitation and acceptance with two members.
- Rollback-only adjacent map travel (server returned nine world hours).
- Rollback-only first/second civilian-day processing, proving repeated day processing adds no additional taxes or updates.
- Verified no test assignments, reputation records, party records or daily ledger entries persisted.
- Confirmed contracts (7), populated systems (7), hex condition records (631), discovery events (3), and navigation perks (3).
- Confirmed RLS on all new civilian tables and no anonymous EXECUTE permission for civilian RPCs.
- JavaScript syntax and HTML integration checks passed for the Player Suite, Map, and Research.

## Release cautions
- Changes to Gradari Supabase are applied. The GitHub feature branch must be merged to publish the new frontend.
- An authenticated desktop/mobile visual smoke test is still advised after publication; end-to-end multi-user play and the first full live civilian day require observation.
- Phase 2 recruitment, military accounting and warfare are not implemented in this release.
- Existing shipyard manpower remains legacy until Phase 2 migration. Do not mix it with the reserved military_population field.
