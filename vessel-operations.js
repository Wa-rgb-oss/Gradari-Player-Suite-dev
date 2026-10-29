(() => {
"use strict";
const $=id=>document.getElementById(id);
const hexEl=$("selectedHexRef"), form=$("gmVesselCargoForm"),hangarForm=$("gmHangarForm");
if(!hexEl||!form||!hangarForm)return;
const status=$("gmVesselOpsState");
const rpc=(action,payload)=>GMAuth.api("rpc/"+action,{method:"POST",body:JSON.stringify(payload)});
const fill=(id,items,placeholder,format)=>{const el=$(id);const value=el.value;el.replaceChildren(new Option(placeholder,""));items.forEach(x=>el.add(new Option(format(x),x.id||x.code)));if([...el.options].some(x=>x.value===value))el.value=value;};
const fmt=n=>Number(n||0).toLocaleString();
let seq=0,assets=[],armies=[],blueprints=new Map(),canCommand=false,selectedFaction=null,selectedHex="";
function update(){
 const ship=assets.find(x=>x.id===$("gmCargoShip").value);
 const blueprint=blueprints.get(ship?.blueprint_id);
 $("gmCargoManifest").textContent=ship?
 "CARGO LIMIT "+fmt(blueprint?.cargo_capacity)+" · ONBOARD "+JSON.stringify(ship.cargo_manifest||{}):
 "NO CARGO VESSEL SELECTED";
 const transport=assets.find(x=>x.id===$("gmTroopShip").value);
 const embark=$("gmTroopAction").value==="embark";
 fill("gmTroopArmy",armies.filter(a=>embark?
   !a.transport_ship_id&&a.location_ref===transport?.location_ref&&a.movement_status==="stationary":
   a.transport_ship_id===transport?.id),"NO ELIGIBLE ARMIES",a=>a.name+" / "+fmt(a.strength));
 $("gmTroopTransportForm").querySelector('button[type="submit"]').disabled=!canCommand||!transport||!$("gmTroopArmy").value;
 const tender=assets.find(x=>x.id===$("gmRepairTender").value);
 fill("gmRepairTarget",assets.filter(x=>x.location_ref===tender?.location_ref&&Number(x.strength)<Number(x.max_strength)),
  "NO DAMAGED VESSELS",x=>x.name+" / "+fmt(x.strength)+"/"+fmt(x.max_strength));
 $("gmRepairTenderForm").querySelector('button[type="submit"]').disabled=!canCommand||!tender||!$("gmRepairTarget").value;
 const host=assets.find(x=>x.id===$("gmHangarHost").value);
 const hostBlueprint=blueprints.get(host?.blueprint_id);
 const used=assets.filter(x=>x.carrier_ship_id===host?.id).length;
 const free=host?Math.max(0,Number(hostBlueprint?.hangar_slots||0)-used):0;
 fill("gmHangarCraft",assets.filter(x=>!x.carrier_ship_id&&!x.fleet_id&&x.location_ref===host?.location_ref&&blueprints.get(x.blueprint_id)?.vessel_category==="strike_craft"),
  "NO AVAILABLE STRIKE CRAFT",x=>x.name);
 form.querySelector('button[type="submit"]').disabled=!canCommand||!ship||!$("gmCargoResource").value;
 hangarForm.querySelector('button[type="submit"]').disabled=!canCommand||!host||free<1||!$("gmHangarCraft").value;
}
async function reload(){
 const current=hexEl.textContent.trim();if(!/^HEX_-?\d+_-?\d+$/.test(current))return;
 selectedHex=current;const request=++seq;
 try{
 const [session,tr,ships,bps,resources,armyData]=await Promise.all([
 GMAuth.getSession(),
 GMAuth.api("territories?location_ref=eq."+encodeURIComponent(current)+"&select=faction_id"),
 GMAuth.api("ships?status=eq.active&select=id,name,location_ref,blueprint_id,faction_id,fleet_id,carrier_ship_id,cargo_manifest,strength,max_strength"),
 GMAuth.api("ship_blueprints?player_visible=eq.true&select=id,name,vessel_category,cargo_capacity,hangar_slots,troops_capacity,special_role"),
 GMAuth.api("resource_catalog?select=code,name&order=name"),
 GMAuth.api("armies?status=eq.active&select=id,name,faction_id,location_ref,strength,movement_status,transport_ship_id")
 ]);
 if(request!==seq)return;
 const uid=session?.user?.id;
 const membership=uid?await GMAuth.api("faction_memberships?user_id=eq."+encodeURIComponent(uid)+"&status=eq.active&select=faction_id"):[];
 if(request!==seq)return;
 const candidates=[...new Set([...membership.map(x=>x.faction_id),...tr.map(x=>x.faction_id)].filter(Boolean))];
 let authorized=null;
 for(const candidate of candidates){
   if(await rpc("can_command_faction",{p_faction_id:candidate})){authorized=candidate;break;}
 }
 if(request!==seq)return;
 selectedFaction=authorized;canCommand=!!authorized;
 blueprints=new Map(bps.map(b=>[b.id,b]));
 assets=ships.filter(s=>s.faction_id===authorized);
 armies=armyData.filter(a=>a.faction_id===authorized);
 fill("gmCargoShip",assets.filter(s=>blueprints.get(s.blueprint_id)?.cargo_capacity>0 && s.location_ref===current),"NO CARGO VESSELS",s=>s.name);
 fill("gmHangarHost",assets.filter(s=>blueprints.get(s.blueprint_id)?.hangar_slots>0&&s.location_ref===current),"NO HANGAR VESSELS",s=>s.name);
 fill("gmTroopShip",assets.filter(s=>blueprints.get(s.blueprint_id)?.vessel_category!=="strike_craft"&&s.location_ref===current),"NO LOCAL TRANSPORTS",s=>s.name);
 fill("gmRepairTender",assets.filter(s=>blueprints.get(s.blueprint_id)?.vessel_category==="military_support"&&s.location_ref===current&&blueprints.get(s.blueprint_id)?.special_role==="repair"),"NO REPAIR TENDERS",s=>s.name);
 fill("gmCargoResource",resources,"SELECT RESOURCE",x=>x.name);
 status.textContent=canCommand?"CARGO AND HANGARS READY":"FACTION COMMAND AUTHORITY REQUIRED";
 update();
 }catch(e){if(request===seq)status.textContent="VESSEL OPERATIONS UNAVAILABLE // "+e.message;}
}
async function submit(action,payload,label){
 status.textContent=label+"...";
 try{await rpc(action,payload);await reload();status.textContent=label+" COMPLETE";}
 catch(e){status.textContent=label+" FAILED // "+e.message;update();}
}
form.addEventListener("submit",e=>{
 e.preventDefault();if(!canCommand)return;
 const quantity=Number($("gmCargoQuantity").value),ship=$("gmCargoShip").value,res=$("gmCargoResource").value;
 if(!ship||!res||!Number.isFinite(quantity)||quantity<=0||quantity>100000)return;
 const load=$("gmCargoDirection").value==="load";
 if(!confirm((load?"Load ":"Unload ")+quantity+" "+res+"?"))return;
 submit("transfer_ship_cargo",{p_ship_id:ship,p_resource:res,p_quantity:quantity,p_load:load},"CARGO TRANSFER");
});
hangarForm.addEventListener("submit",e=>{
 e.preventDefault();if(!canCommand)return;
 const carrier=$("gmHangarHost").value,craft=$("gmHangarCraft").value;
 if(!carrier||!craft||!confirm("Embark selected strike craft?"))return;
 submit("assign_strike_craft",{p_craft_id:craft,p_carrier_id:carrier},"HANGAR ASSIGNMENT");
});
["gmCargoShip","gmHangarHost","gmCargoResource","gmCargoDirection","gmTroopShip","gmTroopAction","gmRepairTender"].forEach(id=>$(id).addEventListener("change",update));
$("gmTroopTransportForm").addEventListener("submit",e=>{
 e.preventDefault();if(!canCommand)return;
 const ship=$("gmTroopShip").value,army=$("gmTroopArmy").value,embark=$("gmTroopAction").value==="embark";
 if(!ship||!army||!confirm((embark?"Embark":"Disembark")+" selected army?"))return;
 submit("manage_army_embarkation",{p_army_id:army,p_ship_id:ship,p_embark:embark},"ARMY TRANSPORT");
});
$("gmRepairTenderForm").addEventListener("submit",e=>{
 e.preventDefault();if(!canCommand)return;
 const tender=$("gmRepairTender").value,target=$("gmRepairTarget").value,points=Number($("gmRepairPoints").value);
 if(!tender||!target||!Number.isFinite(points)||points<1||points>1000)return;
 if(!confirm("Restore "+points+" hull strength using ship components?"))return;
 submit("repair_ship_with_tender",{p_tender:tender,p_target:target,p_repair:points},"FIELD REPAIR");
});
new MutationObserver(()=>{if(selectedHex!==hexEl.textContent.trim())reload()}).observe(hexEl,{subtree:true,childList:true,characterData:true});
reload();
})();