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
- player profile and game registration
- personal Aureum wallet and transaction history
- player inventory/resources
- faction membership, position, permissions, treasury display, and faction resources
- player-owned characters
- formal action submission and personal action history
- player-visible world state and news
- map placeholder
- project/canon reference

### Game Master backend

The restricted admin interface controls authoritative game state.

Current framework includes:

- player directory
- faction creation and editing
- faction membership, rank, title, and permission assignment
- personal balance control with transaction ledger entries
- asset/resource catalog
- player asset assignment
- faction asset assignment
- action review, status, GM notes, and resolution
- world-state publishing
- news publishing

## Security model

Supabase Row Level Security is the primary authorization boundary.

Players cannot use the browser/API to read or modify another player's protected records. Player-owned rows are bound to `auth.uid()`. Faction data is controlled by membership policies. Administrative writes require membership in the private admin registry through `private.is_admin()`.

The frontend does not rely on hidden buttons for security.

## Main files

- `index.html` — session router
- `login.html` — player login and account creation
- `dashboard.html` — authenticated player dashboard
- `map.html` — temporary galactic map display
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
