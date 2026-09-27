# Gradari Player Suite — Development

This repository is the active development copy of the Gradari Mireris game client.

## Repository boundary

- `Wa-rgb-oss/Gradari-Player-Suite` — original project, read-only.
- `Wa-rgb-oss/Gradari-Player-Suite-dev` — active development repository.

## Product model

The site is the front end of the Gradari Mireris game and is divided into two authority surfaces:

### Player frontend

Authenticated players can access only their own player-owned data and faction information allowed by their membership.

Current framework includes:

- persistent login/account session
- live canon world clock
- player profile and game registration
- personal Aureum wallet and transaction history
- inventory, resources, holdings, markets, and automated economy cycles
- faction founding, membership, permissions, treasury, markets, leadership, and resources
- one active living character with travel, death, and succession continuity
- interactive hex map with territory, character location, holdings, armies, raids, and conquest
- Senate seats, Influence, legislation, political activity, offices, candidacy, elections, and Imperial taxation
- events, objectives, rewards, formal actions, world state, and news
- project/canon reference

### Game Master backend

The restricted admin interface controls authoritative game state.

Current framework includes:

- player and character administration, including character death records
- faction creation, leadership succession, membership, permissions, treasury, markets, and resources
- personal and faction economy controls with transaction ledgers and automated cycle history
- asset/resource catalog, holdings, facility production, and market administration
- authoritative map registry, territory, location modifiers, armies, travel, raids, and conquest
- Senate seats, Influence, political actions, offices, elections, legislation, policy, and Imperial taxation
- live world-clock controls and automated world processing
- event/campaign administration, action review/resolution, world-state publishing, and news publishing

## Security model

Supabase Row Level Security is the primary authorization boundary.

Players cannot use the browser/API to read or modify another player's protected records. Player-owned rows are bound to `auth.uid()`. Faction data is controlled by membership policies. Administrative writes require membership in the private admin registry through `private.is_admin()`.

The frontend does not rely on hidden buttons for security.

## Main files

- `index.html` — session router
- `login.html` — player login and account creation
- `dashboard.html` — authenticated player dashboard
- `map.html` / `map.js` — interactive galactic hex map and world interaction layer
- `player-suite.html` — player economy, inventory, faction, characters, actions, and canon
- `player-suite.js` — player interactions
- `player-data.js` — shared player-state loader
- `about.html` — project overview
- `admin.html` — restricted Game Master backend
- `admin.js` — admin controls
- `auth.js` — persistent Supabase session handling
- `ui.js` — shared UI helpers
- `styles.css` — shared command-console visual system
- `legacy-player-suite.html` — preserved original Player Suite

## Visual direction

Mid-2000s military science-fiction command console: angular HUD panels, technical typography, cyan/steel instrumentation, restrained amber indicators, tactical grids, and dense system readouts.


## Senate politics

Gradari includes a Senate politics framework.

- Influence is a character-level political currency with its own ledger.
- Factions can hold Senate seats.
- Senate voting is faction-based and weighted by the number of seats controlled.
- Faction leaders automatically retain political authority and can delegate the `politics` permission to members.
- Authorized characters can spend Influence to sponsor legislation.
- Passed Senate bills automatically enter the policy register.
- Policies can carry structured effects for later integration with economy, military, map, and character systems.
- Imperial factions have a configurable Imperial tax rate.
- Imperial tax assessments apply to configured faction-generated Aureum revenue, not member deposits or founding capital.
- The First Consul and Senate chamber are controlled from the Game Master backend.

The Politics player page is `politics.html`. Politics administration is part of the restricted `admin.html` backend.

### Offices and elections

- Political offices are configurable by the Game Master rather than hardcoded beyond the seeded First Consul office.
- An office can be filled by appointment, a Senate-seat-weighted election, or a one-player-one-vote election.
- Elections run against the canon world clock, with scheduled opening and closing handled by the world heartbeat.
- Living characters may declare candidacy when they meet an office's Influence requirement.
- Resolved elections assign the winning character to the office; dead characters are automatically withdrawn and vacate held offices.
- Election results can remain hidden until resolution, while the voter's own vote remains visible to them.


The uploaded legacy Senate, economy, and map HTML files are design references only and are not part of this implementation.


## Character continuity

- Each player may have one active living character at a time.
- Characters have explicit life status: `alive` or `dead`.
- Deceased characters remain in the historical Record and cannot be deleted by normal players.
- When a character dies, physical presence and character-based political actions stop immediately.
- A player may create a new living character after the prior character is deceased.
- Character Influence remains attached to the deceased character as historical political capital. A configurable succession percentage controls how much political standing, if any, transfers to the successor; the default is 0%.
- Player-account Aureum, inventory, facilities, and faction membership remain account-level and continue across character succession.
- Character succession is recorded as predecessor → successor history for the player.
