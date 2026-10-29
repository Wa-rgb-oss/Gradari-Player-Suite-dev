(() => {
  "use strict";
  const hex=document.getElementById("selectedHexRef");
  const panel=document.querySelector("#gmMapContext")?.closest(".gm-context-panel");
  if(!hex||!panel||!window.GMContext)return;
  const header=document.createElement("div");
  header.className="gm-context-object-switch";
  header.innerHTML='<label><span>CONTEXT TARGET</span><select id="gmMapContextTarget"><option value="">SELECT A HEX</option></select></label>';
  panel.insertBefore(header,document.getElementById("gmMapContext"));
  const picker=header.querySelector("select");
  let requestId=0;
  const load=async()=>{
    const current=hex.textContent.trim();
    const id=++requestId;
    picker.replaceChildren(new Option(current && current!=="--"?"HEX // "+current:"SELECT A HEX",current?"hex:"+current:""));
    if(!/^HEX_-?\d+_-?\d+$/.test(current))return;
    try{
      const term=encodeURIComponent(current);
      const [fac,arm,ter]=await Promise.allSettled([
        GMAuth.api("facilities?location_ref=eq."+term+"&select=id,name"),
        GMAuth.api("armies?location_ref=eq."+term+"&select=id,name"),
        GMAuth.api("territories?location_ref=eq."+term+"&select=faction_id")
      ]);
      if(id!==requestId)return;
      const facilities=fac.status==="fulfilled"?fac.value:[];
      const armies=arm.status==="fulfilled"?arm.value:[];
      const territories=ter.status==="fulfilled"?ter.value:[];
      const targets=[
        ...facilities.map(x=>({kind:"facility",id:x.id,name:x.name||"Facility"})),
        ...armies.map(x=>({kind:"army",id:x.id,name:x.name||"Army"}))
      ];
      const factionId=territories[0]?.faction_id;
      if(factionId)targets.push({kind:"faction",id:factionId,name:"Controlling Faction"});
      targets.forEach(item=>picker.add(new Option(item.kind.toUpperCase()+" // "+item.name,item.kind+":"+item.id)));
    }catch(error){console.warn("Context object listing failed",error);}
  };
  picker.addEventListener("change",()=>{
    const val=picker.value;
    if(!val)return;
    const sep=val.indexOf(":");
    const kind=val.slice(0,sep),id=val.slice(sep+1);
    GMContext.select(kind,kind==="hex"?id:null,kind==="hex"?null:id);
  });
  new MutationObserver(load).observe(hex,{subtree:true,childList:true,characterData:true});
  load();
})();