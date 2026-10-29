(() => {
  "use strict";
  const picker=document.getElementById("gmSuiteContextPicker");
  const refresh=document.getElementById("gmSuiteContextRefresh");
  const status=document.getElementById("gmSuiteContextState");
  if(!picker || !window.GMContext)return;
  const showTab=id=>{
    document.querySelector('[data-tab-target="'+id+'"]')?.click();
    document.getElementById(id)?.scrollIntoView({block:"start",behavior:"smooth"});
  };
  GMContext.initialize("gmSuiteContext",(action,context)=>{
    switch(action.id){
      case "character": case "inspect":
        showTab(context.kind==="faction"?"suite-faction":
                context.kind==="facility"?"suite-economy":
                context.kind==="army"||context.kind==="fleet"?"suite-actions":"suite-characters");
        break;
      case "manage":case "economy":showTab("suite-economy");break;
      case "faction":showTab("suite-faction");break;
      case "social":showTab("suite-friends");break;
      case "fleet":case "military":location.href=GMAuth.siteHref("map/");break;
    }
  });
  const refreshObjects=async()=>{
    refresh.disabled=true;
    status.textContent="LOADING YOUR CONTEXTS...";
    try {
      const session=await GMAuth.getSession();
      if(!session?.user?.id){status.textContent="SIGN IN REQUIRED";return;}
      const uid=encodeURIComponent(session.user.id);
      const fetches=await Promise.allSettled([
        GMAuth.api("characters?user_id=eq."+uid+"&select=id,name"),
        GMAuth.api("facilities?owner_user_id=eq."+uid+"&select=id,name"),
        GMAuth.api("faction_memberships?user_id=eq."+uid+"&status=eq.active&select=faction_id"),
        GMAuth.api("armies?select=id,name,faction_id"),
        GMAuth.api("fleets?status=eq.active&select=id,name,faction_id")
      ]);
      const rows=fetches.map(x=>x.status==="fulfilled"&&Array.isArray(x.value)?x.value:[]);
      const options=[];
      rows[0].forEach(x=>options.push({kind:"character",id:x.id,name:x.name||"Character"}));
      rows[1].forEach(x=>options.push({kind:"facility",id:x.id,name:x.name||"Facility"}));
      const factionIds=new Set(rows[2].map(x=>x.faction_id).filter(Boolean));
      const factions=await Promise.allSettled([...factionIds].map(id=>
        GMAuth.api("factions?id=eq."+encodeURIComponent(id)+"&select=id,name")));
      factions.forEach((r,i)=>{
        if(r.status==="fulfilled")r.value.forEach(x=>options.push({kind:"faction",id:x.id,name:x.name||"Faction"}));
      });
      rows[3].filter(x=>factionIds.has(x.faction_id)).forEach(x=>options.push({kind:"army",id:x.id,name:x.name||"Army"}));
      rows[4].filter(x=>factionIds.has(x.faction_id)).forEach(x=>options.push({kind:"fleet",id:x.id,name:x.name||"Fleet"}));
      picker.replaceChildren(new Option("SELECT AN OBJECT",""));
      options.forEach(x=>{
        const opt=new Option(x.kind.toUpperCase()+" // "+x.name,x.kind+":"+x.id);
        picker.add(opt);
      });
      status.textContent=options.length?options.length+" OBJECTS READY":"NO PERSONAL OBJECTS FOUND";
      if(options.length){picker.selectedIndex=1;picker.dispatchEvent(new Event("change"));}
      else GMContext.select(null);
    }catch(error){status.textContent="OBJECT LIST UNAVAILABLE // "+error.message;}
    finally{refresh.disabled=false;}
  };
  picker.addEventListener("change",()=>{
    const value=picker.value;
    if(!value){GMContext.select(null);return;}
    const split=value.indexOf(":");
    const kind=value.slice(0,split),id=value.slice(split+1);
    GMContext.select(kind,null,id);
  });
  refresh.addEventListener("click",refreshObjects);
  document.addEventListener("gm:authenticated",refreshObjects,{once:true});
  if(document.readyState==="complete")refreshObjects();
  else window.addEventListener("load",refreshObjects,{once:true});
})();