-- Alpha 0.5.0 Phase 1: initial repeatable Imperial civilian contracts.
-- All rewards are verified by server-side objective state, not browser claims.
insert into public.civilian_contracts(
code,title,description,career_path,status,difficulty,min_party_size,max_party_size,
reward_aureum,reward_reputation,reward_research_points,
location_ref,objective_kind,objective_resource_code,objective_quantity,duration_game_hours)
values
('ALPHA050_SURVEY_BEACON','Survey the Imperial Beacon',
 'Travel through adjacent hexes and inspect the survey beacon northeast of the Imperial capital.',
 'exploration','active',1,1,3,180,4,2,'HEX_-2_-1','visit_hex',null,0,72),
('ALPHA050_CAPITAL_PATROL','Imperial Civilian Survey',
 'Report in from the capital system. All participants must be present to complete the assignment.',
 'exploration','active',1,1,3,100,2,1,'HEX_-2_-2','visit_hex',null,0,36),
('ALPHA050_CIVIC_SERVICE','Imperial Civic Service',
 'Complete a new political activity after accepting this contract. Each participant must contribute a qualifying action.',
 'political','active',2,1,3,240,5,2,null,'political_activity',null,0,72),
('ALPHA050_FOOD_RELIEF','Virethon Food Relief',
 'Deliver ten units of food from your personal or authorized faction stores to the Virethon Primaris population.',
 'economic','active',2,1,3,450,5,2,'HEX_-2_-2','supply_system','food',10,108),
('ALPHA050_ENERGY_RELIEF','Virethon Energy Relief',
 'Deliver eight units of energy from your personal or authorized faction stores to the Imperial capital.',
 'economic','active',2,1,3,420,5,2,'HEX_-2_-2','supply_system','energy',8,108),
('ALPHA050_TRIPLE_EXPEDITION','Three-Citizen Expedition',
 'Assemble three friends in a temporary party and travel together to the specified hex.',
 'exploration','active',4,3,3,1500,15,9,'HEX_0_1','visit_hex',null,0,324),
('ALPHA050_DUAL_SURVEY','Cooperative Cartography',
 'Two explorers must reach the Syrethian Reach and report their findings.',
 'exploration','active',3,2,2,900,10,6,'HEX_-5_2','visit_hex',null,0,216)
on conflict(code) do nothing;
