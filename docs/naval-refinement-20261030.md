# Naval Systems Refinement — implementation and test plan
Deployment date: October 30, 2026. Source branch: `main`; production Supabase project `tgszdvvitdijzkkbrlpl`.

## Changes delivered
1. **Consolidated Map command interface:** Seven responsive categories (Army Command, Fleet Command, Shipyards, Logistics, Warfare, Military Records, Civilian Shipping). Old controls stay in DOM for existing handlers, while duplicate original wrappers are hidden only if the new navigation successfully initializes.
2. **Distinct shipyard roles and levels:** Naval Yard produces military/strike/support vessels. Civilian Shipyard owned by an individual player produces civilian freighters. Naval levels: 1 for Auris, support and fighters; 2 for Severan; 3 for Cindarion, Aurelian, Virelion. Existing Level 1 faction Naval Yard remains level 1 (not artificially upgraded).
3. **Player-operated civilian vessels:** `ships.owner_user_id`, personal shipyard orders paid by player's Aureum and `player_resources`, automatic world-hour commissioning, personal vessel movement to arbitrary hex destinations, personal cargo loading/unloading at governed systems, voyage history. A civilian freighter is attached to the governing faction for existing FK compatibility, but the owner retains operational control.
4. **Logistics tenders:** Secure supply delivery consumes actual onboard food/energy and adds them to the friendly developed system's economy, which existing army supply ticks can use.
5. **Reconnaissance:** Authenticated faction-commanded Sereth vessels scan within three hexes and write faction-accessible reports of hostile vessels and their combined strength.
6. **Civilian/military separation:** Player-owned vessels cannot join military fleets or be counted in military engagement ship totals; personal cargo is not accessible through faction stockpile transfer calls. Merchant ship data is visible only to owner and admins via RLS.

## Testing
- Sign in and open Map > Military. Verify seven navigation categories, responsive layout and unchanged map.
- At a faction Naval Yard: verify the level-1 site cannot build Severan or capital cruisers and instead shows the requirements.
- Build a Civilian Shipyard via the existing Map construction flow; select the hex in Civilian Shipping and order Lorak-Class Merchant Freighter using personal wallet and resources. Verify your wallet/resources are debited.
- After construction world time: confirm `ships.owner_user_id` is populated; embark no military crew from system population; ship visible in Civilian Shipping.
- Load personal resources at a governed location, sail across multiple hexes, confirm arrival, unload, open Exchange Markets for manual trade; inspect voyage history.
- Produce Sereth scout and Surneth tender in Naval Yard; scan nearby target, inspect report; load tender food or energy and deliver to friendly system; confirm stockpile quantities.
- Test army, fleet, cargo, hangars, repairs, naval battle and diplomacy tabs.
- Verify another ordinary user does not see your private merchant ship/cargo.

## Known limitations
- **Recurring automated trade routes / direct cargo contracts** have not been implemented. Travel, manifests, owner-controlled loading/unloading and trade-market navigation are operational foundations; selling/buying remain through existing markets.
- **Class-specific fighter combat bonuses and squadron management** are not implemented; strike craft retain hangar slots and baseline hull-strength simulation.
- **Recon fog-of-war masking** is not yet implemented. Reports provide reconnaissance functionality, but existing galaxy visibility is unchanged.
- **Full browser acceptance test and Pages CDN propagation** could not be independently confirmed from this execution environment. GitHub `main` source and Supabase production changes were committed/applied.
- Existing active Naval Yard is level 1. There is no civilian shipyard currently in the world; players must build one first.
- Existing Supabase security advisor lists broader legacy security-definer warnings. New public RPCs explicitly revoke anonymous execution and check authorization internally. A separate systematic RPC-security audit remains advisable.

## Rollout protection
All migrations are additive except narrowing player-owned ship SELECT policy. No live ships, build orders or voyages were inserted or deleted by deployment. No pre-existing user/faction balances were changed by deployment.
