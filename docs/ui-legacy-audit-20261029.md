# Alpha 0.5.0 — live UI and legacy-system audit (2026-10-29)

## Scope
Audited the active GitHub Pages entry points (public landing, login, home, map, Player Suite, politics, research, markets, News & About, admin), their shared authentication/client-side UI dependencies, and the production Supabase schema. This is a **non-destructive cleanup**; the current game database remains authoritative.

## Removals and replacements

| Older/redundant implementation | Current implementation | Action |
| --- | --- | --- |
| Standalone `legacy-player-suite/index.html` with separate styling and form experience | `player-suite/` with account, characters, facilities, factions, contracts and Contextual Actions | Retired old interactive page; replaced with a canonical redirect. Existing bookmarks still work. |
| Duplicate authentication library `auth-20261007-v3.js` beside outdated `auth.js` | One `auth.js`, including password reset, account confirmation, and existing sessions | Updated all ten inspected active player/admin entry pages to load the unified library and removed duplicate file. |
| Second row of map-editor category tabs (`.admin-map-subtabs`) below the modern ribbon | Current Revit-inspired editor ribbon (`data-map-ribbon`) | Suppressed duplicate visible nav while keeping its original buttons in DOM for existing JS event handlers and state sync. |
| Additional `OPEN MARKET` button in the old Map location-control card | Contextual `Open Market` action with RPC eligibility | Concealed redundant button **only if** a permitted contextual market action is rendered; old button remains as a fallback if action discovery fails. |
| Generic `LOCATION ACTIONS` heading for specialized refinery/factory/shipyard controls | Contextual Actions for selection; `FACILITY OPERATIONS` for specialized management | Updated presentation label; retained functional control forms and their existing backend paths. |

## Audited but intentionally retained

- Map Location, Character, Military, Build, Display *detail panels*: these host actual live forms and telemetry. Contextual Actions opens them, rather than reimplementing validation. Removing these panels would break travel, building, recruitment, and military orders.
- Player Suite *Formal Action submissions* (`actions_tab`): not the same as Contextual Actions; these are Game Master-reviewed roleplay requests and remain live.
- Player Suite registration (`players_tab`) vs `player_profiles`: different business purposes; both remain in the current application.
- Player facility controls and production/stockpile schedules: retained because Contextual Actions is a launcher and not an alternative production engine.
- `ships`, `shipyard_orders`, `armies` and military/population ledgers: empty tables are not necessarily obsolete; ships and military systems are still being developed.
- Supabase tables, migration history, triggers, RLS policies, characters, and player records: none were dropped or rewritten in this UI audit.

## Verification performed
- Inspected live repository file contents and active page script references, including `factions/create/`.
- Confirmed new authentication library contains both existing session/API methods and current recovery methods.
- Confirmed the inspected active pages no longer reference the retired auth filename prior to deletion; subsequently checked and updated the faction creation route too.
- Verified legacy Player Suite redirects to the current route.
- Verified current Admin Map ribbon includes all six underlying editor categories: World, System, Industry, Ships, Labels, Tools.
- Preserved the original event-handling tab controls in the DOM.
- No production data was deleted.

## Outstanding browser QA
1. Hard-refresh login and test login, logout, reset-password UI, and account recovery.
2. Open admin Map; confirm the ribbon alone switches between all six tool sets.
3. Open Player Suite via `/legacy-player-suite/`; confirm redirect to `/player-suite/`.
4. Select a map hex containing a trade station; verify a single visible Open Market action (fallback applies on API failure).
5. Select a map hex with facilities and verify refinery/factory controls still work.

## Future candidates (not removed)
- Consider replacing the remaining Map detail-tab strip with a fully action-first panel only after Contextual Actions has equivalent buttons for location details, display settings, all military operations, and standalone travel status.
- Consolidate persistent route-specific version parameters into a release-asset versioning strategy to reduce stale cache issues.
- Audit Supabase privileged RPCs separately before deleting or changing policies; legacy-sounding names alone are insufficient evidence of disuse.
