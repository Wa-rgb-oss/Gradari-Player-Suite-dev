(() => {
  const $=id=>document.getElementById(id);
  const esc=value=>GMUI.esc(value);
  const fmt=value=>Number(value||0).toLocaleString(undefined,{maximumFractionDigits:2});
  let session=null;
  let perks=[];
  let prerequisites=[];
  let unlocked=[];

  function healthMultiplier(row){
    return Math.max(0,Math.min(100,Number(row.health ?? 100)))/100;
  }

  function renderSites(types,facilities,clocks){
    const typeMap=new Map((types||[]).map(row=>[row.id,row]));
    const sites=(facilities||[]).filter(row=>{
      const type=typeMap.get(row.facility_type_id);
      return row.owner_user_id===session.user.id && String(type?.code||"").toUpperCase()==="RESEARCH_SITE";
    });
    const active=sites.filter(row=>String(row.status||"active").toLowerCase()==="active");
    const daily=active.reduce((sum,row)=>{
      const type=typeMap.get(row.facility_type_id);
      const perDay=Math.max(0,Number(type?.output_per_cycle||36));
      return sum+(perDay*Number(row.production_modifier??1)*healthMultiplier(row));
    },0);

    $("researchSiteCount").textContent=active.length+"/"+sites.length;
    $("researchDailyOutput").textContent=fmt(daily);

    const root=$("researchSiteList");
    const empty=$("researchSiteEmpty");
    if(!sites.length){
      root.innerHTML="";
      empty.hidden=false;
      return;
    }
    empty.hidden=true;
    root.innerHTML=sites.map(row=>{
      const type=typeMap.get(row.facility_type_id);
      const activeStatus=String(row.status||"active").toLowerCase()==="active";
      const perDay=Math.max(0,Number(type?.output_per_cycle||36))*Number(row.production_modifier??1)*healthMultiplier(row);
      const clock=(clocks||[]).find(item=>item.facility_id===row.id);
      return '<article class="notice research-site-row">'+
        '<div><strong>'+esc(row.name||"Research Site")+'</strong>'+
        '<div class="section-code">RESEARCH SITE // '+esc(row.location_ref||"LOCATION UNSET")+'</div>'+
        '<div class="section-code">OUTPUT // +'+esc(fmt(perDay))+' RP / IN-GAME DAY</div></div>'+
        '<div class="research-site-meta"><span class="status-chip '+(activeStatus?"":"muted")+'">'+esc(String(row.status||"active").toUpperCase())+'</span>'+
        (activeStatus&&clock?.next_production_at?'<span class="section-code">NEXT OUTPUT // <span data-research-countdown="'+esc(clock.next_production_at)+'">--:--:--</span></span>':'')+
        '</div></article>';
    }).join("");
    updateCountdowns();
  }

  function updateCountdowns(){
    document.querySelectorAll("[data-research-countdown]").forEach(el=>{
      const ms=new Date(el.dataset.researchCountdown).getTime()-Date.now();
      if(!Number.isFinite(ms)){el.textContent="--:--";return;}
      if(ms<=0){el.textContent="PROCESSING";return;}
      const sec=Math.ceil(ms/1000);
      const h=Math.floor(sec/3600);
      const min=Math.floor((sec%3600)/60);
      const s=sec%60;
      el.textContent=String(h).padStart(2,"0")+":"+String(min).padStart(2,"0")+":"+String(s).padStart(2,"0");
    });
  }

  function renderTree(){
    $("researchPublishedCount").textContent=String(perks.length);
    $("researchUnlockedCount").textContent=String(unlocked.length);
    const root=$("researchTree");
    const empty=$("researchTreeEmpty");
    if(!perks.length){
      root.innerHTML="";
      empty.hidden=false;
      return;
    }

    empty.hidden=true;
    const owned=new Set(unlocked.map(row=>row.perk_id));
    const perkMap=new Map(perks.map(row=>[row.id,row]));
    const requirements=new Map();
    prerequisites.forEach(row=>{
      if(!requirements.has(row.perk_id)) requirements.set(row.perk_id,[]);
      requirements.get(row.perk_id).push(row.prerequisite_perk_id);
    });

    root.innerHTML='<div class="research-node-grid">'+perks.map(perk=>{
      const req=requirements.get(perk.id)||[];
      const missing=req.filter(id=>!owned.has(id));
      const isOwned=owned.has(perk.id);
      const reqNames=req.map(id=>perkMap.get(id)?.name).filter(Boolean).join(", ");
      return '<article class="research-node '+(isOwned?"unlocked":"locked")+'">'+
        '<div class="section-code">'+esc(String(perk.category||"GENERAL").toUpperCase())+' // TIER '+esc(perk.tier)+'</div>'+
        '<h3>'+esc(perk.name)+'</h3>'+
        '<p>'+esc(perk.description||"Research advancement.")+'</p>'+
        (reqNames?'<div class="section-code">REQUIRES // '+esc(reqNames)+'</div>':'')+
        '<div class="split-actions research-node-actions"><strong>'+esc(fmt(perk.cost_points))+' RP</strong>'+
        (isOwned?'<span class="status-chip">UNLOCKED</span>':'<button class="hud-button secondary research-unlock" type="button" data-perk="'+esc(perk.id)+'" '+(missing.length?"disabled":"")+'>UNLOCK</button>')+
        '</div></article>';
    }).join("")+'</div>';

    root.querySelectorAll(".research-unlock:not([disabled])").forEach(button=>{
      button.addEventListener("click",async()=>{
        const state=$("researchState");
        try{
          state.textContent="UNLOCKING RESEARCH...";
          await GMAuth.api("rpc/unlock_research_perk",{method:"POST",body:JSON.stringify({p_perk_id:button.dataset.perk})});
          state.textContent="RESEARCH UNLOCKED.";
          await load();
        }catch(error){
          state.textContent="RESEARCH UNLOCK FAILED // "+error.message;
        }
      });
    });
  }

  async function load(){
    const uid=session.user.id;
    const [walletRows,types,facilities,clocks,perkRows,reqRows,ownedRows]=await Promise.all([
      GMAuth.api("player_research_wallets?user_id=eq."+encodeURIComponent(uid)+"&select=*"),
      GMAuth.api("facility_types?select=*"),
      GMAuth.api("facilities?owner_user_id=eq."+encodeURIComponent(uid)+"&select=*"),
      GMAuth.api("facility_production_clocks?select=*").catch(()=>[]),
      GMAuth.api("research_perks?player_visible=eq.true&is_active=eq.true&select=*&order=tier.asc,sort_order.asc,name.asc"),
      GMAuth.api("research_perk_prerequisites?select=*"),
      GMAuth.api("player_research_perks?user_id=eq."+encodeURIComponent(uid)+"&select=*")
    ]);

    const wallet=(walletRows||[])[0]||null;
    $("researchPoints").textContent=fmt(wallet?.points||0);
    $("researchLifetime").textContent=fmt(wallet?.lifetime_earned||0);

    perks=perkRows||[];
    prerequisites=reqRows||[];
    unlocked=ownedRows||[];
    renderSites(types,facilities,clocks);
    renderTree();
  }

  async function init(){
    session=await GMUI.initProtected();
    if(!session) return;
    try{
      await load();
      setInterval(updateCountdowns,1000);
      setInterval(()=>load().catch(()=>{}),30000);
    }catch(error){
      $("researchState").textContent="RESEARCH DATA ERROR // "+error.message;
    }
  }

  window.addEventListener("load",()=>init().catch(()=>{}));
})();
