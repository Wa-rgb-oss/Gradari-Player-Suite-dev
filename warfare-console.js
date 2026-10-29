(() => {
 "use strict";
 const $=id=>document.getElementById(id),loc=$("selectedHexRef");
 if(!loc||!$("gmFleetState"))return;
 const esc=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const state=$("gmFleetState");let seq=0,me=null,hex="",faction=null,canCommand=false;
 let blueprints=[],yards=[],fleets=[],ships=[],wars=[],offers=[];
 const req=(path,params)=>GMAuth.api("rpc/"+path,{method:"POST",body:JSON.stringify(params)});
 const options=(element,rows,lab,placeholder)=>{element.replaceChildren(new Option(placeholder||"SELECT",""));rows.forEach(x=>element.add(new Option(lab(x),x.id)));};
 function auth(){
  return faction&&(faction.leader_user_id===me||
    faction.memberPermissions?.includes("military")||faction.memberPermissions?.includes("all"));
 }
 function format(n){return Number(n||0).toLocaleString(undefined,{maximumFractionDigits:2});}
 function selection(){
  const blueprint=blueprints.find(b=>b.id===$("gmShipBlueprint").value);
  $("gmShipBuildDetails").textContent=blueprint?
   "COST "+format(Number(blueprint.strength)*20)+" A · CREW "+format(blueprint.manpower_cost)+" · BUILD "+format(blueprint.build_cycles*36)+" WORLD HOURS":"NO BLUEPRINT SELECTED";
  const fleet=fleets.find(f=>f.id===$("gmFleetSelect").value);
  const member=ships.filter(s=>s.fleet_id===fleet?.id&&s.status==="active");
  $("gmFleetDetails").textContent=fleet?"LOCATION "+fleet.location_ref+" · "+fleet.movement_status.toUpperCase()+" · "+member.length+" SHIPS":"NO FLEET SELECTED";
  $("gmShipyardForm").querySelector('button[type="submit"]').disabled=!canCommand||!yards.length||!blueprint;
  $("gmFleetForm").querySelector('button[type="submit"]').disabled=!canCommand||!hex||!faction;
  $("gmFleetMoveForm").querySelector('button[type="submit"]').disabled=!canCommand||!fleet||fleet.movement_status!=="stationary"||fleet.location_ref===hex||!member.length;
  $("gmShipAssignForm").querySelector('button[type="submit"]').disabled=!canCommand||!fleet||fleet.movement_status!=="stationary"||!$("gmShipSelect").value;
 }
 async function load(){
  const ref=loc.textContent.trim(),id=++seq;hex=/^HEX_-?\d+_-?\d+$/.test(ref)?ref:"";
  faction=null;canCommand=false;state.textContent="LOADING NAVAL OPERATIONS...";
  if(!hex){state.textContent="SELECT A HEX";return;}
  try{
   const session=await GMAuth.getSession();me=session?.user?.id;
   const q=encodeURIComponent(hex);
   const [tr,fac,types,bp,fl,sp,orders,warData,battles,allOffers,memberships]=await Promise.all([
    GMAuth.api("territories?location_ref=eq."+q+"&select=faction_id"),
    GMAuth.api("facilities?location_ref=eq."+q+"&select=id,name,owner_faction_id,facility_type_id,status"),
    GMAuth.api("facility_types?select=id,name"),
    GMAuth.api("ship_blueprints?player_visible=eq.true&select=id,name,strength,manpower_cost,build_cycles"),
    GMAuth.api("fleets?status=eq.active&select=id,name,faction_id,location_ref,movement_status"),
    GMAuth.api("ships?status=eq.active&select=id,name,faction_id,location_ref,fleet_id,strength"),
    GMAuth.api("shipyard_orders?location_ref=eq."+q+"&select=id,ship_name,status,cycles_remaining,build_ready_world_hour&order=created_at.desc&limit=10"),
    GMAuth.api("military_wars?status=eq.active&select=*&order=opened_at.desc&limit=30"),
    GMAuth.api("military_battles?location_ref=eq."+q+"&select=*&order=created_at.desc&limit=8"),
    GMAuth.api("military_peace_proposals?status=eq.pending&select=id,war_id,proposed_by_faction_id,terms"),
    GMAuth.api("faction_memberships?user_id=eq."+encodeURIComponent(me||"00000000-0000-0000-0000-000000000000")+"&status=eq.active&select=faction_id,permissions")
   ]);
   if(id!==seq)return;
   const currentFaction=tr[0]?.faction_id;
   const own=memberships.map(m=>m.faction_id);
   const candidateIds=[...new Set([...own,...fl.map(f=>f.faction_id)])];
   const factionRecords=candidateIds.length?
    await GMAuth.api("factions?id=in.("+candidateIds.map(encodeURIComponent).join(",")+")&select=id,name,leader_user_id"):[];
   if(id!==seq)return;
   faction=factionRecords.find(f=>f.id===currentFaction)||null;
   if(faction)faction.memberPermissions=memberships.find(m=>m.faction_id===faction.id)?.permissions||[];
   canCommand=Boolean(auth());
   const typesById=new Map(types.map(t=>[t.id,t.name]));
   yards=fac.filter(f=>f.owner_faction_id===faction?.id&&f.status==="active"&&/yard/i.test(typesById.get(f.facility_type_id)||""));
   blueprints=bp;fleets=fl.filter(f=>f.faction_id===faction?.id);ships=sp.filter(s=>s.faction_id===faction?.id);
   wars=warData.filter(w=>w.attacker_faction_id===faction?.id||w.defender_faction_id===faction?.id);
   offers=allOffers;
   options($("gmShipyardSelect"),yards,y=>y.name,"NO AVAILABLE YARD");
   options($("gmShipBlueprint"),blueprints,b=>b.name,"SELECT BLUEPRINT");
   options($("gmFleetSelect"),fleets,f=>f.name+" / "+f.location_ref,"NO FLEET");
   options($("gmShipSelect"),ships.filter(s=>!s.fleet_id&&s.location_ref===hex),s=>s.name,"NO UNASSIGNED SHIPS");
   $("gmShipOrders").innerHTML=orders.length?orders.map(o=>'<div class="telemetry-row"><span>'+esc(o.ship_name)+' / '+esc(o.status)+'</span><strong>'+format(o.cycles_remaining)+' CYCLES</strong></div>').join(""):'<div class="empty-state">NO SHIPYARD ORDERS.</div>';
   $("gmBattleReports").innerHTML=battles.length?battles.map(b=>'<article class="notice"><strong>'+esc(b.narrative||"STRATEGIC BATTLE")+'</strong><div class="section-code">LOSSES / ATTACKER '+format(b.attacker_losses)+' · DEFENDER '+format(b.defender_losses)+'</div></article>').join(""):'<div class="empty-state">NO BATTLE REPORTS FOR THIS HEX.</div>';
   $("gmWarfareWars").innerHTML=wars.length?wars.map(w=>{
    const ownProposals=offers.filter(o=>o.war_id===w.id&&o.proposed_by_faction_id!==faction.id);
    return '<article class="notice"><strong>WAR / '+esc(w.id.slice(0,8))+'</strong>'+
    '<div class="section-code">ATTACKER '+format(w.attacker_score)+' · DEFENDER '+format(w.defender_score)+'</div>'+
    '<div class="map-button-grid" style="margin-top:8px">'+
    '<button type="button" class="hud-button secondary" data-war-offer="'+esc(w.id)+'">PROPOSE PEACE</button>'+
    ownProposals.map(o=>'<button type="button" class="hud-button secondary" data-war-accept="'+esc(o.id)+'">ACCEPT '+esc(o.terms)+'</button>').join("")+'</div></article>';
   }).join(""):'<div class="empty-state">NO ACTIVE WARS FOR THE SELECTED FACTION.</div>';
   state.textContent=canCommand?"FACTION NAVAL AUTHORITY VERIFIED":"VIEW ONLY / SELECT A HEX OWNED BY A FACTION YOU COMMAND";
   selection();
  }catch(e){if(id===seq){state.textContent="FLEET DATA UNAVAILABLE // "+e.message;console.warn(e);}}
 }
 async function run(form,fn,params,message){const btn=form.querySelector('button[type="submit"]');btn.disabled=true;state.textContent=message+"...";try{const result=await req(fn,params);state.textContent=message+" COMPLETE";await load();state.textContent=message+" COMPLETE // "+esc(JSON.stringify(result));}catch(e){state.textContent="COMMAND FAILED // "+e.message;selection();}}
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
 $("gmWarfareWars").addEventListener("click",async e=>{
  const offer=e.target.closest("[data-war-offer]"),accept=e.target.closest("[data-war-accept]");
  if(!canCommand||(!offer&&!accept))return;
  try{
   if(offer){const terms=prompt("Peace terms: white_peace, attacker_victory, or defender_victory","white_peace");
    if(!terms)return;await req("offer_war_peace",{p_war:offer.dataset.warOffer,p_terms:terms});}
   else if(confirm("Accept this peace proposal and end the war?")){
    await req("respond_war_peace",{p_proposal:accept.dataset.warAccept,p_accept:true});}
   await load();
  }catch(err){state.textContent="PEACE NEGOTIATION FAILED // "+err.message;}
 });
 ["gmShipBlueprint","gmFleetSelect","gmShipSelect","gmShipyardSelect"].forEach(id=>$(id).addEventListener("change",selection));
 new MutationObserver(load).observe(loc,{childList:true,subtree:true,characterData:true});
 load();
})();