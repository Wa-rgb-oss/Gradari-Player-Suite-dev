# Gradari Mireris Alpha 0.5.0, Phase 1

## Implementation status (2026-10-26)

This branch starts Phase 1 using the current `Gradari-Player-Suite-dev` codebase. Nothing here has been merged into `main` or applied to the production Gradari database.

### Completed on this branch

- Added a `Contracts & Assignments` tab to the existing Player Suite without replacing the existing layout or styling.
- Added a civilian contract board that loads authorized contracts and the current player's assignments.
- Added a secure, atomic contract-acceptance RPC; players cannot directly insert their own assignments or award themselves rewards.
- Added the first SQL migration for civilian contracts and assignment state.
- Added a separate, non-destructive migration extending the existing `system_economies` model with population capacity, military-population tracking, and local energy storage.
- Added hex stability/movement-difficulty data structures, an audit ledger for future population-day processing, and a read-only population preview helper.

### Not implemented yet

- Contract objectives/completion and Aureum/reputation/research-point payouts.
- Temporary three-player parties and cooperative contract enrollment.
- Canonical in-game world-clock deadline processing.
- Civilian population's actual daily energy/food deduction, growth and taxation.
- Local energy production/supply mapping.
- Hex travel, piracy/discovery events, navigation research, and other Phase 1 roadmap items.
- Phase 2 recruitment and warfare.

### Existing system compatibility findings

1. The current game already uses `public.system_economies.population`, `manpower`, and `food`.
2. The legacy `run_industry_cycle()` already changes population and manpower. The new population simulation must replace/integrate its existing logic rather than process twice.
3. The existing `queue_ship_construction()` spends local manpower but does not explicitly transfer civilians into military personnel. Phase 2 will require a careful reconciliation of active ships and any queued orders, with no inferred or duplicated personnel.
4. Existing `ship_blueprints`, `ships`, and `shipyard_orders` should be extended, not duplicated.
5. Production/stability/taxing rules are **not** activated by these migrations. Balance constants remain unset pending user approval.

### Database deployment blocker

The currently connected Supabase project is the **CleanFreaks** project, not the Gradari database. Gradari's configured Supabase project (visible in `auth.js`) is not accessible through the active Supabase connector. **Do not apply these migrations to CleanFreaks.**

Once Gradari Supabase access is enabled, inspect its live schema/migrations, back up relevant data, verify function and policy dependencies, and apply these migrations in timestamp order. Then run database-level security and concurrency tests.

### Review / testing checklist

- [ ] Confirm GitHub branch contains only intended modifications.
- [ ] Check JavaScript syntax, HTML panel/tab anchors, and CSS compatibility.
- [ ] Validate SQL migrations on a Gradari staging database and confirm `private.is_admin()` is available.
- [ ] Test authenticated and anonymous RLS access for both new tables.
- [ ] Verify two simultaneous accept requests cannot create two active assignments.
- [ ] Verify players cannot modify payouts or mark their own assignments completed.
- [ ] Verify contract board loads and shows database-unavailable fallback safely.
- [ ] Check desktop and mobile tab navigation and direct `#contracts` link.
- [ ] Audit current population/manpower/ship order totals before activation.
- [ ] Confirm that the live game behavior does not change until migrations and features are intentionally released.

### Next implementation sequence

1. Connect the correct Gradari Supabase project and validate pending migrations.
2. Finish contract completion/rewards and canonical world-clock deadlines, with transaction-safe payouts.
3. Add three-person temporary parties, invites, cooperative acceptance and eligibility.
4. Expand research/network career rules; implement hex travel, conditions, proximity discoveries.
5. Integrate a **single** daily civilian population tick with growth caps, local food/energy accounting, taxation, and reconciliation logs.
6. Test Phase 1 end-to-end before beginning Phase 2.
