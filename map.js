(() => {
  let session = null;
  let player = null;
  let territories = [];
  let modifiers = [];
  let mapRegistry = [];
  let mapLabels = [];
  let armies = [];
  let armyMovements = [];
  let militaryOperations = [];
  let characterTravel = [];
  let worldClock = null;
  let selectedHex = null;
  let hoverHex = null;

  const canvas = document.getElementById("galaxyMap");
  const ctx = canvas.getContext("2d");
  const $ = id => document.getElementById(id);
  const esc = value => GMUI.esc(value);
  const fmt = value => Number(value || 0).toLocaleString(undefined,{maximumFractionDigits:2});
  const setState = (el,message,type="") => GMUI.setState(el,message,type);

  let radius = 14;
  let hexSize = 32;
  let mapHexes = [];
  let mapHexSet = new Set();
  let camera = {x:0,y:0,zoom:1};
  let drag = null;
  let firstResize = true;

  const layers = {
    territory:true,
    facilities:true,
    character:true,
    modifiers:true
  };

  const dirs = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
  const canonLocations = {"HEX_-2_-2":{name:"VIRETHON PRIMARIS",type:"IMPERIAL CAPITAL",faction:"GRADARI MIRERIS"}};

  function refFor(q,r) {
    return "HEX_" + q + "_" + r;
  }

  function parseRef(ref) {
    const match = /^HEX_(-?\d+)_(-?\d+)$/.exec(ref || "");
    return match ? {q:Number(match[1]),r:Number(match[2])} : null;
  }

  function buildCircle() {
    const registry = (mapRegistry || []).filter(row => row.player_visible !== false);
    if (registry.length) {
      mapHexes = registry.map(row => ({
        q:Number(row.q),
        r:Number(row.r),
        ref:row.location_ref,
        display_name:row.display_name || null,
        region_name:row.region_name || null,
        terrain_type:row.terrain_type || null,
        habitable_systems:Number(row.habitable_systems || 0),
        status:row.status || "open"
      }));
      mapHexSet = new Set(mapHexes.map(row => row.ref));
    } else {
      mapHexes = [];
      mapHexSet = new Set();
      for (let q=-radius;q<=radius;q++) {
        for (let r=-radius;r<=radius;r++) {
          const s = -q-r;
          if (Math.max(Math.abs(q),Math.abs(r),Math.abs(s)) <= radius) {
            const hex = {q,r,ref:refFor(q,r)};
            mapHexes.push(hex);
            mapHexSet.add(hex.ref);
          }
        }
      }
    }
    $("mapHexCount").textContent = mapHexes.length.toLocaleString();
  }

  function factionById(id) {
    return player?.factions?.find(row => row.id === id) || null;
  }

  function territoryByRef(ref) {
    return territories.find(row => row.location_ref === ref) || null;
  }

  function livingCharacter() {
    return player?.characters?.find(row => row.status === "active" && row.life_status === "alive") || null;
  }

  function activeMembership() {
    return player?.primaryMembership?.status === "active" ? player.primaryMembership : null;
  }

  function facilityTypeById(id) {
    return player?.facilityTypes?.find(row => row.id === id) || null;
  }

  function hexDistance(aRef,bRef) {
    const a=parseRef(aRef), b=parseRef(bRef);
    if(!a || !b) return 0;
    const as=-a.q-a.r, bs=-b.q-b.r;
    return Math.max(Math.abs(a.q-b.q),Math.abs(a.r-b.r),Math.abs(as-bs));
  }

  function currentWorldHour() {
    return Number(worldClock?.total_world_hours || 0);
  }

  function worldArrivalLabel(totalHours) {
    if(!Number.isFinite(Number(totalHours))) return "--";
    const whole=Math.floor(Number(totalHours));
    const aevum=Math.floor(whole/9360);
    const cycle=Math.floor((whole%9360)/720)+1;
    const week=Math.floor((whole%720)/180)+1;
    const day=Math.floor((whole%180)/36)+1;
    const hour=(whole%36)+1;
    return "A"+aevum+" C"+cycle+" W"+week+" D"+day+" H"+String(hour).padStart(2,"0");
  }

  function worldSpeed() {
    const speed=Number(worldClock?.speed || 5);
    return speed>0 ? speed : 5;
  }

  function realDurationLabel(worldHours) {
    const realHours=Math.max(0,Number(worldHours||0)/worldSpeed());
    const totalMinutes=Math.round(realHours*60);
    if(totalMinutes<60) return totalMinutes+" MIN REAL";
    const days=Math.floor(totalMinutes/1440);
    const hours=Math.floor((totalMinutes%1440)/60);
    const minutes=totalMinutes%60;
    return [days?days+"D":"",hours?hours+"H":"",minutes?minutes+"M":""].filter(Boolean).join(" ")+" REAL";
  }

  function realArrivalLabel(arriveWorldHour) {
    const remaining=Math.max(0,Number(arriveWorldHour||0)-currentWorldHour());
    const when=new Date(Date.now()+(remaining/worldSpeed())*3600000);
    return when.toLocaleString(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
  }

  function movementTimeLabel(worldHours) {
    return fmt(worldHours)+" WORLD HRS ("+realDurationLabel(worldHours)+")";
  }

  function arrivalTimeLabel(worldHour) {
    return worldArrivalLabel(worldHour)+" ("+realArrivalLabel(worldHour)+")";
  }

  function activeModifiersFor(ref) {
    const now = Date.now();
    const worldNow=currentWorldHour();
    return modifiers.filter(row =>
      row.location_ref === ref &&
      (row.starts_world_hour==null || Number(row.starts_world_hour)<=worldNow) &&
      (row.expires_world_hour==null || Number(row.expires_world_hour)>worldNow) &&
      (!row.starts_at || new Date(row.starts_at).getTime() <= now) &&
      (!row.expires_at || new Date(row.expires_at).getTime() > now)
    );
  }

  async function loadMapData() {
    const [hexRows,territoryRows,labelRows,modifierRows,armyRows,armyMoveRows,operationRows,travelRows,clock] = await Promise.all([
      GMAuth.api("map_hexes?player_visible=eq.true&select=*&order=q.asc,r.asc"),
      GMAuth.api("territories?select=*&order=location_ref.asc"),
      GMAuth.api("map_labels?player_visible=eq.true&select=*&order=created_at.asc"),
      GMAuth.api("location_modifiers?player_visible=eq.true&select=*&order=created_at.desc"),
      GMAuth.api("armies?select=*&order=name.asc"),
      GMAuth.api("army_movements?select=*&order=created_at.desc&limit=100"),
      GMAuth.api("military_operations?select=*&order=created_at.desc&limit=100"),
      GMAuth.api("character_travel?select=*&order=created_at.desc&limit=20"),
      GMAuth.api("rpc/get_world_clock",{method:"POST",body:"{}"})
    ]);
    mapRegistry = hexRows || [];
    territories = territoryRows || [];
    mapLabels = labelRows || [];
    modifiers = modifierRows || [];
    armies = armyRows || [];
    armyMovements = armyMoveRows || [];
    militaryOperations = operationRows || [];
    characterTravel = travelRows || [];
    worldClock = clock || null;
  }

  async function refreshAll(message="",target=null) {
    player = await GMPlayerData.load(session);
    await loadMapData();
    radius = Number(player.config?.map_radius || 14);
    hexSize = Number(player.config?.map_hex_size || 32);
    buildCircle();
    renderUi();
    draw();
    if (message && target) setState(target,message,"success");
  }

  function hexToWorld(q,r) {
    return {
      x:hexSize*Math.sqrt(3)*(q+r/2),
      y:hexSize*1.5*r
    };
  }

  function worldToScreen(point) {
    return {
      x:point.x*camera.zoom+camera.x,
      y:point.y*camera.zoom+camera.y
    };
  }

  function screenToWorld(x,y) {
    return {
      x:(x-camera.x)/camera.zoom,
      y:(y-camera.y)/camera.zoom
    };
  }

  function roundHex(q,r) {
    let x=q,z=r,y=-x-z;
    let rx=Math.round(x),ry=Math.round(y),rz=Math.round(z);
    const xd=Math.abs(rx-x),yd=Math.abs(ry-y),zd=Math.abs(rz-z);
    if (xd>yd && xd>zd) rx=-ry-rz;
    else if (yd>zd) ry=-rx-rz;
    else rz=-rx-ry;
    return {q:rx,r:rz};
  }

  function pixelToHex(x,y) {
    const p = screenToWorld(x,y);
    const q = (Math.sqrt(3)/3*p.x-1/3*p.y)/hexSize;
    const r = (2/3*p.y)/hexSize;
    return roundHex(q,r);
  }

  function corners(x,y,size=hexSize) {
    const points=[];
    for (let i=0;i<6;i++) {
      const angle=Math.PI/180*(60*i-30);
      points.push({
        x:x+size*Math.cos(angle),
        y:y+size*Math.sin(angle)
      });
    }
    return points;
  }

  function hexPath(q,r) {
    const p=hexToWorld(q,r);
    const points=corners(p.x,p.y).map(worldToScreen);
    ctx.beginPath();
    ctx.moveTo(points[0].x,points[0].y);
    for (let i=1;i<points.length;i++) ctx.lineTo(points[i].x,points[i].y);
    ctx.closePath();
    return points;
  }

  function colorWithAlpha(hex,alpha) {
    const value=(hex || "#4fa8c4").replace("#","");
    const full=value.length===3 ? value.split("").map(x=>x+x).join("") : value.padEnd(6,"0");
    const r=parseInt(full.slice(0,2),16) || 0;
    const g=parseInt(full.slice(2,4),16) || 0;
    const b=parseInt(full.slice(4,6),16) || 0;
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function drawStars(width,height) {
    ctx.save();
    ctx.fillStyle="rgba(218,239,244,.52)";
    for (let i=0;i<220;i++) {
      const x=(i*911+137)%Math.max(1,width);
      const y=(i*577+83)%Math.max(1,height);
      const size=(i%9===0?1.6:1);
      ctx.fillRect(x,y,size,size);
    }
    ctx.fillStyle="rgba(79,168,196,.20)";
    for (let i=0;i<48;i++) {
      const x=(i*421+67)%Math.max(1,width);
      const y=(i*733+149)%Math.max(1,height);
      ctx.fillRect(x,y,1.3,1.3);
    }
    ctx.restore();
  }

  function drawBaseHexes() {
    mapHexes.forEach(hex => {
      hexPath(hex.q,hex.r);
      ctx.fillStyle="rgba(134,215,232,.018)";
      ctx.fill();
      ctx.strokeStyle="rgba(134,215,232,.105)";
      ctx.lineWidth=Math.max(.65,1*camera.zoom);
      ctx.stroke();
    });
  }

  function drawTerritories() {
    if (!layers.territory) return;

    territories.forEach(row => {
      const h=parseRef(row.location_ref);
      if (!h || !mapHexSet.has(row.location_ref)) return;
      const faction=factionById(row.faction_id);
      if (!faction) return;

      hexPath(h.q,h.r);
      ctx.fillStyle=colorWithAlpha(faction.color,.42);
      ctx.fill();
      ctx.strokeStyle=colorWithAlpha(faction.color,.66);
      ctx.lineWidth=Math.max(1,1.5*camera.zoom);
      ctx.stroke();
    });

    territories.forEach(row => {
      const h=parseRef(row.location_ref);
      const faction=factionById(row.faction_id);
      if (!h || !faction) return;
      const p=hexToWorld(h.q,h.r);
      const points=corners(p.x,p.y).map(worldToScreen);

      dirs.forEach((dir,index) => {
        const nref=refFor(h.q+dir[0],h.r+dir[1]);
        const neighbor=territoryByRef(nref);
        if (neighbor?.faction_id === row.faction_id) return;
        ctx.beginPath();
        ctx.moveTo(points[index].x,points[index].y);
        ctx.lineTo(points[(index+1)%6].x,points[(index+1)%6].y);
        ctx.strokeStyle=colorWithAlpha(faction.color,.98);
        ctx.lineWidth=Math.max(1.5,3.2*camera.zoom);
        ctx.stroke();
      });
    });

    if (camera.zoom >= .72) {
      ctx.save();
      ctx.textAlign="center";
      ctx.textBaseline="middle";
      territories.forEach(row => {
        if (!row.display_name) return;
        const h=parseRef(row.location_ref);
        if (!h) return;
        const p=worldToScreen(hexToWorld(h.q,h.r));
        ctx.font=`500 ${Math.max(8,10*camera.zoom)}px "Share Tech Mono", Consolas, monospace`;
        ctx.fillStyle="rgba(226,241,244,.80)";
        ctx.strokeStyle="rgba(2,8,12,.90)";
        ctx.lineWidth=3;
        ctx.strokeText(row.display_name.toUpperCase(),p.x,p.y-13*camera.zoom);
        ctx.fillText(row.display_name.toUpperCase(),p.x,p.y-13*camera.zoom);
      });
      ctx.restore();
    }
  }

  function facilitySymbol(type) {
    const code=String(type?.code || "").toUpperCase();
    if (code.includes("MINE") || code.includes("EXTRACT")) return "◆";
    if (code.includes("AGRI") || code.includes("FARM")) return "✦";
    if (code.includes("REFINERY")) return "⬢";
    if (code.includes("TRADING")) return "◎";
    if (code.includes("RESEARCH")) return "◇";
    if (code.includes("FACTORY")) return "▣";
    if (code.includes("SHIP")) return "⊕";
    return "■";
  }

  function drawMapLabels() {
    ctx.save();
    mapLabels.forEach(label => {
      const p=worldToScreen({x:Number(label.x),y:Number(label.y)});
      const fontSize=Math.max(8,Number(label.font_size||16)*camera.zoom);
      const opacity=Number(label.opacity??1);
      const border=label.border_style||"none";
      const borderOpacity=Number(label.border_opacity??.8);
      const bgOpacity=Number(label.background_opacity??0);
      ctx.font=fontSize+'px Georgia';
      ctx.textAlign='left';
      ctx.textBaseline='alphabetic';
      const w=ctx.measureText(label.text).width,h=fontSize;
      if(bgOpacity>0){
        ctx.fillStyle=colorWithAlpha(label.background_color||"#000000",bgOpacity);
        ctx.fillRect(p.x-6,p.y-h-6,w+12,h+12);
      }
      if(border==="box"){
        ctx.strokeStyle=colorWithAlpha(label.border_color||"#000000",borderOpacity);
        ctx.lineWidth=Math.max(1,2*camera.zoom);
        ctx.strokeRect(p.x-6,p.y-h-6,w+12,h+12);
      }
      if(border==="outline"){
        ctx.strokeStyle=colorWithAlpha(label.border_color||"#000000",borderOpacity);
        ctx.lineWidth=Math.max(1,3*camera.zoom);
        ctx.strokeText(label.text,p.x,p.y);
      }
      ctx.fillStyle=colorWithAlpha(label.color||"#ffffff",opacity);
      ctx.fillText(label.text,p.x,p.y);
    });
    ctx.restore();
  }

  function drawSystems() {
    const refs=new Set([
      ...(mapHexes || []).filter(row=>Number(row.habitable_systems||0)>0).map(row=>row.ref),
      ...(player?.systemEconomies || []).map(row=>row.location_ref)
    ]);
    ctx.save();
    refs.forEach(ref=>{
      const h=parseRef(ref);
      if(!h || !mapHexSet.has(ref)) return;
      const p=worldToScreen(hexToWorld(h.q,h.r));
      const radius=Math.max(3.5,5*camera.zoom);
      ctx.beginPath();
      ctx.arc(p.x,p.y,radius,0,Math.PI*2);
      ctx.fillStyle="rgba(226,241,244,.92)";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(p.x,p.y,radius+Math.max(2,3*camera.zoom),0,Math.PI*2);
      ctx.strokeStyle="rgba(134,215,232,.48)";
      ctx.lineWidth=1;
      ctx.stroke();
    });
    ctx.restore();
  }

  function drawTradeStations() {
    const stations=player?.tradeStations || [];
    if(!stations.length) return;
    ctx.save();
    ctx.textAlign="center";
    ctx.textBaseline="middle";
    stations.forEach(station => {
      const h=parseRef(station.location_ref);
      if(!h || !mapHexSet.has(station.location_ref)) return;
      const p=worldToScreen(hexToWorld(h.q,h.r));
      const size=Math.max(9,13*camera.zoom);
      ctx.beginPath();
      ctx.arc(p.x,p.y,size,0,Math.PI*2);
      ctx.fillStyle="rgba(5,13,18,.96)";
      ctx.fill();
      ctx.strokeStyle="#d8a35d";
      ctx.lineWidth=Math.max(1.5,2.2*camera.zoom);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(p.x,p.y,Math.max(4,6*camera.zoom),0,Math.PI*2);
      ctx.strokeStyle="#f1d7b0";
      ctx.lineWidth=Math.max(1,1.2*camera.zoom);
      ctx.stroke();
      if(camera.zoom>=.72){
        ctx.font=`600 ${Math.max(8,10*camera.zoom)}px "Share Tech Mono", Consolas, monospace`;
        ctx.textBaseline="bottom";
        ctx.strokeStyle="rgba(2,8,12,.95)";
        ctx.lineWidth=4;
        ctx.strokeText(String(station.station_name||"GUILDED CONCORD").toUpperCase(),p.x,p.y-size-4);
        ctx.fillStyle="#f1d7b0";
        ctx.fillText(String(station.station_name||"GUILDED CONCORD").toUpperCase(),p.x,p.y-size-4);
      }
    });
    ctx.restore();
  }

  function drawFacilities() {
    if (!layers.facilities) return;
    ctx.save();
    ctx.textAlign="center";
    ctx.textBaseline="middle";

    player.facilities.forEach(row => {
      const h=parseRef(row.location_ref);
      if (!h || !mapHexSet.has(row.location_ref)) return;
      const p=worldToScreen(hexToWorld(h.q,h.r));
      const type=facilityTypeById(row.facility_type_id);
      const size=Math.max(7,10*camera.zoom);

      ctx.beginPath();
      ctx.arc(p.x,p.y,size,0,Math.PI*2);
      ctx.fillStyle="rgba(3,12,17,.94)";
      ctx.fill();
      ctx.strokeStyle=row.status==="active" ? "#86d7e8" : "#d8a35d";
      ctx.lineWidth=Math.max(1,1.8*camera.zoom);
      ctx.stroke();

      ctx.fillStyle="#d8a35d";
      ctx.font=`500 ${Math.max(8,12*camera.zoom)}px "Share Tech Mono", Consolas, monospace`;
      ctx.fillText(facilitySymbol(type),p.x,p.y+.5);
    });
    ctx.restore();
  }

  function drawShips() {
    const ships=player?.ships || [];
    if(!ships.length) return;
    ctx.save();
    ships.forEach(ship=>{
      const h=parseRef(ship.location_ref);
      if(!h || !mapHexSet.has(ship.location_ref)) return;
      const p=worldToScreen(hexToWorld(h.q,h.r));
      const x=p.x+Math.max(12,18*camera.zoom);
      const y=p.y-Math.max(10,14*camera.zoom);
      ctx.beginPath();
      ctx.moveTo(x,y-Math.max(5,7*camera.zoom));
      ctx.lineTo(x+Math.max(5,7*camera.zoom),y+Math.max(6,8*camera.zoom));
      ctx.lineTo(x,y+Math.max(3,4*camera.zoom));
      ctx.lineTo(x-Math.max(5,7*camera.zoom),y+Math.max(6,8*camera.zoom));
      ctx.closePath();
      ctx.fillStyle="rgba(216,163,93,.95)";
      ctx.fill();
      ctx.strokeStyle="rgba(241,215,176,.95)";
      ctx.lineWidth=1;
      ctx.stroke();
      if(camera.zoom>=.85){
        ctx.font=`600 ${Math.max(8,9*camera.zoom)}px "Share Tech Mono", Consolas, monospace`;
        ctx.textAlign="center";ctx.textBaseline="top";ctx.fillStyle="#f1d7b0";
        ctx.fillText(String(ship.name||"SHIP").toUpperCase(),x,y+Math.max(8,10*camera.zoom));
      }
    });
    ctx.restore();
  }

  function drawArmies() {
    ctx.save();
    ctx.textAlign="center";
    ctx.textBaseline="middle";
    armies.filter(row=>row.status==="active" && row.location_ref).forEach(row => {
      const h=parseRef(row.location_ref);
      if(!h || !mapHexSet.has(row.location_ref)) return;
      const p=worldToScreen(hexToWorld(h.q,h.r));
      const faction=factionById(row.faction_id);
      const radius=Math.max(8,12*camera.zoom);
      ctx.beginPath();
      ctx.rect(p.x-radius,p.y-radius,radius*2,radius*2);
      ctx.fillStyle="rgba(3,10,15,.95)";
      ctx.fill();
      ctx.strokeStyle=faction?.color || "#86d7e8";
      ctx.lineWidth=Math.max(1.5,2*camera.zoom);
      ctx.stroke();
      ctx.fillStyle=faction?.color || "#86d7e8";
      ctx.font=`600 ${Math.max(8,11*camera.zoom)}px "Share Tech Mono", Consolas, monospace`;
      ctx.fillText("A",p.x,p.y+.5);
    });
    ctx.restore();
  }

  function drawModifiers() {
    if (!layers.modifiers) return;
    const refs=new Set(modifiers.filter(row => activeModifiersFor(row.location_ref).length).map(row=>row.location_ref));
    ctx.save();
    refs.forEach(ref => {
      const h=parseRef(ref);
      if (!h) return;
      const p=worldToScreen(hexToWorld(h.q,h.r));
      const offset=Math.max(12,18*camera.zoom);
      ctx.beginPath();
      ctx.moveTo(p.x,p.y-offset);
      ctx.lineTo(p.x-offset*.45,p.y-offset*.35);
      ctx.lineTo(p.x+offset*.45,p.y-offset*.35);
      ctx.closePath();
      ctx.fillStyle="rgba(216,112,93,.88)";
      ctx.fill();
    });
    ctx.restore();
  }

  function drawCharacterTravelRoute() {
    if(!layers.character) return;
    const char=livingCharacter();
    const travel=char ? characterTravel.find(row=>row.character_id===char.id && row.status==="traveling") : null;
    if(!travel) return;
    const from=parseRef(travel.from_ref), to=parseRef(travel.to_ref);
    if(!from || !to) return;
    const a=worldToScreen(hexToWorld(from.q,from.r));
    const b=worldToScreen(hexToWorld(to.q,to.r));
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(a.x,a.y);
    ctx.lineTo(b.x,b.y);
    ctx.setLineDash([3,8]);
    ctx.lineDashOffset=0;
    ctx.strokeStyle="rgba(240,201,143,.9)";
    ctx.lineWidth=Math.max(1.5,2*camera.zoom);
    ctx.shadowColor="rgba(216,163,93,.45)";
    ctx.shadowBlur=5;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowBlur=0;
    ctx.beginPath();
    ctx.arc(b.x,b.y,Math.max(4,5*camera.zoom),0,Math.PI*2);
    ctx.strokeStyle="#d8a35d";
    ctx.lineWidth=1.5;
    ctx.stroke();
    ctx.restore();
  }

  function drawCharacter() {
    if (!layers.character) return;
    const char=livingCharacter();
    const h=parseRef(char?.location_ref);
    if (!h) return;

    const p=worldToScreen(hexToWorld(h.q,h.r));
    const r=Math.max(12,17*camera.zoom);
    ctx.save();
    ctx.beginPath();
    ctx.arc(p.x,p.y,r,0,Math.PI*2);
    ctx.strokeStyle="#d8a35d";
    ctx.lineWidth=Math.max(2,2.3*camera.zoom);
    ctx.shadowColor="rgba(216,163,93,.55)";
    ctx.shadowBlur=12*camera.zoom;
    ctx.stroke();
    ctx.shadowBlur=0;

    ctx.beginPath();
    ctx.moveTo(p.x-r*.5,p.y);
    ctx.lineTo(p.x+r*.5,p.y);
    ctx.moveTo(p.x,p.y-r*.5);
    ctx.lineTo(p.x,p.y+r*.5);
    ctx.strokeStyle="rgba(240,201,143,.88)";
    ctx.lineWidth=1;
    ctx.stroke();
    ctx.restore();
  }

  function drawSelection() {
    const targets=[
      {hex:hoverHex,color:"rgba(134,215,232,.65)",width:1.5},
      {hex:selectedHex,color:"#d8a35d",width:2.8}
    ];
    targets.forEach(item => {
      if (!item.hex) return;
      hexPath(item.hex.q,item.hex.r);
      ctx.strokeStyle=item.color;
      ctx.lineWidth=Math.max(item.width,item.width*camera.zoom);
      ctx.stroke();
    });
  }

  function drawCanonLocations() {
    ctx.save();
    Object.entries(canonLocations).forEach(([ref,location]) => {
      const h=parseRef(ref);
      if (!h || !mapHexSet.has(ref)) return;
      const p=worldToScreen(hexToWorld(h.q,h.r));
      const markerSize=Math.max(5,7*camera.zoom);
      ctx.beginPath();
      ctx.arc(p.x,p.y,markerSize,0,Math.PI*2);
      ctx.fillStyle="rgb(216,163,93)";
      ctx.fill();
      ctx.strokeStyle="rgb(255,232,190)";
      ctx.lineWidth=Math.max(1,1.5*camera.zoom);
      ctx.stroke();
      if (camera.zoom >= .55) {
        const fontSize=Math.max(9,11*camera.zoom);
        ctx.font="600 "+fontSize+"px Share Tech Mono, Consolas, monospace";
        ctx.textAlign="center";
        ctx.textBaseline="bottom";
        ctx.strokeStyle="rgb(2,8,12)";
        ctx.lineWidth=4;
        ctx.strokeText(location.name,p.x,p.y-markerSize-5);
        ctx.fillStyle="rgb(241,215,176)";
        ctx.fillText(location.name,p.x,p.y-markerSize-5);
      }
    });
    ctx.restore();
  }

  function draw() {
    const rect=canvas.getBoundingClientRect();
    ctx.clearRect(0,0,rect.width,rect.height);
    drawStars(rect.width,rect.height);
    drawBaseHexes();
    drawTerritories();
    drawMapLabels();
    drawSystems();
    drawCanonLocations();
    drawModifiers();
    drawTradeStations();
    drawFacilities();
    drawShips();
    drawArmies();
    drawCharacterTravelRoute();
    drawCharacter();
    drawSelection();

    $("mapClaimedCount").textContent=territories.filter(row=>row.faction_id).length.toLocaleString();
    $("mapFacilityCount").textContent=player?.facilities?.length.toLocaleString() || "0";
    $("mapZoomReadout").textContent=Math.round(camera.zoom*100)+"%";
  }

  function resizeCanvas(center=false) {
    const rect=canvas.getBoundingClientRect();
    const dpr=Math.min(2,window.devicePixelRatio || 1);
    const width=Math.max(320,rect.width);
    const height=Math.max(360,rect.height);
    canvas.width=Math.round(width*dpr);
    canvas.height=Math.round(height*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    if (center || firstResize) {
      firstResize=false;
      centerMap();
    } else {
      draw();
    }
  }

  function centerMap() {
    const rect=canvas.getBoundingClientRect();
    if (!mapHexes.length || !rect.width || !rect.height) return;

    const points=mapHexes.map(hex=>hexToWorld(hex.q,hex.r));
    const xs=points.map(p=>p.x);
    const ys=points.map(p=>p.y);
    const minX=Math.min(...xs)-hexSize;
    const maxX=Math.max(...xs)+hexSize;
    const minY=Math.min(...ys)-hexSize;
    const maxY=Math.max(...ys)+hexSize;
    const mapW=maxX-minX;
    const mapH=maxY-minY;

    camera.zoom=Math.max(.35,Math.min(1.25,Math.min((rect.width-70)/mapW,(rect.height-70)/mapH)));
    camera.x=rect.width/2-((minX+maxX)/2)*camera.zoom;
    camera.y=rect.height/2-((minY+maxY)/2)*camera.zoom;
    draw();
  }

  function centerOnRef(ref,zoom=Math.max(camera.zoom,1)) {
    const h=parseRef(ref);
    if (!h) return;
    const rect=canvas.getBoundingClientRect();
    const p=hexToWorld(h.q,h.r);
    camera.zoom=Math.min(2.2,Math.max(.55,zoom));
    camera.x=rect.width/2-p.x*camera.zoom;
    camera.y=rect.height/2-p.y*camera.zoom;
    selectedHex={q:h.q,r:h.r,ref};
    renderSelection();
    draw();
  }

  function selectAt(x,y) {
    const h=pixelToHex(x,y);
    const ref=refFor(h.q,h.r);
    if (!mapHexSet.has(ref)) return;
    selectedHex={q:h.q,r:h.r,ref};
    renderSelection();
    draw();
  }

  function updateHover(x,y) {
    const h=pixelToHex(x,y);
    const ref=refFor(h.q,h.r);
    hoverHex=mapHexSet.has(ref) ? {q:h.q,r:h.r,ref} : null;
    draw();
  }

  function renderCharacterPanel() {
    const char=livingCharacter();
    if (!char) {
      $("mapCharacterName").textContent="No Active Character";
      $("mapCharacterStatus").textContent="--";
      $("mapCharacterLocation").textContent="--";
      $("mapCharacterMovement").textContent="--";
      $("mapCharacterFaction").textContent="--";
      $("setInitialLocationBtn").hidden=true;
      return;
    }

    $("mapCharacterName").textContent=char.name;
    $("mapCharacterStatus").textContent="ALIVE";
    const travel=characterTravel.find(row=>row.character_id===char.id && row.status==="traveling");
    $("mapCharacterLocation").textContent=char.location_name || char.location_ref || "UNPLACED";
    $("mapCharacterMovement").textContent=travel ? "TRAVELING // ETA "+arrivalTimeLabel(travel.arrive_world_hour) : "STATIONARY";
    $("mapCharacterFaction").textContent=factionById(char.faction_id)?.name || activeMembership()?.faction?.name || "NO FACTION";

    $("setInitialLocationBtn").hidden=Boolean(char.location_ref) || !selectedHex;
  }

  function facilityCode(type) {
    return String(type?.code || type?.name || "").toUpperCase();
  }

  function factionFacilities() {
    const factionId=activeMembership()?.faction_id;
    return factionId ? (player.facilities || []).filter(row => row.owner_faction_id===factionId || row.controlling_faction_id===factionId) : [];
  }

  function hasFacilityKind(kind) {
    return factionFacilities().some(row => facilityCode(facilityTypeById(row.facility_type_id)).includes(kind));
  }

  function facilityUnlocked(type) {
    const code=facilityCode(type);
    if (code.includes("REFIN")) return hasFacilityKind("EXTRACT") || hasFacilityKind("MINE");
    if (code.includes("FACTORY") || code.includes("SHIP")) return hasFacilityKind("REFIN");
    return true;
  }

  function renderResourceStockpile() {
    const root=$("mapResourceStockpile");
    if(!root) return;
    const factionId=activeMembership()?.faction_id;
    const rows=(player.factionResources || []).filter(row=>row.faction_id===factionId && Number(row.quantity)!==0);
    const names=new Map((player.resourceCatalog || []).map(row=>[row.code,row.name]));
    root.innerHTML=rows.length ? rows.map(row =>
      '<div class="telemetry-row"><span>'+esc(names.get(row.resource_code)||row.resource_code)+'</span><strong>'+esc(fmt(row.quantity))+'</strong></div>'
    ).join("") : '<div class="empty-state map-mini-empty">NO STORED RESOURCES.</div>';
  }

  function renderProductionRates() {
    const root=$("mapProductionRates");
    if(!root) return;
    const rates=new Map();
    const add=(code,amount)=>rates.set(code,(rates.get(code)||0)+Number(amount||0));
    const factionId=activeMembership()?.faction_id;
    const owned=factionFacilities();
    owned.forEach(facility=>{
      const code=facilityCode(facilityTypeById(facility.facility_type_id));
      const mod=Number(facility.production_modifier||1);
      if(code.includes("EXTRACT")||code.includes("MINE")){
        (player.resourceDeposits||[]).filter(d=>d.location_ref===facility.location_ref).forEach(d=>add(d.resource_code,Number(d.richness||1)*10*mod));
      }else if(code.includes("FARM")||code.includes("AGRI")){
        add("food",100*mod);
      }else if(code.includes("REFIN")){
        const links=(player.facilityConnections||[]).filter(x=>x.refinery_facility_id===facility.id).slice(0,3);
        links.forEach(link=>{
          const extractor=player.facilities.find(x=>x.id===link.extractor_facility_id);
          if(!extractor) return;
          (player.resourceDeposits||[]).filter(d=>d.location_ref===extractor.location_ref).forEach(d=>{
            const out=d.resource_code==="gold_ore"?"refined_gold":d.resource_code==="vyr_ore"?"vyrsteel":d.resource_code==="aetherite"?"refined_aetherite":null;
            if(out) add(out,Number(d.richness||1)*8*mod);
          });
        });
      }else if(code.includes("FACTORY")){
        const order=(player.factoryOrders||[]).find(x=>x.facility_id===facility.id);
        const recipe=(player.factoryRecipes||[]).find(x=>x.code===order?.recipe_code);
        if(recipe) add(recipe.output_resource_code,Number(recipe.output_quantity||1)*mod);
      }
    });
    const names=new Map((player.resourceCatalog||[]).map(row=>[row.code,row.name]));
    root.innerHTML=rates.size ? [...rates.entries()].map(([code,amount])=>
      '<div class="telemetry-row"><span>'+esc(names.get(code)||code)+'</span><strong>+'+esc(fmt(amount))+'</strong></div>'
    ).join("") : '<div class="empty-state map-mini-empty">NO ACTIVE PRODUCTION.</div>';
  }

  function renderFacilityTypeSelect() {
    const select=$("mapFacilityType");
    const types=(player.facilityTypes || []).filter(row=>row.player_buildable && facilityUnlocked(row));
    select.innerHTML=types.length
      ? types.map(row=>'<option value="'+esc(row.id)+'">'+esc(row.name)+'</option>').join("")
      : '<option value="">No facilities available</option>';
    updateBuildPreview();
    renderResourceStockpile();
    renderProductionRates();
  }

  function updateBuildPreview() {
    const type=facilityTypeById($("mapFacilityType").value);
    $("mapBuildCost").textContent=type ? fmt(type.build_cost_aureum)+" A" : "--";
    $("mapBuildUpkeep").textContent=type ? fmt(type.upkeep_aureum_per_cycle)+" A" : "--";
    $("mapWalletBalance").textContent=fmt(player?.wallet?.balance || 0)+" A";
  }

  function buildEligibility() {
    if (!selectedHex) return {ok:false,message:"SELECT A HEX TO CONSTRUCT A HOLDING."};
    const char=livingCharacter();
    if (!char) return {ok:false,message:"AN ACTIVE LIVING CHARACTER IS REQUIRED."};
    if (!char.location_ref) return {ok:false,message:"SET YOUR CHARACTER'S INITIAL LOCATION FIRST."};
    if (char.location_ref!==selectedHex.ref) return {ok:false,message:"YOUR CHARACTER MUST BE PRESENT AT THIS LOCATION."};

    const membership=activeMembership();
    if (!membership?.faction_id) return {ok:false,message:"AN ACTIVE FACTION MEMBERSHIP IS REQUIRED."};

    const territory=territoryByRef(selectedHex.ref);
    if (!territory?.faction_id) return {ok:false,message:"THIS HEX IS NOT CURRENTLY CONTROLLED BY YOUR FACTION."};
    if (territory.faction_id!==membership.faction_id) return {ok:false,message:"THIS HEX IS CONTROLLED BY ANOTHER FACTION."};

    const system=(player.systemEconomies || []).find(row=>row.location_ref===selectedHex.ref);
    const slotLimit=Number(system?.slot_limit || 8);
    const used=(player.facilities || []).filter(row=>row.location_ref===selectedHex.ref).length;
    if (used>=slotLimit) return {ok:false,message:"NO FACILITY SLOTS AVAILABLE IN THIS SYSTEM."};

    const type=facilityTypeById($("mapFacilityType")?.value);
    if (type && !facilityUnlocked(type)) return {ok:false,message:"FACILITY REQUIREMENTS NOT MET."};
    const code=facilityCode(type);
    if ((code.includes("EXTRACT") || code.includes("MINE")) && !(player.resourceDeposits || []).some(row=>row.location_ref===selectedHex.ref)) {
      return {ok:false,message:"NO EXTRACTABLE RESOURCE DEPOSIT AT THIS LOCATION."};
    }
    if (!(player.facilityTypes || []).some(row=>row.player_buildable && facilityUnlocked(row))) {
      return {ok:false,message:"NO PLAYER-BUILDABLE FACILITIES ARE AVAILABLE."};
    }
    return {ok:true,message:""};
  }

  function renderTravelPanel() {
    const char=livingCharacter();
    const travel=char ? characterTravel.find(row=>row.character_id===char.id && row.status==="traveling") : null;
    let distance=0;
    let hours=0;
    let arrival=null;

    if(char?.location_ref && selectedHex){
      distance=hexDistance(char.location_ref,selectedHex.ref);
      hours=distance*Number(player?.config?.character_travel_hours_per_hex || 6);
      arrival=currentWorldHour()+hours;
    }

    $("mapTravelDistance").textContent=selectedHex && char?.location_ref ? distance+" HEX"+(distance===1?"":"ES") : "--";
    $("mapTravelHours").textContent=distance ? movementTimeLabel(hours) : "--";
    $("mapTravelArrival").textContent=distance ? arrivalTimeLabel(arrival) : "--";

    const button=$("mapTravelBtn");
    button.disabled=Boolean(travel) || !char?.location_ref || !selectedHex || distance<1;
    button.textContent=travel ? "CHARACTER IN TRANSIT" : "TRAVEL TO SELECTED HEX";
  }

  function canMilitary() {
    const membership=activeMembership();
    const faction=membership?.faction;
    if(!membership || !faction) return false;
    return faction.leader_user_id===session.user.id || (membership.permissions||[]).includes("military");
  }

  function controlledArmies() {
    const factionId=activeMembership()?.faction_id;
    return canMilitary() && factionId ? armies.filter(row=>row.faction_id===factionId && row.status==="active") : [];
  }

  function renderMilitaryPanel() {
    const select=$("mapArmySelect");
    const list=controlledArmies();
    const current=select.value;

    select.innerHTML=list.length
      ? list.map(row=>'<option value="'+esc(row.id)+'">'+esc(row.name)+'</option>').join("")
      : '<option value="">No controlled armies</option>';

    if(list.some(row=>row.id===current)) select.value=current;
    const army=list.find(row=>row.id===select.value) || list[0] || null;

    $("mapArmyStrength").textContent=army ? fmt(army.strength)+" / "+fmt(army.max_strength) : "--";
    $("mapArmyLocation").textContent=army?.location_ref || "--";
    $("mapArmyStatus").textContent=army ? (army.movement_status==="moving"?"MOVING":"STATIONARY") : "--";
    const activeMove=army ? armyMovements.find(row=>row.army_id===army.id && row.status==="moving") : null;
    if(activeMove){
      const total=Math.max(0,Number(activeMove.arrive_world_hour)-Number(activeMove.depart_world_hour));
      $("mapArmyTravelTime").textContent=movementTimeLabel(total);
      $("mapArmyTravelArrival").textContent=arrivalTimeLabel(activeMove.arrive_world_hour);
    }else if(army && selectedHex && army.location_ref!==selectedHex.ref){
      const distance=hexDistance(army.location_ref,selectedHex.ref);
      const hours=distance*Number(player?.config?.army_travel_hours_per_hex || 12);
      $("mapArmyTravelTime").textContent=movementTimeLabel(hours);
      $("mapArmyTravelArrival").textContent=arrivalTimeLabel(currentWorldHour()+hours);
    }else{
      $("mapArmyTravelTime").textContent="--";
      $("mapArmyTravelArrival").textContent="--";
    }

    const hasSelection=Boolean(selectedHex);
    const atTarget=army && selectedHex && army.location_ref===selectedHex.ref && army.movement_status==="stationary";
    const targetTerritory=selectedHex ? territoryByRef(selectedHex.ref) : null;
    const enemy=atTarget && targetTerritory?.faction_id && targetTerritory.faction_id!==army.faction_id;
    const activeOp=army ? militaryOperations.find(row=>row.army_id===army.id && ["active","awaiting_resolution"].includes(row.status)) : null;

    $("mapArmyMoveBtn").disabled=!army || !hasSelection || army.movement_status!=="stationary" || army.location_ref===selectedHex?.ref || Boolean(activeOp);
    $("mapRaidBtn").disabled=!army || !enemy || Boolean(activeOp);
    $("mapConquestBtn").disabled=!army || !enemy || Boolean(activeOp);
  }

  function renderBuildPanel() {
    const result=buildEligibility();
    $("mapBuildForm").hidden=!result.ok;
    $("mapBuildLocked").hidden=result.ok;
    $("mapBuildLocked").textContent=result.message;
    updateBuildPreview();
  }

  function renderSelection() {
    if (!selectedHex) {
      $("mapSelectedReadout").textContent="SELECT A HEX";
      $("mapCoordinateReadout").textContent="Q -- // R --";
      $("selectedHexName").textContent="No Hex Selected";
      $("selectedHexRef").textContent="--";
      $("selectedHexFaction").textContent="UNCLAIMED";
      $("selectedHexStatus").textContent="--";
      $("selectedHexProduction").textContent="--";
      $("selectedHexSlots").textContent="0 / 8";
      $("selectedHexPopulation").textContent="--";
      $("selectedHexManpower").textContent="--";
      $("selectedResourceList").innerHTML="";
      $("selectedResourceEmpty").hidden=false;
      $("selectedFacilityControls").innerHTML="";
      $("selectedFacilityList").innerHTML="";
      $("selectedFacilityEmpty").hidden=false;
      $("selectedModifierList").innerHTML="";
      $("selectedModifierEmpty").hidden=false;
      renderCharacterPanel();
      renderBuildPanel();
      return;
    }

    const territory=territoryByRef(selectedHex.ref);
    const mapHex=mapHexes.find(row=>row.ref===selectedHex.ref) || selectedHex;
    const faction=factionById(territory?.faction_id);
    const canon=canonLocations[selectedHex.ref];
    const name=canon?.name || territory?.display_name || mapHex.display_name || "Hex "+selectedHex.q+", "+selectedHex.r;
    const production=Number(territory?.production_modifier ?? 1);
    const locationStatus=territory?.status || mapHex.status || "open";
    const context=[
      mapHex.region_name ? String(mapHex.region_name).toUpperCase() : null,
      mapHex.terrain_type ? String(mapHex.terrain_type).toUpperCase() : null,
      Number(mapHex.habitable_systems || 0)>0 ? Number(mapHex.habitable_systems)+" HABITABLE SYSTEM"+(Number(mapHex.habitable_systems)===1?"":"S") : null
    ].filter(Boolean).join(" // ");

    $("mapSelectedReadout").textContent=name.toUpperCase();
    $("mapCoordinateReadout").textContent=context || ("Q "+selectedHex.q+" // R "+selectedHex.r);
    $("selectedHexName").textContent=name;
    $("selectedHexRef").textContent=selectedHex.ref;
    $("selectedHexFaction").textContent=faction?.name || canon?.faction || "UNCLAIMED";
    $("selectedHexStatus").textContent=canon?.type || String(locationStatus).toUpperCase();
    $("selectedHexProduction").textContent=Math.round(production*100)+"%";

    const system=(player.systemEconomies || []).find(row=>row.location_ref===selectedHex.ref);
    const selectedFacilities=player.facilities.filter(row=>row.location_ref===selectedHex.ref);
    $("selectedHexSlots").textContent=selectedFacilities.length+" / "+Number(system?.slot_limit || 8);
    $("selectedHexPopulation").textContent=system ? fmt(system.population) : "--";
    $("selectedHexManpower").textContent=system ? fmt(system.manpower) : "--";

    const deposits=(player.resourceDeposits || []).filter(row=>row.location_ref===selectedHex.ref);
    const resourceNames=new Map((player.resourceCatalog || []).map(row=>[row.code,row.name]));
    $("selectedResourceEmpty").hidden=deposits.length>0;
    $("selectedResourceList").innerHTML=deposits.map(row =>
      '<article class="notice map-list-row"><strong>'+esc(resourceNames.get(row.resource_code)||row.resource_code)+'</strong></article>'
    ).join("");
    $("selectedFacilityEmpty").hidden=selectedFacilities.length>0;
    $("selectedFacilityList").innerHTML=selectedFacilities.map(row => {
      const type=facilityTypeById(row.facility_type_id);
      return '<article class="notice map-list-row"><div><strong>'+esc(row.name || type?.name || "Holding")+'</strong><div class="section-code">'+esc(type?.name || "FACILITY")+'</div></div><span>'+esc(fmt(type?.upkeep_aureum_per_cycle || 0))+' A / DAY</span></article>';
    }).join("");

    const factionId=activeMembership()?.faction_id;
    const ownedFacilities=selectedFacilities.filter(row => row.owner_faction_id===factionId || row.controlling_faction_id===factionId);
    const ownedRefineries=ownedFacilities.filter(row => facilityCode(facilityTypeById(row.facility_type_id)).includes("REFIN"));
    const ownedFactories=ownedFacilities.filter(row => facilityCode(facilityTypeById(row.facility_type_id)).includes("FACTORY"));
    const ownedShipyards=ownedFacilities.filter(row => facilityCode(facilityTypeById(row.facility_type_id)).includes("SHIP"));
    const station=(player.tradeStations || []).find(row=>row.location_ref===selectedHex.ref);

    let facilityControls="";
    ownedRefineries.forEach(refinery => {
      const links=(player.facilityConnections || []).filter(link=>link.refinery_facility_id===refinery.id);
      const linkedRows=links.map(link=>player.facilities.find(row=>row.id===link.extractor_facility_id)).filter(Boolean);
      facilityControls += '<article class="notice"><strong>'+esc(refinery.name || "Refinery")+'</strong><div class="section-code">'+links.length+' / 3 EXTRACTORS</div>'+
        linkedRows.map(extractor=>'<div class="split-actions" style="margin-top:8px"><span>'+esc(extractor.name||facilityTypeById(extractor.facility_type_id)?.name||"Extractor")+' // '+esc(extractor.location_ref)+'</span><button class="hud-button secondary refinery-disconnect-btn" type="button" data-refinery="'+esc(refinery.id)+'" data-extractor="'+esc(extractor.id)+'">DISCONNECT</button></div>').join("")+
        '<button class="hud-button secondary refinery-connect-btn" type="button" data-refinery="'+esc(refinery.id)+'" style="margin-top:8px" '+(links.length>=3?'disabled':'')+'>CONNECT EXTRACTOR</button></article>';
    });
    ownedFactories.forEach(factory => {
      const order=(player.factoryOrders || []).find(row=>row.facility_id===factory.id);
      facilityControls += '<article class="notice"><strong>'+esc(factory.name || "Factory")+'</strong><div class="section-code">PRODUCTION LINE</div><select class="factory-recipe-select" data-factory="'+esc(factory.id)+'">'+
        '<option value="">Select production</option>'+
        (player.factoryRecipes || []).map(recipe=>'<option value="'+esc(recipe.code)+'" '+(order?.recipe_code===recipe.code?'selected':'')+'>'+esc(recipe.name)+'</option>').join("")+
        '</select><button class="hud-button secondary factory-recipe-save" type="button" data-factory="'+esc(factory.id)+'" style="margin-top:8px">SET PRODUCTION</button></article>';
    });
    ownedShipyards.forEach(shipyard => {
      const orders=(player.shipyardOrders||[]).filter(row=>row.shipyard_facility_id===shipyard.id && row.status==="building");
      facilityControls += '<article class="notice"><strong>'+esc(shipyard.name || "Shipyard")+'</strong><div class="section-code">CONSTRUCTION QUEUE // '+orders.length+' ACTIVE</div>'+
        orders.map(order=>'<div class="split-actions" style="margin-top:8px"><span>'+esc(order.ship_name)+'</span><strong>'+esc(order.cycles_remaining)+' CYCLES</strong></div>').join("")+
        '<select class="shipyard-blueprint-select" data-shipyard="'+esc(shipyard.id)+'" style="margin-top:8px"><option value="">Select hull</option>'+
        (player.shipBlueprints||[]).map(bp=>'<option value="'+esc(bp.id)+'">'+esc(bp.name)+' // '+esc(bp.build_cycles)+' cycles</option>').join("")+
        '</select><input class="shipyard-name-input" data-shipyard="'+esc(shipyard.id)+'" placeholder="Ship name (optional)" style="margin-top:8px">'+
        '<button class="hud-button secondary shipyard-queue-btn" type="button" data-shipyard="'+esc(shipyard.id)+'" style="margin-top:8px">BEGIN CONSTRUCTION</button></article>';
    });
    if(station){
      facilityControls += '<article class="notice"><strong>'+esc(station.station_name || "Guilded Concord Trade Station")+'</strong><div class="section-code">GUILDED CONCORD EXCHANGE</div><a class="hud-button secondary" href="player-suite.html#markets" style="display:inline-flex;margin-top:8px">OPEN MARKET</a></article>';
    }
    $("selectedFacilityControls").innerHTML=facilityControls;

    document.querySelectorAll(".refinery-connect-btn").forEach(button=>button.addEventListener("click",async()=>{
      const refineryId=button.dataset.refinery;
      const linked=new Set((player.facilityConnections||[]).filter(x=>x.refinery_facility_id===refineryId).map(x=>x.extractor_facility_id));
      const candidates=factionFacilities().filter(row=>{
        const code=facilityCode(facilityTypeById(row.facility_type_id));
        return (code.includes("EXTRACT")||code.includes("MINE"))&&!linked.has(row.id);
      });
      if(!candidates.length) return setState($("mapBuildState"),"NO UNCONNECTED EXTRACTORS AVAILABLE","error");
      const menu=candidates.map((row,i)=>(i+1)+". "+(row.name||facilityTypeById(row.facility_type_id)?.name||"Extractor")+" // "+row.location_ref).join("\n");
      const picked=await GMUI.promptAction("Connect which extractor?\n"+menu,"1",{code:"INDUSTRY / REFINERY",title:"Connect Extractor",inputLabel:"Extractor Number",confirmText:"CONNECT"});
      if(picked===null) return;
      const choice=Number(picked)-1;
      if(!Number.isInteger(choice)||!candidates[choice]) return;
      try{
        await GMAuth.api("rpc/connect_refinery_extractor",{method:"POST",body:JSON.stringify({p_refinery_id:refineryId,p_extractor_id:candidates[choice].id})});
        await refreshAll("EXTRACTOR CONNECTED",$("mapBuildState"));
      }catch(error){setState($("mapBuildState"),"CONNECTION FAILED // "+error.message,"error")}
    }));

    document.querySelectorAll(".refinery-disconnect-btn").forEach(button=>button.addEventListener("click",async()=>{
      try{
        await GMAuth.api("rpc/disconnect_refinery_extractor",{method:"POST",body:JSON.stringify({p_refinery_id:button.dataset.refinery,p_extractor_id:button.dataset.extractor})});
        await refreshAll("EXTRACTOR DISCONNECTED",$("mapBuildState"));
      }catch(error){setState($("mapBuildState"),"DISCONNECT FAILED // "+error.message,"error")}
    }));

    document.querySelectorAll(".shipyard-queue-btn").forEach(button=>button.addEventListener("click",async()=>{
      const id=button.dataset.shipyard;
      const blueprint=document.querySelector('.shipyard-blueprint-select[data-shipyard="'+id+'"]')?.value;
      const name=document.querySelector('.shipyard-name-input[data-shipyard="'+id+'"]')?.value || null;
      if(!blueprint) return setState($("mapBuildState"),"SELECT A SHIP BLUEPRINT","error");
      try{
        await GMAuth.api("rpc/queue_ship_construction",{method:"POST",body:JSON.stringify({p_shipyard_id:id,p_blueprint_id:blueprint,p_ship_name:name})});
        await refreshAll("SHIP CONSTRUCTION STARTED",$("mapBuildState"));
      }catch(error){setState($("mapBuildState"),"SHIP CONSTRUCTION FAILED // "+error.message,"error")}
    }));

    document.querySelectorAll(".factory-recipe-save").forEach(button=>button.addEventListener("click",async()=>{
      const select=document.querySelector('.factory-recipe-select[data-factory="'+button.dataset.factory+'"]');
      if(!select?.value) return;
      try{
        await GMAuth.api("rpc/set_factory_recipe",{method:"POST",body:JSON.stringify({p_facility_id:button.dataset.factory,p_recipe_code:select.value})});
        await refreshAll("FACTORY PRODUCTION SET",$("mapBuildState"));
      }catch(error){setState($("mapBuildState"),"PRODUCTION UPDATE FAILED // "+error.message,"error")}
    }));

    const selectedModifiers=activeModifiersFor(selectedHex.ref);
    $("selectedModifierEmpty").hidden=selectedModifiers.length>0;
    $("selectedModifierList").innerHTML=selectedModifiers.map(row =>
      '<article class="notice map-list-row"><div><strong>'+esc(row.label || row.modifier_type || "Location Effect")+'</strong><div class="section-code">'+esc(String(row.modifier_type || "effect").toUpperCase())+'</div></div><span>'+esc(Math.round(Number(row.production_multiplier || 1)*100))+'%</span></article>'
    ).join("");

    renderCharacterPanel();
    renderTravelPanel();
    renderMilitaryPanel();
    renderBuildPanel();
  }

  function renderUi() {
    renderFacilityTypeSelect();
    renderCharacterPanel();
    renderTravelPanel();
    renderMilitaryPanel();
    renderSelection();
    renderResourceStockpile();
    renderProductionRates();
  }

  function canvasPoint(event) {
    const rect=canvas.getBoundingClientRect();
    return {x:event.clientX-rect.left,y:event.clientY-rect.top};
  }

  canvas.addEventListener("pointerdown",event => {
    if (event.pointerType==="mouse" && event.button!==0) return;
    canvas.setPointerCapture(event.pointerId);
    const p=canvasPoint(event);
    drag={
      pointerId:event.pointerId,
      startX:p.x,
      startY:p.y,
      cameraX:camera.x,
      cameraY:camera.y,
      moved:false
    };
  });

  canvas.addEventListener("pointermove",event => {
    const p=canvasPoint(event);
    if (!drag || drag.pointerId!==event.pointerId) {
      if (event.pointerType==="mouse") updateHover(p.x,p.y);
      return;
    }

    const dx=p.x-drag.startX;
    const dy=p.y-drag.startY;
    if (Math.abs(dx)>3 || Math.abs(dy)>3) drag.moved=true;
    if (drag.moved) {
      camera.x=drag.cameraX+dx;
      camera.y=drag.cameraY+dy;
      draw();
    }
  });

  canvas.addEventListener("pointerup",event => {
    if (!drag || drag.pointerId!==event.pointerId) return;
    const p=canvasPoint(event);
    if (!drag.moved) selectAt(p.x,p.y);
    drag=null;
  });

  canvas.addEventListener("pointercancel",()=>{drag=null;});
  canvas.addEventListener("pointerleave",event => {
    if (event.pointerType==="mouse" && !drag) {
      hoverHex=null;
      draw();
    }
  });

  canvas.addEventListener("wheel",event => {
    event.preventDefault();
    const p=canvasPoint(event);
    const before=screenToWorld(p.x,p.y);
    const factor=event.deltaY<0 ? 1.1 : .9;
    camera.zoom=Math.min(2.7,Math.max(.35,camera.zoom*factor));
    camera.x=p.x-before.x*camera.zoom;
    camera.y=p.y-before.y*camera.zoom;
    draw();
  },{passive:false});

  document.querySelectorAll("[data-map-tab]").forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-map-tab]").forEach(tab => tab.classList.toggle("active", tab === button));
      document.querySelectorAll(".map-command-page").forEach(page => page.classList.toggle("active", page.id === button.dataset.mapTab));
    });
  });

  $("mapPanelCollapse")?.addEventListener("click", () => {
    const workspace = document.querySelector(".map-workspace-unified");
    workspace?.classList.toggle("map-panel-collapsed");
    $("mapPanelCollapse").textContent = workspace?.classList.contains("map-panel-collapsed") ? "›" : "‹";
    setTimeout(resize, 180);
  });

  $("mapCenterBtn").addEventListener("click",centerMap);

  $("mapCharacterBtn").addEventListener("click",() => {
    const char=livingCharacter();
    if (!char?.location_ref) {
      setState($("mapCharacterState"),"YOUR CHARACTER DOES NOT HAVE A MAP LOCATION YET","error");
      return;
    }
    centerOnRef(char.location_ref,1.2);
  });

  $("mapRefreshBtn").addEventListener("click",async () => {
    try {
      await refreshAll("MAP DATA REFRESHED",$("mapCharacterState"));
    } catch (error) {
      setState($("mapCharacterState"),"MAP REFRESH FAILED // "+error.message,"error");
    }
  });

  $("mapCopyBtn").addEventListener("click",async () => {
    if (!selectedHex) {
      setState($("mapCharacterState"),"SELECT A HEX FIRST","error");
      return;
    }
    try {
      await navigator.clipboard.writeText(selectedHex.ref);
      setState($("mapCharacterState"),selectedHex.ref+" COPIED","success");
    } catch {
      setState($("mapCharacterState"),selectedHex.ref,"success");
    }
  });

  $("setInitialLocationBtn").addEventListener("click",async () => {
    const char=livingCharacter();
    if (!char || !selectedHex) return;
    if (!await GMUI.confirmAction("Set "+selectedHex.ref+" as "+char.name+"'s initial location? Future movement will use the travel system rather than instant relocation.",{code:"CHARACTER / LOCATION",title:"Set Initial Location",confirmText:"SET LOCATION"})) return;

    try {
      setState($("mapCharacterState"),"ESTABLISHING CHARACTER LOCATION...");
      await GMAuth.api("rpc/set_initial_character_location",{
        method:"POST",
        body:JSON.stringify({
          p_character_id:char.id,
          p_location_ref:selectedHex.ref
        })
      });
      await refreshAll("INITIAL LOCATION ESTABLISHED",$("mapCharacterState"));
    } catch (error) {
      setState($("mapCharacterState"),"LOCATION UPDATE FAILED // "+error.message,"error");
    }
  });

  $("mapTravelBtn").addEventListener("click",async () => {
    const char=livingCharacter();
    if(!char || !selectedHex) return;
    if(!await GMUI.confirmAction("Begin travel to "+selectedHex.ref+"? Travel time follows the live world clock.",{code:"CHARACTER / TRAVEL",title:"Begin Travel",confirmText:"BEGIN TRAVEL"})) return;
    try{
      setState($("mapTravelState"),"TRAVEL ORDER TRANSMITTED...");
      const result=await GMAuth.api("rpc/begin_character_travel",{
        method:"POST",
        body:JSON.stringify({p_character_id:char.id,p_to_ref:selectedHex.ref})
      });
      await refreshAll("TRAVELING // "+movementTimeLabel(result.travel_hours)+" // ETA "+arrivalTimeLabel(result.arrive_world_hour),$("mapTravelState"));
    }catch(error){
      setState($("mapTravelState"),"TRAVEL FAILED // "+error.message,"error");
    }
  });

  $("mapArmySelect").addEventListener("change",renderMilitaryPanel);

  $("mapArmyMoveBtn").addEventListener("click",async () => {
    const armyId=$("mapArmySelect").value;
    if(!armyId || !selectedHex) return;
    try{
      setState($("mapMilitaryState"),"ARMY MOVEMENT ORDER TRANSMITTED...");
      const result=await GMAuth.api("rpc/order_army_movement",{
        method:"POST",
        body:JSON.stringify({p_army_id:armyId,p_to_ref:selectedHex.ref})
      });
      await refreshAll("ARMY MOVING // "+movementTimeLabel(result.travel_hours)+" // ETA "+arrivalTimeLabel(result.arrive_world_hour),$("mapMilitaryState"));
    }catch(error){
      setState($("mapMilitaryState"),"ARMY MOVEMENT FAILED // "+error.message,"error");
    }
  });

  async function launchOperation(type){
    const armyId=$("mapArmySelect").value;
    if(!armyId || !selectedHex) return;
    if(!await GMUI.confirmAction("Launch "+type.toUpperCase()+" operation at "+selectedHex.ref+"?",{code:"MILITARY / OPERATION",title:"Confirm Operation",confirmText:"LAUNCH OPERATION",danger:true})) return;
    try{
      setState($("mapMilitaryState"),type.toUpperCase()+" OPERATION STARTING...");
      const result=await GMAuth.api("rpc/launch_military_operation",{
        method:"POST",
        body:JSON.stringify({
          p_army_id:armyId,
          p_target_ref:selectedHex.ref,
          p_operation_type:type
        })
      });
      await refreshAll(type.toUpperCase()+" ACTIVE // RESOLUTION AT "+arrivalTimeLabel(result.resolve_world_hour),$("mapMilitaryState"));
    }catch(error){
      setState($("mapMilitaryState"),type.toUpperCase()+" FAILED // "+error.message,"error");
    }
  }

  $("mapRaidBtn").addEventListener("click",()=>launchOperation("raid"));
  $("mapConquestBtn").addEventListener("click",()=>launchOperation("conquest"));

  $("mapFacilityType").addEventListener("change",updateBuildPreview);

  $("mapBuildForm").addEventListener("submit",async event => {
    event.preventDefault();
    const eligibility=buildEligibility();
    if (!eligibility.ok) {
      setState($("mapBuildState"),eligibility.message,"error");
      return;
    }

    const form=event.currentTarget;
    const d=Object.fromEntries(new FormData(form));
    try {
      setState($("mapBuildState"),"CONSTRUCTING HOLDING...");
      const result=await GMAuth.api("rpc/construct_player_facility",{
        method:"POST",
        body:JSON.stringify({
          p_facility_type_id:d.facility_type_id,
          p_location_ref:selectedHex.ref,
          p_name:d.name.trim() || null
        })
      });
      form.elements.name.value="";
      await refreshAll("CONSTRUCTION COMPLETE // "+result.name,$("mapBuildState"));
    } catch (error) {
      setState($("mapBuildState"),"CONSTRUCTION FAILED // "+error.message,"error");
    }
  });

  [
    ["layerTerritory","territory"],
    ["layerFacilities","facilities"],
    ["layerCharacter","character"],
    ["layerModifiers","modifiers"]
  ].forEach(([id,key]) => {
    $(id).addEventListener("change",event => {
      layers[key]=event.currentTarget.checked;
      draw();
    });
  });

  const observer=new ResizeObserver(() => resizeCanvas(false));
  observer.observe(canvas.parentElement);


  (async () => {
    session=await GMUI.initProtected();
    if (!session) return;
    try {
      player=await GMPlayerData.load(session);
      await loadMapData();
      radius=Number(player.config?.map_radius || 14);
      hexSize=Number(player.config?.map_hex_size || 32);
      buildCircle();
      renderUi();
      resizeCanvas(true);
    } catch (error) {
      const page=document.querySelector(".map-page");
      if (page) page.insertAdjacentHTML("afterbegin",'<div class="notice">MAP SYSTEM ERROR // '+esc(error.message)+'</div>');
    }
  })();
})();