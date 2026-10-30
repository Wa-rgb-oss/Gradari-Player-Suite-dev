(()=>{
"use strict";
const $=id=>document.getElementById(id), loc=$("selectedHexRef"),root=$("map-tab-military");
if(!root||!loc||!$("gmCivilianShippingSection"))return;
const rpc=(name,payload)=>GMAuth.api("rpc/"+name,{method:"POST",body:JSON.stringify(payload)});
const fmt=n=>Number(n||0).toLocaleString(undefined,{maximumFractionDigits:2});
const setOptions=(id,items,label,empty="NONE AVAILABLE")=>{
 const el=$(id);const current=el.value;el.replaceChildren(new Option(empty,""));
 items.forEach(x=>el.add(new Option(label(x),x.id||x.code)));
 if([...el.options].some(x=>x.value===current))el.value=current;
};
const panels=[
 ["army","Army Command","Army movement and recruitment",["gmArmyOrderForm","gmRecruitForm","gmRecruitUnitList","gmRecruitHistory"]],
 ["fleet","Fleet Command","Fleet formation, movement and hangars",["gmFleetState","gmFleetForm","gmFleetMoveForm","gmShipAssignForm","gmHangarForm"]],
 ["shipyards","Shipyards","Naval and civilian construction",["gmShipyardForm","gmShipOrders","gmCivilianBuildForm"]],
 ["logistics","Logistics","Cargo, transports, maintenance and supply",["gmVesselCargoForm","gmTroopTransportForm","gmRepairTenderForm","gmResupplyForm","gmVesselOpsState"]],
 ["warfare","Warfare","Naval engagements, war score and peace",["gmNavalEngageForm","gmWarfareWars"]],
 ["records","Military Records","Combat reports and reconnaissance",["gmNavalReports","gmBattleReports","gmReconForm"]],
 ["commerce","Civilian Shipping","Personal vessels and trade routes",["gmCivilianState","gmCivilianMoveForm","gmCivilianCargoForm","gmCivilianFleetList"]]
];
const shell=document.createElement("div");shell.id="gmNavalRefinement";
shell.className="gm-naval-refinement";
const nav=document.createElement("nav");nav.className="gm-naval-nav";nav.setAttribute("aria-label","Military and shipping sections");
const content=document.createElement("div");content.className="gm-naval-content";
for(const [key,title,subtitle,ids] of panels){
 const tab=document.createElement("button");tab.type="button";tab.dataset.navalTab=key;tab.textContent=title;
 tab.className="hud-button secondary";nav.append(tab);
 const pane=document.createElement("section");pane.dataset.navalPane=key;pane.className="gm-naval-pane";
 const h=document.createElement("h2");h.textContent=title;pane.append(h);
 const p=document.createElement("p");p.className="section-code";p.textContent=subtitle;pane.append(p);
 for(const id of ids){const item=$(id);if(item)pane.append(item)}
 content.append(pane);
}
shell.append(nav,content);
const market=document.createElement("p");market.className="section-code";market.textContent="Load from your personal inventory, navigate to another governed system, then unload and trade through the existing Exchange Markets.";const link=document.createElement("a");link.href="exchange-markets/";link.textContent="Open Exchange Markets";market.append(document.createTextNode(" · "),link);content.querySelector('[data-naval-pane="commerce"]')?.append(market);
root.prepend(shell);
let saved="army";try{saved=window.sessionStorage?.getItem("gmNavalTab")||"army"}catch(_){}
const show=(key)=>{
 for(const tab of nav.querySelectorAll("[data-naval-tab]")){const active=tab.dataset.navalTab===key;tab.classList.toggle("is-active",active);tab.setAttribute("aria-pressed",String(active))}
 for(const pane of content.querySelectorAll("[data-naval-pane]"))pane.hidden=pane.dataset.navalPane!==key;
 try{window.sessionStorage?.setItem("gmNavalTab",key)}catch(_){}
};
nav.addEventListener("click",e=>{const b=e.target.closest("[data-naval-tab]");if(b)show(b.dataset.navalTab)});
show(panels.some(p=>p[0]===saved)?saved:"army");
// Existing logic continues using original element IDs; only their presentation containers moved.
const state=$("gmCivilianState"),reconResult=$("gmReconResult");
let run=0,hex="",owner=null,ships=[],yards=[],bps=[],resources=[],militaryShips=[],commandableFactions=[],movingIds=new Set(),shipyards=[];
const permittedYard=b=>yards.some(y=>y.id===$("gmCivilianYard").value&&y.level>=b.required_yard_level);
function update(){
 const bp=bps.find(b=>b.id===$("gmCivilianBlueprint").value);
 $("gmCivilianBuildCost").textContent=bp?
  "PERSONAL COST "+fmt(bp.strength*20)+" A · RESOURCES "+JSON.stringify(bp.resource_costs||{})+" · REQUIRED YARD LEVEL "+bp.required_yard_level:"SELECT A CIVILIAN VESSEL";
 const ship=ships.find(x=>x.id===$("gmCivilianShip").value);
 const underway=ship&&movingIds.has(ship.id);
 $("gmCivilianShipState").textContent=ship?"CURRENT "+ship.location_ref+" · CARGO "+JSON.stringify(ship.cargo_manifest||{})+(underway?" · IN TRANSIT":""):"NO SHIP SELECTED";
 $("gmCivilianBuildForm").querySelector("button[type=submit]").disabled=!bp||!permittedYard(bp)||!$("gmCivilianYard").value;
 $("gmCivilianMoveForm").querySelector("button[type=submit]").disabled=!ship||underway||ship.location_ref===hex;
 $("gmCivilianCargoForm").querySelector("button[type=submit]").disabled=!ship||underway||ship.location_ref!==hex;
 setOptions("gmResupplyTender",militaryShips.filter(s=>s.location_ref===hex&&s.special_role==="resupply"),s=>s.name,"NO LOGISTICS TENDERS");
 setOptions("gmReconShip",militaryShips.filter(s=>s.special_role==="reconnaissance"),s=>s.name+" / "+s.location_ref,"NO RECON VESSELS");
 $("gmResupplyForm").querySelector("button[type=submit]").disabled=!$("gmResupplyTender").value;
 $("gmReconForm").querySelector("button[type=submit]").disabled=!$("gmReconShip").value;
}
async function refresh(){
 const h=loc.textContent.trim();if(!/^HEX_-?\d+_-?\d+$/.test(h))return;hex=h;const token=++run;
 state.textContent="LOADING CIVILIAN VESSELS...";
 try{
  const session=await GMAuth.getSession();owner=session?.user?.id;
  if(!owner)throw Error("Sign in to manage shipping");
  const [allShips,ownYards,allBp,rs,voyages,allFactions,memberships,territories]=await Promise.all([
   GMAuth.api("ships?select=id,name,location_ref,owner_user_id,faction_id,blueprint_id,cargo_manifest,status,fleet_id&status=eq.active"),
   GMAuth.api("facilities?owner_user_id=eq."+owner+"&status=eq.active&select=id,name,level,location_ref,facility_type_id"),
   GMAuth.api("ship_blueprints?player_visible=eq.true&select=id,name,code,vessel_category,strength,resource_costs,required_yard_level,required_yard_kind,special_role"),
   GMAuth.api("resource_catalog?player_visible=eq.true&select=code,name&order=name"),
   GMAuth.api("civilian_ship_movements?status=eq.moving&select=ship_id"),
   GMAuth.api("factions?status=eq.active&select=id,leader_user_id"),
   GMAuth.api("faction_memberships?user_id=eq."+owner+"&status=eq.active&select=faction_id"),
   GMAuth.api("territories?location_ref=eq."+encodeURIComponent(hex)+"&select=faction_id")
  ]);
  if(token!==run)return;
  const types=await GMAuth.api("facility_types?select=id,code");
  if(token!==run)return;
  const yardTypes=new Set(types.filter(t=>t.code==="SHIPYARD").map(t=>t.id));
  yards=ownYards.filter(y=>yardTypes.has(y.facility_type_id)&&y.location_ref===hex);
  shipyards=ownYards.filter(y=>yardTypes.has(y.facility_type_id));
  ships=allShips.filter(s=>s.owner_user_id===owner);
  bps=allBp.filter(b=>b.vessel_category==="civilian");
  resources=rs;
  movingIds=new Set(voyages.map(v=>v.ship_id));
  const candidates=allFactions.filter(f=>f.leader_user_id===owner||memberships.some(m=>m.faction_id===f.id)||territories.some(t=>t.faction_id===f.id));
  commandableFactions=[];
  for(const f of candidates)if(await rpc("can_command_faction",{p_faction_id:f.id}))commandableFactions.push(f.id);
  if(token!==run)return;
  const militaryBp=new Map(allBp.map(b=>[b.id,b]));
  militaryShips=allShips.filter(s=>commandableFactions.includes(s.faction_id)&&!s.owner_user_id)
    .map(s=>({...s,special_role:militaryBp.get(s.blueprint_id)?.special_role}));
  setOptions("gmCivilianYard",yards,y=>y.name+" / LEVEL "+y.level,"NO OWNED CIVILIAN YARD AT HEX");
  setOptions("gmCivilianBlueprint",bps,b=>b.name,"NO CIVILIAN DESIGNS");
  setOptions("gmCivilianShip",ships,s=>s.name+" / "+s.location_ref,"NO PERSONAL SHIPS");
  setOptions("gmCivilianResource",resources,r=>r.name,"SELECT RESOURCE");
  $("gmCivilianFleetList").textContent=ships.length?ships.map(s=>s.name+" | "+s.location_ref+(movingIds.has(s.id)?" | TRAVELING":"")).join("\n"):"NO OWNED VESSELS";
  state.textContent="CIVILIAN SHIPYARDS: "+shipyards.length+" · PERSONAL SHIPS: "+ships.length;
  update();
 }catch(e){if(token===run){state.textContent="SHIPPING UNAVAILABLE // "+e.message;console.warn(e)}}
}
async function execute(action,payload,label){
 state.textContent=label+"...";
 try{const result=await rpc(action,payload);await refresh();state.textContent=label+" CONFIRMED / "+JSON.stringify(result);return result}
 catch(e){state.textContent=label+" FAILED / "+e.message;return null}
}
$("gmCivilianBuildForm").addEventListener("submit",e=>{e.preventDefault();
 const yard=$("gmCivilianYard").value,bp=$("gmCivilianBlueprint").value,name=$("gmCivilianName").value.trim();
 if(!yard||!bp||!name||!confirm("Spend personal resources to construct "+name+"?"))return;
 execute("queue_civilian_ship",{p_yard:yard,p_blueprint:bp,p_name:name},"CIVILIAN CONSTRUCTION");
});
$("gmCivilianMoveForm").addEventListener("submit",e=>{e.preventDefault();
 const ship=$("gmCivilianShip").value;if(!ship||!confirm("Sail selected civilian vessel to "+hex+"?"))return;
 execute("move_civilian_ship",{p_ship:ship,p_destination:hex},"CIVILIAN VOYAGE");
});
$("gmCivilianCargoForm").addEventListener("submit",e=>{e.preventDefault();
 const ship=$("gmCivilianShip").value,resource=$("gmCivilianResource").value,quantity=Number($("gmCivilianQuantity").value),load=$("gmCivilianDirection").value==="load";
 if(!ship||!resource||!Number.isFinite(quantity)||quantity<=0)return;
 execute("transfer_civilian_cargo",{p_ship:ship,p_resource:resource,p_quantity:quantity,p_load:load},"PERSONAL CARGO TRANSFER");
});
$("gmResupplyForm").addEventListener("submit",async e=>{e.preventDefault();
 const ship=$("gmResupplyTender").value,resource=$("gmResupplyResource").value,amount=Number($("gmResupplyAmount").value);
 if(!ship||!Number.isFinite(amount)||amount<=0)return;
 if(await execute("resupply_system_from_tender",{p_ship:ship,p_resource:resource,p_quantity:amount},"SYSTEM RESUPPLY"))show("logistics");
});
$("gmReconForm").addEventListener("submit",async e=>{e.preventDefault();
 const ship=$("gmReconShip").value;if(!ship)return;
 const result=await execute("scan_with_recon",{p_ship:ship,p_target:hex},"RECON SCAN");
 if(result){reconResult.textContent="TARGET "+result.target_ref+" · HOSTILE SHIPS "+fmt(result.hostile_ships)+" · THREAT STRENGTH "+fmt(result.hostile_strength);show("records")}
});
["gmCivilianShip","gmCivilianBlueprint","gmCivilianYard","gmResupplyTender","gmReconShip"].forEach(id=>$(id).addEventListener("change",update));
new MutationObserver(()=>{if(hex!==loc.textContent.trim())refresh()}).observe(loc,{childList:true,subtree:true,characterData:true});
refresh();
})();