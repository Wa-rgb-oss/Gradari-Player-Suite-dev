# Gradari Player Suite — Development

This repository is the development copy of the Gradari Mireris Player Suite.

## Repository boundary

- `Wa-rgb-oss/Gradari-Player-Suite` — original project, treated as read-only.
- `Wa-rgb-oss/Gradari-Player-Suite-dev` — active development repository.

## Current structure

- `index.html` — session router
- `login.html` — player login and account creation
- `dashboard.html` — authenticated home / command dashboard
- `map.html` — temporary galactic map display
- `player-suite.html` — player registration, formal actions, canon reference
- `about.html` — project overview
- `admin.html` — restricted Game Master administration
- `reset-password.html` — GM password recovery
- `legacy-player-suite.html` — preserved copy of the original Player Suite
- `styles.css` — shared command-console visual system
- `auth.js` — persistent Supabase player session handling
- `ui.js` — shared authenticated UI helpers
- `player-suite.js` — Player Suite behavior and Supabase record submission

## Development direction

The interface is being rebuilt around a mid-2000s military science-fiction command console aesthetic with angular HUD panels, technical typography, cyan/steel instrumentation, restrained amber status accents, and dense tactical information presentation.
