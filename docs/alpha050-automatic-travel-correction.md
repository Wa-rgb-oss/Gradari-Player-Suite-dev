# Alpha 0.5.0: Automatic Multi-Hex Character Travel

Corrects the earlier adjacent-only player interface.

- Players select any valid destination hex once; the server plans a route across each intermediate visible hex and returns the total ETA.
- Each leg uses the destination hex's movement difficulty, navigation research adjustment and possible piracy delay.
- Each route is persisted as a waypoint array with individual world-hour arrivals. The heartbeat advances the character automatically one or more completed steps; no new orders required.
- Existing journeys created before this migration continue using the original single-route completion logic.
- Map previews the server-computed route, displays a single actionable travel button, draws all legs, animates the character along the path, and updates the movement HUD while the journey is active.
- The actual server-authoritative character location changes at waypoint arrivals, with read-only periodic synchronization.

## Verification

- Authenticated route preview from HEX_-2_-2 to HEX_-6_-2 returned four legs with five waypoints, total 39 world hours before any future piracy incident.
- A rollback-only test started this route, advanced one intermediate hex while keeping the character in travel status, then advanced the final legs and confirmed stationary status at the destination.
- Confirmed player had no active trips and remained stationary after rollback.
- Confirmed preview RPC is callable only by signed-in users.
- Map JS syntax and eight frontend structure checks passed.

## Changes

- Supabase migration: 20261027033000_alpha050_automatic_hex_routes.sql
- map.js
- map/index.html

This applies only to civilian character travel. Army and Phase 2 military movements remain unchanged.
