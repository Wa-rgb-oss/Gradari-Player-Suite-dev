(() => {
let session=null,state=null;
const stationUI=new Map();
const $=id=>document.getElementById(id);
const esc=v=>GMUI.esc(v);
const fmt=v=>Number(v||0).toLocaleString(undefined,{maximumFractionDigits:2});
const rpc=(name,args={})=>GMAuth.api("rpc/"+name,{method:"POST",body:JSON.stringify(args)});

function render(){
  const root=$("marketList");
  const cards=[];
  const names=new Map((state.resourceCatalog||[]).map(x=>[x.code,x]));
  (state.tradeStations||[]).forEach(station=>{
    const ui=stationUI.get(station.market_id)||{collapsed:false,sort:"name"};
    stationUI.set(station.market_id,ui);
    const resources=(state.tradeStationResources||[]).filter(x=>x.market_id===station.market_id).sort((a,b)=>{
      if(ui.sort==="price-low") return Number(a.buy_price)-Number(b.buy_price);
      if(ui.sort==="price-high") return Number(b.buy_price)-Number(a.buy_price);
      return String(names.get(a.resource_code)?.name||a.resource_code).localeCompare(String(names.get(b.resource_code)?.name||b.resource_code));
    });
    cards.push(`<article class="notice exchange-station-card" data-station="${esc(station.market_id)}"><div class="split-actions exchange-station-head"><div><strong style="color:var(--text)">${esc(station.station_name)}</strong><div class="section-code">GUILDED CONCORD TRADE STATION // ${esc(station.location_ref)}</div></div><div class="exchange-station-tools"><label class="exchange-sort-label">SORT <select class="exchange-sort"><option value="name" ${ui.sort==="name"?"selected":""}>NAME</option><option value="price-low" ${ui.sort==="price-low"?"selected":""}>PRICE: LOW → HIGH</option><option value="price-high" ${ui.sort==="price-high"?"selected":""}>PRICE: HIGH → LOW</option></select></label><button class="hud-button secondary exchange-collapse" type="button" aria-expanded="${!ui.collapsed}">${ui.collapsed?"EXPAND":"COLLAPSE"}</button></div></div><div class="resource-list exchange-station-body" style="margin-top:10px" ${ui.collapsed?"hidden":""}>${resources.map(row=>{
      const resource=names.get(row.resource_code);
      const owned=Number((state.playerResources||[]).find(x=>x.resource_code===row.resource_code)?.quantity||0);
      const avg=Number(row.market_value??((Number(row.buy_price)+Number(row.sell_price))/2));
      const priceClass=value=>Number(value)>avg+.005?"market-price-high":Number(value)<avg-.005?"market-price-low":"market-price-neutral";
      return `<div class="resource-row station-resource-row" data-market="${esc(row.market_id)}" data-resource="${esc(row.resource_code)}"><div><strong>${esc(resource?.name||row.resource_code)}</strong><div class="section-code">${esc(String(resource?.category||"resource").toUpperCase())} // MARKET STOCK: ${row.stock==null?"UNLIMITED":esc(fmt(row.stock))} // AVAILABLE TO SELL: ${esc(fmt(owned))}</div></div><div style="display:flex;gap:7px;align-items:center;justify-content:flex-end;flex-wrap:wrap"><span class="market-price-neutral">AVG ${esc(fmt(avg))} A</span><span class="${priceClass(row.buy_price)}">BUY ${esc(fmt(row.buy_price))} A</span><span class="${priceClass(row.sell_price)}">SELL ${esc(fmt(row.sell_price))} A</span><input class="station-resource-qty" type="number" min="0.01" step="0.01" value="1" style="width:82px"><button class="hud-button secondary station-resource-buy" type="button">BUY</button><button class="hud-button secondary station-resource-sell" type="button">SELL</button></div></div>`;
    }).join("")||'<div class="empty-state">NO CURRENT LISTINGS.</div>'}</div></article>`);
  });
  root.innerHTML=cards.join("");
  $("marketEmpty").hidden=cards.length>0;
  root.querySelectorAll(".exchange-collapse").forEach(button=>button.addEventListener("click",()=>{
    const card=button.closest(".exchange-station-card"),ui=stationUI.get(card.dataset.station);
    ui.collapsed=!ui.collapsed; render();
  }));
  root.querySelectorAll(".exchange-sort").forEach(select=>select.addEventListener("change",()=>{
    const card=select.closest(".exchange-station-card"),ui=stationUI.get(card.dataset.station);
    ui.sort=select.value; render();
  }));
  root.querySelectorAll(".station-resource-buy,.station-resource-sell").forEach(button=>button.addEventListener("click",async()=>{
    const row=button.closest(".station-resource-row"),qty=Number(row.querySelector(".station-resource-qty").value||0),direction=button.classList.contains("station-resource-buy")?"buy":"sell";
    try{
      const result=await rpc("trade_station_resource",{p_market_id:row.dataset.market,p_resource_code:row.dataset.resource,p_quantity:qty,p_direction:direction});
      GMUI.setState($("marketState"),direction.toUpperCase()+" COMPLETE // "+fmt(result.value)+" AUREUM","success");
      await load();
    }catch(error){GMUI.setState($("marketState"),"TRADE FAILED // "+error.message,"error")}
  }));
}
async function load(){
  const uid=encodeURIComponent(session.user.id);
  const [memberships,resources,stations,listings,playerResources]=await Promise.all([
    GMAuth.api("faction_memberships?user_id=eq."+uid+"&select=*&order=created_at.asc"),
    GMAuth.api("resource_catalog?player_visible=eq.true&select=*&order=category.asc,name.asc"),
    GMAuth.api("trade_station_markets?player_visible=eq.true&select=*&order=station_name.asc"),
    (async()=>{try{await rpc("normalize_trade_station_market",{});}catch{} return GMAuth.api("trade_station_resource_listings?select=*&order=resource_code.asc");})(),
    GMAuth.api("player_resources?user_id=eq."+uid+"&select=*&order=resource_code.asc")
  ]);
  const primaryMembership=(memberships||[]).find(row=>row.status==="active")||(memberships||[])[0]||null;
  let factionResources=[];
  if(primaryMembership?.faction_id){
    factionResources=await GMAuth.api("faction_resources?faction_id=eq."+encodeURIComponent(primaryMembership.faction_id)+"&select=*&order=resource_code.asc");
  }
  state={primaryMembership,resourceCatalog:resources||[],playerResources:playerResources||[],factionResources:factionResources||[],tradeStations:stations||[],tradeStationResources:listings||[]};
  render();
}
async function init(){session=await GMUI.initProtected();if(!session)return;await load();}
init().catch(error=>{const el=$("marketState");if(el)GMUI.setState(el,"EXCHANGE LOAD FAILED // "+error.message,"error");});
})();