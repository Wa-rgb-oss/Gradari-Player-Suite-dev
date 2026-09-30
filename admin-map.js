(() => {
  const canvas=document.getElementById("adminGalaxyMap");
  if(!canvas) return;
  const ctx=canvas.getContext("2d");
  const $=id=>document.getElementById(id);
  const esc=value=>GMUI.esc(value);
  const setState=(el,message,type="")=>GMUI.setState(el,message,type);
  const fmt=value=>Number(value||0).toLocaleString(undefined,{maximumFractionDigits:2});

  let data=null;
  let mode="select";
  let mapHexes=[];
  let mapHexSet=new Set();
  let camera={x:0,y:0,zoom:1};
  let size=32;
  let radius=14;
  let dragging=false;
  let dragMoved=false;
  let draggingLabel=false;
  let dragStart={x:0,y:0};
  let cameraStart={x:0,y:0};
  let selectedLabelId=null;
  let selectedBuildingId=null;
  let selectedSystemRef=null;
  let firstVisibleResize=true;

  const dirs=[[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];

  const factionById=id=>(data?.factions||[]).find(row=>row.id===id)||null;
  const typeById=id=>(data?.facilityTypes||[]).find(row=>row.id===id)||null;
  const territoryByRef=ref=>(data?.territories||[]).find(row=>row.location_ref===ref)||null;
  const labelById=id=>(data?.mapLabels||[]).find(row=>row.id===id)||null;
  const buildingById=id=>(data?.facilities||[]).find(row=>row.id===id)||null;

  function refFor(q,r){return "HEX_"+q+"_"+r}
  function parseRef(ref){
    const m=/^HEX_(-?\d+)_(-?\d+)$/.exec(ref||"");
    return m?{q:Number(m[1]),r:Number(m[2])}:null;
  }

  function buildMapHexes(){
    const configured=(data?.mapHexes||[]).filter(row=>row.player_visible!==false);
    radius=Number(data?.config?.[0]?.map_radius ?? 14);
    size=Number(data?.config?.[0]?.map_hex_size ?? 32);
    if(configured.length){
      mapHexes=configured.map(row=>({...row,q:Number(row.q),r:Number(row.r)}));
    }else{
      mapHexes=[];
      for(let q=-radius;q<=radius;q++) for(let r=-radius;r<=radius;r++){
        const s=-q-r;
        if(Math.max(Math.abs(q),Math.abs(r),Math.abs(s))<=radius){
          mapHexes.push({q,r,location_ref:refFor(q,r),player_visible:true});
        }
      }
    }
    mapHexSet=new Set(mapHexes.map(row=>row.location_ref||refFor(row.q,row.r)));
    $("adminMapHexCount").textContent=String(mapHexes.length);
  }

  function hexToPixel(q,r){return{x:size*Math.sqrt(3)*(q+r/2),y:size*1.5*r}}
  function worldToScreen(p){return{x:p.x*camera.zoom+camera.x,y:p.y*camera.zoom+camera.y}}
  function screenToWorld(x,y){return{x:(x-camera.x)/camera.zoom,y:(y-camera.y)/camera.zoom}}
  function roundHex(q,r){
    let x=q,z=r,y=-x-z,rx=Math.round(x),ry=Math.round(y),rz=Math.round(z);
    const xd=Math.abs(rx-x),yd=Math.abs(ry-y),zd=Math.abs(rz-z);
    if(xd>yd&&xd>zd)rx=-ry-rz; else if(yd>zd)ry=-rx-rz; else rz=-rx-ry;
    return{q:rx,r:rz};
  }
  function pixelToHex(x,y){
    const p=screenToWorld(x,y);
    return roundHex((Math.sqrt(3)/3*p.x-1/3*p.y)/size,(2/3*p.y)/size);
  }
  function corners(x,y){
    const pts=[];
    for(let i=0;i<6;i++){
      const a=Math.PI/180*(60*i-30);
      pts.push({x:x+size*Math.cos(a),y:y+size*Math.sin(a)});
    }
    return pts;
  }
  function rgba(hex,a){
    const raw=String(hex||"#4fa8c4").replace("#","");
    const full=raw.length===3?raw.split("").map(x=>x+x).join(""):raw.padEnd(6,"0");
    const r=parseInt(full.slice(0,2),16)||0,g=parseInt(full.slice(2,4),16)||0,b=parseInt(full.slice(4,6),16)||0;
    return `rgba(${r},${g},${b},${a})`;
  }
  function darken(hex,amount=70){
    const c=String(hex||"#4fa8c4").replace("#","");
    const r=Math.max(0,(parseInt(c.slice(0,2),16)||0)-amount);
    const g=Math.max(0,(parseInt(c.slice(2,4),16)||0)-amount);
    const b=Math.max(0,(parseInt(c.slice(4,6),16)||0)-amount);
    return `rgb(${r},${g},${b})`;
  }
  function drawHex(q,r,fill,stroke="rgba(255,255,255,.12)"){
    const p=hexToPixel(q,r),pts=corners(p.x,p.y).map(worldToScreen);
    ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);
    pts.slice(1).forEach(pt=>ctx.lineTo(pt.x,pt.y));
    ctx.closePath();ctx.fillStyle=fill;ctx.fill();ctx.strokeStyle=stroke;ctx.lineWidth=1;ctx.stroke();
  }

  function drawBorders(){
    const claims=new Map((data?.territories||[]).filter(row=>row.faction_id).map(row=>[row.location_ref,row.faction_id]));
    claims.forEach((factionId,ref)=>{
      const h=parseRef(ref),faction=factionById(factionId);
      if(!h||!faction) return;
      const p=hexToPixel(h.q,h.r),pts=corners(p.x,p.y).map(worldToScreen);
      dirs.forEach((dir,index)=>{
        const neighbor=claims.get(refFor(h.q+dir[0],h.r+dir[1]));
        if(neighbor===factionId) return;
        ctx.beginPath();ctx.moveTo(pts[index].x,pts[index].y);ctx.lineTo(pts[(index+1)%6].x,pts[(index+1)%6].y);
        ctx.strokeStyle=darken(faction.color);ctx.lineWidth=Math.max(2,5*camera.zoom);ctx.stroke();
      });
    });
  }

  function drawStars(){
    const rect=canvas.getBoundingClientRect();
    ctx.fillStyle="rgba(255,255,255,.68)";
    for(let i=0;i<300;i++)ctx.fillRect((i*911)%Math.max(1,rect.width),(i*577)%Math.max(1,rect.height),1.4,1.4);
  }

  function drawLabels(){
    (data?.mapLabels||[]).forEach(label=>{
      const p=worldToScreen({x:Number(label.x),y:Number(label.y)});
      const fontSize=Math.max(8,Number(label.font_size||16)*camera.zoom);
      const opacity=Number(label.opacity??1);
      const border=label.border_style||"none";
      const borderOpacity=Number(label.border_opacity??.8);
      const bgOpacity=Number(label.background_opacity??0);
      ctx.font=`${fontSize}px Georgia`;
      ctx.textAlign="left";ctx.textBaseline="alphabetic";
      const w=ctx.measureText(label.text).width,h=fontSize;
      if(bgOpacity>0){
        ctx.fillStyle=rgba(label.background_color||"#000000",bgOpacity);
        ctx.fillRect(p.x-6,p.y-h-6,w+12,h+12);
      }
      if(border==="box"){
        ctx.strokeStyle=rgba(label.border_color||"#000000",borderOpacity);
        ctx.lineWidth=Math.max(1,2*camera.zoom);ctx.strokeRect(p.x-6,p.y-h-6,w+12,h+12);
      }
      if(border==="outline"){
        ctx.strokeStyle=rgba(label.border_color||"#000000",borderOpacity);
        ctx.lineWidth=Math.max(1,3*camera.zoom);ctx.strokeText(label.text,p.x,p.y);
      }
      ctx.fillStyle=rgba(label.color||"#ffffff",opacity);ctx.fillText(label.text,p.x,p.y);
      if(selectedLabelId===label.id){
        ctx.strokeStyle="#d8a35d";ctx.lineWidth=1;ctx.strokeRect(p.x-8,p.y-h-8,w+16,h+16);
      }
    });
  }

  function facilitySymbol(type){
    const code=String(type?.code||type?.name||"").toUpperCase();
    if(code.includes("MINE"))return "◆";
    if(code.includes("REFIN"))return "⬢";
    if(code.includes("TRADE"))return "◎";
    if(code.includes("FACTORY"))return "▣";
    if(code.includes("RESEARCH"))return "◇";
    if(code.includes("DEPOT")||code.includes("FORT"))return "▲";
    return "■";
  }

  function drawBuildings(){
    (data?.facilities||[]).forEach(b=>{
      const h=parseRef(b.location_ref);if(!h)return;
      const p=worldToScreen(hexToPixel(h.q,h.r));
      const type=typeById(b.facility_type_id);
      ctx.beginPath();ctx.arc(p.x,p.y,13*camera.zoom,0,Math.PI*2);
      ctx.fillStyle="rgba(6,16,24,.94)";ctx.fill();
      ctx.strokeStyle=selectedBuildingId===b.id?"#d8a35d":"#45d7e8";
      ctx.lineWidth=Math.max(1,2*camera.zoom);ctx.stroke();
      ctx.fillStyle="#d8a35d";ctx.font=`${Math.max(10,16*camera.zoom)}px Georgia`;ctx.textAlign="center";ctx.textBaseline="middle";
      ctx.fillText(facilitySymbol(type),p.x,p.y);
      if(camera.zoom>.75){
        ctx.font=`${Math.max(8,11*camera.zoom)}px Consolas`;ctx.fillStyle="#dce9ed";
        ctx.fillText(b.name||type?.name||"Asset",p.x,p.y-18*camera.zoom);
      }
    });
    ctx.textBaseline="alphabetic";
  }

  function draw(){
    const rect=canvas.getBoundingClientRect();
    ctx.clearRect(0,0,rect.width,rect.height);drawStars();
    mapHexes.forEach(h=>drawHex(h.q,h.r,"rgba(255,255,255,.025)"));
    (data?.territories||[]).forEach(row=>{
      if(!row.faction_id)return;
      const h=parseRef(row.location_ref),faction=factionById(row.faction_id);
      if(h&&faction)drawHex(h.q,h.r,rgba(faction.color,.6),faction.color);
    });
    drawBorders();drawLabels();drawBuildings();
    $("adminMapClaimedCount").textContent=String((data?.territories||[]).filter(row=>row.faction_id).length);
    $("adminMapLabelCount").textContent=String((data?.mapLabels||[]).length);
    $("adminMapBuildingCount").textContent=String((data?.facilities||[]).filter(row=>parseRef(row.location_ref)).length);
  }

  function centerMap(){
    const rect=canvas.getBoundingClientRect();
    if(!rect.width||!rect.height||!mapHexes.length)return;
    const pts=mapHexes.map(h=>hexToPixel(h.q,h.r));
    const xs=pts.map(p=>p.x),ys=pts.map(p=>p.y);
    const minX=Math.min(...xs)-size,maxX=Math.max(...xs)+size,minY=Math.min(...ys)-size,maxY=Math.max(...ys)+size;
    camera.zoom=Math.max(.35,Math.min(1.4,Math.min((rect.width-50)/(maxX-minX),(rect.height-50)/(maxY-minY))));
    camera.x=rect.width/2-((minX+maxX)/2)*camera.zoom;
    camera.y=rect.height/2-((minY+maxY)/2)*camera.zoom;
    draw();
  }

  function resizeCanvas(forceCenter=false){
    const rect=canvas.getBoundingClientRect();
    if(!rect.width||!rect.height)return;
    const dpr=Math.min(2,window.devicePixelRatio||1);
    canvas.width=Math.round(rect.width*dpr);canvas.height=Math.round(rect.height*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    if(forceCenter||firstVisibleResize){firstVisibleResize=false;centerMap();}else draw();
  }

  function setMode(next){
    mode=next;$("adminMapModeReadout").textContent=next;
    ["adminMapPaintBtn","adminMapEraseBtn","adminMapLabelBtn","adminMapSelectLabelBtn","adminMapBuildBtn","adminMapSelectBuildingBtn"].forEach(id=>$(id)?.classList.remove("active"));
    const active={paint:"adminMapPaintBtn",erase:"adminMapEraseBtn",label:"adminMapLabelBtn",select:"adminMapSelectLabelBtn",build:"adminMapBuildBtn",selectBuilding:"adminMapSelectBuildingBtn"}[next];
    if(active)$(active)?.classList.add("active");
  }

  function renderFactionControls(){
    const factions=data?.factions||[];
    const current=$("adminMapFaction").value;
    const options=factions.filter(f=>f.status==="active").map(f=>'<option value="'+esc(f.id)+'">'+esc(f.name)+'</option>').join("");
    $("adminMapFaction").innerHTML=options||'<option value="">No active factions</option>';
    if(current&&factions.some(f=>f.id===current))$("adminMapFaction").value=current;
    $("adminMapIndustryFaction").innerHTML=options||'<option value="">No active factions</option>';
    $("adminMapEditBuildingFaction").innerHTML=options||'<option value="">No active factions</option>';

    $("adminMapFactionList").innerHTML=factions.map(f=>{
      const count=(data.territories||[]).filter(t=>t.faction_id===f.id).length;
      return '<article class="notice admin-map-row"><div class="admin-map-swatch" style="background:'+esc(f.color||"#4fa8c4")+'"></div><div><strong>'+esc(f.name)+'</strong><div class="section-code">'+count+' CLAIMED HEXES // '+esc(String(f.status).toUpperCase())+'</div></div><div class="admin-map-row-actions"><button class="hud-button secondary map-edit-faction" data-id="'+esc(f.id)+'" type="button">EDIT</button><button class="hud-button danger map-delete-faction" data-id="'+esc(f.id)+'" type="button">DELETE</button></div></article>';
    }).join("")||'<div class="empty-state">NO FACTIONS CREATED.</div>';

    $("adminMapFactionList").querySelectorAll(".map-edit-faction").forEach(btn=>btn.addEventListener("click",()=>editFaction(btn.dataset.id)));
    $("adminMapFactionList").querySelectorAll(".map-delete-faction").forEach(btn=>btn.addEventListener("click",()=>deleteFaction(btn.dataset.id)));

    const selected=factionById($("adminMapFaction").value);
    if(selected&&!$("adminMapFactionEditId").value){
      $("adminMapFactionName").value=selected.name||"";
      $("adminMapFactionColor").value=selected.color||"#4fa8c4";
    }
    updateBuildPreview();
  }

  function editFaction(id){
    const f=factionById(id);if(!f)return;
    $("adminMapFactionEditId").value=id;$("adminMapFactionName").value=f.name||"";$("adminMapFactionColor").value=f.color||"#4fa8c4";
    $("adminMapFaction").value=id;updateBuildPreview();
  }
  function newFaction(){
    $("adminMapFactionEditId").value="";$("adminMapFactionName").value="";$("adminMapFactionColor").value="#4fa8c4";
  }
  async function saveFaction(){
    const name=$("adminMapFactionName").value.trim(),color=$("adminMapFactionColor").value,id=$("adminMapFactionEditId").value;
    if(!name)return setState($("adminMapState"),"FACTION NAME IS REQUIRED","error");
    try{
      if(id){
        await GMAuth.api("factions?id=eq."+encodeURIComponent(id),{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({name,color})});
      }else{
        await GMAuth.api("factions",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({name,color,status:"active",treasury:0,federal_member:true})});
      }
      await window.GMAdminRefresh("MAP FACTION SAVED");
      newFaction();
    }catch(error){setState($("adminMapState"),"FACTION SAVE FAILED // "+error.message,"error")}
  }
  async function deleteFaction(id){
    const f=factionById(id);if(!f)return;
    const used=(data.territories||[]).some(t=>t.faction_id===id)||(data.facilities||[]).some(x=>x.owner_faction_id===id||x.controlling_faction_id===id)||(data.memberships||[]).some(x=>x.faction_id===id);
    if(used)return setState($("adminMapState"),"CANNOT DELETE "+f.name.toUpperCase()+" WHILE IT HAS TERRITORY, FACILITIES, OR MEMBERSHIPS.","error");
    if(!confirm("Delete "+f.name+" permanently?"))return;
    try{
      await GMAuth.api("factions?id=eq."+encodeURIComponent(id),{method:"DELETE",headers:{Prefer:"return=minimal"}});
      await window.GMAdminRefresh("FACTION DELETED");
    }catch(error){setState($("adminMapState"),"FACTION DELETE FAILED // "+error.message,"error")}
  }

  function renderBuildingControls(){
    const types=data?.facilityTypes||[];
    const typeOptions=types.map(t=>'<option value="'+esc(t.id)+'">'+esc(t.name)+'</option>').join("");
    $("adminMapBuildingType").innerHTML=typeOptions||'<option value="">No facility types</option>';
    $("adminMapEditBuildingType").innerHTML=typeOptions||'<option value="">No facility types</option>';

    const rows=(data?.facilities||[]).filter(b=>parseRef(b.location_ref));
    $("adminMapBuildingList").innerHTML=rows.map(b=>{
      const faction=factionById(b.owner_faction_id||b.controlling_faction_id),type=typeById(b.facility_type_id);
      return '<article class="notice admin-map-row"><div class="admin-map-building-icon">'+esc(facilitySymbol(type))+'</div><div><strong>'+esc(b.name||type?.name||"Asset")+'</strong><div class="section-code">'+esc(faction?.name||"NO FACTION")+' // '+esc(type?.name||"FACILITY")+' // '+esc(b.location_ref||"UNPLACED")+'</div></div><div class="admin-map-row-actions"><button class="hud-button secondary map-edit-building" data-id="'+esc(b.id)+'" type="button">EDIT</button><button class="hud-button danger map-delete-building" data-id="'+esc(b.id)+'" type="button">DELETE</button></div></article>';
    }).join("")||'<div class="empty-state">NO CONSTRUCTED ASSETS.</div>';
    $("adminMapBuildingList").querySelectorAll(".map-edit-building").forEach(btn=>btn.addEventListener("click",()=>selectBuilding(btn.dataset.id)));
    $("adminMapBuildingList").querySelectorAll(".map-delete-building").forEach(btn=>btn.addEventListener("click",()=>deleteBuilding(btn.dataset.id)));
    updateBuildPreview();
  }

  function updateBuildPreview(){
    const type=typeById($("adminMapBuildingType").value),faction=factionById($("adminMapIndustryFaction").value);
    $("adminMapBuildCost").textContent=type?fmt(type.build_cost_aureum)+" A":"0";
    $("adminMapBuildOutput").textContent=type?fmt(type.output_per_cycle):"0";
    $("adminMapBuildUpkeep").textContent=type?fmt(type.upkeep_aureum_per_cycle)+" A":"0";
    $("adminMapIndustryTreasury").textContent=faction?fmt(faction.treasury)+" A":"0";
  }

  function selectBuilding(id){
    const b=buildingById(id);if(!b)return;
    selectedBuildingId=id;
    $("adminMapEditBuildingName").value=b.name||"";
    $("adminMapEditBuildingFaction").value=b.owner_faction_id||b.controlling_faction_id||"";
    $("adminMapEditBuildingType").value=b.facility_type_id||"";
    $("adminMapEditBuildingNotes").value=b.notes||"";
    setMode("selectBuilding");draw();
  }

  async function saveSelectedBuilding(){
    const b=buildingById(selectedBuildingId);if(!b)return setState($("adminMapState"),"SELECT AN ASSET FIRST","error");
    const factionId=$("adminMapEditBuildingFaction").value;
    try{
      await GMAuth.api("facilities?id=eq."+encodeURIComponent(b.id),{
        method:"PATCH",headers:{Prefer:"return=minimal"},
        body:JSON.stringify({
          name:$("adminMapEditBuildingName").value.trim()||null,
          owner_faction_id:factionId||null,
          controlling_faction_id:factionId||null,
          facility_type_id:$("adminMapEditBuildingType").value,
          notes:$("adminMapEditBuildingNotes").value.trim()||null
        })
      });
      await window.GMAdminRefresh("MAP ASSET SAVED");
    }catch(error){setState($("adminMapState"),"ASSET SAVE FAILED // "+error.message,"error")}
  }

  async function deleteBuilding(id=selectedBuildingId){
    const b=buildingById(id);if(!b)return;
    if(!confirm("Delete "+(b.name||"this asset")+"? Construction cost will not be refunded."))return;
    try{
      await GMAuth.api("facilities?id=eq."+encodeURIComponent(id),{method:"DELETE",headers:{Prefer:"return=minimal"}});
      selectedBuildingId=null;await window.GMAdminRefresh("MAP ASSET DELETED");
    }catch(error){setState($("adminMapState"),"ASSET DELETE FAILED // "+error.message,"error")}
  }

  async function claimHex(ref){
    const factionId=$("adminMapFaction").value;if(!factionId)return setState($("adminMapState"),"SELECT A FACTION FIRST","error");
    const existing=territoryByRef(ref);
    const mapHex=mapHexes.find(h=>(h.location_ref||refFor(h.q,h.r))===ref);
    try{
      if(existing){
        await GMAuth.api("territories?location_ref=eq."+encodeURIComponent(ref),{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({faction_id:factionId})});
        existing.faction_id=factionId;
      }else{
        const payload={location_ref:ref,display_name:mapHex?.display_name||null,faction_id:factionId,production_modifier:1,status:"stable"};
        await GMAuth.api("territories",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify(payload)});
        data.territories.push(payload);
      }
      draw();renderFactionControls();
    }catch(error){setState($("adminMapState"),"HEX CLAIM FAILED // "+error.message,"error")}
  }

  async function eraseHex(ref){
    const existing=territoryByRef(ref);if(!existing)return;
    try{
      await GMAuth.api("territories?location_ref=eq."+encodeURIComponent(ref),{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({faction_id:null})});
      existing.faction_id=null;draw();renderFactionControls();
    }catch(error){setState($("adminMapState"),"HEX ERASE FAILED // "+error.message,"error")}
  }

  async function clearClaims(){
    if(!confirm("Clear every faction claim on the galaxy map? This preserves hex metadata, facilities, characters, and other game records."))return;
    try{
      await GMAuth.api("territories?faction_id=not.is.null",{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({faction_id:null})});
      (data.territories||[]).forEach(row=>row.faction_id=null);
      draw();renderFactionControls();setState($("adminMapState"),"ALL MAP CLAIMS CLEARED","success");
    }catch(error){setState($("adminMapState"),"CLEAR CLAIMS FAILED // "+error.message,"error")}
  }

  function getLabelAt(mx,my){
    for(let i=(data?.mapLabels||[]).length-1;i>=0;i--){
      const l=data.mapLabels[i],p=worldToScreen({x:Number(l.x),y:Number(l.y)});
      ctx.font=`${Math.max(8,Number(l.font_size||16)*camera.zoom)}px Georgia`;
      const w=ctx.measureText(l.text).width,h=Number(l.font_size||16)*camera.zoom;
      if(mx>=p.x-6&&mx<=p.x+w+6&&my>=p.y-h-8&&my<=p.y+8)return l;
    }
    return null;
  }

  function loadSelectedLabelFields(){
    const l=labelById(selectedLabelId);if(!l)return;
    $("adminMapEditLabelText").value=l.text||"";
    $("adminMapLabelColor").value=l.color||"#ffffff";
    $("adminMapLabelSize").value=l.font_size||16;
    $("adminMapLabelOpacity").value=l.opacity??1;
    $("adminMapLabelBorder").value=l.border_style||"none";
    $("adminMapLabelBorderColor").value=l.border_color||"#000000";
    $("adminMapLabelBorderOpacity").value=l.border_opacity??.8;
    $("adminMapLabelBgColor").value=l.background_color||"#000000";
    $("adminMapLabelBgOpacity").value=l.background_opacity??0;
  }

  async function placeLabel(mx,my){
    const textValue=$("adminMapLabelText").value.trim();if(!textValue)return;
    const p=screenToWorld(mx,my);
    const payload={
      text:textValue,x:p.x,y:p.y,color:$("adminMapLabelColor").value,
      font_size:Number($("adminMapLabelSize").value)||16,opacity:Number($("adminMapLabelOpacity").value),
      border_style:$("adminMapLabelBorder").value,border_color:$("adminMapLabelBorderColor").value,
      border_opacity:Number($("adminMapLabelBorderOpacity").value),background_color:$("adminMapLabelBgColor").value,
      background_opacity:Number($("adminMapLabelBgOpacity").value),player_visible:true
    };
    try{
      const rows=await GMAuth.api("map_labels",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify(payload)});
      if(rows?.[0]){data.mapLabels.push(rows[0]);selectedLabelId=rows[0].id}
      draw();$("adminMapLabelCount").textContent=String(data.mapLabels.length);
    }catch(error){setState($("adminMapState"),"LABEL CREATE FAILED // "+error.message,"error")}
  }

  async function saveSelectedLabel(){
    const l=labelById(selectedLabelId);if(!l)return setState($("adminMapState"),"SELECT A MAP LABEL FIRST","error");
    const payload={
      text:$("adminMapEditLabelText").value.trim()||l.text,color:$("adminMapLabelColor").value,
      font_size:Number($("adminMapLabelSize").value)||16,opacity:Number($("adminMapLabelOpacity").value),
      border_style:$("adminMapLabelBorder").value,border_color:$("adminMapLabelBorderColor").value,
      border_opacity:Number($("adminMapLabelBorderOpacity").value),background_color:$("adminMapLabelBgColor").value,
      background_opacity:Number($("adminMapLabelBgOpacity").value)
    };
    try{
      await GMAuth.api("map_labels?id=eq."+encodeURIComponent(l.id),{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify(payload)});
      Object.assign(l,payload);draw();
    }catch(error){setState($("adminMapState"),"LABEL SAVE FAILED // "+error.message,"error")}
  }

  async function deleteSelectedLabel(){
    const l=labelById(selectedLabelId);if(!l)return;
    try{
      await GMAuth.api("map_labels?id=eq."+encodeURIComponent(l.id),{method:"DELETE",headers:{Prefer:"return=minimal"}});
      data.mapLabels=data.mapLabels.filter(x=>x.id!==l.id);selectedLabelId=null;$("adminMapEditLabelText").value="";draw();
    }catch(error){setState($("adminMapState"),"LABEL DELETE FAILED // "+error.message,"error")}
  }

  async function placeBuilding(ref){
    const factionId=$("adminMapIndustryFaction").value,typeId=$("adminMapBuildingType").value;
    if(!factionId||!typeId)return setState($("adminMapState"),"SELECT A FACTION AND BUILDING TYPE","error");
    try{
      const result=await GMAuth.api("rpc/admin_place_faction_facility",{
        method:"POST",body:JSON.stringify({
          p_faction_id:factionId,p_facility_type_id:typeId,p_location_ref:ref,
          p_name:null,p_notes:null,p_charge_treasury:$("adminMapChargeTreasury").checked
        })
      });
      await window.GMAdminRefresh("ASSET PLACED // "+result.name);
    }catch(error){setState($("adminMapState"),"ASSET PLACEMENT FAILED // "+error.message,"error")}
  }

  function getBuildingAt(mx,my){
    const rows=(data?.facilities||[]).filter(b=>parseRef(b.location_ref));
    for(let i=rows.length-1;i>=0;i--){
      const b=rows[i],h=parseRef(b.location_ref),p=worldToScreen(hexToPixel(h.q,h.r));
      if(Math.hypot(mx-p.x,my-p.y)<=18*camera.zoom+6)return b;
    }
    return null;
  }

  function exportMap(){
    const factions=(data?.factions||[]).map(f=>({id:f.id,name:f.name,color:f.color,status:f.status}));
    const factionIndex=new Map(factions.map((f,i)=>[f.id,i]));
    const hexes={};
    (data?.territories||[]).filter(t=>t.faction_id&&factionIndex.has(t.faction_id)).forEach(t=>{
      const h=parseRef(t.location_ref);if(h)hexes[h.q+","+h.r]=factionIndex.get(t.faction_id);
    });
    const labels=(data?.mapLabels||[]).map(l=>({
      id:l.id,text:l.text,x:Number(l.x),y:Number(l.y),color:l.color,size:l.font_size,opacity:Number(l.opacity),
      border:l.border_style,borderColor:l.border_color,borderOpacity:Number(l.border_opacity),
      bgColor:l.background_color,bgOpacity:Number(l.background_opacity)
    }));
    const serverFacilities=(data?.facilities||[]).filter(b=>parseRef(b.location_ref)).map(b=>({
      id:b.id,name:b.name,facility_type_id:b.facility_type_id,owner_faction_id:b.owner_faction_id,
      controlling_faction_id:b.controlling_faction_id,location_ref:b.location_ref,status:b.status,
      production_modifier:b.production_modifier,notes:b.notes||null
    }));
    const save={version:"2.0",type:"gradari_galaxy_map",exportedAt:new Date().toISOString(),hexes,labels,factions,serverFacilities};
    const blob=new Blob([JSON.stringify(save,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="gradari-galaxy-map-save.json";a.click();URL.revokeObjectURL(url);
  }

  async function importMap(file){
    if(!file)return;
    try{
      const payload=JSON.parse(await file.text());
      if(!payload.hexes||!Array.isArray(payload.labels))throw new Error("This does not look like a Gradari map save.");
      if(!confirm("Importing will replace current faction claims and map labels. Existing factions, facilities, characters, armies, and economy records will not be deleted. Continue?"))return;

      const sourceFactions=Array.isArray(payload.factions)?payload.factions:[];
      const liveByName=new Map((data.factions||[]).map(f=>[String(f.name).trim().toLowerCase(),f]));
      const claims=[];
      Object.entries(payload.hexes).forEach(([key,value])=>{
        let ref=key.startsWith("HEX_")?key:null;
        if(!ref){const parts=key.split(",").map(Number);if(parts.length===2&&parts.every(Number.isFinite))ref=refFor(parts[0],parts[1])}
        if(!ref||!mapHexSet.has(ref))return;
        let faction=null;
        if(typeof value==="string")faction=factionById(value)||liveByName.get(value.trim().toLowerCase());
        if(!faction&&Number.isInteger(Number(value))&&sourceFactions[Number(value)]){
          const source=sourceFactions[Number(value)];
          faction=factionById(source.id)||liveByName.get(String(source.name||"").trim().toLowerCase());
        }
        if(faction)claims.push({location_ref:ref,faction_id:faction.id,production_modifier:1,status:"stable"});
      });

      await GMAuth.api("territories?faction_id=not.is.null",{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({faction_id:null})});
      if(claims.length){
        await GMAuth.api("territories?on_conflict=location_ref",{
          method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(claims)
        });
      }

      await GMAuth.api("map_labels?id=not.is.null",{method:"DELETE",headers:{Prefer:"return=minimal"}});
      if(payload.labels.length){
        const labels=payload.labels.map(l=>({
          text:String(l.text||"").slice(0,500),x:Number(l.x)||0,y:Number(l.y)||0,
          color:l.color||"#ffffff",font_size:Number(l.font_size??l.size??16)||16,
          opacity:Number(l.opacity??1),border_style:l.border_style??l.border??"none",
          border_color:l.border_color??l.borderColor??"#000000",
          border_opacity:Number(l.border_opacity??l.borderOpacity??.8),
          background_color:l.background_color??l.bgColor??"#000000",
          background_opacity:Number(l.background_opacity??l.bgOpacity??0),
          player_visible:true
        })).filter(l=>l.text);
        if(labels.length)await GMAuth.api("map_labels",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify(labels)});
      }

      await window.GMAdminRefresh("MAP IMPORTED // "+claims.length+" CLAIMS");
    }catch(error){setState($("adminMapState"),"MAP IMPORT FAILED // "+error.message,"error")}
    finally{$("adminMapImportFile").value=""}
  }

  function renderTradeResourceEditor(){
    const marketId=$("adminTradeStationMarket").value;
    const catalog=data?.resourceCatalog || [];
    $("adminTradeResourceCode").innerHTML=catalog.map(row=>'<option value="'+esc(row.code)+'">'+esc(row.name)+'</option>').join("");
    const rows=(data?.tradeStationResources||[]).filter(row=>row.market_id===marketId);
    $("adminTradeResourceList").innerHTML=rows.length ? rows.map(row=>{
      const item=catalog.find(x=>x.code===row.resource_code);
      return '<div class="resource-row"><div><strong>'+esc(item?.name||row.resource_code)+'</strong><div class="section-code">BUY '+esc(fmt(row.buy_price))+' A // SELL '+esc(fmt(row.sell_price))+' A</div></div><button class="hud-button danger admin-trade-resource-delete" type="button" data-market="'+esc(row.market_id)+'" data-resource="'+esc(row.resource_code)+'">REMOVE</button></div>';
    }).join("") : '<div class="empty-state map-mini-empty">NO STRATEGIC RESOURCE LISTINGS.</div>';
    document.querySelectorAll(".admin-trade-resource-delete").forEach(button=>button.addEventListener("click",async()=>{
      try{
        await GMAuth.api("trade_station_resource_listings?market_id=eq."+encodeURIComponent(button.dataset.market)+"&resource_code=eq."+encodeURIComponent(button.dataset.resource),{method:"DELETE",headers:{Prefer:"return=minimal"}});
        await window.GMAdminRefresh("STATION LISTING REMOVED");
        renderTradeResourceEditor();
      }catch(error){setState($("adminMapState"),"LISTING DELETE FAILED // "+error.message,"error")}
    }));
  }

  async function saveTradeResource(){
    const marketId=$("adminTradeStationMarket").value;
    if(!$("adminTradeStationEnabled").checked || !marketId) return setState($("adminMapState"),"SAVE THE TRADE STATION AND MARKET FIRST","error");
    const row={
      market_id:marketId,
      resource_code:$("adminTradeResourceCode").value,
      buy_price:Number($("adminTradeBuyPrice").value||0),
      sell_price:Number($("adminTradeSellPrice").value||0),
      stock:$("adminTradeStock").value===""?null:Number($("adminTradeStock").value)
    };
    try{
      await GMAuth.api("trade_station_resource_listings?on_conflict=market_id,resource_code",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(row)});
      await window.GMAdminRefresh("STATION RESOURCE LISTING SAVED");
      loadSystemFields(selectedSystemRef);
    }catch(error){setState($("adminMapState"),"LISTING SAVE FAILED // "+error.message,"error")}
  }

  function loadSystemFields(ref){
    selectedSystemRef=ref;
    const system=(data?.systemEconomies||[]).find(row=>row.location_ref===ref);
    const deposits=(data?.resourceDeposits||[]).filter(row=>row.location_ref===ref);
    const has=code=>deposits.some(row=>row.resource_code===code);
    $("adminMapSystemRef").textContent=ref;
    $("adminMapPopulation").value=Number(system?.population||0);
    $("adminMapManpower").value=Number(system?.manpower||0);
    $("adminResEnergy").checked=has("energy");
    $("adminResGold").checked=has("gold_ore");
    $("adminResAetherite").checked=has("aetherite");
    $("adminResVyr").checked=has("vyr_ore");
    const station=(data?.tradeStations||[]).find(row=>row.location_ref===ref);
    $("adminTradeStationEnabled").checked=Boolean(station);
    $("adminTradeStationName").value=station?.station_name || "";
    $("adminTradeStationMarket").value=station?.market_id || "";
    renderTradeResourceEditor();
  }

  async function saveSystem(){
    if(!selectedSystemRef)return setState($("adminMapState"),"SELECT A HEX FIRST","error");
    const economy={location_ref:selectedSystemRef,population:Number($("adminMapPopulation").value)||0,manpower:Number($("adminMapManpower").value)||0,slot_limit:8};
    const wanted=[
      ["energy",$("adminResEnergy").checked],
      ["gold_ore",$("adminResGold").checked],
      ["aetherite",$("adminResAetherite").checked],
      ["vyr_ore",$("adminResVyr").checked]
    ];
    try{
      await GMAuth.api("system_economies?on_conflict=location_ref",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(economy)});
      await GMAuth.api("map_resource_deposits?location_ref=eq."+encodeURIComponent(selectedSystemRef),{method:"DELETE",headers:{Prefer:"return=minimal"}});
      const rows=wanted.filter(([,enabled])=>enabled).map(([resource_code])=>({location_ref:selectedSystemRef,resource_code,richness:1}));
      if(rows.length)await GMAuth.api("map_resource_deposits",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify(rows)});

      const stationEnabled=$("adminTradeStationEnabled").checked;
      const existingStation=(data?.tradeStations||[]).find(row=>row.location_ref===selectedSystemRef);
      if(stationEnabled){
        const marketId=$("adminTradeStationMarket").value;
        if(!marketId) throw new Error("Select an exchange market for the trade station.");
        const stationRow={market_id:marketId,location_ref:selectedSystemRef,station_name:$("adminTradeStationName").value.trim()||"Guilded Concord Trade Station",player_visible:true};
        if(existingStation){
          await GMAuth.api("trade_station_markets?market_id=eq."+encodeURIComponent(existingStation.market_id),{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify(stationRow)});
        }else{
          await GMAuth.api("trade_station_markets",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify(stationRow)});
        }
      }else if(existingStation){
        await GMAuth.api("trade_station_markets?market_id=eq."+encodeURIComponent(existingStation.market_id),{method:"DELETE",headers:{Prefer:"return=minimal"}});
      }

      await window.GMAdminRefresh("SYSTEM ECONOMY SAVED");
      loadSystemFields(selectedSystemRef);
    }catch(error){setState($("adminMapState"),"SYSTEM SAVE FAILED // "+error.message,"error")}
  }

  async function runIndustryCycle(){
    if(!confirm("Run one industrial production cycle now?")) return;
    try{
      setState($("adminMapState"),"RUNNING INDUSTRY CYCLE...");
      const result=await GMAuth.api("rpc/run_industry_cycle",{method:"POST",body:"{}"});
      await window.GMAdminRefresh("INDUSTRY CYCLE COMPLETE // "+Number(result?.processed||0)+" OPERATIONS");
    }catch(error){setState($("adminMapState"),"INDUSTRY CYCLE FAILED // "+error.message,"error")}
  }

  function handleCanvasClick(mx,my){
    if(mode==="label"){placeLabel(mx,my);return}
    if(mode==="select"){
      const l=getLabelAt(mx,my);
      selectedLabelId=l?.id||null;
      if(l) loadSelectedLabelFields();
      else {
        $("adminMapEditLabelText").value="";
        const h=pixelToHex(mx,my),ref=refFor(h.q,h.r);
        if(mapHexSet.has(ref)) loadSystemFields(ref);
      }
      draw();return;
    }
    if(mode==="selectBuilding"){
      const b=getBuildingAt(mx,my);if(b)selectBuilding(b.id);return;
    }
    const h=pixelToHex(mx,my),ref=refFor(h.q,h.r);
    if(!mapHexSet.has(ref))return;
    if(mode==="paint")claimHex(ref);
    else if(mode==="erase")eraseHex(ref);
    else if(mode==="build")placeBuilding(ref);
  }

  function renderAll(){
    if(!data)return;
    buildMapHexes();renderFactionControls();renderBuildingControls();
    const stationMarket=$("adminTradeStationMarket");
    const stationCurrent=stationMarket.value;
    stationMarket.innerHTML='<option value="">Select market</option>'+(data.markets||[]).map(row=>'<option value="'+esc(row.id)+'">'+esc(row.name)+'</option>').join("");
    if((data.markets||[]).some(row=>row.id===stationCurrent)) stationMarket.value=stationCurrent;
    $("adminMapLabelCount").textContent=String((data.mapLabels||[]).length);
    if(canvas.getBoundingClientRect().width>0)resizeCanvas(firstVisibleResize);
    else draw();
  }

  document.addEventListener("gm:admin-state",event=>{
    data=event.detail;
    renderAll();
  });

  $("adminMapFaction").addEventListener("change",()=>{
    const f=factionById($("adminMapFaction").value);
    if(f){$("adminMapFactionEditId").value=f.id;$("adminMapFactionName").value=f.name||"";$("adminMapFactionColor").value=f.color||"#4fa8c4"}
  });
  $("adminMapIndustryFaction").addEventListener("change",updateBuildPreview);
  $("adminMapBuildingType").addEventListener("change",updateBuildPreview);
  $("adminMapPaintBtn").addEventListener("click",()=>setMode("paint"));
  $("adminMapEraseBtn").addEventListener("click",()=>setMode("erase"));
  $("adminMapCenterBtn").addEventListener("click",centerMap);
  $("adminMapClearBtn").addEventListener("click",clearClaims);
  $("adminMapSaveFactionBtn").addEventListener("click",saveFaction);
  $("adminMapNewFactionBtn").addEventListener("click",newFaction);
  $("adminMapLabelBtn").addEventListener("click",()=>setMode("label"));
  $("adminMapSelectLabelBtn").addEventListener("click",()=>setMode("select"));
  $("adminMapRenameLabelBtn").addEventListener("click",saveSelectedLabel);
  $("adminMapDeleteLabelBtn").addEventListener("click",deleteSelectedLabel);
  $("adminMapBuildBtn").addEventListener("click",()=>setMode("build"));
  $("adminMapSelectBuildingBtn").addEventListener("click",()=>setMode("selectBuilding"));
  $("adminMapSaveBuildingBtn").addEventListener("click",saveSelectedBuilding);
  $("adminMapDeleteBuildingBtn").addEventListener("click",()=>deleteBuilding());
  $("adminMapExportBtn").addEventListener("click",exportMap);
  $("adminMapImportBtn").addEventListener("click",()=>$("adminMapImportFile").click());
  $("adminMapImportFile").addEventListener("change",event=>importMap(event.target.files?.[0]));
  $("adminMapSaveSystemBtn").addEventListener("click",saveSystem);
  $("adminTradeStationMarket").addEventListener("change",renderTradeResourceEditor);
  $("adminTradeResourceSaveBtn").addEventListener("click",saveTradeResource);
  $("adminRunIndustryCycleBtn").addEventListener("click",runIndustryCycle);

  canvas.addEventListener("pointerdown",event=>{
    if(event.pointerType==="mouse"&&event.button!==0)return;
    canvas.setPointerCapture(event.pointerId);
    const rect=canvas.getBoundingClientRect(),mx=event.clientX-rect.left,my=event.clientY-rect.top;
    if(mode==="select"){
      const l=getLabelAt(mx,my);
      if(l){selectedLabelId=l.id;loadSelectedLabelFields();draggingLabel=true;dragging=true;dragMoved=false;draw();return}
    }
    dragging=true;dragMoved=false;dragStart={x:event.clientX,y:event.clientY};cameraStart={...camera};
  });

  canvas.addEventListener("pointermove",event=>{
    if(!dragging)return;
    const rect=canvas.getBoundingClientRect(),mx=event.clientX-rect.left,my=event.clientY-rect.top;
    if(draggingLabel){
      const l=labelById(selectedLabelId);
      if(l){const p=screenToWorld(mx,my);l.x=p.x;l.y=p.y;draw()}
      return;
    }
    const dx=event.clientX-dragStart.x,dy=event.clientY-dragStart.y;
    if(Math.abs(dx)>3||Math.abs(dy)>3)dragMoved=true;
    if(dragMoved){camera.x=cameraStart.x+dx;camera.y=cameraStart.y+dy;draw()}
  });

  canvas.addEventListener("pointerup",async event=>{
    const rect=canvas.getBoundingClientRect(),mx=event.clientX-rect.left,my=event.clientY-rect.top;
    if(draggingLabel){
      const l=labelById(selectedLabelId);draggingLabel=false;dragging=false;
      if(l){
        try{await GMAuth.api("map_labels?id=eq."+encodeURIComponent(l.id),{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({x:l.x,y:l.y})})}
        catch(error){setState($("adminMapState"),"LABEL MOVE FAILED // "+error.message,"error")}
      }
      return;
    }
    if(!dragMoved)handleCanvasClick(mx,my);
    dragging=false;
  });

  canvas.addEventListener("pointercancel",()=>{dragging=false;draggingLabel=false});
  canvas.addEventListener("wheel",event=>{
    event.preventDefault();
    const rect=canvas.getBoundingClientRect(),mx=event.clientX-rect.left,my=event.clientY-rect.top;
    const before=screenToWorld(mx,my),factor=event.deltaY<0?1.1:.9;
    camera.zoom=Math.min(3,Math.max(.4,camera.zoom*factor));
    camera.x=mx-before.x*camera.zoom;camera.y=my-before.y*camera.zoom;draw();
  },{passive:false});

  new ResizeObserver(()=>resizeCanvas(false)).observe(canvas.parentElement);
  document.querySelector('[data-tab-target="admin-map"]')?.addEventListener("click",()=>setTimeout(()=>resizeCanvas(firstVisibleResize),30));

  setMode("select");
})();