(() => {
 "use strict";
 const $=id=>document.getElementById(id),loc=$("selectedHexRef");
 if(!loc||!$("gmFleetState"))return;
 const esc=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const state=$("gmFleetState");let seq=0,me=null,hex="",faction=null,canCommand=false;
 let blueprints=[],yards=[],fleets=[],ships=[],wars=[],offers=[],hostileAtFleet=[],armies=[],supplyLogs=[];let lastRef=null;
 const req=(path,params)=>GMAuth.api("rpc/"+path,{method:"POST",body:JSON.stringify(params)});
 const options=(element,rows,lab,placeholder)=>{element.replaceChildren(new Option(placeholder||"SELECT",""));rows.forEach(x=>element.add(new Option(lab(x),x.id)));};
 function auth(){
  return faction&&(faction.leader_user_id===me||
    faction.memberPermissions?.includes("military")||faction.memberPermissions?.includes("all"));
 }
 function format(n){return Number(n||0).toLocaleString(undefined,{maximumFractionDigits:2});}
 function selection(){
  const army=armies.find(a=>a.id===$("gmArmyCommandSelect").value);
  const supply=supplyLogs.find(l=>l.army_id===army?.id);
  $("gmArmyCommandDetails").textContent=army?"STRENGTH "+format(army.strength)+" · LOCATION "+army.location_ref+" · "+String(army.movement_status).toUpperCase()+" · SUPPLY "+(supply?String(supply.status).toUpperCase()+" / "+(supply.supply_ref||"NO CORRIDOR"):"AWAITING FIRST DAILY TICK"):"NO ARMY SELECTED";
  $("gmArmyOrderForm").querySelector('button[type="submit"]').disabled=!canCommand||!army||army.movement_status!=="stationary"||!hex;
  const category=$("gmShipCategory").value;
  const previous=$("gmShipBlueprint").value;
  const visibleBlueprints=blueprints.filter(b=>category==="all"||b.vessel_category===category);
  const blueprintPicker=$("gmShipBlueprint");
  const changed=visibleBlueprints.some(b=>b.id===previous)?previous:null;
  if(blueprintPicker.dataset.category!==category){
   options(blueprintPicker,visibleBlueprints,b=>b.name,"SELECT BLUEPRINT");
   blueprintPicker.dataset.category=category;
   if(changed)blueprintPicker.value=changed;
  }
  const blueprint=blueprints.find(b=>b.id===blueprintPicker.value);
  $("gmShipBuildDetails").textContent=blueprint?
   (blueprint.description||"CANON NAVAL VESSEL")+"\n"+
   "DOCTRINE / "+(blueprint.doctrine_function||"UNSPECIFIED")+"\n"+
   "CATEGORY / "+(blueprint.vessel_category||"WARSHIP").toUpperCase()+" · "+(blueprint.lore_status==="primary_canon"?"CANON":"GRADARI GAME EXPANSION")+"\n"+
   "CARGO / "+format(blueprint.cargo_capacity)+" · HANGARS / "+format(blueprint.hangar_slots)+"\n"+
   "CREW / "+format(blueprint.crew_min)+"–"+format(blueprint.crew_max)+" · TROOP CAPACITY / "+format(blueprint.troops_capacity)+" · STRIKE CRAFT / "+format(blueprint.strike_craft_min)+"–"+format(blueprint.strike_craft_max)+"\n"+
   "REQUIRES NAVAL YARD LEVEL "+format(blueprint.required_yard_level)+" · PROVISIONAL GAME BALANCE / "+format(Number(blueprint.strength)*20)+" A · "+JSON.stringify(blueprint.resource_costs||{})+" · "+format(blueprint.build_cycles*36)+" WORLD HOURS"+
   (blueprint.deployment_restriction?"\nDOCTRINAL RESTRICTION / "+blueprint.deployment_restriction:"")
   :"SELECT A CANONICAL SHIP BLUEPRINT.";
  const fleet=fleets.find(f=>f.id===$("gmFleetSelect").value);
  const member=ships.filter(s=>s.fleet_id===fleet?.id&&s.status==="active");
  $("gmFleetDetails").textContent=fleet?"LOCATION "+fleet.location_ref+" · "+fleet.movement_status.toUpperCase()+" · "+member.length+" SHIPS · UPKEEP "+format(member.reduce((sum,ship)=>sum+Number(ship.strength)*.05,0))+" A / DAY":"NO FLEET SELECTED";
  $("gmShipyardForm").querySelector('button[type="submit"]').disabled=!canCommand||!yards.some(y=>y.id===$("gmShipyardSelect").value && y.level>=Number(blueprint?.required_yard_level||999))||!blueprint;
  $("gmFleetForm").querySelector('button[type="submit"]').disabled=!canCommand||!hex||!faction;
  $("gmFleetMoveForm").querySelector('button[type="submit"]').disabled=!canCommand||!fleet||fleet.movement_status!=="stationary"||fleet.location_ref===hex||!member.length;
  options($("gmShipSelect"),ships.filter(ship=>!ship.fleet_id&&ship.location_ref===fleet?.location_ref),ship=>ship.name,"NO UNASSIGNED SHIPS");
  const enemies=[...new Set(hostileAtFleet.filter(ship=>ship.location_ref===fleet?.location_ref&&ship.faction_id!==fleet?.faction_id).map(ship=>ship.faction_id))];
  options($("gmNavalEnemy"),enemies.map(id=>({id,name:"HOSTILE FACTION / "+id.slice(0,8)})),item=>item.name,"NO HOSTILES PRESENT");
  $("gmNavalEngageForm").querySelector('button[type="submit"]').disabled=!canCommand||!fleet||fleet.movement_status!=="stationary"||!member.length||!enemies.length;
  $("gmShipAssignForm").querySelector('button[type="submit"]').disabled=!canCommand||!fleet||fleet.movement_status!=="stationary"||!$("gmShipSelect").value;
 }
 async function load(force=false){
  const ref=loc.textContent.trim();if(!force&&ref===lastRef)return;lastRef=ref;
  const id=++seq;hex=/^HEX_-?\d+_-?\d+$/.test(ref)?ref:"";
  faction=null;canCommand=false;state.textContent="LOADING NAVAL OPERATIONS...";
  if(!hex){state.textContent="SELECT A HEX";return;}
  try{
   const session=await GMAuth.getSession();me=session?.user?.id;
   const q=encodeURIComponent(hex);
   const [tr,fac,types,bp,fl,sp,orders,warData,battles,allOffers,memberships,localShips,navalReports,allArmies,armySupplies]=await Promise.all([
    GMAuth.api("territories?location_ref=eq."+q+"&select=faction_id"),
    GMAuth.api("facilities?location_ref=eq."+q+"&select=id,name,level,owner_faction_id,facility_type_id,status"),
    GMAuth.api("facility_types?select=id,name"),
    GMAuth.api("ship_blueprints?player_visible=eq.true&select=id,name,description,doctrine_function,crew_min,crew_max,troops_capacity,strike_craft_min,strike_craft_max,deployment_restriction,strength,manpower_cost,build_cycles,resource_costs,vessel_category,cargo_capacity,hangar_slots,lore_status,required_yard_level,required_yard_kind"),
    GMAuth.api("fleets?status=eq.active&select=id,name,faction_id,location_ref,movement_status"),
    GMAuth.api("ships?status=eq.active&select=id,name,faction_id,location_ref,fleet_id,strength"),
    GMAuth.api("shipyard_orders?location_ref=eq."+q+"&select=id,ship_name,status,cycles_remaining,build_ready_world_hour&order=created_at.desc&limit=10"),
    GMAuth.api("military_wars?status=eq.active&select=*&order=opened_at.desc&limit=30"),
    GMAuth.api("military_battles?location_ref=eq."+q+"&select=*&order=created_at.desc&limit=8"),
    GMAuth.api("military_peace_proposals?status=eq.pending&select=id,war_id,proposed_by_faction_id,terms"),
    GMAuth.api("faction_memberships?user_id=eq."+encodeURIComponent(me||"00000000-0000-0000-0000-000000000000")+"&status=eq.active&select=faction_id,permissions"),
    GMAuth.api("ships?status=eq.active&select=faction_id,location_ref"),
    GMAuth.api("naval_battle_reports?select=attacker_before,defender_before,attacker_after,defender_after,created_at&order=created_at.desc&limit=8"),
    GMAuth.api("armies?status=eq.active&select=id,name,faction_id,location_ref,strength,movement_status"),
    GMAuth.api("army_supply_log?select=army_id,status,supply_ref,world_day&order=world_day.desc&limit=100")
   ]);
   if(id!==seq)return;
   const currentFaction=tr[0]?.faction_id;
   const own=memberships.map(m=>m.faction_id);
   const candidateIds=[...new Set([...own,...fl.map(f=>f.faction_id),currentFaction].filter(Boolean))];
   const factionRecords=candidateIds.length?
    await GMAuth.api("factions?id=in.("+candidateIds.map(encodeURIComponent).join(",")+")&select=id,name,leader_user_id"):[];
   if(id!==seq)return;
   const permissions=await Promise.all(factionRecords.map(async f=>({
     faction:f,
     allowed:Boolean(await req("can_command_faction",{p_faction_id:f.id}))
   })));
   if(id!==seq)return;
   const chosen=permissions.find(x=>x.faction.id===currentFaction&&x.allowed)||
     permissions.find(x=>x.allowed)||
     permissions.find(x=>x.faction.id===currentFaction);
   faction=chosen?.faction||null;
   canCommand=Boolean(chosen?.allowed);
   if(faction)faction.memberPermissions=memberships.find(m=>m.faction_id===faction.id)?.permissions||[];
   if(id!==seq)return;
   const typesById=new Map(types.map(t=>[t.id,t.name]));
   yards=fac.filter(f=>f.owner_faction_id===faction?.id&&f.status==="active"&&/naval yard/i.test(typesById.get(f.facility_type_id)||""));
   blueprints=bp.filter(b=>b.vessel_category!=="civilian");fleets=fl.filter(f=>f.faction_id===faction?.id);ships=sp.filter(s=>s.faction_id===faction?.id);
   hostileAtFleet=localShips;
   supplyLogs=armySupplies;
   armies=allArmies.filter(a=>a.faction_id===faction?.id);
   options($("gmArmyCommandSelect"),armies,a=>a.name+" / "+a.location_ref,"NO CONTROLLED ARMIES");
   wars=warData.filter(w=>w.attacker_faction_id===faction?.id||w.defender_faction_id===faction?.id);
   offers=allOffers;
   options($("gmShipyardSelect"),yards,y=>y.name+" / LEVEL "+y.level,"NO AVAILABLE NAVAL YARD");
   $("gmShipBlueprint").dataset.category="";
   options($("gmShipBlueprint"),blueprints,b=>b.name,"SELECT BLUEPRINT");
   options($("gmFleetSelect"),fleets,f=>f.name+" / "+f.location_ref,"NO FLEET");
   
   $("gmShipOrders").innerHTML=orders.length?orders.map(o=>'<div class="telemetry-row"><span>'+esc(o.ship_name)+' / '+esc(o.status)+'</span><strong>'+format(o.cycles_remaining)+' CYCLES</strong></div>').join(""):'<div class="empty-state">NO SHIPYARD ORDERS.</div>';
   $("gmNavalReports").innerHTML=navalReports.length?navalReports.map(b=>'<article class="notice"><strong>NAVAL ENGAGEMENT</strong><div class="section-code">ATTACKER '+format(b.attacker_before)+' → '+format(b.attacker_after)+' · DEFENDER '+format(b.defender_before)+' → '+format(b.defender_after)+'</div></article>').join(""):'<div class="empty-state">NO RECENT NAVAL BATTLES.</div>';
   $("gmBattleReports").innerHTML=battles.length?battles.map(b=>'<article class="notice"><strong>'+esc(b.narrative||"STRATEGIC BATTLE")+'</strong><div class="section-code">LOSSES / ATTACKER '+format(b.attacker_losses)+' · DEFENDER '+format(b.defender_losses)+'</div></article>').join(""):'<div class="empty-state">NO BATTLE REPORTS FOR THIS HEX.</div>';
   $("gmWarfareWars").innerHTML=wars.length?wars.map(w=>{
    const ownProposals=offers.filter(o=>o.war_id===w.id&&o.proposed_by_faction_id!==faction.id);
    return '<article class="notice"><strong>WAR / '+esc(w.id.slice(0,8))+'</strong>'+
    '<div class="section-code">ATTACKER '+format(w.attacker_score)+' · DEFENDER '+format(w.defender_score)+'</div>'+
    '<div class="map-button-grid" style="margin-top:8px">'+
    '<button type="button" class="hud-button secondary" data-war-offer="'+esc(w.id)+'">PROPOSE PEACE</button>'+
    ownProposals.map(o=>'<button type="button" class="hud-button secondary" data-war-accept="'+esc(o.id)+'">ACCEPT '+esc(o.terms)+'</button><button type="button" class="hud-button secondary" data-war-reject="'+esc(o.id)+'">REJECT</button>').join("")+'</div></article>';
   }).join(""):'<div class="empty-state">NO ACTIVE WARS FOR THE SELECTED FACTION.</div>';
   state.textContent=canCommand?"FACTION MILITARY AUTHORITY VERIFIED":"VIEW ONLY / MILITARY COMMAND PERMISSION REQUIRED";
   document.getElementById("map-tab-military")?.setAttribute("data-modern-military-ready","true");
   selection();
  }catch(e){if(id===seq){state.textContent="FLEET DATA UNAVAILABLE // "+e.message;console.warn(e);}}
 }
 async function run(form,fn,params,message){const btn=form.querySelector('button[type="submit"]');btn.disabled=true;state.textContent=message+"...";try{const result=await req(fn,params);state.textContent=message+" COMPLETE";await load(true);state.textContent=message+" COMPLETE // "+esc(JSON.stringify(result));}catch(e){state.textContent="COMMAND FAILED // "+e.message;selection();}}
 $("gmArmyOrderForm").addEventListener("submit",e=>{
  e.preventDefault();if(!canCommand)return;
  const id=$("gmArmyCommandSelect").value,mode=$("gmArmyOrderType").value;
  const a=armies.find(x=>x.id===id);if(!a||!hex)return;
  if(!confirm("Issue "+mode.toUpperCase()+" order for "+a.name+" at "+hex+"?"))return;
  if(mode==="move"){
    run(e.currentTarget,"order_army_movement",{p_army_id:id,p_to_ref:hex},"ARMY MOVEMENT");
  }else{
    run(e.currentTarget,"launch_military_operation",{p_army_id:id,p_target_ref:hex,p_operation_type:mode},"MILITARY OPERATION");
  }
 });
 $("gmShipyardForm").addEventListener("submit",e=>{e.preventDefault();if(!canCommand)return;const form=e.currentTarget;
 const yard=$("gmShipyardSelect").value,blueprint=$("gmShipBlueprint").value,name=$("gmShipName").value.trim();
 if(!yard||!blueprint||!name)return; if(!confirm("Queue this vessel for faction shipyard construction?"))return;
 run(form,"queue_faction_ship",{p_yard:yard,p_blueprint:blueprint,p_name:name},"SHIP CONSTRUCTION");});
 $("gmFleetForm").addEventListener("submit",e=>{e.preventDefault();if(!canCommand||!faction)return;
 run(e.currentTarget,"form_fleet",{p_faction:faction.id,p_location:hex,p_name:$("gmFleetName").value.trim()},"FLEET FORMATION");});
 $("gmShipAssignForm").addEventListener("submit",e=>{e.preventDefault();if(!canCommand)return;
 run(e.currentTarget,"assign_ship_to_fleet",{p_ship:$("gmShipSelect").value,p_fleet:$("gmFleetSelect").value},"SHIP ASSIGNMENT");});
 $("gmFleetMoveForm").addEventListener("submit",e=>{e.preventDefault();if(!canCommand)return;
 if(!confirm("Move the selected fleet to "+hex+"?"))return;
 run(e.currentTarget,"move_fleet",{p_fleet:$("gmFleetSelect").value,p_target:hex},"FLEET MOVEMENT");});
 $("gmNavalEngageForm").addEventListener("submit",e=>{
  e.preventDefault();
  if(!canCommand||!$("gmFleetSelect").value||!$("gmNavalEnemy").value)return;
  if(!confirm("Authorize a naval engagement against hostile ships?"))return;
  run(e.currentTarget,"launch_naval_engagement",{p_fleet:$("gmFleetSelect").value,p_enemy_faction:$("gmNavalEnemy").value},"NAVAL ENGAGEMENT");
 });
 $("gmWarfareWars").addEventListener("click",async e=>{
  const offer=e.target.closest("[data-war-offer]"),accept=e.target.closest("[data-war-accept]"),reject=e.target.closest("[data-war-reject]");
  if(!canCommand||(!offer&&!accept&&!reject))return;
  try{
   if(offer){const terms=prompt("Peace terms: white_peace, attacker_victory, or defender_victory","white_peace");
    if(!terms)return;await req("offer_war_peace",{p_war:offer.dataset.warOffer,p_terms:terms});}
   else if(accept&&confirm("Accept this peace proposal and end the war?")){
    await req("respond_war_peace",{p_proposal:accept.dataset.warAccept,p_accept:true});}
   else if(reject&&confirm("Reject this peace offer?")){
    await req("respond_war_peace",{p_proposal:reject.dataset.warReject,p_accept:false});}
   await load(true);
  }catch(err){state.textContent="PEACE NEGOTIATION FAILED // "+err.message;}
 });
 ["gmArmyCommandSelect","gmArmyOrderType","gmShipCategory","gmShipBlueprint","gmFleetSelect","gmShipSelect","gmShipyardSelect"].forEach(id=>$(id).addEventListener("change",selection));
 new MutationObserver(()=>load(false)).observe(loc,{childList:true,subtree:true,characterData:true});
 load(true);
})();