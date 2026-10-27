/* Alpha 0.5.0 Phase 1: civilian contracts, careers, temporary parties.
 * All state-changing actions are validated by Supabase RPCs.
 */
(() => {
 const $=id=>document.getElementById(id);
 const list=$("civilianContractList"), active=$("civilianAssignmentList"), notice=$("civilianContractState");
 if(!list||!active||!notice)return;
 const partyInfo=$("civilianPartyInfo"),partyActions=$("civilianPartyActions"),invites=$("civilianPartyInvites");
 const reputation=$("civilianReputation"),filter=$("civilianCareerFilter");
 const esc=v=>GMUI.esc(String(v??""));
 const amt=v=>Number(v||0).toLocaleString(undefined,{maximumFractionDigits:2});
 const careers={economic:"ECONOMIC",political:"POLITICAL",exploration:"EXPLORATION"};
 let fetching=false,working=false,available=[],assignments=[],party=null,roster=[],directory=new Map(),worldHour=null,clockAnchor=0,clockSpeed=0;
 const myUser=()=>window.GMPlayerSuiteState?.session?.user?.id||null;
 const api=(functionName,params={})=>GMAuth.api("rpc/"+functionName,{method:"POST",body:JSON.stringify(params)});
 function feedback(msg,bad=false){notice.textContent=msg;notice.style.color=bad?"#d99582":"";}
 function currentWorldHour(){return worldHour==null?null:worldHour+Math.max(0,Date.now()-clockAnchor)/3600000*clockSpeed;}
 function clockLeft(due){if(due==null)return "NO EXPIRATION";const now=currentWorldHour();if(now==null)return "WORLD CLOCK LOADING";const left=Math.max(0,Math.ceil(Number(due)-now));return left+" GAME HOURS LEFT";}
 function labelFor(userId){return directory.get(userId)||"PLAYER "+String(userId).slice(0,8);}
 function completionLabel(c){if(c.objective_kind==="supply_system")return "DELIVER "+amt(c.objective_quantity)+" "+String(c.objective_resource_code||"").toUpperCase()+(c.location_ref?" TO "+c.location_ref:"");if(c.objective_kind==="political_activity")return "COMPLETE A NEW POLITICAL ACTIVITY";return "TRAVEL TO "+(c.location_ref||"DESIGNATED HEX");}
 function renderBoard(){
  const mine=new Set(assignments.filter(a=>a.status==="accepted"||a.status==="in_progress").map(a=>a.contract_id));
  const selected=filter?.value||"all";
  const shown=available.filter(c=>selected==="all"||c.career_path===selected);
  list.innerHTML=shown.length?shown.map(c=>{
   const taken=mine.has(c.id);
   const now=currentWorldHour();
   const cooldown=(assignments.filter(a=>a.contract_id===c.id&&a.status==="completed"&&a.accepted_world_hour!=null)
      .reduce((remaining,a)=>Math.max(remaining,Number(a.accepted_world_hour)+Number(c.cooldown_game_hours||36)-Number(now||0)),0));
   const groupSize=roster.length||1;
   const required=groupSize<c.min_party_size||groupSize>c.max_party_size;
   return '<article class="hud-panel compact" style="margin-bottom:12px">'+
    '<div class="section-head"><div><div class="section-code">'+esc(careers[c.career_path]||c.career_path)+' / DIFFICULTY '+esc(c.difficulty)+'/5</div>'+
    '<h3>'+esc(c.title)+'</h3></div></div><p class="hero-copy">'+esc(c.description)+'</p>'+
    '<div class="telemetry-stack">'+
    '<div class="telemetry-row"><span>Objective</span><strong>'+esc(completionLabel(c))+'</strong></div>'+
    '<div class="telemetry-row"><span>Required Team</span><strong>'+esc(c.min_party_size)+(c.max_party_size!==c.min_party_size?'–'+esc(c.max_party_size):'')+' PLAYERS</strong></div>'+
    '<div class="telemetry-row"><span>Reward Pool</span><strong>'+amt(c.reward_aureum)+' A / '+esc(c.reward_reputation)+' REP / '+esc(c.reward_research_points)+' RP</strong></div>'+
    '<div class="telemetry-row"><span>Deadline After Acceptance</span><strong>'+esc(c.duration_game_hours==null?"NONE":c.duration_game_hours+" GAME HOURS")+'</strong></div></div>'+
    '<div class="form-actions" style="margin-top:12px"><button class="hud-button secondary" type="button" data-contract-action="accept" data-id="'+esc(c.id)+'" '+
      ((taken||required||cooldown>0||working)?'disabled':'')+'>'+(taken?"ALREADY ACCEPTED":required?"PARTY SIZE REQUIRED":cooldown>0?"COOLDOWN "+Math.ceil(cooldown)+" GAME HRS":"ACCEPT CONTRACT")+'</button></div></article>';
  }).join(""):'<div class="empty-state">NO AVAILABLE CONTRACTS FOR THIS CAREER.</div>';

  active.innerHTML=assignments.length?assignments.map(a=>{
   const c=available.find(c=>c.id===a.contract_id);
   const inProgress=a.status==="accepted"||a.status==="in_progress";
   const supply=inProgress&&c?.objective_kind==="supply_system";
   return '<article class="hud-panel compact" style="margin-bottom:10px">'+
    '<div class="section-code">'+esc(String(a.status).replaceAll("_"," ").toUpperCase())+'</div>'+
    '<h3 style="margin:7px 0">'+esc(c?.title||"CONTRACT ASSIGNMENT")+'</h3>'+
    (inProgress?'<p><span data-civilian-deadline="'+esc(a.due_world_hour??'')+'">'+esc(clockLeft(a.due_world_hour))+'</span></p>':'')+
    (supply?'<form class="form-shell" data-contract-action="supply" data-id="'+esc(a.id)+'">'+
      '<div class="form-grid"><label><span>Supply Amount</span><input type="number" name="quantity" min="0.01" max="1000000" step="any" required></label>'+
      '<label><span>Source</span><select name="source"><option value="player">PERSONAL INVENTORY</option><option value="faction">FACTION INVENTORY</option></select></label></div>'+
      '<label><span>Resource</span><select name="resource"><option value="'+esc(c.objective_resource_code)+'">'+esc(String(c.objective_resource_code).toUpperCase())+'</option>'+
      (c.objective_resource_code==="energy"?'<option value="energy_cells">ENERGY CELLS (1:1)</option>':'')+
      '</select></label>'+
      '<button class="hud-button secondary" type="submit">DELIVER '+esc(c.objective_resource_code?.toUpperCase())+'</button></form>':'')+
    (inProgress?'<div class="form-actions" style="margin-top:10px"><button type="button" class="hud-button secondary" data-contract-action="claim" data-id="'+esc(a.id)+'">VERIFY &amp; CLAIM</button>'+
      '<button type="button" class="hud-button danger" data-contract-action="cancel" data-id="'+esc(a.id)+'">CANCEL</button></div>':'')+
    '</article>';
  }).join(""):'<div class="empty-state">NO CONTRACT ASSIGNMENTS YET.</div>';
 }
 function renderParties(mine,inv,friendships,reputationRows){
  const uid=myUser(),leader=party?.leader_user_id===uid;
  partyInfo.innerHTML=party?'<div class="telemetry-row"><span>PARTY STATUS</span><strong>ACTIVE / '+roster.length+'/3</strong></div>'+
   roster.map(m=>'<div class="telemetry-row"><span>'+esc(labelFor(m.user_id))+'</span><strong>'+(m.user_id===party.leader_user_id?"LEADER":"MEMBER")+'</strong></div>').join(""):'<div class="empty-state">NOT IN A PARTY.</div>';
  const friends=(friendships||[]).map(f=>f.user_a===uid?f.user_b:f.user_a)
   .filter(id=>id!==uid&&!roster.some(m=>m.user_id===id));
  partyActions.innerHTML=party?
   '<button class="hud-button secondary" type="button" data-party-action="leave">LEAVE PARTY</button>'+
   (leader&&roster.length<3?'<label><span>Invite a Friend</span><select id="civilianFriendTarget"><option value="">CHOOSE FRIEND</option>'+
     friends.map(id=>'<option value="'+esc(id)+'">'+esc(labelFor(id))+'</option>').join("")+
    '</select></label><button class="hud-button secondary" type="button" data-party-action="invite">INVITE FRIEND</button>':''):
   '<button class="hud-button" type="button" data-party-action="create">CREATE PARTY</button>';
  invites.innerHTML=(inv||[]).filter(i=>i.invited_user_id===uid&&i.status==="pending"&&Date.parse(i.expires_at)>Date.now()).map(i=>
   '<div class="hud-panel compact"><div class="section-code">PARTY INVITATION</div><p>From '+esc(labelFor(i.sender_user_id))+'</p>'+
   '<div class="form-actions"><button class="hud-button secondary" data-party-action="respond" data-accept="yes" data-id="'+esc(i.id)+'">ACCEPT</button>'+
   '<button class="hud-button secondary" data-party-action="respond" data-accept="no" data-id="'+esc(i.id)+'">DECLINE</button></div></div>').join("");
  const rep=reputationRows?.[0]||{};
  reputation.innerHTML=Object.keys(careers).map(k=>'<div class="telemetry-row"><span>'+careers[k]+'</span><strong>'+amt(rep[k]||0)+' REP</strong></div>').join("");
 }
 async function load(){
  const uid=myUser();if(!uid||fetching||working)return;fetching=true;
  try{
   const [cs,as,owned,ins,fs,rs,clk]=await Promise.all([
    GMAuth.api("civilian_contracts?select=*&status=eq.active&order=created_at.desc"),
    GMAuth.api("civilian_assignments?select=*&order=accepted_at.desc&limit=60"),
    GMAuth.api("civilian_party_members?user_id=eq."+encodeURIComponent(uid)+"&departed_at=is.null&select=party_id,user_id"),
    GMAuth.api("civilian_party_invites?select=*&order=created_at.desc&limit=40"),
    GMAuth.api("friendships?select=user_a,user_b&or=(user_a.eq."+uid+",user_b.eq."+uid+")").catch(()=>[]),
    GMAuth.api("civilian_reputation?user_id=eq."+uid+"&select=economic,political,exploration").catch(()=>[]),
    api("get_world_clock").catch(()=>null)
   ]);
   const state=window.GMPlayerSuiteState;
   directory=new Map((state?.directory||[]).map(p=>[p.user_id,p.display_name||p.user_id]));
   available=cs||[];assignments=as||[];worldHour=clk?.total_world_hours!=null?Number(clk.total_world_hours):null;clockAnchor=Date.now();clockSpeed=clk?.running?Number(clk?.speed||5):0;
   const partyId=owned?.[0]?.party_id;
   const [ps,ms]=partyId?await Promise.all([
    GMAuth.api("civilian_parties?id=eq."+partyId+"&select=*"),
    GMAuth.api("civilian_party_members?party_id=eq."+partyId+"&departed_at=is.null&select=*")
   ]):[[],[]];
   party=ps?.[0]||null;roster=ms||[];
   renderParties(owned,ins,fs,rs);
   renderBoard();feedback("");
  }catch(error){feedback("CIVILIAN NETWORK ERROR // "+(error.message||"PLEASE TRY AGAIN"),true);}
  finally{fetching=false;}
 }
 async function transact(promise,msg){
  if(working)return;working=true;feedback("SENDING REQUEST...");
  try{const result=await promise;feedback(msg+(result?.aureum_distributed!=null?" / "+amt(result.aureum_distributed)+" AUREUM DISTRIBUTED":""));working=false;await load();}
  catch(e){working=false;feedback("OPERATION FAILED // "+(e.message||"REQUEST FAILED"),true);renderBoard();}
 }
 list.addEventListener("click",e=>{
  const b=e.target.closest('[data-contract-action="accept"]');if(!b)return;
  transact(api("accept_civilian_contract",{p_contract_id:b.dataset.id}),"CONTRACT ACCEPTED");
 });
 active.addEventListener("click",e=>{
  const b=e.target.closest("[data-contract-action]");if(!b)return;
  if(b.dataset.contractAction==="claim")transact(api("claim_civilian_assignment",{p_assignment_id:b.dataset.id}),"CONTRACT COMPLETED");
  if(b.dataset.contractAction==="cancel"&&confirm("Cancel this assignment for your entire party?"))
   transact(api("cancel_civilian_assignment",{p_assignment_id:b.dataset.id}),"ASSIGNMENT CANCELLED");
 });
 active.addEventListener("submit",e=>{
  const form=e.target.closest('form[data-contract-action="supply"]');if(!form)return;
  e.preventDefault();
  const a=assignments.find(a=>a.id===form.dataset.id),c=available.find(c=>c.id===a?.contract_id);
  if(!c)return feedback("CONTRACT UNAVAILABLE",true);
  const values=new FormData(form);
  transact(api("supply_civilian_system",{p_location_ref:c.location_ref,p_resource:values.get("resource"),
   p_quantity:Number(values.get("quantity")),p_source:values.get("source"),p_assignment_id:a.id}),"SUPPLIES DELIVERED");
 });
 partyActions.addEventListener("click",e=>{
  const b=e.target.closest("[data-party-action]");if(!b)return;
  if(b.dataset.partyAction==="create")transact(api("create_civilian_party"),"PARTY CREATED");
  if(b.dataset.partyAction==="leave"&&party)transact(api("leave_civilian_party",{p_party_id:party.id}),"LEFT PARTY");
  if(b.dataset.partyAction==="invite"&&party){
   const id=$("civilianFriendTarget")?.value;
   if(!id)return feedback("CHOOSE A FRIEND",true);
   transact(api("invite_civilian_party",{p_party_id:party.id,p_user_id:id}),"FRIEND INVITED");
  }
 });
 invites.addEventListener("click",e=>{
  const b=e.target.closest('[data-party-action="respond"]');if(!b)return;
  transact(api("respond_civilian_party_invite",{p_invite_id:b.dataset.id,p_accept:b.dataset.accept==="yes"}),"INVITATION UPDATED");
 });
 filter?.addEventListener("change",renderBoard);
 setInterval(()=>{document.querySelectorAll("[data-civilian-deadline]").forEach(node=>{
   const due=node.dataset.civilianDeadline;
   node.textContent=clockLeft(due===""?null:Number(due));
 });},1000);
 document.addEventListener("gm:player-state",load);
 if(window.GMPlayerSuiteState)load();
})();
