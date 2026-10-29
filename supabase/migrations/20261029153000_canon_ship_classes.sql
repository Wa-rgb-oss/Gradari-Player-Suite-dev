-- Ranks of Fiction primary-canon naval roster, pp. 100–104.
-- The pre-canon test blueprints are retired, not deleted, to preserve historical references.
alter table public.ship_blueprints
  add column if not exists canon_source text,
  add column if not exists doctrine_function text,
  add column if not exists crew_min integer,
  add column if not exists crew_max integer,
  add column if not exists troops_capacity integer,
  add column if not exists strike_craft_min integer,
  add column if not exists strike_craft_max integer,
  add column if not exists deployment_restriction text;
update public.ship_blueprints
set player_visible=false
where code in ('patrol_corvette','line_frigate','heavy_cruiser')
  and canon_source is null;
with canonical (code,name,hull_type,description,crew_min,crew_max,troops_capacity,craft_min,craft_max,doctrine,strength,cycles,aetherite,restriction) as (
 values
 ('auris_doctrine_frigate','Auris-Class Doctrine Frigate','frigate',
  'Escort and tactical support. Harmonic shielding, de-escalation protocols, Archivora Archive Core.',
  1200,1600,1200,12,18,'Preservation of Ethren',350::numeric,4,15::numeric,null::text),
 ('severan_line_destroyer','Severan-Class Line Destroyer','destroyer',
  'Mid-range fleetline combatant. Twin Vyr-Storm Cannons, rotating Aether Shields, Inspectorium Pods.',
  4500,6000,4800,40,60,'Strategic Engagement / Doctrine Enforcement',900::numeric,6,25::numeric,null::text),
 ('cindarion_siege_cruiser','Cindarion-Class Siege Cruiser','siege_cruiser',
  'Planetary siege and blockade enforcement. Orbital Descent Cannons, Civil Compliance Array, gravity anchors.',
  9000,11000,20000,80,120,'Tactical Suppression / Strategic Compliance',1400::numeric,10,45::numeric,
  'Planetary attacks require authorization by the Circle of Accord or Emperis; shared operational/doctrinal command under the Decree of Siege Restraint.'),
 ('aurelian_assault_cruiser','Aurelian-Class Assault Cruiser','assault_cruiser',
  'Heavy assault and planetary breach. Four Vyr-Storm Cannons, troop-drop hangars, Crush Array.',
  15000,18000,400000,200,250,'Hammer of Compliance',1900::numeric,12,65::numeric,
  'Major assaults often require dual sanction from Praetora Victorum and Ethrenari Council.'),
 ('virelion_command_carrier','Virelion-Class Command Carrier','command_carrier',
  'Fleet coordination and multi-branch deployment hub. Concord Command Node, strike-wing bays, Doctrine Amplifiers.',
  18000,22000,40000,250,300,'Strategic Harmony',2300::numeric,16,85::numeric,
  'Reserved for Valorae Grand Admiral or Praetora Emperis oversight.')
)
insert into public.ship_blueprints
 (code,name,hull_type,description,resource_costs,manpower_cost,build_cycles,strength,player_visible,
  canon_source,doctrine_function,crew_min,crew_max,troops_capacity,strike_craft_min,strike_craft_max,deployment_restriction)
select c.code,c.name,c.hull_type,c.description,jsonb_build_object('aetherite',c.aetherite),
       c.crew_min,c.cycles,c.strength,true,
       'Ranks of Fiction, pp. 100–104',c.doctrine,c.crew_min,c.crew_max,c.troops_capacity,c.craft_min,c.craft_max,c.restriction
from canonical c
where not exists (select 1 from public.ship_blueprints existing where existing.code=c.code);
