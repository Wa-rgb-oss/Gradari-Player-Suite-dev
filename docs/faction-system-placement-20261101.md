# Faction System Placement — 2026-11-01

## Scope
Updated the **existing production map registry and system_economies** against the user's painted territory borders. Map continues to load from Supabase; no front-end code needed. The same hex IDs, existing facility records and territory paint remain unchanged.

## Canonical system designation relocations
| System | Previously | New hex | Faction |
|---|---|---|---|
| Syrethian Reach | HEX_-5_2 | HEX_-7_-3 | Accordant Spiral |
| Auris Somnarium | HEX_0_1 | HEX_-8_-3 | Accordant Spiral |
| Naexus Arc | HEX_-6_-2 | HEX_0_-4 | Bastion Front |
| Lorak's Chain | HEX_0_-2 | HEX_2_-5 | Bastion Front |
| Varn'cath Expanse | HEX_-4_-3 | HEX_-7_3 | Veiled Concord |
| Zenthori Vane | unchanged | HEX_-3_3 | Doctrine Pure |
| Virethon Primaris | unchanged | HEX_-2_-2 | Gradari Mireris Empire |

Canon source: Ranks of Fiction, *Core Constellium – The Seven Star Systems*. Faction assignments reflect the political bloc associations and **the user's current painted control**, which is a gameplay simplification rather than implying every Constellium system is canonically sovereign.

### Important preservation
The old Syrethian hex `HEX_-5_2` contains **seven player-owned facilities**. They remain exactly where built, along with their resources and ongoing economic records, under the label `Syrethian Industrial Holdings`. This was intentional; moving player structures to a remote hex silently would break location-specific investments. Other old source hexes were unlabelled but kept their existing system economy data, so no population or asset history was deleted or migrated.

## Six new developed systems (game-original provisional designations)
| New system | Hex | Faction |
|---|---|---|
| Arch-Lux Nexus | HEX_6_0 | Luminark Core |
| Vire-Lux Matrix | HEX_8_0 | Luminark Core |
| Tera-Lux Assembly | HEX_9_0 | Luminark Core |
| Solis Crown | HEX_8_-12 | Caelestis Concordat |
| Radiant Citadel | HEX_10_-10 | Caelestis Concordat |
| Dawnward Sanctum | HEX_12_-11 | Caelestis Concordat |

These names are **proposed names**, not verified canonical system names. They derive from existing Luminark Tri-Singularity and Caelestis solar-theocratic themes. Each is an actual developed system in `system_economies` with 8,000 starting residents, 2,500 food, 2,500 energy, and 30,000 population capacity. Existing relocated canonical identities receive 12,032 starting population at their new hexes. Every destination already belonged to its intended painted faction and was empty, with no active player facilities.

## Integrity
- `private.system_placement_audit` records the source labels and all destination additions for future review/reversal.
- Migration validates the exact target ownership, absence of existing system population, and absence of player facilities.
- No new `factions` or territorial borders were created. The Virelac Enclave, Horizion Systems Compact and other nonregistered powers do not yet have painted territory or registered faction records, so no speculative borders were assigned to them.
- No frontend changes needed. Existing Map renderer reads names, faction ownership, and developed-system economics from Supabase.

## Testing
Open the live Map, refresh, and check each named hex. Look for Syrethian Industrial Holdings at the old user facility location. Confirm the six new outlying systems appear at the existing Luminark and Caelestis color patches. Confirm no facilities were lost.
