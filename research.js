(() => {
  const $=id=>document.getElementById(id);
  const esc=value=>GMUI.esc(value);
  const fmt=value=>Number(value||0).toLocaleString(undefined,{maximumFractionDigits:2});
  let session=null;
  let perks=[];
  let prerequisites=[];
  let unlocked=[];
  let researchBalance=0;

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
      const perDay=Math.max(0,Number(type?.output_per_cycle||1));
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
      const perDay=Math.max(0,Number(type?.output_per_cycle||1))*Number(row.production_modifier??1)*healthMultiplier(row);
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

  function drawResearchConnections(){
    const stage=document.getElementById("researchNetworkStage");
    const svg=document.getElementById("researchConnections");
    if(!stage||!svg) return;

    const stageRect=stage.getBoundingClientRect();
    const width=Math.max(1,stage.clientWidth);
    const height=Math.max(1,stage.clientHeight);
    svg.setAttribute("viewBox","0 0 "+width+" "+height);

    const owned=new Set(unlocked.map(row=>row.perk_id));
    const lines=prerequisites.map(link=>{
      const source=stage.querySelector('[data-perk-id="'+CSS.escape(link.prerequisite_perk_id)+'"]');
      const target=stage.querySelector('[data-perk-id="'+CSS.escape(link.perk_id)+'"]');
      if(!source||!target) return "";

      const a=source.getBoundingClientRect();
      const b=target.getBoundingClientRect();
      const x1=a.right-stageRect.left;
      const y1=a.top-stageRect.top+a.height/2;
      const x2=b.left-stageRect.left;
      const y2=b.top-stageRect.top+b.height/2;
      const bend=Math.max(36,(x2-x1)*0.48);
      const className=owned.has(link.prerequisite_perk_id)?"research-link active":"research-link";
      return '<path class="'+className+'" d="M '+x1+' '+y1+' C '+(x1+bend)+' '+y1+', '+(x2-bend)+' '+y2+', '+x2+' '+y2+'"></path>';
    }).join("");

    svg.innerHTML='<defs><marker id="researchArrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 z"></path></marker></defs>'+lines;
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

    const nodes=perks.map(perk=>{
      const req=requirements.get(perk.id)||[];
      const missing=req.filter(id=>!owned.has(id));
      const isOwned=owned.has(perk.id);
      const cost=Number(perk.cost_points||0);
      const affordable=researchBalance>=cost;
      const available=!isOwned&&!missing.length;
      const state=isOwned?"unlocked":missing.length?"locked":affordable?"available":"underfunded";
      const status=isOwned?"UNLOCKED":missing.length?"LOCKED":affordable?"AVAILABLE":"INSUFFICIENT RP";
      const reqNames=req.map(id=>perkMap.get(id)?.name).filter(Boolean);
      const missingNames=missing.map(id=>perkMap.get(id)?.name).filter(Boolean);
      const col=Math.max(1,Math.min(3,Number(perk.position_x||0)+1));
      const row=Math.max(1,Math.min(5,Number(perk.position_y||0)+1));
      const initials=String(perk.name||"RP").split(/\s+/).map(part=>part[0]).join("").slice(0,3).toUpperCase();
      let action='';
      if(isOwned){
        action='<span class="status-chip research-node-status">UNLOCKED</span>';
      }else if(missing.length){
        action='<button class="hud-button secondary research-unlock" type="button" disabled>LOCKED</button>';
      }else if(!affordable){
        action='<button class="hud-button secondary research-unlock" type="button" disabled>NEED '+esc(fmt(cost-researchBalance))+' RP</button>';
      }else{
        action='<button class="hud-button secondary research-unlock" type="button" data-perk="'+esc(perk.id)+'">UNLOCK</button>';
      }

      return '<article class="research-node '+state+'" data-perk-id="'+esc(perk.id)+'" style="grid-column:'+col+';grid-row:'+row+'">'+
        '<div class="research-node-head"><span class="research-node-icon">'+esc(initials)+'</span><div><div class="section-code">'+esc(String(perk.category||"GENERAL").toUpperCase())+' // TIER '+esc(perk.tier)+'</div><h3>'+esc(perk.name)+'</h3></div></div>'+
        '<p>'+esc(perk.description||"Research advancement.")+'</p>'+
        (reqNames.length?'<div class="research-node-requires">REQUIRES // '+esc(reqNames.join(" + "))+'</div>':'<div class="research-node-requires open">ENTRY RESEARCH</div>')+
        (missingNames.length?'<div class="research-node-missing">MISSING // '+esc(missingNames.join(" + "))+'</div>':'')+
        '<div class="research-node-footer"><strong>'+esc(fmt(cost))+' RP</strong><span class="research-node-state">'+esc(status)+'</span>'+action+'</div>'+
        '</article>';
    }).join("");

    root.innerHTML=
      '<div class="research-network-legend"><span><i class="legend-dot unlocked"></i>UNLOCKED</span><span><i class="legend-dot available"></i>AVAILABLE</span><span><i class="legend-dot locked"></i>LOCKED</span><strong>'+esc(fmt(researchBalance))+' RP AVAILABLE</strong></div>'+
      '<div class="research-network-scroll">'+
        '<div class="research-network">'+
          '<div class="research-tier-headings"><span>TIER 1 // FOUNDATIONS</span><span>TIER 2 // SPECIALIZATION</span><span>TIER 3 // CAPSTONES</span></div>'+
          '<div class="research-network-stage" id="researchNetworkStage">'+
            '<svg class="research-connections" id="researchConnections" aria-hidden="true"></svg>'+
            '<div class="research-node-grid">'+nodes+'</div>'+
          '</div>'+
        '</div>'+
      '</div>';

    root.querySelectorAll(".research-unlock[data-perk]").forEach(button=>{
      button.addEventListener("click",async()=>{
        const perk=perkMap.get(button.dataset.perk);
        if(!perk) return;
        const cost=Number(perk.cost_points||0);
        const confirmed=await GMUI.confirmAction(
          "Unlock "+perk.name+" for "+fmt(cost)+" RP? Research Point spending is permanent.",
          {code:"RESEARCH / UNLOCK",title:"Authorize Research",confirmText:"UNLOCK PERK"}
        );
        if(!confirmed) return;

        const state=$("researchState");
        try{
          button.disabled=true;
          state.textContent="UNLOCKING RESEARCH...";
          await GMAuth.api("rpc/unlock_research_perk",{method:"POST",body:JSON.stringify({p_perk_id:button.dataset.perk})});
          state.textContent="RESEARCH UNLOCKED // "+String(perk.name||"PERK").toUpperCase();
          await load();
        }catch(error){
          state.textContent="RESEARCH UNLOCK FAILED // "+error.message;
          button.disabled=false;
        }
      });
    });

    requestAnimationFrame(drawResearchConnections);
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
    researchBalance=Number(wallet?.points||0);
    $("researchPoints").textContent=fmt(researchBalance);
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
      window.addEventListener("resize",()=>requestAnimationFrame(drawResearchConnections));
    }catch(error){
      $("researchState").textContent="RESEARCH DATA ERROR // "+error.message;
    }
  }

  window.addEventListener("load",()=>init().catch(()=>{}));
})();