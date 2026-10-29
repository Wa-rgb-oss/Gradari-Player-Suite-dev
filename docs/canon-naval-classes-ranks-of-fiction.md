# Canonical naval ship classes — Ranks of Fiction

Primary source: `Ranks of fiction(2).pdf`, **Gradari Mireris Ship Classes**, printed pages **100–104**.
The source explicitly establishes itself as primary canon, superseding secondary operations and player-created expansion.

## Five canonical major vessel classes

| Class | Purpose | Crew | Troop capacity | Strike craft |
|---|---|---:|---:|---:|
| Auris-Class Doctrine Frigate | Escort / tactical support | 1,200–1,600 | 1,200 | 12–18 |
| Severan-Class Line Destroyer | Fleetline combat | 4,500–6,000 | 4,800 | 40–60 |
| Cindarion-Class Siege Cruiser | Siege / blockade | 9,000–11,000 | 20,000 | 80–120 |
| Aurelian-Class Assault Cruiser | Heavy assault / occupation | 15,000–18,000 | 400,000 | 200–250 |
| Virelion-Class Command Carrier | Fleet command / joint deployment | 18,000–22,000 | 40,000 | 250–300 |

## Operational canon caveats
- Cindarion planetary deployment is restricted by the Decree of Siege Restraint: command authority must be sanctioned; see printed pages 10–11 and 102–103.
- Aurelian assaults often require dual sanction from Praetora Victorum and the Ethrenari Council (p. 104).
- Virelion command carriers are reserved for Valorae Grand Admirals or Praetora Emperis oversight (p. 100).
- The document also defines *strike craft*, separate from capital hulls: Falx-IV Spireblade, Kireth-7 Doctrine Fang, Morvex Weighing Hammer, Volthera Tithe Drop (pp. 104–105). They are **not** implemented as standalone buildable ship blueprints here.

## Implementation notes
- The old three test blueprints remain in the database but are not player-visible. This preserves foreign-key relationships and historical records.
- The five canonical classes are displayed in the shipyard.
- Game-defined `strength`, `build_cycles`, `resource_costs`, and calculated 20 A/strength price are **provisional game balance**, not canon. The canonical Auris frigate's economic reference is ₳240–320 million on printed page 54, materially different from current test-game costs. A dedicated economy rebalancing is needed before claims of lore-accurate costs.
- The backend currently deducts the **minimum crew** on construction; troop capacity and strike-craft counts are descriptive specifications, not automatically filled cargo.
- Restrictions currently appear as descriptive metadata. Rank-based launch/deployment approvals and specialized ship abilities require dedicated authorization/gameplay work; do not represent these as enforced.
