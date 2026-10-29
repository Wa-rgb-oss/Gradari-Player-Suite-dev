(() => {
  "use strict";
  const $=id=>document.getElementById(id);
  const locationRef=$("selectedHexRef");
  const form=$("gmRecruitForm");
  if(!form||!locationRef)return;
  const mode=$("gmRecruitMode"), army=$("gmRecruitArmy"),name=$("gmRecruitName");
  const count=$("gmRecruitCount"), cost=$("gmRecruitCost"),status=$("gmRecruitStatus");
  const civilians=$("gmRecruitCivilians"),military=$("gmRecruitMilitary"), treasury=$("gmRecruitTreasury");
  const units=$("gmRecruitUnitList");
  const clean=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  let request=0,context=null,roster=[];
  function render(){
    const n=Number(count.value)||0;
    cost.textContent=(n*25).toLocaleString()+" A";
    name.closest("label").hidden=mode.value==="reinforce";
    army.closest("label").hidden=mode.value!=="reinforce";
    const enough=context&&Number(context.pop)>=n+100&&n>=10&&n<=5000&&
      Number(context.mil)+n<=Math.floor((Number(context.pop)+Number(context.mil))*.2);
    const funded=context&&Number(context.treasury)>=n*25;
    form.querySelector('button[type="submit"]').disabled=!enough||!funded||!context?.authorized||
      (mode.value==="reinforce"&&!army.value);
  }
  const refresh=async()=>{
    const ref=locationRef.textContent.trim();
    const id=++request;
    context=null;roster=[];form.querySelector('button[type="submit"]').disabled=true;
    civilians.textContent=military.textContent=treasury.textContent="--";
    units.textContent="SELECT A FACTION-OWNED DEVELOPED SYSTEM.";
    if(!/^HEX_-?\d+_-?\d+$/.test(ref))return;
    try {
      const key=encodeURIComponent(ref);
      const [systems,territories,armies]=await Promise.all([
        GMAuth.api("system_economies?location_ref=eq."+key+"&select=location_ref,population,military_population"),
        GMAuth.api("territories?location_ref=eq."+key+"&select=faction_id"),
        GMAuth.api("armies?location_ref=eq."+key+"&select=id,name,faction_id,strength,status,movement_status")
      ]);
      if(request!==id)return;
      if(!systems[0]||!territories[0]?.faction_id){
        units.textContent="NO DEVELOPED FACTION SYSTEM AT THIS LOCATION.";return;
      }
      const factionId=territories[0].faction_id;
      const [factions,memberships]=await Promise.all([
        GMAuth.api("factions?id=eq."+encodeURIComponent(factionId)+"&select=id,name,treasury,leader_user_id"),
        GMAuth.api("faction_memberships?faction_id=eq."+encodeURIComponent(factionId)+"&status=eq.active&select=user_id,permissions")
      ]);
      if(request!==id)return;
      const faction=factions[0];
      const sess=await GMAuth.getSession();
      const uid=sess?.user?.id;
      const member=memberships.find(x=>x.user_id===uid);
      const permitted=faction?.leader_user_id===uid||member?.permissions?.includes("military")||
        member?.permissions?.includes("all");
      context={ref,pop:systems[0].population,mil:systems[0].military_population,
        treasury:faction?.treasury??0,authorized:Boolean(permitted)};
      civilians.textContent=Number(context.pop).toLocaleString();
      military.textContent=Number(context.mil).toLocaleString();
      treasury.textContent=Number(context.treasury).toLocaleString()+" A";
      roster=armies.filter(a=>a.faction_id===factionId&&a.status==="active");
      army.replaceChildren(new Option("SELECT ARMY",""));
      roster.filter(a=>a.movement_status==="stationary").forEach(a=>army.add(new Option(a.name+" // "+a.strength,a.id)));
      units.innerHTML=roster.length?roster.map(a=>'<div class="telemetry-row"><span>'+clean(a.name)+'</span><strong>'+Number(a.strength).toLocaleString()+' PERSONNEL</strong></div>').join(""):
        '<div class="empty-state">NO FACTION ARMIES STATIONED HERE.</div>';
      status.textContent=permitted?"RECRUITMENT AUTHORIZED // "+faction.name:
        "MILITARY AUTHORITY REQUIRED TO RECRUIT AT THIS SYSTEM.";
      render();
    }catch(error){if(request===id)status.textContent="RECRUITMENT DATA UNAVAILABLE // "+error.message;}
  };
  form.addEventListener("submit",async event=>{
    event.preventDefault();
    if(!context?.authorized||form.querySelector('button[type="submit"]').disabled)return;
    const n=Number(count.value),reinforce=mode.value==="reinforce";
    if(!Number.isInteger(n)||n<10||n>5000)return;
    const label=reinforce?"reinforce the selected army":"form a new army";
    if(!confirm("Spend "+(n*25).toLocaleString()+" Aureum and enlist "+n+" civilians to "+label+"?"))return;
    const button=form.querySelector('button[type="submit"]');
    button.disabled=true;
    status.textContent="PROCESSING RECRUITMENT...";
    try {
      const result=await GMAuth.api("rpc/recruit_faction_army",{
        method:"POST",body:JSON.stringify({
          p_location_ref:context.ref,p_personnel:n,
          p_army_name:reinforce?null:name.value.trim(),
          p_reinforce_army_id:reinforce?army.value:null
        })
      });
      status.textContent="RECRUITMENT COMPLETE // "+result.personnel+" ENLISTED // "+Number(result.cost).toLocaleString()+" AUREUM";
      await refresh();
      status.textContent="RECRUITMENT COMPLETE // "+result.personnel+" ENLISTED // "+Number(result.cost).toLocaleString()+" AUREUM. REFRESH THE MAP TO LOAD NEW ARMY ORDERS.";
    }catch(error){status.textContent="RECRUITMENT FAILED // "+error.message;render();}
  });
  [mode,count,army,name].forEach(el=>el.addEventListener("input",render));
  new MutationObserver(refresh).observe(locationRef,{childList:true,characterData:true,subtree:true});
  refresh();
})();