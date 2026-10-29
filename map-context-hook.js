(() => {
  "use strict";
  const ref = document.getElementById("selectedHexRef");
  if(!ref || !window.GMContext)return;
  const openTab = name => {
    document.querySelector('[data-map-tab="'+name+'"]')?.click();
    document.querySelector(".map-command-panel")?.scrollIntoView({block:"nearest",behavior:"smooth"});
  };
  GMContext.initialize("gmMapContext",(action,context)=>{
    switch(action.id){
      case "travel":openTab("map-tab-character");document.getElementById("mapTravelBtn")?.focus();break;
      case "build":openTab("map-tab-build");document.getElementById("mapFacilityType")?.focus();break;
      case "military":openTab("map-tab-military");document.getElementById("mapArmySelect")?.focus();break;
      case "inspect":
        if(context.kind==="hex"){openTab("map-tab-location");break;}
        if(context.kind==="facility"){location.href=GMAuth.siteHref("player-suite/#economy");break;}
        if(context.kind==="army"){openTab("map-tab-military");break;}
        if(context.kind==="faction"){location.href=GMAuth.siteHref("player-suite/#faction");break;}
        break;
      case "facilities":openTab("map-tab-location");document.getElementById("selectedFacilityList")?.scrollIntoView({block:"nearest"});break;
      case "manage":case "economy":location.href=GMAuth.siteHref("player-suite/#economy");break;
      case "faction":location.href=GMAuth.siteHref("player-suite/#faction");break;
      case "character":location.href=GMAuth.siteHref("player-suite/#characters");break;
      case "social":location.href=GMAuth.siteHref("player-suite/#friends");break;
      case "market":location.href=GMAuth.siteHref("exchange-markets/");break;
      case "politics":location.href=GMAuth.siteHref("politics/");break;
    }
  });
  let prev="";
  const select=()=>{
    const value=ref.textContent.trim();
    if(prev===value)return;
    prev=value;
    GMContext.select(/^HEX_-?\d+_-?\d+$/.test(value)?"hex":null,value);
  };
  new MutationObserver(select).observe(ref,{childList:true,subtree:true,characterData:true});
  select();
})();